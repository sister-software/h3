//! Polygon to cells.
//!
//! Translated from H3 C `algos.c` (`maxPolygonToCellsSize`, `polygonToCells`) and `polyfill.c`
//! (`polygonToCellsExperimental` and its size estimate) (Apache-2.0, Copyright Uber
//! Technologies, Inc.).
//!
//! [`polygon_to_cells`] returns C's whole output buffer (a hash set with `0` in unused slots),
//! whose order is unspecified. [`polygon_to_cells_experimental`] returns cells in C iteration
//! order.

use crate::bbox::{BBox, bbox_hex_estimate, line_hex_estimate};
use crate::cell::{cell_to_boundary, cell_to_lat_lng, lat_lng_to_cell};
use crate::constants::*;
use crate::errors::{H3Error, H3Result};
use crate::hierarchy::{ChildIter, cell_to_center_child, cell_to_children_size};
use crate::index::*;
use crate::latlng::get_hexagon_area_avg_km2;
use crate::math::Trig;
use crate::polygon::*;
use crate::traversal::grid_disk1_buffer;
use crate::{LatLng, coords::INVALID_DIGIT};

const POLYGON_TO_CELLS_BUFFER: i64 = 12;

fn alloc_zeroed(n: i64) -> H3Result<Vec<u64>> {
    let n = usize::try_from(n).map_err(|_| H3Error::MemoryAlloc)?;
    let mut v = Vec::new();
    v.try_reserve_exact(n).map_err(|_| H3Error::MemoryAlloc)?;
    v.resize(n, 0);
    Ok(v)
}

/// C `maxPolygonToCellsSize`.
pub fn max_polygon_to_cells_size(polygon: &GeoPolygon, res: i32, flags: u32) -> H3Result<i64> {
    validate_polygon_flags(flags)?;
    let bbox = bbox_from_geo_loop(&polygon.exterior);
    let mut n = bbox_hex_estimate(&bbox, res)?;
    let mut total_verts = polygon.exterior.len() as i64;
    for h in &polygon.holes {
        total_verts = total_verts.checked_add(h.len() as i64).ok_or(H3Error::MemoryAlloc)?;
    }
    if n < total_verts {
        n = total_verts;
    }
    n.checked_add(POLYGON_TO_CELLS_BUFFER).ok_or(H3Error::MemoryAlloc)
}

/// C `_getEdgeHexagons`.
fn get_edge_hexagons(
    lp: &[LatLng],
    num_hexagons: i64,
    res: i32,
    num_search: &mut usize,
    search: &mut [u64],
    found: &mut [u64],
) -> H3Result<()> {
    let n = lp.len();
    let nh = num_hexagons as u64;
    for i in 0..n {
        let origin = lp[i];
        let destination = if i == n - 1 { lp[0] } else { lp[i + 1] };
        let est = line_hex_estimate(&origin, &destination, res)?;
        for j in 0..est {
            let inv = 1.0 / est as f64;
            let interp = LatLng {
                lat: (origin.lat * (est - j) as f64 * inv) + (destination.lat * j as f64 * inv),
                lng: (origin.lng * (est - j) as f64 * inv) + (destination.lng * j as f64 * inv),
            };
            let point_hex = lat_lng_to_cell(&interp, res)?;
            let mut loc = (point_hex % nh) as usize;
            let mut loop_count: i64 = 0;
            while found[loc] != 0 {
                if loop_count > num_hexagons {
                    return Err(H3Error::Failed);
                }
                if found[loc] == point_hex {
                    break;
                }
                loc = (loc + 1) % found.len();
                loop_count += 1;
            }
            if found[loc] == point_hex {
                continue;
            }
            found[loc] = point_hex;
            // C writes without a bound check; the size estimate guarantees room for valid input.
            if *num_search >= search.len() {
                return Err(H3Error::Failed);
            }
            search[*num_search] = point_hex;
            *num_search += 1;
        }
    }
    Ok(())
}

