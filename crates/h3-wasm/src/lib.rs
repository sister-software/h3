//! Internal WebAssembly adapter for `@sister.software/h3`. Not published.
//!
//! Translates `sister_h3::raw` results into the numeric ABI documented in
//! `docs/api-decisions.md` ("Private WASM ABI"):
//!
//! - index results: `u64`; on `0`, `last_error()` distinguishes failure from a C `H3_NULL` result;
//! - non-negative integers: `f64`, negated C code on failure;
//! - booleans: `i32` `0`/`1`, negated C code on failure;
//! - floats and variable-length results: `Vec<f64>` / `Vec<u64>` / `Vec<i32>`, with
//!   `last_error()` distinguishing an empty success from a failure.
//!
//! Every fallible export sets `last_error()`. Resource-limit rejections use statuses 1001–1003
//! and are decided before any result allocation. No geometry logic lives here.

use std::cell::Cell;

use sister_h3::{H3Error, LatLng, degs_to_rads, raw};
use wasm_bindgen::prelude::*;

mod limits;
mod out;
use limits::{Estimate, admit};
pub use out::{out_f64, out_f64_ptr, out_u64_ptr};

thread_local! {
    static LAST_ERROR: Cell<u32> = const { Cell::new(0) };
}

#[inline]
pub(crate) fn set_error(code: u32) {
    LAST_ERROR.with(|e| e.set(code));
}

/// Largest integer exactly representable in an `f64` (JavaScript `Number.MAX_SAFE_INTEGER`).
const MAX_SAFE: f64 = 9007199254740991.0;

#[inline]
fn index(r: Result<u64, H3Error>) -> u64 {
    match r {
        Ok(h) => {
            set_error(0);
            h
        }
        Err(e) => {
            set_error(e.code());
            0
        }
    }
}

#[inline]
fn count(r: Result<i64, H3Error>) -> f64 {
    match r {
        Ok(v) if v >= 0 && (v as f64) <= MAX_SAFE => {
            set_error(0);
            v as f64
        }
        Ok(_) => {
            // Not representable as a safe integer; reported as E_FAILED-like domain error to JS,
            // which turns it into a RangeError.
            set_error(limits::UNSAFE_INTEGER);
            -f64::from(limits::UNSAFE_INTEGER)
        }
        Err(e) => {
            set_error(e.code());
            -f64::from(e.code())
        }
    }
}

#[inline]
fn vec_or_error<T>(r: Result<Vec<T>, H3Error>) -> Vec<T> {
    match r {
        Ok(v) => {
            set_error(0);
            v
        }
        Err(e) => {
            set_error(e.code());
            Vec::new()
        }
    }
}

/// Stores an index result in the reused output buffer: the count, or the negated status.
fn emit_u64(r: Result<Vec<u64>, H3Error>) -> f64 {
    match r {
        Ok(v) => {
            set_error(0);
            out::store_u64(v) as f64
        }
        Err(e) => {
            set_error(e.code());
            -f64::from(e.code())
        }
    }
}

/// Stores a float result in the reused float buffer: the count, or the negated status.
fn emit_f64(r: Result<Vec<f64>, H3Error>) -> f64 {
    match r {
        Ok(v) => {
            set_error(0);
            out::store_f64(v) as f64
        }
        Err(e) => {
            set_error(e.code());
            -f64::from(e.code())
        }
    }
}

/// Stores a two-value result in the fixed float output: 0, or the C error code.
fn pair(r: Result<(f64, f64), H3Error>) -> u32 {
    match r {
        Ok((a, b)) => {
            out::set_f64(a, b);
            set_error(0);
            0
        }
        Err(e) => {
            set_error(e.code());
            e.code()
        }
    }
}

/// The status of the most recent fallible call: 0 on success, a C error code, or a resource
/// status (1001 items, 1002 result bytes, 1003 workspace, 1004 unsafe integer).
#[wasm_bindgen]
pub fn last_error() -> u32 {
    LAST_ERROR.with(Cell::get)
}

