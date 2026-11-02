#![allow(clippy::wrong_self_convention)] // names mirror C (`_ijkToHex2d`, `ijkToCube`, ...)

//! Coordinate primitives: IJK hex coordinates, 2D/3D vectors, and face-local addresses.
//!
//! Translated from H3 C `coordijk.h`, `vec2d.c`, `vec3d.h`, and `faceijk.h` (Apache-2.0,
//! Copyright Uber Technologies, Inc.). Floating-point operation order follows the C source so
//! that results are bit-identical where the platform math library is identical.
//!
//! Integer arithmetic uses wrapping operations: the C code relies on two's-complement behaviour
//! in the few places that can overflow, and guards the meaningful cases explicitly.

use crate::constants::{M_ONESEVENTH, M_RSIN60, M_SQRT3_2};
use crate::math::Trig;

/// An H3 digit / direction (0–7).
pub(crate) type Direction = u8;

pub(crate) const CENTER_DIGIT: Direction = 0;
pub(crate) const K_AXES_DIGIT: Direction = 1;
pub(crate) const J_AXES_DIGIT: Direction = 2;
pub(crate) const JK_AXES_DIGIT: Direction = 3;
pub(crate) const I_AXES_DIGIT: Direction = 4;
pub(crate) const IK_AXES_DIGIT: Direction = 5;
pub(crate) const IJ_AXES_DIGIT: Direction = 6;
pub(crate) const INVALID_DIGIT: Direction = 7;
pub(crate) const NUM_DIGITS: Direction = INVALID_DIGIT;

/// IJK hexagon coordinates. Each axis is spaced 120 degrees apart.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub(crate) struct CoordIjk {
    pub i: i32,
    pub j: i32,
    pub k: i32,
}

pub(crate) const fn ijk(i: i32, j: i32, k: i32) -> CoordIjk {
    CoordIjk { i, j, k }
}

/// Unit vectors indexed by [`Direction`].
pub(crate) const UNIT_VECS: [CoordIjk; 7] =
    [ijk(0, 0, 0), ijk(0, 0, 1), ijk(0, 1, 0), ijk(0, 1, 1), ijk(1, 0, 0), ijk(1, 0, 1), ijk(1, 1, 0)];

/// C `ADD_INT32S_OVERFLOWS`.
#[inline]
pub(crate) fn add_i32_overflows(a: i32, b: i32) -> bool {
    a.checked_add(b).is_none()
}

/// C `SUB_INT32S_OVERFLOWS`.
#[inline]
pub(crate) fn sub_i32_overflows(a: i32, b: i32) -> bool {
    a.checked_sub(b).is_none()
}

impl CoordIjk {
    #[inline]
    pub fn add(self, o: CoordIjk) -> CoordIjk {
        ijk(self.i.wrapping_add(o.i), self.j.wrapping_add(o.j), self.k.wrapping_add(o.k))
    }

    #[inline]
    pub fn sub(self, o: CoordIjk) -> CoordIjk {
        ijk(self.i.wrapping_sub(o.i), self.j.wrapping_sub(o.j), self.k.wrapping_sub(o.k))
    }

    #[inline]
    pub fn scale(self, f: i32) -> CoordIjk {
        ijk(self.i.wrapping_mul(f), self.j.wrapping_mul(f), self.k.wrapping_mul(f))
    }

    /// C `_ijkNormalizeCouldOverflow`.
    pub fn normalize_could_overflow(&self) -> bool {
        let (max, min) = if self.i > self.j { (self.i, self.j) } else { (self.j, self.i) };
        min < 0 && (add_i32_overflows(max, min) || sub_i32_overflows(0, min) || sub_i32_overflows(max, min))
    }

    /// C `_ijkNormalize`: normalizes to the canonical form with no negative components and at
    /// least one zero component.
    pub fn normalize(&mut self) {
        if self.i < 0 {
            self.j = self.j.wrapping_sub(self.i);
            self.k = self.k.wrapping_sub(self.i);
            self.i = 0;
        }
        if self.j < 0 {
            self.i = self.i.wrapping_sub(self.j);
            self.k = self.k.wrapping_sub(self.j);
            self.j = 0;
        }
        if self.k < 0 {
            self.i = self.i.wrapping_sub(self.k);
            self.j = self.j.wrapping_sub(self.k);
            self.k = 0;
        }
        let mut min = self.i;
        if self.j < min {
            min = self.j;
        }
        if self.k < min {
            min = self.k;
        }
        if min > 0 {
            self.i -= min;
            self.j -= min;
            self.k -= min;
        }
    }

    #[inline]
    pub fn normalized(mut self) -> CoordIjk {
        self.normalize();
        self
    }

    /// C `_ijkToHex2d`.
    #[inline]
    pub fn to_hex2d(&self) -> Vec2d {
        let i = self.i.wrapping_sub(self.k);
        let j = self.j.wrapping_sub(self.k);
        Vec2d { x: f64::from(i) - 0.5 * f64::from(j), y: f64::from(j) * M_SQRT3_2 }
    }

