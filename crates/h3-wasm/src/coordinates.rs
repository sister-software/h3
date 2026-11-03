//! WebAssembly adapters for coordinates.
use super::*;

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