/// ABI version; the TypeScript runtime refuses a binary with a different value.
#[wasm_bindgen]
pub fn abi_version() -> u32 {
    1
}

pub use limits::{limit_maximum, limit_requested, set_limits};

// --- Phase A: validation and inspection -----------------------------------------------------

#[wasm_bindgen]
pub fn is_valid_cell(h: u64) -> bool {
    raw::is_valid_cell(h)
}

#[wasm_bindgen]
pub fn is_pentagon(h: u64) -> bool {
    raw::is_pentagon(h)
}

#[wasm_bindgen]
pub fn is_res_class_iii(h: u64) -> bool {
    raw::is_res_class_iii(h)
}

#[wasm_bindgen]
pub fn get_resolution(h: u64) -> i32 {
    raw::get_resolution(h)
}

#[wasm_bindgen]
pub fn get_base_cell_number(h: u64) -> i32 {
    raw::get_base_cell_number(h)
}

#[wasm_bindgen]
pub fn get_index_digit(h: u64, digit: i32) -> f64 {
    count(raw::get_index_digit(h, digit).map(i64::from))
}

#[wasm_bindgen]
pub fn construct_cell(res: i32, base_cell_number: i32, digits: &[i32]) -> u64 {
    index(raw::construct_cell(res, base_cell_number, digits))
}

#[wasm_bindgen]
pub fn get_res0_cells() -> f64 {
    if !admit(Estimate::indexes(122)) {
        return -f64::from(last_error());
    }
    emit_u64(Ok(raw::get_res0_cells()))
}

#[wasm_bindgen]
pub fn get_pentagons(res: i32) -> f64 {
    if !admit(Estimate::indexes(12)) {
        return -f64::from(last_error());
    }
    emit_u64(raw::get_pentagons(res))
}

#[wasm_bindgen]
pub fn get_num_cells(res: i32) -> f64 {
    count(raw::get_num_cells(res))
}

// --- Phase B: coordinates and boundaries ----------------------------------------------------

/// `latLngToCell` with degree inputs (converted with C `degsToRads`).
#[wasm_bindgen]
pub fn lat_lng_to_cell(lat_degs: f64, lng_degs: f64, res: i32) -> u64 {
    index(raw::lat_lng_to_cell(&LatLng::from_radians(degs_to_rads(lat_degs), degs_to_rads(lng_degs)), res))
}

/// `cellToLatLng` into the two-value float output (`out_f64(0)` lat, `out_f64(1)` lng, radians).
/// Returns 0 or the C error code.
#[wasm_bindgen]
pub fn cell_to_lat_lng(h: u64) -> u32 {
    pair(raw::cell_to_lat_lng(h).map(|g| (g.lat, g.lng)))
}

/// `cellToBoundary`: flattened `[lat, lng, ...]` in radians, or empty on failure.
#[wasm_bindgen]
pub fn cell_to_boundary(h: u64) -> f64 {
    emit_f64(raw::cell_to_boundary(h).map(|b| b.iter().flat_map(|g| [g.lat, g.lng]).collect()))
}

/// `getIcosahedronFaces`: the C sparse array (unused slots `-1`), or empty on failure.
#[wasm_bindgen]
pub fn get_icosahedron_faces(h: u64) -> Vec<i32> {
    vec_or_error(raw::get_icosahedron_faces(h))
}

// --- Phase C: hierarchy ---------------------------------------------------------------------

#[wasm_bindgen]
pub fn cell_to_parent(h: u64, res: i32) -> u64 {
    index(raw::cell_to_parent(h, res))
}

#[wasm_bindgen]
pub fn cell_to_center_child(h: u64, res: i32) -> u64 {
    index(raw::cell_to_center_child(h, res))
}

