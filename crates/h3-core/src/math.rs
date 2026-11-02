//! The transcendental functions the H3 algorithms use, behind one switch.
//!
//! By default these call the platform's libm through `std` (`f64::sin` and friends), the same
//! library a locally built H3 C uses, so results match C on the same machine (bit for bit on linux
//! x86-64 glibc, where the parity fixtures are generated). With the `libm` feature they call the
//! pure-Rust [`libm`](https://crates.io/crates/libm) crate instead, which gives the same bits on
//! every platform and matches this crate's WebAssembly build (which enables the feature).
//!
//! Square roots are not routed here: IEEE 754 requires `sqrt` to be correctly rounded, so it is
//! identical everywhere. Everything else in the crate is plain arithmetic, which Rust never
//! contracts into fused multiply-adds.

/// The six libm functions, as methods so call sites read like `std`'s (`x.h3_sin()`).
pub(crate) trait Trig {
    fn h3_sin(self) -> Self;
    fn h3_cos(self) -> Self;
    fn h3_tan(self) -> Self;
    fn h3_acos(self) -> Self;
    fn h3_atan(self) -> Self;
    fn h3_atan2(self, x: Self) -> Self;
}

#[cfg(not(feature = "libm"))]
impl Trig for f64 {
    #[inline(always)]
    fn h3_sin(self) -> f64 {
        self.sin()
    }
    #[inline(always)]
    fn h3_cos(self) -> f64 {
        self.cos()
    }
    #[inline(always)]
    fn h3_tan(self) -> f64 {
        self.tan()
    }
    #[inline(always)]
    fn h3_acos(self) -> f64 {
        self.acos()
    }
    #[inline(always)]
    fn h3_atan(self) -> f64 {
        self.atan()
    }
    #[inline(always)]
    fn h3_atan2(self, x: f64) -> f64 {
        self.atan2(x)
    }
}

#[cfg(feature = "libm")]
impl Trig for f64 {
    #[inline(always)]
    fn h3_sin(self) -> f64 {
        libm::sin(self)
    }
    #[inline(always)]
    fn h3_cos(self) -> f64 {
        libm::cos(self)
    }
    #[inline(always)]
    fn h3_tan(self) -> f64 {
        libm::tan(self)
    }
    #[inline(always)]
    fn h3_acos(self) -> f64 {
        libm::acos(self)
    }
    #[inline(always)]
    fn h3_atan(self) -> f64 {
        libm::atan(self)
    }
    #[inline(always)]
    fn h3_atan2(self, x: f64) -> f64 {
        libm::atan2(self, x)
    }
}