/// C `polygonToCells`: C's whole output buffer (length `maxPolygonToCellsSize`), unused slots `0`.
pub fn polygon_to_cells(polygon: &GeoPolygon, res: i32, flags: u32) -> H3Result<Vec<u64>> {
    validate_polygon_flags(flags)?;
    let bboxes = bboxes_from_polygon(polygon);
    let num_hexagons = max_polygon_to_cells_size(polygon, res, flags)?;
    let mut out = alloc_zeroed(num_hexagons)?;
    let mut search = alloc_zeroed(num_hexagons)?;
    let mut found = alloc_zeroed(num_hexagons)?;
    let nh = num_hexagons as u64;

    let mut num_search = 0usize;
    let mut num_found = 0usize;
    get_edge_hexagons(&polygon.exterior, num_hexagons, res, &mut num_search, &mut search, &mut found)?;
    for hole in &polygon.holes {
        get_edge_hexagons(hole, num_hexagons, res, &mut num_search, &mut search, &mut found)?;
    }
    found.iter_mut().for_each(|x| *x = 0);

    while num_search > 0 {
        for &search_hex in &search[..num_search] {
            let ring = grid_disk1_buffer(search_hex);
            for &hex in &ring {
                if hex == 0 {
                    continue;
                }
                let mut loc = (hex % nh) as usize;
                let mut loop_count: i64 = 0;
                while out[loc] != 0 {
                    if loop_count > num_hexagons {
                        return Err(H3Error::Failed);
                    }
                    if out[loc] == hex {
                        break;
                    }
                    loc = (loc + 1) % out.len();
                    loop_count += 1;
                }
                if out[loc] == hex {
                    continue;
                }
                // C ignores cellToLatLng errors here and tests the uninitialized/previous value;
                // for the valid cells that gridDisk produces this cannot fail.
                let Ok(center) = cell_to_lat_lng(hex) else { continue };
                if !point_inside_polygon(polygon, &bboxes, &center) {
                    continue;
                }
                out[loc] = hex;
                if num_found >= found.len() {
                    return Err(H3Error::Failed);
                }
                found[num_found] = hex;
                num_found += 1;
            }
        }
        core::mem::swap(&mut search, &mut found);
        found[..num_search].iter_mut().for_each(|x| *x = 0);
        num_search = num_found;
        num_found = 0;
    }
    Ok(out)
}

// --- Experimental polyfill (polyfill.c) ----------------------------------------------------

const CELL_SCALE_FACTOR: f64 = 1.1;
const CHILD_SCALE_FACTOR: f64 = 1.4;

const MAX_EDGE_LENGTH_RADS: [f64; 16] = [
    0.21577206265130,
    0.08308767068495,
    0.03148970436439,
    0.01190662871439,
    0.00450053330908,
    0.00170105523619,
    0.00064293917678,
    0.00024300820659,
    0.00009184847087,
    0.00003471545901,
    0.00001312121017,
    0.00000495935129,
    0.00000187445860,
    0.00000070847876,
    0.00000026777980,
    0.00000010121125,
];

const NORTH_POLE_CELLS: [u64; 16] = [
    0x8001fffffffffff,
    0x81033ffffffffff,
    0x820327fffffffff,
    0x830326fffffffff,
    0x8403263ffffffff,
    0x85032623fffffff,
    0x860326237ffffff,
    0x870326233ffffff,
    0x880326233bfffff,
    0x890326233abffff,
    0x8a0326233ab7fff,
    0x8b0326233ab0fff,
    0x8c0326233ab03ff,
    0x8d0326233ab03bf,
    0x8e0326233ab039f,
    0x8f0326233ab0399,
];

const SOUTH_POLE_CELLS: [u64; 16] = [
    0x80f3fffffffffff,
    0x81f2bffffffffff,
    0x82f297fffffffff,
    0x83f293fffffffff,
    0x84f2939ffffffff,
    0x85f29383fffffff,
    0x86f29380fffffff,
    0x87f29380effffff,
    0x88f29380e1fffff,
    0x89f29380e0fffff,
    0x8af29380e0d7fff,
    0x8bf29380e0d0fff,
    0x8cf29380e0d0dff,
    0x8df29380e0d0cff,
    0x8ef29380e0d0cc7,
    0x8ff29380e0d0cc4,
];

use crate::tables::RES0_BBOXES;

const VALID_RANGE_BBOX: BBox = BBox::new(M_PI_2, -M_PI_2, M_PI, -M_PI);

