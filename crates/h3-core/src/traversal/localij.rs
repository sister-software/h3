//! Face-local IJ conversion, translated from H3 C `localij.c` (Apache-2.0).
use crate::CoordIJ;
use crate::cell::h3_to_face_ijk_with_initialized_fijk;
use crate::constants::*;
use crate::coords::*;
use crate::errors::{H3Error, H3Result};
use crate::index::*;
use crate::tables::BASE_CELL_NEIGHBOR_60CCW_ROTS;
const PENTAGON_ROTATIONS: [[i32; 7]; 7] = [
    [0, -1, 0, 0, 0, 0, 0],
    [-1, -1, -1, -1, -1, -1, -1],
    [0, -1, 0, 0, 0, 1, 0],
    [0, -1, 0, 0, 1, 1, 0],
    [0, -1, 0, 5, 0, 0, 0],
    [0, -1, 5, 5, 0, 0, 0],
    [0, -1, 0, 0, 0, 0, 0],
];
const PENTAGON_ROTATIONS_REVERSE: [[i32; 7]; 7] = [
    [0, 0, 0, 0, 0, 0, 0],
    [-1, -1, -1, -1, -1, -1, -1],
    [0, 1, 0, 0, 0, 0, 0],
    [0, 1, 0, 0, 0, 1, 0],
    [0, 5, 0, 0, 0, 0, 0],
    [0, 5, 0, 5, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0],
];
const PENTAGON_ROTATIONS_REVERSE_NONPOLAR: [[i32; 7]; 7] = [
    [0, 0, 0, 0, 0, 0, 0],
    [-1, -1, -1, -1, -1, -1, -1],
    [0, 1, 0, 0, 0, 0, 0],
    [0, 1, 0, 0, 0, 1, 0],
    [0, 5, 0, 0, 0, 0, 0],
    [0, 1, 0, 5, 1, 1, 0],
    [0, 0, 0, 0, 0, 0, 0],
];
const PENTAGON_ROTATIONS_REVERSE_POLAR: [[i32; 7]; 7] = [
    [0, 0, 0, 0, 0, 0, 0],
    [-1, -1, -1, -1, -1, -1, -1],
    [0, 1, 1, 1, 1, 1, 1],
    [0, 1, 0, 0, 0, 1, 0],
    [0, 1, 0, 0, 1, 1, 1],
    [0, 1, 0, 5, 1, 1, 0],
    [0, 1, 1, 0, 1, 1, 1],
];
const FAILED_DIRECTIONS: [[bool; 7]; 7] = [
    [false, false, false, false, false, false, false],
    [false, false, false, false, false, false, false],
    [false, false, false, false, true, true, false],
    [false, false, false, false, true, false, true],
    [false, false, true, true, false, false, false],
    [false, false, true, false, false, false, true],
    [false, false, false, true, false, true, false],
];