    /// C `_unitIjkToDigit`.
    pub fn to_unit_digit(&self) -> Direction {
        let c = self.normalized();
        for (d, v) in UNIT_VECS.iter().enumerate() {
            if c == *v {
                return d as Direction;
            }
        }
        INVALID_DIGIT
    }

    fn lin3(self, iv: CoordIjk, jv: CoordIjk, kv: CoordIjk) -> CoordIjk {
        iv.scale(self.i).add(jv.scale(self.j)).add(kv.scale(self.k)).normalized()
    }

    /// C `_upAp7Checked`.
    pub fn up_ap7_checked(&mut self) -> Result<(), crate::H3Error> {
        let i = self.i.wrapping_sub(self.k);
        let j = self.j.wrapping_sub(self.k);
        const MAX3: i32 = i32::MAX / 3;
        if i >= MAX3 || j >= MAX3 || i < 0 || j < 0 {
            if add_i32_overflows(i, i) {
                return Err(crate::H3Error::Failed);
            }
            let i2 = i + i;
            if add_i32_overflows(i2, i) {
                return Err(crate::H3Error::Failed);
            }
            let i3 = i2 + i;
            if add_i32_overflows(j, j) {
                return Err(crate::H3Error::Failed);
            }
            let j2 = j + j;
            if sub_i32_overflows(i3, j) || add_i32_overflows(i, j2) {
                return Err(crate::H3Error::Failed);
            }
        }
        self.i = lround(f64::from(i * 3 - j) * M_ONESEVENTH);
        self.j = lround(f64::from(i + j * 2) * M_ONESEVENTH);
        self.k = 0;
        if self.normalize_could_overflow() {
            return Err(crate::H3Error::Failed);
        }
        self.normalize();
        Ok(())
    }

    /// C `_upAp7rChecked`.
    pub fn up_ap7r_checked(&mut self) -> Result<(), crate::H3Error> {
        let i = self.i.wrapping_sub(self.k);
        let j = self.j.wrapping_sub(self.k);
        const MAX3: i32 = i32::MAX / 3;
        if i >= MAX3 || j >= MAX3 || i < 0 || j < 0 {
            if add_i32_overflows(i, i) {
                return Err(crate::H3Error::Failed);
            }
            let i2 = i + i;
            if add_i32_overflows(j, j) {
                return Err(crate::H3Error::Failed);
            }
            let j2 = j + j;
            if add_i32_overflows(j2, j) {
                return Err(crate::H3Error::Failed);
            }
            let j3 = j2 + j;
            if add_i32_overflows(i2, j) || sub_i32_overflows(j3, i) {
                return Err(crate::H3Error::Failed);
            }
        }
        self.i = lround(f64::from(i * 2 + j) * M_ONESEVENTH);
        self.j = lround(f64::from(j * 3 - i) * M_ONESEVENTH);
        self.k = 0;
        if self.normalize_could_overflow() {
            return Err(crate::H3Error::Failed);
        }
        self.normalize();
        Ok(())
    }

    /// C `_upAp7`: parent in a counter-clockwise aperture-7 grid.
    pub fn up_ap7(&mut self) {
        let i = self.i.wrapping_sub(self.k);
        let j = self.j.wrapping_sub(self.k);
        self.i = lround(f64::from(i.wrapping_mul(3).wrapping_sub(j)) * M_ONESEVENTH);
        self.j = lround(f64::from(i.wrapping_add(j.wrapping_mul(2))) * M_ONESEVENTH);
        self.k = 0;
        self.normalize();
    }

    /// C `_upAp7r`: parent in a clockwise aperture-7 grid.
    pub fn up_ap7r(&mut self) {
        let i = self.i.wrapping_sub(self.k);
        let j = self.j.wrapping_sub(self.k);
        self.i = lround(f64::from(i.wrapping_mul(2).wrapping_add(j)) * M_ONESEVENTH);
        self.j = lround(f64::from(j.wrapping_mul(3).wrapping_sub(i)) * M_ONESEVENTH);
        self.k = 0;
        self.normalize();
    }

    /// C `_downAp7`.
    pub fn down_ap7(&mut self) {
        *self = self.lin3(ijk(3, 0, 1), ijk(1, 3, 0), ijk(0, 1, 3));
    }

    /// C `_downAp7r`.
    pub fn down_ap7r(&mut self) {
        *self = self.lin3(ijk(3, 1, 0), ijk(0, 3, 1), ijk(1, 0, 3));
    }

    /// C `_downAp3`.
    pub fn down_ap3(&mut self) {
        *self = self.lin3(ijk(2, 0, 1), ijk(1, 2, 0), ijk(0, 1, 2));
    }

    /// C `_downAp3r`.
    pub fn down_ap3r(&mut self) {
        *self = self.lin3(ijk(2, 1, 0), ijk(0, 2, 1), ijk(1, 0, 2));
    }

    /// C `_neighbor`.
    pub fn neighbor(&mut self, digit: Direction) {
        if digit > CENTER_DIGIT && digit < NUM_DIGITS {
            *self = self.add(UNIT_VECS[digit as usize]).normalized();
        }
    }

