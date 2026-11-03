//! WebAssembly adapters for measurements.
use super::*;

/// Returns the great-circle distance between degree coordinates. Units: 0 radians, 1 kilometres, 2 metres.
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