/// C `cellToLocalIjk`.
pub(crate) fn cell_to_local_ijk(origin: u64, mut h3: u64) -> H3Result<CoordIjk> {
    let res = get_resolution(origin);
    if res != get_resolution(h3) {
        return Err(H3Error::ResMismatch);
    }
    let origin_base_cell = get_base_cell(origin);
    let base_cell = get_base_cell(h3);
    if origin_base_cell >= NUM_BASE_CELLS || base_cell >= NUM_BASE_CELLS {
        return Err(H3Error::CellInvalid);
    }

    let mut dir = CENTER_DIGIT;
    let mut rev_dir = CENTER_DIGIT;
    if origin_base_cell != base_cell {
        dir = get_base_cell_direction(origin_base_cell, base_cell);
        if dir == INVALID_DIGIT {
            return Err(H3Error::Failed);
        }
        rev_dir = get_base_cell_direction(base_cell, origin_base_cell);
        debug_assert!(rev_dir != INVALID_DIGIT);
    }

    let origin_on_pent = is_base_cell_pentagon(origin_base_cell);
    let index_on_pent = is_base_cell_pentagon(base_cell);

    let mut index_fijk = crate::coords::FaceIjk::default();
    if dir != CENTER_DIGIT {
        let base_cell_rotations = BASE_CELL_NEIGHBOR_60CCW_ROTS[origin_base_cell as usize][dir as usize];
        if index_on_pent {
            for _ in 0..base_cell_rotations {
                h3 = rotate_pent60cw(h3);
                rev_dir = rotate_digit60cw(rev_dir);
                if rev_dir == K_AXES_DIGIT {
                    rev_dir = rotate_digit60cw(rev_dir);
                }
            }
        } else {
            for _ in 0..base_cell_rotations {
                h3 = rotate60cw(h3);
                rev_dir = rotate_digit60cw(rev_dir);
            }
        }
    }
    h3_to_face_ijk_with_initialized_fijk(h3, &mut index_fijk);

    if dir != CENTER_DIGIT {
        let mut pentagon_rotations = 0;
        let mut direction_rotations = 0;
        if origin_on_pent {
            let old = leading_non_zero_digit(origin);
            if old == INVALID_DIGIT {
                return Err(H3Error::CellInvalid);
            }
            if FAILED_DIRECTIONS[old as usize][dir as usize] {
                return Err(H3Error::Failed);
            }
            direction_rotations = PENTAGON_ROTATIONS[old as usize][dir as usize];
            pentagon_rotations = direction_rotations;
        } else if index_on_pent {
            let ild = leading_non_zero_digit(h3);
            if ild == INVALID_DIGIT {
                return Err(H3Error::CellInvalid);
            }
            if FAILED_DIRECTIONS[ild as usize][rev_dir as usize] {
                return Err(H3Error::Failed);
            }
            pentagon_rotations = PENTAGON_ROTATIONS[rev_dir as usize][ild as usize];
        }
        if pentagon_rotations < 0 || direction_rotations < 0 {
            return Err(H3Error::CellInvalid);
        }
        for _ in 0..pentagon_rotations {
            index_fijk.coord.rotate60cw();
        }
        let mut offset = CoordIjk::default();
        offset.neighbor(dir);
        for r in (0..res).rev() {
            if is_resolution_class_iii(r + 1) {
                offset.down_ap7();
            } else {
                offset.down_ap7r();
            }
        }
        for _ in 0..direction_rotations {
            offset.rotate60cw();
        }
        index_fijk.coord = index_fijk.coord.add(offset).normalized();
    } else if origin_on_pent && index_on_pent {
        let old = leading_non_zero_digit(origin);
        let ild = leading_non_zero_digit(h3);
        if old == INVALID_DIGIT || ild == INVALID_DIGIT {
            return Err(H3Error::CellInvalid);
        }
        if FAILED_DIRECTIONS[old as usize][ild as usize] {
            return Err(H3Error::Failed);
        }
        let within = PENTAGON_ROTATIONS[old as usize][ild as usize];
        for _ in 0..within {
            index_fijk.coord.rotate60cw();
        }
    }
    Ok(index_fijk.coord)
}

