//! H3 index bit layout, validation, and base-cell lookups.
//!
//! Translated from H3 C `h3Index.h`, `h3Index.c`, and `baseCells.c` (Apache-2.0, Copyright Uber
//! Technologies, Inc.). Functions here operate on raw `u64` values with C semantics: like C,
//! most accessors do not validate their argument.

use crate::constants::*;
use crate::coords::{
    CENTER_DIGIT, Direction, FaceIjk, INVALID_DIGIT, K_AXES_DIGIT, NUM_DIGITS, rotate_digit60ccw, rotate_digit60cw,
};
use crate::errors::{H3Error, H3Result};
use crate::tables::{BASE_CELL_DATA, BASE_CELL_NEIGHBORS, FACE_IJK_BASE_CELLS};

pub(crate) const H3_NULL: u64 = 0;
pub(crate) const H3_MODE_OFFSET: u32 = 59;
pub(crate) const H3_BC_OFFSET: u32 = 45;
pub(crate) const H3_RES_OFFSET: u32 = 52;
pub(crate) const H3_RESERVED_OFFSET: u32 = 56;
pub(crate) const H3_PER_DIGIT_OFFSET: u32 = 3;
pub(crate) const H3_MODE_MASK: u64 = 15 << H3_MODE_OFFSET;
pub(crate) const H3_BC_MASK: u64 = 127 << H3_BC_OFFSET;
pub(crate) const H3_RES_MASK: u64 = 15 << H3_RES_OFFSET;
pub(crate) const H3_RESERVED_MASK: u64 = 7 << H3_RESERVED_OFFSET;
pub(crate) const H3_DIGIT_MASK: u64 = 7;
/// C `H3_INIT`: mode 0, res 0, base cell 0, all digits 7.
pub(crate) const H3_INIT: u64 = 35184372088831;

#[inline]
pub(crate) const fn get_mode(h: u64) -> u64 {
    (h & H3_MODE_MASK) >> H3_MODE_OFFSET
}
#[inline]
pub(crate) const fn set_mode(h: u64, v: u64) -> u64 {
    (h & !H3_MODE_MASK) | (v << H3_MODE_OFFSET)
}
#[inline]
pub(crate) const fn get_base_cell(h: u64) -> i32 {
    ((h & H3_BC_MASK) >> H3_BC_OFFSET) as i32
}
#[inline]
pub(crate) const fn set_base_cell(h: u64, bc: i32) -> u64 {
    (h & !H3_BC_MASK) | ((bc as u64) << H3_BC_OFFSET)
}
#[inline]
pub(crate) const fn get_resolution(h: u64) -> i32 {
    ((h & H3_RES_MASK) >> H3_RES_OFFSET) as i32
}
#[inline]
pub(crate) const fn set_resolution(h: u64, res: i32) -> u64 {
    (h & !H3_RES_MASK) | ((res as u64) << H3_RES_OFFSET)
}
#[inline]
pub(crate) const fn get_reserved_bits(h: u64) -> u64 {
    (h & H3_RESERVED_MASK) >> H3_RESERVED_OFFSET
}
#[inline]
pub(crate) const fn set_reserved_bits(h: u64, v: u64) -> u64 {
    (h & !H3_RESERVED_MASK) | (v << H3_RESERVED_OFFSET)
}
/// C `H3_GET_INDEX_DIGIT`; `res` must be in 1..=15.
#[inline]
pub(crate) const fn get_index_digit(h: u64, res: i32) -> Direction {
    ((h >> ((MAX_H3_RES - res) as u32 * H3_PER_DIGIT_OFFSET)) & H3_DIGIT_MASK) as Direction
}
/// C `H3_SET_INDEX_DIGIT`; `res` must be in 1..=15.
#[inline]
pub(crate) const fn set_index_digit(h: u64, res: i32, digit: u64) -> u64 {
    let shift = (MAX_H3_RES - res) as u32 * H3_PER_DIGIT_OFFSET;
    (h & !(H3_DIGIT_MASK << shift)) | (digit << shift)
}

/// C `isResolutionClassIII`.
#[inline]
pub(crate) const fn is_resolution_class_iii(res: i32) -> bool {
    res % 2 != 0
}

/// C `_isBaseCellPentagon`.
#[inline]
pub(crate) fn is_base_cell_pentagon(base_cell: i32) -> bool {
    if !(0..NUM_BASE_CELLS).contains(&base_cell) {
        return false;
    }
    BASE_CELL_DATA[base_cell as usize].is_pentagon
}

