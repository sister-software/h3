//! WebAssembly adapters for hierarchy.
use super::*;

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