/// C `localIjkToCell`.
pub(crate) fn local_ijk_to_cell(origin: u64, ijk: &CoordIjk) -> H3Result<u64> {
    let res = get_resolution(origin);
    let origin_base_cell = get_base_cell(origin);
    if origin_base_cell >= NUM_BASE_CELLS {
        return Err(H3Error::CellInvalid);
    }
    let origin_on_pent = is_base_cell_pentagon(origin_base_cell);

    let mut out = set_resolution(set_mode(H3_INIT, H3_CELL_MODE), res);

    if res == 0 {
        let dir = ijk.to_unit_digit();
        if dir == INVALID_DIGIT {
            return Err(H3Error::Failed);
        }
        let new_base_cell = get_base_cell_neighbor(origin_base_cell, dir);
        if new_base_cell == INVALID_BASE_CELL {
            return Err(H3Error::Failed);
        }
        return Ok(set_base_cell(out, new_base_cell));
    }

    let mut ijk_copy = *ijk;
    for r in (0..res).rev() {
        let last_ijk = ijk_copy;
        let mut last_center;
        if is_resolution_class_iii(r + 1) {
            ijk_copy.up_ap7_checked()?;
            last_center = ijk_copy;
            last_center.down_ap7();
        } else {
            ijk_copy.up_ap7r_checked()?;
            last_center = ijk_copy;
            last_center.down_ap7r();
        }
        let diff = last_ijk.sub(last_center).normalized();
        out = set_index_digit(out, r + 1, u64::from(diff.to_unit_digit()));
    }

    if ijk_copy.i > 1 || ijk_copy.j > 1 || ijk_copy.k > 1 {
        return Err(H3Error::Failed);
    }

    let mut dir = ijk_copy.to_unit_digit();
    let mut base_cell = get_base_cell_neighbor(origin_base_cell, dir);
    let index_on_pent = base_cell != INVALID_BASE_CELL && is_base_cell_pentagon(base_cell);

    if dir != CENTER_DIGIT {
        let mut pentagon_rotations = 0;
        if origin_on_pent {
            let old = leading_non_zero_digit(origin);
            if old == INVALID_DIGIT {
                return Err(H3Error::CellInvalid);
            }
            pentagon_rotations = PENTAGON_ROTATIONS_REVERSE[old as usize][dir as usize];
            for _ in 0..pentagon_rotations {
                dir = rotate_digit60ccw(dir);
            }
            if dir == K_AXES_DIGIT {
                return Err(H3Error::Pentagon);
            }
            base_cell = get_base_cell_neighbor(origin_base_cell, dir);
            debug_assert!(base_cell != INVALID_BASE_CELL);
        }

        let base_cell_rotations = BASE_CELL_NEIGHBOR_60CCW_ROTS[origin_base_cell as usize][dir as usize];

        if index_on_pent {
            let rev_dir = get_base_cell_direction(base_cell, origin_base_cell);
            for _ in 0..base_cell_rotations {
                out = rotate60ccw(out);
            }
            let ild = leading_non_zero_digit(out);
            if ild == INVALID_DIGIT {
                return Err(H3Error::CellInvalid);
            }
            pentagon_rotations = if is_base_cell_polar_pentagon(base_cell) {
                PENTAGON_ROTATIONS_REVERSE_POLAR[rev_dir as usize][ild as usize]
            } else {
                PENTAGON_ROTATIONS_REVERSE_NONPOLAR[rev_dir as usize][ild as usize]
            };
            if pentagon_rotations < 0 {
                return Err(H3Error::CellInvalid);
            }
            for _ in 0..pentagon_rotations {
                out = rotate_pent60ccw(out);
            }
        } else {
            if pentagon_rotations < 0 {
                return Err(H3Error::CellInvalid);
            }
            for _ in 0..pentagon_rotations {
                out = rotate60ccw(out);
            }
            for _ in 0..base_cell_rotations {
                out = rotate60ccw(out);
            }
        }
    } else if origin_on_pent && index_on_pent {
        let old = leading_non_zero_digit(origin);
        let ild = leading_non_zero_digit(out);
        if old == INVALID_DIGIT || ild == INVALID_DIGIT {
            return Err(H3Error::CellInvalid);
        }
        let within = PENTAGON_ROTATIONS_REVERSE[old as usize][ild as usize];
        if within < 0 {
            return Err(H3Error::CellInvalid);
        }
        for _ in 0..within {
            out = rotate60ccw(out);
        }
    }

    if index_on_pent && leading_non_zero_digit(out) == K_AXES_DIGIT {
        return Err(H3Error::Pentagon);
    }

    Ok(set_base_cell(out, base_cell))
}

/// C `cellToLocalIj`. `mode` must be 0.
pub fn cell_to_local_ij(origin: u64, h3: u64, mode: u32) -> H3Result<CoordIJ> {
    if mode != 0 {
        return Err(H3Error::OptionInvalid);
    }
    Ok(cell_to_local_ijk(origin, h3)?.to_ij())
}

/// C `localIjToCell`. `mode` must be 0.
pub fn local_ij_to_cell(origin: u64, ij: &CoordIJ, mode: u32) -> H3Result<u64> {
    if mode != 0 {
        return Err(H3Error::OptionInvalid);
    }
    let ijk = CoordIjk::from_ij(*ij)?;
    local_ijk_to_cell(origin, &ijk)
}
