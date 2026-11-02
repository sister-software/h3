//! Cell set outlines.
//!
//! Translated from H3 C `cellsToMultiPoly.c` and the `GeoMultiPolygon` to `LinkedGeoPolygon`
//! conversion in `linkedGeo.c` (Apache-2.0, Copyright Uber Technologies, Inc.). The C arc set uses
//! pointers for its doubly linked loops and union-find parents; here they are indices into one
//! arc vector, with the same hashing, traversal, and union-by-rank order.

use crate::LatLng;
use crate::area::geo_loop_area_rads2;
use crate::constants::*;
use crate::edge::{directed_edge_to_boundary, origin_to_directed_edges, reverse_directed_edge};
use crate::errors::{H3Error, H3Result};
use crate::index::*;
use crate::polygon::GeoPolygon;

const HASH_TABLE_MULTIPLIER: i64 = 10;

/// Approximate size of a C `Arc` (used for the C overflow check and workspace accounting).
pub(crate) const ARC_BYTES: u64 = 48;

/// C `checkCellsToMultiPolyOverflow` for a 32-bit `size_t` (the WASM target) or 64-bit host.
fn check_overflow(num_cells: i64) -> H3Result<()> {
    let arcs_per_cell = 6 * ARC_BYTES;
    let buckets_per_cell = 6 * HASH_TABLE_MULTIPLIER as u64 * core::mem::size_of::<usize>() as u64;
    let max = arcs_per_cell.max(buckets_per_cell);
    if num_cells > 0 && num_cells as u64 > (usize::MAX as u64) / max {
        return Err(H3Error::MemoryBounds);
    }
    Ok(())
}

/// C `validateCellSet`.
fn validate_cell_set(cells: &[u64]) -> H3Result<()> {
    if cells.is_empty() {
        return Ok(());
    }
    let res = get_resolution(cells[0]);
    for &c in cells {
        if !is_valid_cell(c) {
            return Err(H3Error::CellInvalid);
        }
        if get_resolution(c) != res {
            return Err(H3Error::ResMismatch);
        }
    }
    if cells.len() >= 2 {
        let mut sorted = cells.to_vec();
        sorted.sort_unstable();
        if sorted.windows(2).any(|w| w[0] == w[1]) {
            return Err(H3Error::DuplicateInput);
        }
    }
    Ok(())
}

/// C `hashEdge` (SplitMix64 finalizer).
#[inline]
fn hash_edge(mut x: u64, n: u64) -> u64 {
    x ^= x >> 30;
    x = x.wrapping_mul(0xbf58476d1ce4e5b9);
    x ^= x >> 27;
    x = x.wrapping_mul(0x94d049bb133111eb);
    x ^= x >> 31;
    x % n
}

#[derive(Clone, Copy)]
struct Arc {
    id: u64,
    visited: bool,
    removed: bool,
    next: usize,
    prev: usize,
    parent: usize,
    rank: i64,
}

struct ArcSet {
    arcs: Vec<Arc>,
    buckets: Vec<Option<usize>>,
}

impl ArcSet {
    /// C `createArcSet` (with `cellToEdgeArcs`).
    fn new(cells: &[u64]) -> H3Result<ArcSet> {
        let num_arcs: usize = cells.iter().map(|&c| if is_pentagon(c) { 5 } else { 6 }).sum();
        let num_buckets = num_arcs * HASH_TABLE_MULTIPLIER as usize;
        let mut arcs: Vec<Arc> = Vec::new();
        arcs.try_reserve_exact(num_arcs).map_err(|_| H3Error::MemoryAlloc)?;
        let mut buckets: Vec<Option<usize>> = Vec::new();
        buckets.try_reserve_exact(num_buckets).map_err(|_| H3Error::MemoryAlloc)?;
        buckets.resize(num_buckets, None);

        const IDXH: [usize; 6] = [0, 4, 3, 5, 1, 2];
        const IDXP: [usize; 5] = [0, 1, 3, 2, 4];
        for &h in cells {
            let all = origin_to_directed_edges(h);
            let (edges, idx): (&[u64], &[usize]) = if all[0] == 0 { (&all[1..], &IDXP) } else { (&all[..], &IDXH) };
            let base = arcs.len();
            let n = edges.len();
            for &id in edges {
                arcs.push(Arc { id, visited: false, removed: false, next: 0, prev: 0, parent: base, rank: 1 });
            }
            for i in 0..n {
                let cur = idx[i];
                let prev = idx[(i + n - 1) % n];
                let next = idx[(i + 1) % n];
                arcs[base + cur].prev = base + prev;
                arcs[base + cur].next = base + next;
            }
        }
        for (i, arc) in arcs.iter().enumerate() {
            let mut j = hash_edge(arc.id, num_buckets as u64) as usize;
            while buckets[j].is_some() {
                j = (j + 1) % num_buckets;
            }
            buckets[j] = Some(i);
        }
        Ok(ArcSet { arcs, buckets })
    }

