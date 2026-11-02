//! Reused output storage for results that JavaScript reads directly from linear memory.
//!
//! Ownership: the buffers belong to this module and are replaced by the next call that writes
//! them. The TypeScript runtime creates a fresh view after each call (memory may have grown) and
//! copies the values out synchronously before making any other WASM call, so no view outlives the
//! data it reads. This avoids the allocate/copy/free round trip of returning a `Vec`.

use std::cell::{Cell, RefCell};

use wasm_bindgen::prelude::*;

thread_local! {
    static OUT_U64: RefCell<Vec<u64>> = const { RefCell::new(Vec::new()) };
    static OUT_F64: Cell<[f64; 2]> = const { Cell::new([0.0; 2]) };
    static OUT_F64_BUF: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
}

/// Capacity above which the index buffer is shrunk after a much smaller result, so one large
/// result does not pin memory forever (WASM memory itself never shrinks).
const RETAIN_CAPACITY: usize = 1 << 16;

/// Address of the index output buffer (valid until the next call that writes it).
#[wasm_bindgen]
pub fn out_u64_ptr() -> u32 {
    OUT_U64.with(|v| v.borrow().as_ptr() as usize as u32)
}

/// Address of the float output buffer (valid until the next call that writes it).
#[wasm_bindgen]
pub fn out_f64_ptr() -> u32 {
    OUT_F64_BUF.with(|v| v.borrow().as_ptr() as usize as u32)
}

/// Replaces the index output buffer with `v`; returns its length.
pub(crate) fn store_u64(v: Vec<u64>) -> usize {
    let n = v.len();
    OUT_U64.with(|cell| *cell.borrow_mut() = v);
    n
}

/// Replaces the float output buffer with `v`; returns its length.
pub(crate) fn store_f64(v: Vec<f64>) -> usize {
    let n = v.len();
    OUT_F64_BUF.with(|cell| *cell.borrow_mut() = v);
    n
}

/// Value `i` (0 or 1) of the two-value float output.
#[wasm_bindgen]
pub fn out_f64(i: u32) -> f64 {
    OUT_F64.with(|v| v.get()[(i & 1) as usize])
}

pub(crate) fn set_f64(a: f64, b: f64) {
    OUT_F64.with(|v| v.set([a, b]));
}

/// Runs `fill` on a zeroed index buffer of `n` slots, then compacts away zero slots in place and
/// returns the number of non-zero indexes (or the error from `fill`).
pub(crate) fn fill_nonzero_u64<E>(n: usize, fill: impl FnOnce(&mut [u64]) -> Result<(), E>) -> Result<usize, E> {
    OUT_U64.with(|cell| {
        let mut v = cell.borrow_mut();
        v.clear();
        v.resize(n, 0);
        fill(&mut v)?;
        v.retain(|&h| h != 0);
        let len = v.len();
        if v.capacity() > RETAIN_CAPACITY && v.capacity() > 4 * len {
            v.shrink_to(len.max(RETAIN_CAPACITY));
        }
        Ok(len)
    })
}