/// C `_isBaseCellPolarPentagon`.
#[inline]
pub(crate) const fn is_base_cell_polar_pentagon(base_cell: i32) -> bool {
    base_cell == 4 || base_cell == 117
}

/// C `_faceIjkToBaseCell`. Coordinates must be in 0..=2.
#[inline]
pub(crate) fn face_ijk_to_base_cell(h: &FaceIjk) -> i32 {
    i32::from(FACE_IJK_BASE_CELLS[h.face as usize][h.coord.i as usize][h.coord.j as usize][h.coord.k as usize].0)
}

/// C `_faceIjkToBaseCellCCWrot60`.
#[inline]
pub(crate) fn face_ijk_to_base_cell_ccwrot60(h: &FaceIjk) -> i32 {
    i32::from(FACE_IJK_BASE_CELLS[h.face as usize][h.coord.i as usize][h.coord.j as usize][h.coord.k as usize].1)
}

/// C `_baseCellToCCWrot60`.
pub(crate) fn base_cell_to_ccwrot60(base_cell: i32, face: i32) -> i32 {
    if !(0..NUM_ICOSA_FACES as i32).contains(&face) {
        return INVALID_ROTATIONS;
    }
    for plane in &FACE_IJK_BASE_CELLS[face as usize] {
        for row in plane {
            for &(bc, rot) in row {
                if i32::from(bc) == base_cell {
                    return i32::from(rot);
                }
            }
        }
    }
    INVALID_ROTATIONS
}

/// C `_baseCellIsCwOffset`.
#[inline]
pub(crate) fn base_cell_is_cw_offset(base_cell: i32, test_face: i32) -> bool {
    let d = &BASE_CELL_DATA[base_cell as usize];
    i32::from(d.cw_offset_pent[0]) == test_face || i32::from(d.cw_offset_pent[1]) == test_face
}

/// C `_getBaseCellNeighbor`.
#[inline]
pub(crate) fn get_base_cell_neighbor(base_cell: i32, dir: Direction) -> i32 {
    i32::from(BASE_CELL_NEIGHBORS[base_cell as usize][dir as usize])
}

/// C `_getBaseCellDirection`.
pub(crate) fn get_base_cell_direction(origin: i32, neighbor: i32) -> Direction {
    for dir in CENTER_DIGIT..NUM_DIGITS {
        if get_base_cell_neighbor(origin, dir) == neighbor {
            return dir;
        }
    }
    INVALID_DIGIT
}

/// C `_hasGoodTopBits`.
#[inline]
const fn has_good_top_bits(h: u64) -> bool {
    (h >> (64 - 8)) == 0b0000_1000
}

/// C `_hasAny7UptoRes`.
#[inline]
const fn has_any_7_upto_res(h: u64, res: i32) -> bool {
    const MHI: u64 = 0b100100100100100100100100100100100100100100100;
    const MLO: u64 = MHI >> 2;
    let shift = 3 * (15 - res) as u32;
    let h = (h >> shift) << shift;
    (h & MHI & ((!h).wrapping_sub(MLO))) != 0
}

/// C `_hasAll7AfterRes`.
#[inline]
const fn has_all_7_after_res(h: u64, res: i32) -> bool {
    if res < 15 {
        let shift = 19 + 3 * res as u32;
        let h = ((!h) << shift) >> shift;
        return h == 0;
    }
    true
}

/// C `_hasDeletedSubsequence`.
#[inline]
fn has_deleted_subsequence(h: u64, base_cell: i32) -> bool {
    if is_base_cell_pentagon(base_cell) {
        let h = (h << 19) >> 19;
        if h == 0 {
            return false;
        }
        return (63 - h.leading_zeros()).is_multiple_of(3);
    }
    false
}

/// C `isValidCell`.
pub fn is_valid_cell(h: u64) -> bool {
    if !has_good_top_bits(h) {
        return false;
    }
    let res = get_resolution(h);
    let bc = get_base_cell(h);
    if bc >= NUM_BASE_CELLS {
        return false;
    }
    if has_any_7_upto_res(h, res) || !has_all_7_after_res(h, res) || has_deleted_subsequence(h, bc) {
        return false;
    }
    true
}

