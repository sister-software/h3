//! Floating-point vectors translated from H3 C `vec2d.c` and `vec3d.h` (Apache-2.0).
#![allow(clippy::wrong_self_convention)] // Conversion names follow the C coordinate operations.
use super::CoordIjk;
use crate::constants::M_RSIN60;
use crate::math::Trig;
/// 2D floating-point vector.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct Vec2d {
    pub x: f64,
    pub y: f64,
}

impl Vec2d {
    /// C `_v2dMag`.
    #[inline]
    pub fn mag(&self) -> f64 {
        (self.x * self.x + self.y * self.y).sqrt()
    }

    /// C `_v2dAlmostEquals`, using `FLT_EPSILON`.
    #[inline]
    pub fn almost_equals(&self, o: &Vec2d) -> bool {
        (self.x - o.x).abs() < f64::from(f32::EPSILON) && (self.y - o.y).abs() < f64::from(f32::EPSILON)
    }

    /// C `_hex2dToCoordIJK`: the IJK coordinates of the hexagon containing this point.
    pub fn to_coord_ijk(&self) -> CoordIjk {
        let mut h = CoordIjk::default();
        let a1 = self.x.abs();
        let a2 = self.y.abs();

        let x2 = a2 * M_RSIN60;
        let x1 = a1 + x2 / 2.0;

        let m1 = x1 as i32;
        let m2 = x2 as i32;

        let r1 = x1 - f64::from(m1);
        let r2 = x2 - f64::from(m2);

        if r1 < 0.5 {
            if r1 < 1.0 / 3.0 {
                if r2 < (1.0 + r1) / 2.0 {
                    h.i = m1;
                    h.j = m2;
                } else {
                    h.i = m1;
                    h.j = m2.wrapping_add(1);
                }
            } else {
                h.j = if r2 < (1.0 - r1) { m2 } else { m2.wrapping_add(1) };
                h.i = if (1.0 - r1) <= r2 && r2 < (2.0 * r1) { m1.wrapping_add(1) } else { m1 };
            }
        } else if r1 < 2.0 / 3.0 {
            h.j = if r2 < (1.0 - r1) { m2 } else { m2.wrapping_add(1) };
            h.i = if (2.0 * r1 - 1.0) < r2 && r2 < (1.0 - r1) { m1 } else { m1.wrapping_add(1) };
        } else if r2 < (r1 / 2.0) {
            h.i = m1.wrapping_add(1);
            h.j = m2;
        } else {
            h.i = m1.wrapping_add(1);
            h.j = m2.wrapping_add(1);
        }

        // fold across the axes if necessary
        if self.x < 0.0 {
            if h.j % 2 == 0 {
                let axisi = i64::from(h.j) / 2;
                let diff = i64::from(h.i) - axisi;
                h.i = (f64::from(h.i) - 2.0 * diff as f64) as i32;
            } else {
                let axisi = (i64::from(h.j) + 1) / 2;
                let diff = i64::from(h.i) - axisi;
                h.i = (f64::from(h.i) - (2.0 * diff as f64 + 1.0)) as i32;
            }
        }

        if self.y < 0.0 {
            h.i = h.i.wrapping_sub(h.j.wrapping_mul(2).wrapping_add(1) / 2);
            h.j = h.j.wrapping_neg();
        }

        h.normalize();
        h
    }
}

/// C `_v2dIntersect`: intersection of lines p0-p1 and p2-p3.
pub(crate) fn v2d_intersect(p0: &Vec2d, p1: &Vec2d, p2: &Vec2d, p3: &Vec2d) -> Vec2d {
    let s1 = Vec2d { x: p1.x - p0.x, y: p1.y - p0.y };
    let s2 = Vec2d { x: p3.x - p2.x, y: p3.y - p2.y };
    let t = (s2.x * (p0.y - p2.y) - s2.y * (p0.x - p2.x)) / (-s2.x * s1.y + s1.x * s2.y);
    Vec2d { x: p0.x + (t * s1.x), y: p0.y + (t * s1.y) }
}

/// 3D floating-point vector; a point on the unit sphere for geodesic work.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct Vec3d {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vec3d {
    /// C `latLngToVec3`.
    #[inline]
    pub fn from_lat_lng(lat: f64, lng: f64) -> Vec3d {
        let r = lat.h3_cos();
        Vec3d { x: lng.h3_cos() * r, y: lng.h3_sin() * r, z: lat.h3_sin() }
    }

    /// C `vec3ToLatLng`: returns (lat, lng) in radians.
    #[inline]
    pub fn to_lat_lng(self) -> (f64, f64) {
        (self.z.h3_atan2((self.x * self.x + self.y * self.y).sqrt()), self.y.h3_atan2(self.x))
    }

    /// C `vec3LinComb`.
    #[inline]
    pub fn lin_comb(a: f64, v1: Vec3d, b: f64, v2: Vec3d) -> Vec3d {
        Vec3d { x: a * v1.x + b * v2.x, y: a * v1.y + b * v2.y, z: a * v1.z + b * v2.z }
    }

    /// C `vec3Cross`.
    #[inline]
    pub fn cross(self, v2: Vec3d) -> Vec3d {
        Vec3d { x: self.y * v2.z - self.z * v2.y, y: self.z * v2.x - self.x * v2.z, z: self.x * v2.y - self.y * v2.x }
    }

    /// C `vec3Dot`.
    #[inline]
    pub fn dot(self, v2: Vec3d) -> f64 {
        self.x * v2.x + self.y * v2.y + self.z * v2.z
    }

    /// C `vec3NormSq`.
    #[inline]
    pub fn norm_sq(self) -> f64 {
        self.dot(self)
    }

    /// C `vec3Norm`.
    #[inline]
    pub fn norm(self) -> f64 {
        self.norm_sq().sqrt()
    }

    /// C `vec3Normalize`.
    #[inline]
    pub fn normalize(&mut self) {
        let norm = self.norm();
        let s = if norm > 0.0 { 1.0 / norm } else { 0.0 };
        self.x *= s;
        self.y *= s;
        self.z *= s;
    }

    /// C `vec3DistSq`.
    #[inline]
    pub fn dist_sq(self, v2: Vec3d) -> f64 {
        Vec3d::lin_comb(1.0, self, -1.0, v2).norm_sq()
    }
}
