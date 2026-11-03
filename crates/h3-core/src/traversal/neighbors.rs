//! Neighbor transitions and rotations, translated from H3 C `algos.c` (Apache-2.0).
use crate::constants::*;
use crate::coords::*;
use crate::errors::{H3Error, H3Result};
use crate::index::*;
use crate::tables::{BASE_CELL_DATA, BASE_CELL_NEIGHBOR_60CCW_ROTS, BASE_CELL_NEIGHBORS};
const C: Direction = CENTER_DIGIT;
const K: Direction = K_AXES_DIGIT;
const J: Direction = J_AXES_DIGIT;
const JK: Direction = JK_AXES_DIGIT;
const I: Direction = I_AXES_DIGIT;
const IK: Direction = IK_AXES_DIGIT;
const IJ_: Direction = IJ_AXES_DIGIT;

const NEW_DIGIT_II: [[Direction; 7]; 7] = [
    [C, K, J, JK, I, IK, IJ_],
    [K, I, JK, IJ_, IK, J, C],
    [J, JK, K, I, IJ_, C, IK],
    [JK, IJ_, I, IK, C, K, J],
    [I, IK, IJ_, C, J, JK, K],
    [IK, J, C, K, JK, IJ_, I],
    [IJ_, C, IK, J, K, I, JK],
];
const NEW_ADJUSTMENT_II: [[Direction; 7]; 7] = [
    [C, C, C, C, C, C, C],
    [C, K, C, K, C, IK, C],
    [C, C, J, JK, C, C, J],
    [C, K, JK, JK, C, C, C],
    [C, C, C, C, I, I, IJ_],
    [C, IK, C, C, I, IK, C],
    [C, C, J, C, IJ_, C, IJ_],
];
const NEW_DIGIT_III: [[Direction; 7]; 7] = [
    [C, K, J, JK, I, IK, IJ_],
    [K, J, JK, I, IK, IJ_, C],
    [J, JK, I, IK, IJ_, C, K],
    [JK, I, IK, IJ_, C, K, J],
    [I, IK, IJ_, C, K, J, JK],
    [IK, IJ_, C, K, J, JK, I],
    [IJ_, C, K, J, JK, I, IK],
];
const NEW_ADJUSTMENT_III: [[Direction; 7]; 7] = [
    [C, C, C, C, C, C, C],
    [C, K, C, JK, C, K, C],
    [C, C, J, J, C, C, IJ_],
    [C, JK, J, JK, C, C, C],
    [C, C, C, C, I, IK, I],
    [C, K, C, C, IK, IK, C],
    [C, C, IJ_, C, I, C, IJ_],
];

/// C `h3NeighborRotations`: the neighbor of `origin` in direction `dir`, updating `rotations`.
pub(crate) fn h3_neighbor_rotations(origin: u64, mut dir: Direction, rotations: &mut i32) -> H3Result<u64> {
    let mut current = origin;
    if dir >= INVALID_DIGIT {
        return Err(H3Error::Failed);
    }
    *rotations %= 6;
    for _ in 0..*rotations {
        dir = rotate_digit60ccw(dir);
    }

    let mut new_rotations = 0;
    let old_base_cell = get_base_cell(current);
    if old_base_cell >= NUM_BASE_CELLS {
        return Err(H3Error::CellInvalid);
    }
    let old_leading_digit = leading_non_zero_digit(current);

    let mut r = get_resolution(current) - 1;
    loop {
        if r == -1 {
            current = set_base_cell(current, i32::from(BASE_CELL_NEIGHBORS[old_base_cell as usize][dir as usize]));
            new_rotations = i32::from(BASE_CELL_NEIGHBOR_60CCW_ROTS[old_base_cell as usize][dir as usize]);
            if get_base_cell(current) == INVALID_BASE_CELL {
                current = set_base_cell(
                    current,
                    i32::from(BASE_CELL_NEIGHBORS[old_base_cell as usize][IK_AXES_DIGIT as usize]),
                );
                new_rotations =
                    i32::from(BASE_CELL_NEIGHBOR_60CCW_ROTS[old_base_cell as usize][IK_AXES_DIGIT as usize]);
                current = rotate60ccw(current);
                *rotations += 1;
            }
            break;
        }
        let old_digit = get_index_digit(current, r + 1);
        if old_digit == INVALID_DIGIT {
            return Err(H3Error::CellInvalid);
        }
        let next_dir = if is_resolution_class_iii(r + 1) {
            current = set_index_digit(current, r + 1, u64::from(NEW_DIGIT_II[old_digit as usize][dir as usize]));
            NEW_ADJUSTMENT_II[old_digit as usize][dir as usize]
        } else {
            current = set_index_digit(current, r + 1, u64::from(NEW_DIGIT_III[old_digit as usize][dir as usize]));
            NEW_ADJUSTMENT_III[old_digit as usize][dir as usize]
        };
        if next_dir != CENTER_DIGIT {
            dir = next_dir;
            r -= 1;
        } else {
            break;
        }
    }

    let new_base_cell = get_base_cell(current);
    if is_base_cell_pentagon(new_base_cell) {
        let mut already_adjusted_k_subsequence = false;
        if leading_non_zero_digit(current) == K_AXES_DIGIT {
            if old_base_cell != new_base_cell {
                if base_cell_is_cw_offset(new_base_cell, BASE_CELL_DATA[old_base_cell as usize].home_fijk.face) {
                    current = rotate60cw(current);
                } else {
                    current = rotate60ccw(current);
                }
                already_adjusted_k_subsequence = true;
            } else if old_leading_digit == CENTER_DIGIT {
                return Err(H3Error::Pentagon);
            } else if old_leading_digit == JK_AXES_DIGIT {
                current = rotate60ccw(current);
                *rotations += 1;
            } else if old_leading_digit == IK_AXES_DIGIT {
                current = rotate60cw(current);
                *rotations += 5;
            } else {
                return Err(H3Error::Failed);
            }
        }
        for _ in 0..new_rotations {
            current = rotate_pent60ccw(current);
        }
        if old_base_cell != new_base_cell {
            if is_base_cell_polar_pentagon(new_base_cell) {
                if old_base_cell != 118 && old_base_cell != 8 && leading_non_zero_digit(current) != JK_AXES_DIGIT {
                    *rotations += 1;
                }
            } else if leading_non_zero_digit(current) == IK_AXES_DIGIT && !already_adjusted_k_subsequence {
                *rotations += 1;
            }
        }
    } else {
        for _ in 0..new_rotations {
            current = rotate60ccw(current);
        }
    }

    *rotations = (*rotations + new_rotations) % 6;
    Ok(current)
}

/// C `directionForNeighbor`: the direction from `origin` to neighboring `destination`.
pub(crate) fn direction_for_neighbor(origin: u64, destination: u64) -> Direction {
    let start = if is_pentagon(origin) { J_AXES_DIGIT } else { K_AXES_DIGIT };
    for direction in start..NUM_DIGITS {
        let mut rotations = 0;
        if let Ok(n) = h3_neighbor_rotations(origin, direction, &mut rotations)
            && n == destination
        {
            return direction;
        }
    }
    INVALID_DIGIT
}