#[wasm_bindgen]
pub fn cell_to_children_size(h: u64, res: i32) -> f64 {
    count(raw::cell_to_children_size(h, res))
}

#[wasm_bindgen]
pub fn cell_to_children(h: u64, res: i32) -> f64 {
    let n = match raw::cell_to_children_size(h, res) {
        Ok(n) => n,
        Err(e) => {
            set_error(e.code());
            return -f64::from(last_error());
        }
    };
    if !admit(Estimate::indexes_i64(n)) {
        return -f64::from(last_error());
    }
    let mut out = Vec::with_capacity(n as usize);
    out.extend(raw::cell_to_children(h, res));
    emit_u64(Ok(out))
}

#[wasm_bindgen]
pub fn cell_to_child_pos(h: u64, parent_res: i32) -> f64 {
    count(raw::cell_to_child_pos(h, parent_res))
}

/// `childPosToCell`; `child_pos` is a safe integer validated by the TypeScript adapter.
#[wasm_bindgen]
pub fn child_pos_to_cell(child_pos: f64, h: u64, child_res: i32) -> u64 {
    index(raw::child_pos_to_cell(child_pos as i64, h, child_res))
}

#[wasm_bindgen]
pub fn compact_cells(cells: &[u64]) -> f64 {
    // Workspace: the C algorithm keeps two copies of the input (remaining set and hash set).
    let n = cells.len() as f64;
    if !admit(Estimate::indexes(cells.len()).with_workspace(n * 16.0)) {
        return -f64::from(last_error());
    }
    emit_u64(raw::compact_cells(cells))
}

#[wasm_bindgen]
pub fn uncompact_cells(cells: &[u64], res: i32) -> f64 {
    let n = match raw::uncompact_cells_size(cells, res) {
        Ok(n) => n,
        Err(e) => {
            set_error(e.code());
            return -f64::from(last_error());
        }
    };
    if !admit(Estimate::indexes_i64(n)) {
        return -f64::from(last_error());
    }
    emit_u64(raw::uncompact_cells(cells, res))
}

// --- Phase D: traversal ---------------------------------------------------------------------

fn nonzero(v: Vec<u64>) -> Vec<u64> {
    v.into_iter().filter(|&h| h != 0).collect()
}

/// Admission for a disk of radius `k`: result indexes plus the C workspace (cells + distances +
/// the safe-algorithm stack).
fn admit_disk(k: i32) -> Result<(), ()> {
    let n = match raw::max_grid_disk_size(k) {
        Ok(n) => n,
        Err(e) => {
            set_error(e.code());
            return Err(());
        }
    };
    let nf = n as f64;
    if admit(Estimate::indexes_i64(n).with_workspace(nf * 12.0 + f64::from(k.max(0)) * 24.0)) {
        Ok(())
    } else {
        Err(())
    }
}

/// `gridDisk` into the index output buffer: returns the number of cells, or the negated status.
#[wasm_bindgen]
pub fn grid_disk(h: u64, k: i32) -> f64 {
    if admit_disk(k).is_err() {
        return -f64::from(last_error());
    }
    let n = raw::max_grid_disk_size(k).unwrap_or(0) as usize;
    match out::fill_nonzero_u64(n, |buf| raw::grid_disk_into(h, k, buf)) {
        Ok(len) => {
            set_error(0);
            len as f64
        }
        Err(e) => {
            set_error(e.code());
            -f64::from(e.code())
        }
    }
}

/// `gridDiskDistances`: `[cell, distance, cell, distance, ...]` for non-zero cells in C order.
#[wasm_bindgen]
pub fn grid_disk_distances(h: u64, k: i32) -> Vec<u64> {
    if admit_disk(k).is_err() {
        return Vec::new();
    }
    vec_or_error(
        raw::grid_disk_distances(h, k).map(|(cells, d)| {
            cells.into_iter().zip(d).filter(|(c, _)| *c != 0).flat_map(|(c, d)| [c, d as u64]).collect()
        }),
    )
}

