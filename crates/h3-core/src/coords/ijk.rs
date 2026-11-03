//! Integer IJK coordinates and H3 direction digits.
#![allow(clippy::wrong_self_convention)]
use super::Vec2d;
use crate::constants::{M_ONESEVENTH, M_SQRT3_2};
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