/// C `cellToBBox`.
pub(crate) fn cell_to_bbox(cell: u64, cover_children: bool) -> H3Result<BBox> {
    let res = get_resolution(cell);
    let mut out = if res == 0 {
        let bc = get_base_cell(cell);
        if bc >= NUM_BASE_CELLS {
            return Err(H3Error::CellInvalid);
        }
        RES0_BBOXES[bc as usize]
    } else {
        let center = cell_to_lat_lng(cell)?;
        let lng_ratio = 1.0 / center.lat.h3_cos();
        let e = MAX_EDGE_LENGTH_RADS[res as usize];
        BBox {
            north: center.lat + e,
            south: center.lat - e,
            east: center.lng + e * lng_ratio,
            west: center.lng - e * lng_ratio,
        }
    };
    out.scale(if cover_children { CHILD_SCALE_FACTOR } else { CELL_SCALE_FACTOR });
    if cell == NORTH_POLE_CELLS[res as usize] {
        out.north = M_PI_2;
    }
    if cell == SOUTH_POLE_CELLS[res as usize] {
        out.south = -M_PI_2;
    }
    if out.north == M_PI_2 || out.south == -M_PI_2 {
        out.east = M_PI;
        out.west = -M_PI;
    }
    Ok(out)
}

/// C `baseCellNumToCell`.
fn base_cell_num_to_cell(n: i32) -> u64 {
    if !(0..NUM_BASE_CELLS).contains(&n) {
        return 0;
    }
    set_h3_index(0, n, 0)
}

/// C `nextCell`.
fn next_cell(mut cell: u64) -> u64 {
    let mut res = get_resolution(cell);
    loop {
        if res == 0 {
            return base_cell_num_to_cell(get_base_cell(cell) + 1);
        }
        let parent = set_index_digit(set_resolution(cell, res - 1), res, H3_DIGIT_MASK);
        let digit = get_index_digit(cell, res);
        if digit < INVALID_DIGIT - 1 {
            let step = if is_pentagon(parent) && digit == 0 { 2 } else { 1 };
            return set_index_digit(cell, res, u64::from(digit) + step);
        }
        res -= 1;
        cell = parent;
    }
}

/// C `IterCellsPolygonCompact`: compact cells covering a polygon in C order.
struct PolygonCompactIter<'a> {
    cell: u64,
    error: Option<H3Error>,
    polygon: &'a GeoPolygon,
    res: i32,
    mode: u32,
    bboxes: Vec<BBox>,
    started: bool,
    done: bool,
}