fn admit_ring(k: i32) -> Result<(), ()> {
    let n = match raw::max_grid_ring_size(k) {
        Ok(n) => n,
        Err(e) => {
            set_error(e.code());
            return Err(());
        }
    };
    // The safe fallback computes a whole disk.
    let disk = raw::max_grid_disk_size(k).unwrap_or(i64::MAX) as f64;
    if admit(Estimate::indexes_i64(n).with_workspace(disk * 12.0 + f64::from(k.max(0)) * 24.0)) {
        Ok(())
    } else {
        Err(())
    }
}

#[wasm_bindgen]
pub fn grid_ring(h: u64, k: i32) -> f64 {
    if admit_ring(k).is_err() {
        return -f64::from(last_error());
    }
    emit_u64(raw::grid_ring(h, k).map(nonzero))
}

#[wasm_bindgen]
pub fn grid_ring_unsafe(h: u64, k: i32) -> f64 {
    if admit_ring(k).is_err() {
        return -f64::from(last_error());
    }
    emit_u64(raw::grid_ring_unsafe(h, k).map(nonzero))
}

#[wasm_bindgen]
pub fn grid_distance(a: u64, b: u64) -> f64 {
    count(raw::grid_distance(a, b))
}

#[wasm_bindgen]
pub fn grid_path_cells(a: u64, b: u64) -> f64 {
    let n = match raw::grid_path_cells_size(a, b) {
        Ok(n) => n,
        Err(e) => {
            set_error(e.code());
            return -f64::from(last_error());
        }
    };
    if !admit(Estimate::indexes_i64(n)) {
        return -f64::from(last_error());
    }
    emit_u64(raw::grid_path_cells(a, b))
}

/// `cellToLocalIj` (mode 0) into the two-value float output (`i`, `j`). Returns 0 or the C code.
#[wasm_bindgen]
pub fn cell_to_local_ij(origin: u64, h: u64) -> u32 {
    pair(raw::cell_to_local_ij(origin, h, 0).map(|ij| (f64::from(ij.i), f64::from(ij.j))))
}

/// `localIjToCell` (mode 0).
#[wasm_bindgen]
pub fn local_ij_to_cell(origin: u64, i: i32, j: i32) -> u64 {
    index(raw::local_ij_to_cell(origin, &sister_h3::CoordIJ { i, j }, 0))
}

// --- Phase E: directed edges and vertexes ---------------------------------------------------

#[wasm_bindgen]
pub fn are_neighbor_cells(a: u64, b: u64) -> i32 {
    match raw::are_neighbor_cells(a, b) {
        Ok(v) => {
            set_error(0);
            i32::from(v)
        }
        Err(e) => {
            set_error(e.code());
            -(e.code() as i32)
        }
    }
}

#[wasm_bindgen]
pub fn cells_to_directed_edge(a: u64, b: u64) -> u64 {
    index(raw::cells_to_directed_edge(a, b))
}

#[wasm_bindgen]
pub fn get_directed_edge_origin(e: u64) -> u64 {
    index(raw::get_directed_edge_origin(e))
}

#[wasm_bindgen]
pub fn get_directed_edge_destination(e: u64) -> u64 {
    index(raw::get_directed_edge_destination(e))
}

#[wasm_bindgen]
pub fn is_valid_directed_edge(e: u64) -> bool {
    raw::is_valid_directed_edge(e)
}

#[wasm_bindgen]
pub fn is_valid_index(h: u64) -> bool {
    raw::is_valid_index(h)
}

#[wasm_bindgen]
pub fn directed_edge_to_cells(e: u64) -> f64 {
    emit_u64(raw::directed_edge_to_cells(e).map(|c| c.to_vec()))
}

#[wasm_bindgen]
pub fn origin_to_directed_edges(h: u64) -> f64 {
    emit_u64(Ok(nonzero(raw::origin_to_directed_edges(h).to_vec())))
}

