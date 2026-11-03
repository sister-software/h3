//! WebAssembly adapters for traversal.
use super::*;

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