    /// C `findArc`.
    fn find(&self, e: u64) -> Option<usize> {
        let n = self.buckets.len();
        let mut j = hash_edge(e, n as u64) as usize;
        while let Some(a) = self.buckets[j] {
            if self.arcs[a].id == e {
                return Some(a);
            }
            j = (j + 1) % n;
        }
        None
    }

    /// C `getRoot`, with the same path compression.
    fn root(&mut self, a: usize) -> usize {
        let mut r = a;
        while self.arcs[r].parent != r {
            r = self.arcs[r].parent;
        }
        let mut x = a;
        while self.arcs[x].parent != r {
            let next = self.arcs[x].parent;
            self.arcs[x].parent = r;
            x = next;
        }
        r
    }

    /// C `unionArcs`.
    fn union(&mut self, a: usize, b: usize) {
        let mut a = self.root(a);
        let mut b = self.root(b);
        if self.arcs[a].rank < self.arcs[b].rank {
            core::mem::swap(&mut a, &mut b);
        }
        if a != b {
            self.arcs[a].rank += self.arcs[b].rank;
            self.arcs[b].parent = a;
        }
    }

    /// C `cancelArcPairs`.
    fn cancel_pairs(&mut self) -> H3Result<()> {
        for i in 0..self.arcs.len() {
            if self.arcs[i].removed {
                continue;
            }
            let rev = reverse_directed_edge(self.arcs[i].id)?;
            let Some(b) = self.find(rev) else { continue };
            let a = i;
            self.arcs[a].removed = true;
            self.arcs[b].removed = true;
            // Four sequential C statements; each reads links that an earlier one may have changed
            // (e.g. when `a.next == b`), so every statement re-reads its operands.
            let (x, v) = (self.arcs[a].next, self.arcs[b].prev);
            self.arcs[x].prev = v; // a->next->prev = b->prev
            let (x, v) = (self.arcs[a].prev, self.arcs[b].next);
            self.arcs[x].next = v; // a->prev->next = b->next
            let (x, v) = (self.arcs[b].next, self.arcs[a].prev);
            self.arcs[x].prev = v; // b->next->prev = a->prev
            let (x, v) = (self.arcs[b].prev, self.arcs[a].next);
            self.arcs[x].next = v; // b->prev->next = a->next
            self.union(a, b);
        }
        Ok(())
    }
}

struct SortableLoop {
    root: u64,
    area: f64,
    verts: Vec<LatLng>,
}

/// C `createSortableLoop`.
fn sortable_loop(set: &mut ArcSet, start_arc: usize) -> H3Result<SortableLoop> {
    let start = set.arcs[start_arc].id;
    let mut verts = Vec::new();
    let mut arc = start_arc;
    loop {
        let gb = directed_edge_to_boundary(set.arcs[arc].id)?;
        verts.extend_from_slice(&gb[..gb.len().saturating_sub(1)]);
        set.arcs[arc].visited = true;
        arc = set.arcs[arc].next;
        if set.arcs[arc].id == start {
            break;
        }
    }
    let root = set.root(arc);
    let area = geo_loop_area_rads2(&verts);
    Ok(SortableLoop { root: set.arcs[root].id, area, verts })
}

/// Total-order comparators matching C `cmp_SortableLoop` / `cmp_SortablePoly` for non-NaN areas.
fn cmp_area(a: f64, b: f64) -> core::cmp::Ordering {
    if a < b {
        core::cmp::Ordering::Less
    } else if a > b {
        core::cmp::Ordering::Greater
    } else {
        core::cmp::Ordering::Equal
    }
}