    /// C `_ijkRotate60ccw`.
    pub fn rotate60ccw(&mut self) {
        *self = self.lin3(ijk(1, 1, 0), ijk(0, 1, 1), ijk(1, 0, 1));
    }

    /// C `_ijkRotate60cw`.
    pub fn rotate60cw(&mut self) {
        *self = self.lin3(ijk(1, 0, 1), ijk(1, 1, 0), ijk(0, 1, 1));
    }

    /// C `ijkDistance`.
    pub fn distance(&self, o: &CoordIjk) -> i32 {
        let d = self.sub(*o).normalized();
        d.i.wrapping_abs().max(d.j.wrapping_abs().max(d.k.wrapping_abs()))
    }

    /// C `ijkToIj`.
    pub fn to_ij(&self) -> crate::CoordIJ {
        crate::CoordIJ { i: self.i.wrapping_sub(self.k), j: self.j.wrapping_sub(self.k) }
    }

    /// C `ijToIjk`.
    pub fn from_ij(ij: crate::CoordIJ) -> Result<CoordIjk, crate::H3Error> {
        let mut c = ijk(ij.i, ij.j, 0);
        if c.normalize_could_overflow() {
            return Err(crate::H3Error::Failed);
        }
        c.normalize();
        Ok(c)
    }

    /// C `ijkToCube`. Note that the C code reads the already-updated `i` and `j` for `k`.
    pub fn to_cube(&mut self) {
        self.i = self.i.wrapping_neg().wrapping_add(self.k);
        self.j = self.j.wrapping_sub(self.k);
        self.k = self.i.wrapping_neg().wrapping_sub(self.j);
    }

    /// C `cubeToIjk`.
    pub fn from_cube(&mut self) {
        self.i = self.i.wrapping_neg();
        self.k = 0;
        self.normalize();
    }
}

/// C `lround` followed by an `(int)` cast. Rust `f64::round` rounds half away from zero, matching
/// `lround`. The value range at every call site is bounded so the conversion is exact.
#[inline]
fn lround(x: f64) -> i32 {
    x.round() as i64 as i32
}

/// C `_rotate60ccw` on a digit.
#[inline]
pub(crate) const fn rotate_digit60ccw(d: Direction) -> Direction {
    match d {
        K_AXES_DIGIT => IK_AXES_DIGIT,
        IK_AXES_DIGIT => I_AXES_DIGIT,
        I_AXES_DIGIT => IJ_AXES_DIGIT,
        IJ_AXES_DIGIT => J_AXES_DIGIT,
        J_AXES_DIGIT => JK_AXES_DIGIT,
        JK_AXES_DIGIT => K_AXES_DIGIT,
        _ => d,
    }
}

/// C `_rotate60cw` on a digit.
#[inline]
pub(crate) const fn rotate_digit60cw(d: Direction) -> Direction {
    match d {
        K_AXES_DIGIT => JK_AXES_DIGIT,
        JK_AXES_DIGIT => J_AXES_DIGIT,
        J_AXES_DIGIT => IJ_AXES_DIGIT,
        IJ_AXES_DIGIT => I_AXES_DIGIT,
        I_AXES_DIGIT => IK_AXES_DIGIT,
        IK_AXES_DIGIT => K_AXES_DIGIT,
        _ => d,
    }
}

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

/// Face number and IJK coordinates on that face-centered coordinate system.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct FaceIjk {
    pub face: i32,
    pub coord: CoordIjk,
}

/// Information to transform into an adjacent face IJK system.
#[derive(Clone, Copy, Debug)]
pub(crate) struct FaceOrientIjk {
    pub face: i32,
    pub translate: CoordIjk,
    pub ccw_rot60: i32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_digit_round_trip() {
        for (d, v) in UNIT_VECS.iter().enumerate() {
            assert_eq!(v.to_unit_digit(), d as Direction);
        }
        assert_eq!(ijk(2, 0, 0).to_unit_digit(), INVALID_DIGIT);
    }

    #[test]
    fn rotations_are_inverse() {
        for d in 0..7 {
            assert_eq!(rotate_digit60cw(rotate_digit60ccw(d)), d);
            let mut c = UNIT_VECS[d as usize];
            c.rotate60ccw();
            c.rotate60cw();
            assert_eq!(c, UNIT_VECS[d as usize]);
        }
    }

    #[test]
    fn ap7_round_trip() {
        let mut c = ijk(2, 0, 1);
        let orig = c;
        c.down_ap7();
        c.up_ap7();
        assert_eq!(c, orig.normalized());
        let mut c = orig;
        c.down_ap7r();
        c.up_ap7r();
        assert_eq!(c, orig.normalized());
    }

    #[test]
    fn hex2d_origin() {
        assert_eq!(Vec2d { x: 0.0, y: 0.0 }.to_coord_ijk(), ijk(0, 0, 0));
        assert_eq!(Vec2d { x: 1.0, y: 0.0 }.to_coord_ijk(), ijk(1, 0, 0));
    }
}