/// C `setH3Index`.
pub(crate) fn set_h3_index(res: i32, base_cell: i32, init_digit: Direction) -> u64 {
    let mut h = set_mode(H3_INIT, H3_CELL_MODE);
    h = set_resolution(h, res);
    h = set_base_cell(h, base_cell);
    for r in 1..=res {
        h = set_index_digit(h, r, u64::from(init_digit));
    }
    h
}

/// C `_h3LeadingNonZeroDigit`.
pub(crate) fn leading_non_zero_digit(h: u64) -> Direction {
    for r in 1..=get_resolution(h) {
        let d = get_index_digit(h, r);
        if d != 0 {
            return d;
        }
    }
    CENTER_DIGIT
}

/// C `isPentagon`.
pub fn is_pentagon(h: u64) -> bool {
    is_base_cell_pentagon(get_base_cell(h)) && leading_non_zero_digit(h) == CENTER_DIGIT
}

/// C `isResClassIII`.
pub fn is_res_class_iii(h: u64) -> bool {
    get_resolution(h) % 2 != 0
}

/// C `_h3Rotate60ccw`.
pub(crate) fn rotate60ccw(mut h: u64) -> u64 {
    for r in 1..=get_resolution(h) {
        h = set_index_digit(h, r, u64::from(rotate_digit60ccw(get_index_digit(h, r))));
    }
    h
}

/// C `_h3Rotate60cw`.
pub(crate) fn rotate60cw(mut h: u64) -> u64 {
    for r in 1..=get_resolution(h) {
        h = set_index_digit(h, r, u64::from(rotate_digit60cw(get_index_digit(h, r))));
    }
    h
}

/// C `_h3RotatePent60ccw`.
pub(crate) fn rotate_pent60ccw(mut h: u64) -> u64 {
    let mut found_first_non_zero = false;
    let res = get_resolution(h);
    for r in 1..=res {
        h = set_index_digit(h, r, u64::from(rotate_digit60ccw(get_index_digit(h, r))));
        if !found_first_non_zero && get_index_digit(h, r) != 0 {
            found_first_non_zero = true;
            if leading_non_zero_digit(h) == K_AXES_DIGIT {
                h = rotate60ccw(h);
            }
        }
    }
    h
}

/// C `_h3RotatePent60cw`.
pub(crate) fn rotate_pent60cw(mut h: u64) -> u64 {
    let mut found_first_non_zero = false;
    let res = get_resolution(h);
    for r in 1..=res {
        h = set_index_digit(h, r, u64::from(rotate_digit60cw(get_index_digit(h, r))));
        if !found_first_non_zero && get_index_digit(h, r) != 0 {
            found_first_non_zero = true;
            if leading_non_zero_digit(h) == K_AXES_DIGIT {
                h = rotate60cw(h);
            }
        }
    }
    h
}

/// C `_zeroIndexDigits`: zero digits `start..=end`. No-op if `start > end`.
pub(crate) fn zero_index_digits(h: u64, start: i32, end: i32) -> u64 {
    if start > end {
        return h;
    }
    let mut m: u64 = !0;
    m = m.checked_shl(H3_PER_DIGIT_OFFSET * (end - start + 1) as u32).unwrap_or(0);
    m = !m;
    m = m.checked_shl(H3_PER_DIGIT_OFFSET * (MAX_H3_RES - end) as u32).unwrap_or(0);
    m = !m;
    h & m
}

/// C `getResolution` (raw bit extraction).
pub fn get_resolution_raw(h: u64) -> i32 {
    get_resolution(h)
}

/// C `getBaseCellNumber` (raw bit extraction).
pub fn get_base_cell_number(h: u64) -> i32 {
    get_base_cell(h)
}

/// C `getIndexDigit`.
pub fn get_index_digit_checked(h: u64, res: i32) -> H3Result<i32> {
    if !(1..=MAX_H3_RES).contains(&res) {
        return Err(H3Error::ResDomain);
    }
    Ok(i32::from(get_index_digit(h, res)))
}

