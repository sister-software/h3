//! WebAssembly adapters for edges.
use super::*;

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
