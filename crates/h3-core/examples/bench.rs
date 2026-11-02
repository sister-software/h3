//! Native benchmark of the priority operations, for `yarn benchmark` (compared with the same
//! workloads in `benchmarks/c/bench.c`). Not part of the published crate.
//!
//! Prints one JSON object per operation: samples of nanoseconds per operation.

use std::hint::black_box;
use std::time::Instant;

use sister_h3::{GeoPolygon, LatLng, raw};

fn points(n: usize) -> Vec<LatLng> {
    // SplitMix64, same sequence as benchmarks/c/bench.c.
    let mut s: u64 = 0x5157_4833;
    let mut next = || {
        s = s.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = s;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        ((z ^ (z >> 31)) >> 11) as f64 / (1u64 << 53) as f64
    };
    (0..n).map(|_| LatLng::from_degrees(next() * 160.0 - 80.0, next() * 360.0 - 180.0)).collect()
}

fn sample(name: &str, samples: usize, ops: usize, mut f: impl FnMut() -> u64) {
    let mut checksum = 0u64;
    for _ in 0..3 {
        checksum = checksum.wrapping_add(f());
    }
    let mut ns = Vec::with_capacity(samples);
    for _ in 0..samples {
        let t = Instant::now();
        checksum = checksum.wrapping_add(black_box(f()));
        ns.push(t.elapsed().as_nanos() as f64 / ops as f64);
    }
    let list: Vec<String> = ns.iter().map(|x| format!("{x:.2}")).collect();
    println!("{{\"op\":\"{name}\",\"nsPerOp\":[{}],\"checksum\":\"{checksum:x}\"}}", list.join(","));
}

fn main() {
    let samples: usize = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(15);
    let pts = points(10_000);
    let cells: Vec<u64> = pts.iter().map(|p| raw::lat_lng_to_cell(p, 9).unwrap()).collect();
    let disk_origins: Vec<u64> = cells.iter().take(1_000).copied().collect();
    let parent5 = raw::cell_to_parent(cells[0], 5).unwrap();
    let compact_input: Vec<u64> = raw::cell_to_children(parent5, 9).collect();
    let sf = GeoPolygon {
        exterior: [
            (0.659966917655, -2.1364398519396),
            (0.6595011102219, -2.1359434279405),
            (0.6583348114025, -2.1354884206045),
            (0.6581220034068, -2.1382437718946),
            (0.6594479998527, -2.1384597563896),
            (0.6599990002976, -2.1376771158464),
        ]
        .iter()
        .map(|&(a, b)| LatLng::from_radians(a, b))
        .collect(),
        holes: vec![],
    };

    sample("latLngToCell", samples, pts.len(), || {
        pts.iter().map(|p| raw::lat_lng_to_cell(p, 9).unwrap()).fold(0, u64::wrapping_add)
    });
    sample("cellToParent", samples, cells.len(), || {
        cells.iter().map(|&c| raw::cell_to_parent(c, 5).unwrap()).fold(0, u64::wrapping_add)
    });
    sample("cellToLatLng", samples, cells.len(), || {
        cells.iter().map(|&c| raw::cell_to_lat_lng(c).unwrap().lat.to_bits()).fold(0, u64::wrapping_add)
    });
    sample("gridDisk", samples, disk_origins.len(), || {
        disk_origins
            .iter()
            .map(|&c| raw::grid_disk(c, 2).unwrap().into_iter().fold(0, u64::wrapping_add))
            .fold(0, u64::wrapping_add)
    });
    sample("compactCells", samples, 1, || {
        raw::compact_cells(&compact_input).unwrap().into_iter().fold(0, u64::wrapping_add)
    });
    sample("polygonToCells", samples, 1, || {
        raw::polygon_to_cells(&sf, 9, 0).unwrap().into_iter().fold(0, u64::wrapping_add)
    });
}
