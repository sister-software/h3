//! Native Rust versus pinned H3 C fixtures: Phase D (traversal and local IJ).
//!
//! Disk and ring outputs are compared against C's whole output buffer, in C order, including
//! unused `0` slots.

mod common;
use common::*;
use sister_h3::{CoordIJ, raw};

fn k(r: &Record) -> i32 {
    i(&r.args["k"]) as i32
}

#[test]
fn max_sizes() {
    for r in load("maxGridDiskSize") {
        let (e, v) = err(raw::max_grid_disk_size(k(&r)));
        assert_eq!(e, r.error, "line {}", r.line);
        if let Some(v) = v {
            assert_eq!(v, i(&r.result["value"]), "line {}", r.line);
        }
    }
    for r in load("maxGridRingSize") {
        let (e, v) = err(raw::max_grid_ring_size(k(&r)));
        assert_eq!(e, r.error, "line {}", r.line);
        if let Some(v) = v {
            assert_eq!(v, i(&r.result["value"]), "line {}", r.line);
        }
    }
}

fn disks(op: &str, f: impl Fn(u64, i32) -> sister_h3::H3Result<Vec<u64>>) {
    for r in load(op) {
        let (e, v) = err(f(idx(&r.args["index"]), k(&r)));
        assert_eq!(e, r.error, "{op} line {} {:?}", r.line, r.args);
        if let Some(v) = v {
            assert_eq!(v, idxs(&r.result["indexes"]), "{op} line {}", r.line);
        }
    }
}

fn disk_distances(op: &str, f: impl Fn(u64, i32) -> sister_h3::H3Result<(Vec<u64>, Vec<i32>)>) {
    for r in load(op) {
        let (e, v) = err(f(idx(&r.args["index"]), k(&r)));
        assert_eq!(e, r.error, "{op} line {} {:?}", r.line, r.args);
        if let Some((cells, d)) = v {
            assert_eq!(cells, idxs(&r.result["indexes"]), "{op} line {}", r.line);
            let want: Vec<i32> = r.result["distances"].as_array().unwrap().iter().map(|x| i(x) as i32).collect();
            assert_eq!(d, want, "{op} line {} distances", r.line);
        }
    }
}

#[test]
fn grid_disk() {
    disks("gridDisk", raw::grid_disk);
    disks("gridDiskUnsafe", raw::grid_disk_unsafe);
}

#[test]
fn grid_disk_distances() {
    disk_distances("gridDiskDistances", raw::grid_disk_distances);
    disk_distances("gridDiskDistancesUnsafe", raw::grid_disk_distances_unsafe);
    disk_distances("gridDiskDistancesSafe", raw::grid_disk_distances_safe);
}

#[test]
fn grid_ring() {
    disks("gridRing", raw::grid_ring);
    disks("gridRingUnsafe", raw::grid_ring_unsafe);
}

fn pair(r: &Record) -> (u64, u64) {
    (idx(&r.args["origin"]), idx(&r.args["destination"]))
}

#[test]
fn grid_distance_and_path() {
    for r in load("gridDistance") {
        let (a, b) = pair(&r);
        let (e, v) = err(raw::grid_distance(a, b));
        assert_eq!(e, r.error, "line {} {:?}", r.line, r.args);
        if let Some(v) = v {
            assert_eq!(v, i(&r.result["value"]), "line {}", r.line);
        }
    }
    for r in load("gridPathCellsSize") {
        let (a, b) = pair(&r);
        let (e, v) = err(raw::grid_path_cells_size(a, b));
        assert_eq!(e, r.error, "line {}", r.line);
        if let Some(v) = v {
            assert_eq!(v, i(&r.result["value"]), "line {}", r.line);
        }
    }
    for r in load("gridPathCells") {
        let (a, b) = pair(&r);
        let (e, v) = err(raw::grid_path_cells(a, b));
        assert_eq!(e, r.error, "line {} {:?}", r.line, r.args);
        if let Some(v) = v {
            assert_eq!(v, idxs(&r.result["indexes"]), "line {}", r.line);
        }
    }
}

#[test]
fn local_ij() {
    for r in load("cellToLocalIj") {
        let (a, b) = pair(&r);
        let (e, v) = err(raw::cell_to_local_ij(a, b, i(&r.args["mode"]) as u32));
        assert_eq!(e, r.error, "line {} {:?}", r.line, r.args);
        if let Some(v) = v {
            assert_eq!((i64::from(v.i), i64::from(v.j)), (i(&r.result["i"]), i(&r.result["j"])), "line {}", r.line);
        }
    }
    for r in load("localIjToCell") {
        let ij = CoordIJ { i: i(&r.args["i"]) as i32, j: i(&r.args["j"]) as i32 };
        let (e, v) = err(raw::local_ij_to_cell(idx(&r.args["origin"]), &ij, i(&r.args["mode"]) as u32));
        assert_eq!(e, r.error, "line {} {:?}", r.line, r.args);
        if let Some(v) = v {
            assert_eq!(v, idx(&r.result["index"]), "line {}", r.line);
        }
    }
}