impl<'a> PolygonCompactIter<'a> {
    /// C `_iterInitPolygonCompact`.
    fn init(polygon: &'a GeoPolygon, res: i32, flags: u32) -> PolygonCompactIter<'a> {
        let mut it = PolygonCompactIter {
            cell: base_cell_num_to_cell(0),
            error: None,
            polygon,
            res,
            mode: flags & 15,
            bboxes: Vec::new(),
            started: false,
            done: false,
        };
        if !(0..=MAX_H3_RES).contains(&res) {
            it.fail(H3Error::ResDomain);
            return it;
        }
        if let Err(e) = validate_polygon_flags(flags) {
            it.fail(e);
            return it;
        }
        it.bboxes = bboxes_from_polygon(polygon);
        it
    }

    fn fail(&mut self, e: H3Error) {
        self.destroy();
        self.error = Some(e);
    }

    /// C `iterDestroyPolygonCompact`.
    fn destroy(&mut self) {
        self.cell = 0;
        self.error = None;
        self.done = true;
    }

    /// C `iterStepPolygonCompact`.
    fn step(&mut self) {
        let mut cell = self.cell;
        if cell == 0 || self.done {
            return;
        }
        if self.started {
            cell = next_cell(cell);
        } else {
            self.started = true;
        }
        if self.polygon.exterior.is_empty() {
            self.destroy();
            return;
        }
        let mode = self.mode;
        const CENTER: u32 = 0;
        const FULL: u32 = 1;
        const OVERLAPPING: u32 = 2;
        const OVERLAPPING_BBOX: u32 = 3;
        while cell != 0 {
            let cell_res = get_resolution(cell);
            if cell_res == self.res {
                if mode == CENTER || mode == OVERLAPPING || mode == OVERLAPPING_BBOX {
                    let center = match cell_to_lat_lng(cell) {
                        Ok(c) => c,
                        Err(e) => return self.fail(e),
                    };
                    if point_inside_polygon(self.polygon, &self.bboxes, &center) {
                        self.cell = cell;
                        return;
                    }
                }
                if mode == OVERLAPPING || mode == OVERLAPPING_BBOX {
                    let first = self.polygon.exterior[0];
                    if VALID_RANGE_BBOX.contains(&first) {
                        match lat_lng_to_cell(&first, cell_res) {
                            Ok(pc) if pc == cell => {
                                self.cell = cell;
                                return;
                            }
                            Ok(_) => {}
                            Err(e) => return self.fail(e),
                        }
                    }
                }
                if mode == FULL || mode == OVERLAPPING || mode == OVERLAPPING_BBOX {
                    let boundary = match cell_to_boundary(cell) {
                        Ok(b) => b,
                        Err(e) => return self.fail(e),
                    };
                    let bbox = match cell_to_bbox(cell, false) {
                        Ok(b) => b,
                        Err(e) => return self.fail(e),
                    };
                    // C checks full containment first, then (for overlap modes) boundary crossing.
                    let inside = (mode == FULL || mode == OVERLAPPING_BBOX)
                        && cell_boundary_inside_polygon(self.polygon, &self.bboxes, &boundary, &bbox);
                    if inside
                        || ((mode == OVERLAPPING || mode == OVERLAPPING_BBOX)
                            && cell_boundary_crosses_polygon(self.polygon, &self.bboxes, &boundary, &bbox))
                    {
                        self.cell = cell;
                        return;
                    }
                }
                if mode == OVERLAPPING_BBOX {
                    let bbox = match cell_to_bbox(cell, true) {
                        Ok(b) => b,
                        Err(e) => return self.fail(e),
                    };
                    if self.bboxes[0].overlaps(&bbox) {
                        let bb = bbox.to_cell_boundary();
                        if bbox.contains_bbox(&self.bboxes[0])
                            || point_inside_polygon(self.polygon, &self.bboxes, &bb[0])
                            || cell_boundary_crosses_polygon(self.polygon, &self.bboxes, &bb, &bbox)
                        {
                            self.cell = cell;
                            return;
                        }
                    }
                }
            }
            if cell_res < self.res {
                let bbox = match cell_to_bbox(cell, true) {
                    Ok(b) => b,
                    Err(e) => return self.fail(e),
                };
                if self.bboxes[0].overlaps(&bbox) {
                    if self.bboxes[0].contains_bbox(&bbox) {
                        let bb = bbox.to_cell_boundary();
                        if cell_boundary_inside_polygon(self.polygon, &self.bboxes, &bb, &bbox) {
                            self.cell = cell;
                            return;
                        }
                    }
                    match cell_to_center_child(cell, cell_res + 1) {
                        Ok(child) => {
                            cell = child;
                            continue;
                        }
                        Err(e) => return self.fail(e),
                    }
                }
            }
            cell = next_cell(cell);
        }
        self.destroy();
    }
}

/// C `polygonToCellsExperimental` with an output bound of `size` cells (C `E_MEMORY_BOUNDS` when
/// exceeded). Cells are in C iteration order.
pub fn polygon_to_cells_experimental(polygon: &GeoPolygon, res: i32, flags: u32, size: i64) -> H3Result<Vec<u64>> {
    let mut out = Vec::new();
    let mut compact = PolygonCompactIter::init(polygon, res, flags);
    compact.step();
    let mut children = ChildIter::new(compact.cell, res);
    loop {
        for c in children.by_ref() {
            if out.len() as i64 >= size {
                return Err(H3Error::MemoryBounds);
            }
            out.try_reserve(1).map_err(|_| H3Error::MemoryAlloc)?;
            out.push(c);
        }
        compact.step();
        if compact.cell == 0 {
            break;
        }
        children = ChildIter::new(compact.cell, compact.res);
    }
    match compact.error {
        Some(e) => Err(e),
        None => Ok(out),
    }
}

const MAX_SIZE_CELL_THRESHOLD: f64 = 10.0;

/// C `maxPolygonToCellsSizeExperimental`.
pub fn max_polygon_to_cells_size_experimental(polygon: &GeoPolygon, res: i32, flags: u32) -> H3Result<i64> {
    if polygon.exterior.is_empty() {
        return Ok(0);
    }
    let mut it = PolygonCompactIter::init(polygon, res, flags);
    if let Some(e) = it.error {
        return Err(e);
    }
    it.mode = 3;
    let b = it.bboxes[0];
    let area = b.height_rads() * b.width_rads() / b.north.abs().min(b.south.abs()).h3_cos()
        * EARTH_RADIUS_KM
        * EARTH_RADIUS_KM;
    while it.res > 0 && area / get_hexagon_area_avg_km2(it.res - 1).unwrap_or(0.0) > MAX_SIZE_CELL_THRESHOLD {
        it.res -= 1;
    }
    it.step();
    let mut out: i64 = 0;
    while it.cell != 0 {
        // C ignores cellToChildrenSize errors (the compact cell is never finer than `res`).
        out = out.wrapping_add(cell_to_children_size(it.cell, res).unwrap_or(0));
        it.step();
    }
    match it.error {
        Some(e) => Err(e),
        None => Ok(out),
    }
}
