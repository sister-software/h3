//! Spherical areas.
//!
//! Translated from H3 C `area.c` and `adder.h` (Apache-2.0, Copyright Uber Technologies, Inc.).
//! Summation uses the same Kahan compensated algorithm and operation order as C.

use crate::LatLng;
use crate::cell::cell_to_boundary;
use crate::constants::{EARTH_RADIUS_KM, M_PI};
use crate::errors::H3Result;

/// C `Adder` / `kadd`: Kahan compensated summation.
#[derive(Default)]
pub(crate) struct Adder {
    pub sum: f64,
    c: f64,
}

impl Adder {
    #[inline]
    pub fn add(&mut self, x: f64) {
        let y = x - self.c;
        let t = self.sum + y;
        self.c = (t - self.sum) - y;
        self.sum = t;
    }
}

/// C `cagnoli`: the Cagnoli contribution for the edge arc x to y.
#[inline]
fn cagnoli(mut x: LatLng, mut y: LatLng) -> f64 {
    x.lat = x.lat / 2.0 + M_PI / 4.0;
    y.lat = y.lat / 2.0 + M_PI / 4.0;
    let sa = x.lat.sin() * y.lat.sin();
    let ca = x.lat.cos() * y.lat.cos();
    let d = y.lng - x.lng;
    let sd = d.sin();
    let cd = d.cos();
    -2.0 * (sa * sd).atan2(sa * cd + ca)
}

/// C `geoLoopAreaRads2`.
pub(crate) fn geo_loop_area_rads2(verts: &[LatLng]) -> f64 {
    let mut adder = Adder::default();
    let n = verts.len();
    for i in 0..n {
        let j = (i + 1) % n;
        adder.add(cagnoli(verts[i], verts[j]));
    }
    if adder.sum < 0.0 {
        adder.add(4.0 * M_PI);
    }
    adder.sum
}

/// C `cellAreaRads2`.
pub fn cell_area_rads2(cell: u64) -> H3Result<f64> {
    Ok(geo_loop_area_rads2(&cell_to_boundary(cell)?))
}

/// C `cellAreaKm2`.
pub fn cell_area_km2(cell: u64) -> H3Result<f64> {
    Ok(cell_area_rads2(cell)? * (EARTH_RADIUS_KM * EARTH_RADIUS_KM))
}

/// C `cellAreaM2`.
pub fn cell_area_m2(cell: u64) -> H3Result<f64> {
    Ok(cell_area_km2(cell)? * f64::from(1000 * 1000))
}
