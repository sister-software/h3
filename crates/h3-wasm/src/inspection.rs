//! WebAssembly adapters for inspection.
use super::*;

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