/// C `constructCell`. `digits` must contain at least `res` entries.
pub fn construct_cell(res: i32, base_cell_number: i32, digits: &[i32]) -> H3Result<u64> {
    if !(0..=MAX_H3_RES).contains(&res) {
        return Err(H3Error::ResDomain);
    }
    if !(0..NUM_BASE_CELLS).contains(&base_cell_number) {
        return Err(H3Error::BaseCellDomain);
    }
    if digits.len() < res as usize {
        return Err(H3Error::DigitDomain);
    }
    let mut h = set_mode(H3_INIT, H3_CELL_MODE);
    h = set_resolution(h, res);
    h = set_base_cell(h, base_cell_number);
    let mut pentagon = is_base_cell_pentagon(base_cell_number);
    for r in 1..=res {
        let d = digits[(r - 1) as usize];
        if !(0..7).contains(&d) {
            return Err(H3Error::DigitDomain);
        }
        if pentagon {
            if d == 0 {
                // still a pentagon
            } else if d == 1 {
                return Err(H3Error::DeletedDigit);
            } else {
                pentagon = false;
            }
        }
        h = set_index_digit(h, r, d as u64);
    }
    Ok(h)
}

/// C `getRes0Cells`.
pub fn get_res0_cells() -> Vec<u64> {
    (0..NUM_BASE_CELLS).map(|bc| set_base_cell(set_mode(H3_INIT, H3_CELL_MODE), bc)).collect()
}

/// C `res0CellCount`.
pub const fn res0_cell_count() -> i32 {
    NUM_BASE_CELLS
}

/// C `pentagonCount`.
pub const fn pentagon_count() -> i32 {
    NUM_PENTAGONS
}

/// C `getPentagons`.
pub fn get_pentagons(res: i32) -> H3Result<Vec<u64>> {
    if !(0..=MAX_H3_RES).contains(&res) {
        return Err(H3Error::ResDomain);
    }
    Ok((0..NUM_BASE_CELLS).filter(|&bc| is_base_cell_pentagon(bc)).map(|bc| set_h3_index(res, bc, 0)).collect())
}

/// C `_ipow` with wrapping semantics.
pub(crate) const fn ipow(mut base: i64, mut exp: i64) -> i64 {
    let mut result: i64 = 1;
    while exp != 0 {
        if exp & 1 != 0 {
            result = result.wrapping_mul(base);
        }
        exp >>= 1;
        base = base.wrapping_mul(base);
    }
    result
}

/// C `getNumCells`.
pub fn get_num_cells(res: i32) -> H3Result<i64> {
    if !(0..=MAX_H3_RES).contains(&res) {
        return Err(H3Error::ResDomain);
    }
    Ok(2 + 120 * ipow(7, i64::from(res)))
}

/// C `stringToH3` restricted to the canonical form: 1–16 hexadecimal digits in either case.
///
/// C `sscanf("%" PRIx64)` is more permissive (whitespace, `0x`, signs, trailing garbage); this
/// crate deliberately accepts only plain hexadecimal digits.
pub fn string_to_h3(s: &str) -> H3Result<u64> {
    if s.is_empty() || s.len() > 16 || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(H3Error::Failed);
    }
    u64::from_str_radix(s, 16).map_err(|_| H3Error::Failed)
}

/// C `h3ToString`: lowercase hexadecimal with no prefix or padding.
pub fn h3_to_string(h: u64) -> String {
    format!("{h:x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn set_high_bit(h: u64, v: u64) -> u64 {
        (h & !(1 << 63)) | (v << 63)
    }

    #[test]
    fn res0_cells_are_valid() {
        let cells = get_res0_cells();
        assert_eq!(cells.len(), 122);
        assert!(cells.iter().all(|&c| is_valid_cell(c)));
        assert_eq!(h3_to_string(cells[0]), "8001fffffffffff");
    }

    #[test]
    fn pentagons() {
        let p = get_pentagons(0).unwrap();
        assert_eq!(p.len(), 12);
        assert!(p.iter().all(|&c| is_pentagon(c) && is_valid_cell(c)));
    }

    #[test]
    fn rejects_bad_bits() {
        assert!(!is_valid_cell(0));
        assert!(!is_valid_cell(H3_INIT));
        let c = get_res0_cells()[0];
        assert!(!is_valid_cell(set_high_bit(c, 1)));
        assert!(!is_valid_cell(set_reserved_bits(c, 1)));
        assert!(!is_valid_cell(set_mode(c, 2)));
        assert!(!is_valid_cell(set_base_cell(c, 122)));
    }

    #[test]
    fn string_parsing() {
        assert_eq!(string_to_h3("85283473fffffff"), Ok(0x85283473fffffff));
        assert_eq!(string_to_h3("85283473FFFFFFF"), Ok(0x85283473fffffff));
        for bad in ["", "0x1", " 1", "-1", "+1", "11111111111111111", "g"] {
            assert_eq!(string_to_h3(bad), Err(H3Error::Failed), "{bad:?}");
        }
    }
}