#[wasm_bindgen]
pub fn directed_edge_to_boundary(e: u64) -> f64 {
    emit_f64(raw::directed_edge_to_boundary(e).map(|b| b.iter().flat_map(|g| [g.lat, g.lng]).collect()))
}

#[wasm_bindgen]
pub fn reverse_directed_edge(e: u64) -> u64 {
    index(raw::reverse_directed_edge(e))
}

#[wasm_bindgen]
pub fn cell_to_vertex(h: u64, vertex_num: i32) -> u64 {
    index(raw::cell_to_vertex(h, vertex_num))
}

#[wasm_bindgen]
pub fn cell_to_vertexes(h: u64) -> f64 {
    emit_u64(raw::cell_to_vertexes(h).map(|v| nonzero(v.to_vec())))
}

/// `vertexToLatLng` into the two-value float output (radians). Returns 0 or the C error code.
#[wasm_bindgen]
pub fn vertex_to_lat_lng(v: u64) -> u32 {
    pair(raw::vertex_to_lat_lng(v).map(|g| (g.lat, g.lng)))
}

#[wasm_bindgen]
pub fn is_valid_vertex(v: u64) -> bool {
    raw::is_valid_vertex(v)
}

// --- Phase F: measurements ------------------------------------------------------------------

#[inline]
fn float(r: Result<f64, H3Error>) -> f64 {
    match r {
        Ok(v) => {
            set_error(0);
            v
        }
        Err(e) => {
            set_error(e.code());
            f64::NAN
        }
    }
}

/// Great-circle distance between two degree coordinates. `unit`: 0 rads, 1 km, 2 m.
#[wasm_bindgen]
pub fn great_circle_distance(lat1: f64, lng1: f64, lat2: f64, lng2: f64, unit: u32) -> f64 {
    let a = LatLng::from_radians(degs_to_rads(lat1), degs_to_rads(lng1));
    let b = LatLng::from_radians(degs_to_rads(lat2), degs_to_rads(lng2));
    set_error(0);
    match unit {
        0 => raw::great_circle_distance_rads(&a, &b),
        1 => raw::great_circle_distance_km(&a, &b),
        _ => raw::great_circle_distance_m(&a, &b),
    }
}

/// `cellArea`. `unit`: 0 rads2, 1 km2, 2 m2. Check `last_error()`.
#[wasm_bindgen]
pub fn cell_area(h: u64, unit: u32) -> f64 {
    float(match unit {
        0 => raw::cell_area_rads2(h),
        1 => raw::cell_area_km2(h),
        _ => raw::cell_area_m2(h),
    })
}

/// `edgeLength`. `unit`: 0 rads, 1 km, 2 m. Check `last_error()`.
#[wasm_bindgen]
pub fn edge_length(e: u64, unit: u32) -> f64 {
    float(match unit {
        0 => raw::edge_length_rads(e),
        1 => raw::edge_length_km(e),
        _ => raw::edge_length_m(e),
    })
}

/// `getHexagonAreaAvg`. `unit`: 1 km2, 2 m2. Check `last_error()`.
#[wasm_bindgen]
pub fn get_hexagon_area_avg(res: i32, unit: u32) -> f64 {
    float(if unit == 1 { raw::get_hexagon_area_avg_km2(res) } else { raw::get_hexagon_area_avg_m2(res) })
}

/// `getHexagonEdgeLengthAvg`. `unit`: 1 km, 2 m. Check `last_error()`.
#[wasm_bindgen]
pub fn get_hexagon_edge_length_avg(res: i32, unit: u32) -> f64 {
    float(if unit == 1 { raw::get_hexagon_edge_length_avg_km(res) } else { raw::get_hexagon_edge_length_avg_m(res) })
}

// --- Phase G: polygons ----------------------------------------------------------------------