/// C `createGlobeMultiPolygon`.
fn globe() -> Vec<GeoPolygon> {
    let z = 0.0;
    let tris: [[(f64, f64); 3]; 8] = [
        [(M_PI_2, z), (z, z), (z, M_PI_2)],
        [(M_PI_2, z), (z, M_PI_2), (z, M_PI)],
        [(M_PI_2, z), (z, M_PI), (z, -M_PI_2)],
        [(M_PI_2, z), (z, -M_PI_2), (z, z)],
        [(-M_PI_2, z), (z, z), (z, -M_PI_2)],
        [(-M_PI_2, z), (z, -M_PI_2), (z, -M_PI)],
        [(-M_PI_2, z), (z, -M_PI), (z, M_PI_2)],
        [(-M_PI_2, z), (z, M_PI_2), (z, z)],
    ];
    let mut polys: Vec<(f64, GeoPolygon)> = tris
        .iter()
        .map(|t| {
            let ext: Vec<LatLng> = t.iter().map(|&(lat, lng)| LatLng { lat, lng }).collect();
            (geo_loop_area_rads2(&ext), GeoPolygon { exterior: ext, holes: Vec::new() })
        })
        .collect();
    polys.sort_by(|a, b| cmp_area(b.0, a.0));
    polys.into_iter().map(|(_, p)| p).collect()
}

/// C `cellsToMultiPolygon`: outlines of a set of same-resolution, unique, valid cells, as
/// polygons (outer loop counter-clockwise, holes clockwise) ordered by decreasing outer area.
/// An empty input yields no polygons; the whole globe yields eight triangles. Vertices in radians.
///
/// Ordering among polygons (or loops of one polygon) with bit-identical areas follows Rust's
/// stable sort; C uses `qsort`, whose order for such exact ties is implementation-defined.
pub fn cells_to_multi_polygon(cells: &[u64]) -> H3Result<Vec<GeoPolygon>> {
    check_overflow(cells.len() as i64)?;
    validate_cell_set(cells)?;
    if cells.is_empty() {
        return Ok(Vec::new());
    }
    let mut set = ArcSet::new(cells)?;
    set.cancel_pairs()?;

    for a in &mut set.arcs {
        a.visited = false;
    }
    let mut loops = Vec::new();
    for i in 0..set.arcs.len() {
        if !set.arcs[i].visited && !set.arcs[i].removed {
            loops.push(sortable_loop(&mut set, i)?);
        }
    }
    if loops.is_empty() {
        return Ok(globe());
    }
    loops.sort_by(|a, b| a.root.cmp(&b.root).then(cmp_area(a.area, b.area)));

    let mut polys: Vec<(f64, GeoPolygon)> = Vec::new();
    let mut iter = loops.into_iter().peekable();
    while let Some(outer) = iter.next() {
        let mut holes = Vec::new();
        while let Some(next) = iter.peek() {
            if next.root != outer.root {
                break;
            }
            holes.push(iter.next().map(|l| l.verts).unwrap_or_default());
        }
        polys.push((outer.area, GeoPolygon { exterior: outer.verts, holes }));
    }
    polys.sort_by(|a, b| cmp_area(b.0, a.0));
    Ok(polys.into_iter().map(|(_, p)| p).collect())
}

/// C `cellsToLinkedMultiPolygon`, as owned data: polygons of loops (outer first), each loop's
/// vertices in radians, unclosed. A loop with fewer than three vertices is C `E_FAILED`.
pub fn cells_to_linked_multi_polygon(cells: &[u64]) -> H3Result<Vec<Vec<Vec<LatLng>>>> {
    let mpoly = cells_to_multi_polygon(cells)?;
    let mut out = Vec::with_capacity(mpoly.len());
    for p in mpoly {
        let mut loops = Vec::with_capacity(p.holes.len() + 1);
        if p.exterior.len() < 3 {
            return Err(H3Error::Failed);
        }
        loops.push(p.exterior);
        for h in p.holes {
            if h.len() < 3 {
                return Err(H3Error::Failed);
            }
            loops.push(h);
        }
        out.push(loops);
    }
    Ok(out)
}
