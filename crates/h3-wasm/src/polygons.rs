//! WebAssembly adapters for polygons.
use super::*;

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
