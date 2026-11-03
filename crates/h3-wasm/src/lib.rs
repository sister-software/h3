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

mod inspection;
pub use inspection::*;
mod coordinates;
pub use coordinates::*;
mod hierarchy;
pub use hierarchy::*;
mod traversal;
pub use traversal::*;
mod edges;
pub use edges::*;
mod measurements;
pub use measurements::*;
mod polygons;
pub use polygons::*;

fn nonzero(v: Vec<u64>) -> Vec<u64> {
    v.into_iter().filter(|&h| h != 0).collect()
}
