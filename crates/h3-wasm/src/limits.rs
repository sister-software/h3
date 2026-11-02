//! Deterministic per-request budgets (docs/api-decisions.md, "Resource limits").
//!
//! An [`Estimate`] is computed with floating-point arithmetic on non-negative integer counts. All
//! inputs are far below 2^53 or are compared against limits that are, so a value that rounds is
//! already over any representable limit; `f64` therefore acts as saturating checked arithmetic.

use std::cell::Cell;

use wasm_bindgen::prelude::*;

use crate::set_error;

pub(crate) const LIMIT_ITEMS: u32 = 1001;
pub(crate) const LIMIT_RESULT_BYTES: u32 = 1002;
pub(crate) const LIMIT_WORKSPACE: u32 = 1003;
/// A count that is not a JavaScript safe integer.
pub(crate) const UNSAFE_INTEGER: u32 = 1004;

/// Estimated bytes per index in flattened WASM output.
const INDEX_WASM_BYTES: f64 = 8.0;
/// Estimated JavaScript bytes per index result: the string (48) plus its array slot (8).
const INDEX_JS_BYTES: f64 = 56.0;
/// Estimated bytes per number: WASM `f64` (8) plus a JavaScript array slot (8).
const NUMBER_BYTES: f64 = 16.0;
/// Estimated JavaScript bytes per array object.
const ARRAY_JS_BYTES: f64 = 16.0;

#[derive(Clone, Copy)]
struct Limits {
    items: f64,
    result_bytes: f64,
    workspace_bytes: f64,
}

thread_local! {
    static LIMITS: Cell<Limits> =
        const { Cell::new(Limits { items: 0.0, result_bytes: 0.0, workspace_bytes: 0.0 }) };
    static DETAIL: Cell<(f64, f64)> = const { Cell::new((0.0, 0.0)) };
}

/// Sets the budgets resolved by the TypeScript runtime at initialization. Until called, every
/// variable-length request is rejected.
#[wasm_bindgen]
pub fn set_limits(items: f64, result_bytes: f64, workspace_bytes: f64) {
    LIMITS.with(|l| l.set(Limits { items, result_bytes, workspace_bytes }));
}

/// The requested amount for the most recent resource-limit rejection.
#[wasm_bindgen]
pub fn limit_requested() -> f64 {
    DETAIL.with(|d| d.get().0)
}

/// The maximum for the most recent resource-limit rejection.
#[wasm_bindgen]
pub fn limit_maximum() -> f64 {
    DETAIL.with(|d| d.get().1)
}

/// A request estimate: result items, result bytes, workspace bytes.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Estimate {
    pub items: f64,
    pub result_bytes: f64,
    pub workspace_bytes: f64,
}

impl Estimate {
    /// A flat array of `n` index strings.
    pub fn indexes(n: usize) -> Estimate {
        Estimate::indexes_f(n as f64)
    }

    /// A flat array of `n` index strings, from a C `int64_t` size.
    pub fn indexes_i64(n: i64) -> Estimate {
        Estimate::indexes_f(n.max(0) as f64)
    }

    fn indexes_f(n: f64) -> Estimate {
        Estimate {
            items: n,
            result_bytes: n * (INDEX_WASM_BYTES + INDEX_JS_BYTES) + ARRAY_JS_BYTES,
            workspace_bytes: 0.0,
        }
    }

    /// `n` numbers grouped into `arrays` JavaScript arrays (e.g. coordinate pairs).
    #[allow(dead_code)]
    pub fn numbers(n: f64, arrays: f64) -> Estimate {
        Estimate { items: n, result_bytes: n * NUMBER_BYTES + arrays * ARRAY_JS_BYTES, workspace_bytes: 0.0 }
    }

    pub fn with_workspace(mut self, bytes: f64) -> Estimate {
        self.workspace_bytes += bytes;
        self
    }

    #[allow(dead_code)]
    pub fn plus(self, o: Estimate) -> Estimate {
        Estimate {
            items: self.items + o.items,
            result_bytes: self.result_bytes + o.result_bytes,
            workspace_bytes: self.workspace_bytes + o.workspace_bytes,
        }
    }
}

/// Admits a request or records a resource-limit rejection. A request exactly at a limit passes.
pub(crate) fn admit(e: Estimate) -> bool {
    let l = LIMITS.with(Cell::get);
    let reject = |code: u32, requested: f64, maximum: f64| {
        DETAIL.with(|d| d.set((requested, maximum)));
        set_error(code);
        false
    };
    if e.items > l.items {
        return reject(LIMIT_ITEMS, e.items, l.items);
    }
    if e.result_bytes > l.result_bytes {
        return reject(LIMIT_RESULT_BYTES, e.result_bytes, l.result_bytes);
    }
    if e.workspace_bytes > l.workspace_bytes {
        return reject(LIMIT_WORKSPACE, e.workspace_bytes, l.workspace_bytes);
    }
    true
}