/// Builds a polygon from flattened degree coordinates `[lat, lng, ...]` and loop lengths
/// (exterior first), converting with C `degsToRads`.
fn polygon_from(coords: &[f64], loop_lengths: &[u32]) -> sister_h3::GeoPolygon {
    let mut loops = Vec::with_capacity(loop_lengths.len());
    let mut at = 0usize;
    for &n in loop_lengths {
        let n = n as usize;
        let lp: Vec<LatLng> = coords[at * 2..(at + n) * 2]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|&[lat, lng]| LatLng::from_radians(degs_to_rads(lat), degs_to_rads(lng)))
            .collect();
        at += n;
        loops.push(lp);
    }
    let mut it = loops.into_iter();
    sister_h3::GeoPolygon { exterior: it.next().unwrap_or_default(), holes: it.collect() }
}

/// `polygonToCells` (flags 0): non-zero cells in C buffer order.
#[wasm_bindgen]
pub fn polygon_to_cells(coords: &[f64], loop_lengths: &[u32], res: i32) -> f64 {
    let p = polygon_from(coords, loop_lengths);
    let n = match raw::max_polygon_to_cells_size(&p, res, 0) {
        Ok(n) => n,
        Err(e) => {
            set_error(e.code());
            return -f64::from(last_error());
        }
    };
    // Workspace: the C out, search and found buffers.
    if !admit(Estimate::indexes_i64(n).with_workspace(n.max(0) as f64 * 24.0 + coords.len() as f64 * 8.0)) {
        return -f64::from(last_error());
    }
    emit_u64(raw::polygon_to_cells(&p, res, 0).map(nonzero))
}

/// `polygonToCellsExperimental` with containment `flags` (0–3), sized by
/// `maxPolygonToCellsSizeExperimental`. Cells in C iteration order.
#[wasm_bindgen]
pub fn polygon_to_cells_experimental(coords: &[f64], loop_lengths: &[u32], res: i32, flags: u32) -> f64 {
    let p = polygon_from(coords, loop_lengths);
    let n = match raw::max_polygon_to_cells_size_experimental(&p, res, flags) {
        Ok(n) => n,
        Err(e) => {
            set_error(e.code());
            return -f64::from(last_error());
        }
    };
    if !admit(Estimate::indexes_i64(n).with_workspace(coords.len() as f64 * 8.0)) {
        return -f64::from(last_error());
    }
    emit_u64(raw::polygon_to_cells_experimental(&p, res, flags, n))
}

/// `cellsToMultiPolygon` (C `cellsToLinkedMultiPolygon`), encoded as
/// `[numPolygons, (numLoops, (numVerts, lat, lng, ...)...)...]` in radians.
#[wasm_bindgen]
pub fn cells_to_multi_polygon(cells: &[u64]) -> Vec<f64> {
    // Each arc contributes at most two vertices (2 numbers each) plus GeoJSON closure; C keeps an
    // arc struct and ten hash buckets per arc.
    let arcs = cells.len() as f64 * 6.0;
    let e = Estimate::numbers(arcs * 2.0 * 2.0 + arcs * 2.0, arcs * 3.0)
        .with_workspace(arcs * (ARC_WORKSPACE_BYTES + 80.0) + cells.len() as f64 * 8.0);
    if !admit(e) {
        return Vec::new();
    }
    match raw::cells_to_linked_multi_polygon(cells) {
        Ok(polys) => {
            let mut out = vec![polys.len() as f64];
            for p in &polys {
                out.push(p.len() as f64);
                for lp in p {
                    out.push(lp.len() as f64);
                    for v in lp {
                        out.push(v.lat);
                        out.push(v.lng);
                    }
                }
            }
            set_error(0);
            out
        }
        Err(e) => {
            set_error(e.code());
            Vec::new()
        }
    }
}

/// Bytes per C `Arc` in the outline workspace estimate (id, flags, three links, rank).
const ARC_WORKSPACE_BYTES: f64 = 48.0;
