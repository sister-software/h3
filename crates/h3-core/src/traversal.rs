//! Grid traversal: neighbors, disks, rings, local IJ coordinates, distances, and paths.
//!
//! Translated from H3 C `algos.c` and `localij.c` (Apache-2.0, Copyright Uber Technologies, Inc.).
//!
//! Disk and ring functions return the C output buffer: length `maxGridDiskSize(k)` (or
//! `maxGridRingSize(k)`), in C order, with unused slots `0`. The C recursive safe disk algorithm is
//! implemented with an explicit stack that visits cells in exactly the recursive order, so results
//! (including hash-set placement) are identical while stack use is bounded on the heap.

use crate::CoordIJ;
use crate::cell::h3_to_face_ijk_with_initialized_fijk;
use crate::constants::*;
use crate::coords::*;
use crate::errors::{H3Error, H3Result};
use crate::index::*;
use crate::tables::{BASE_CELL_DATA, BASE_CELL_NEIGHBOR_60CCW_ROTS, BASE_CELL_NEIGHBORS};

const DIRECTIONS: [Direction; 6] =
    [J_AXES_DIGIT, JK_AXES_DIGIT, K_AXES_DIGIT, IK_AXES_DIGIT, I_AXES_DIGIT, IJ_AXES_DIGIT];
const NEXT_RING_DIRECTION: Direction = I_AXES_DIGIT;

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

/// k value which encompasses all cells at resolution 15.
const K_ALL_CELLS_AT_RES_15: i32 = 13780510;

/// C `maxGridDiskSize`.
pub fn max_grid_disk_size(k: i32) -> H3Result<i64> {
    if k < 0 {
        return Err(H3Error::Domain);
    }
    if k >= K_ALL_CELLS_AT_RES_15 {
        return get_num_cells(MAX_H3_RES);
    }
    let k = i64::from(k);
    Ok(3 * k * (k + 1) + 1)
}

/// C `maxGridRingSize`.
pub fn max_grid_ring_size(k: i32) -> H3Result<i64> {
    if k < 0 {
        return Err(H3Error::Domain);
    }
    if k == 0 {
        return Ok(1);
    }
    Ok(6 * i64::from(k))
}

fn alloc_zeroed<T: Clone + Default>(n: i64) -> H3Result<Vec<T>> {
    let n = usize::try_from(n).map_err(|_| H3Error::MemoryAlloc)?;
    let mut v = Vec::new();
    v.try_reserve_exact(n).map_err(|_| H3Error::MemoryAlloc)?;
    v.resize(n, T::default());
    Ok(v)
}

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

/// C `gridDiskDistancesUnsafe` writing into `out` / `distances` (length `maxGridDiskSize(k)`).
fn grid_disk_distances_unsafe_into(
    mut origin: u64,
    k: i32,
    out: &mut [u64],
    mut distances: Option<&mut [i32]>,
) -> H3Result<()> {
    if k < 0 {
        return Err(H3Error::Domain);
    }
    let mut idx = 0usize;
    out[idx] = origin;
    if let Some(d) = distances.as_deref_mut() {
        d[idx] = 0;
    }
    idx += 1;
    if is_pentagon(origin) {
        return Err(H3Error::Pentagon);
    }
    let mut ring = 1;
    let mut direction = 0usize;
    let mut i = 0;
    let mut rotations = 0;
    while ring <= k {
        if direction == 0 && i == 0 {
            origin = h3_neighbor_rotations(origin, NEXT_RING_DIRECTION, &mut rotations)?;
            if is_pentagon(origin) {
                return Err(H3Error::Pentagon);
            }
        }
        origin = h3_neighbor_rotations(origin, DIRECTIONS[direction], &mut rotations)?;
        out[idx] = origin;
        if let Some(d) = distances.as_deref_mut() {
            d[idx] = ring;
        }
        idx += 1;
        i += 1;
        if i == ring {
            i = 0;
            direction += 1;
            if direction == 6 {
                direction = 0;
                ring += 1;
            }
        }
        if is_pentagon(origin) {
            return Err(H3Error::Pentagon);
        }
    }
    Ok(())
}

/// C `_gridDiskDistancesInternal`, iteratively, in the exact recursive visiting order.
fn grid_disk_distances_internal(origin: u64, k: i32, out: &mut [u64], distances: &mut [i32]) -> H3Result<()> {
    let max_idx = out.len() as u64;
    // Inserts `cell` at distance `cur_k`; returns whether to continue to its neighbors.
    let mut enter = |cell: u64, cur_k: i32| -> bool {
        let mut off = (cell % max_idx) as usize;
        while out[off] != 0 && out[off] != cell {
            off = (off + 1) % out.len();
        }
        if out[off] == cell && distances[off] <= cur_k {
            return false;
        }
        out[off] = cell;
        distances[off] = cur_k;
        cur_k < k
    };
    if !enter(origin, 0) {
        return Ok(());
    }
    let mut stack: Vec<(u64, i32, usize)> = Vec::new();
    stack.try_reserve(k as usize + 1).map_err(|_| H3Error::MemoryAlloc)?;
    stack.push((origin, 0, 0));
    while let Some(top) = stack.last_mut() {
        if top.2 >= 6 {
            stack.pop();
            continue;
        }
        let (cell, cur_k, i) = *top;
        top.2 += 1;
        let mut rotations = 0;
        match h3_neighbor_rotations(cell, DIRECTIONS[i], &mut rotations) {
            Err(H3Error::Pentagon) => {}
            Err(e) => return Err(e),
            Ok(n) => {
                if enter(n, cur_k + 1) {
                    stack.push((n, cur_k + 1, 0));
                }
            }
        }
    }
    Ok(())
}

/// C `gridDiskDistancesUnsafe`: (cells, distances), each of length `maxGridDiskSize(k)`.
pub fn grid_disk_distances_unsafe(origin: u64, k: i32) -> H3Result<(Vec<u64>, Vec<i32>)> {
    let n = max_grid_disk_size(k)?;
    let mut out = alloc_zeroed(n)?;
    let mut d = alloc_zeroed(n)?;
    grid_disk_distances_unsafe_into(origin, k, &mut out, Some(&mut d))?;
    Ok((out, d))
}

/// C `gridDiskUnsafe`.
pub fn grid_disk_unsafe(origin: u64, k: i32) -> H3Result<Vec<u64>> {
    let n = max_grid_disk_size(k)?;
    let mut out = alloc_zeroed(n)?;
    grid_disk_distances_unsafe_into(origin, k, &mut out, None)?;
    Ok(out)
}

/// C `gridDiskDistancesSafe`.
pub fn grid_disk_distances_safe(origin: u64, k: i32) -> H3Result<(Vec<u64>, Vec<i32>)> {
    let n = max_grid_disk_size(k)?;
    let mut out = alloc_zeroed(n)?;
    let mut d = alloc_zeroed(n)?;
    grid_disk_distances_internal(origin, k, &mut out, &mut d)?;
    Ok((out, d))
}

/// C `gridDiskDistances`: the fast algorithm with fallback to the safe one.
pub fn grid_disk_distances(origin: u64, k: i32) -> H3Result<(Vec<u64>, Vec<i32>)> {
    let n = max_grid_disk_size(k)?;
    let mut out = alloc_zeroed(n)?;
    let mut d = alloc_zeroed(n)?;
    if grid_disk_distances_unsafe_into(origin, k, &mut out, Some(&mut d)).is_err() {
        out.iter_mut().for_each(|x| *x = 0);
        d.iter_mut().for_each(|x| *x = 0);
        grid_disk_distances_internal(origin, k, &mut out, &mut d)?;
    }
    Ok((out, d))
}

/// C `gridDisk`.
pub fn grid_disk(origin: u64, k: i32) -> H3Result<Vec<u64>> {
    let n = max_grid_disk_size(k)?;
    let mut out = alloc_zeroed(n)?;
    grid_disk_into(origin, k, &mut out)?;
    Ok(out)
}

/// C `gridDisk` writing into a caller buffer of at least `maxGridDiskSize(k)` slots (only that
/// prefix is used). As in C, the distances scratch array is allocated only when the fast
/// algorithm fails and the safe one runs.
pub fn grid_disk_into(origin: u64, k: i32, out: &mut [u64]) -> H3Result<()> {
    let n = usize::try_from(max_grid_disk_size(k)?).map_err(|_| H3Error::MemoryAlloc)?;
    let out = out.get_mut(..n).ok_or(H3Error::MemoryBounds)?;
    out.iter_mut().for_each(|x| *x = 0);
    if grid_disk_distances_unsafe_into(origin, k, out, None).is_err() {
        out.iter_mut().for_each(|x| *x = 0);
        let mut d: Vec<i32> = alloc_zeroed(n as i64)?;
        grid_disk_distances_internal(origin, k, out, &mut d)?;
    }
    Ok(())
}

/// C `gridDisksUnsafe`: concatenated `gridDiskUnsafe` buffers.
pub fn grid_disks_unsafe(origins: &[u64], k: i32) -> H3Result<Vec<u64>> {
    let seg = max_grid_disk_size(k)?;
    let total = seg.checked_mul(origins.len() as i64).ok_or(H3Error::MemoryAlloc)?;
    let mut out = alloc_zeroed(total)?;
    for (i, &o) in origins.iter().enumerate() {
        let s = i * seg as usize;
        grid_disk_distances_unsafe_into(o, k, &mut out[s..s + seg as usize], None)?;
    }
    Ok(out)
}

fn grid_ring_unsafe_into(mut origin: u64, k: i32, out: &mut [u64]) -> H3Result<()> {
    if k < 0 {
        return Err(H3Error::Domain);
    }
    if k == 0 {
        out[0] = origin;
        return Ok(());
    }
    let mut idx = 0;
    let mut rotations = 0;
    if is_pentagon(origin) {
        return Err(H3Error::Pentagon);
    }
    for _ in 0..k {
        origin = h3_neighbor_rotations(origin, NEXT_RING_DIRECTION, &mut rotations)?;
        if is_pentagon(origin) {
            return Err(H3Error::Pentagon);
        }
    }
    let last_index = origin;
    out[idx] = origin;
    idx += 1;
    for (direction, &dir) in DIRECTIONS.iter().enumerate() {
        for pos in 0..k {
            origin = h3_neighbor_rotations(origin, dir, &mut rotations)?;
            if pos != k - 1 || direction != 5 {
                out[idx] = origin;
                idx += 1;
                if is_pentagon(origin) {
                    return Err(H3Error::Pentagon);
                }
            }
        }
    }
    if last_index != origin {
        return Err(H3Error::Pentagon);
    }
    Ok(())
}

/// C `gridRingUnsafe`: buffer of length `maxGridRingSize(k)`.
pub fn grid_ring_unsafe(origin: u64, k: i32) -> H3Result<Vec<u64>> {
    let n = max_grid_ring_size(k)?;
    let mut out = alloc_zeroed(n)?;
    grid_ring_unsafe_into(origin, k, &mut out)?;
    Ok(out)
}

/// C `gridRing`: the fast algorithm with fallback to the safe one.
pub fn grid_ring(origin: u64, k: i32) -> H3Result<Vec<u64>> {
    let n = max_grid_ring_size(k)?;
    let mut out = alloc_zeroed(n)?;
    if grid_ring_unsafe_into(origin, k, &mut out).is_ok() {
        return Ok(out);
    }
    out.iter_mut().for_each(|x| *x = 0);
    if k == 0 {
        out[0] = origin;
        return Ok(out);
    }
    let (disk, dist) = grid_disk_distances_safe(origin, k)?;
    let mut i = 0;
    for (c, d) in disk.iter().zip(&dist) {
        if *c != 0 && *d == k {
            // C writes without a bound check; a correct ring never exceeds 6k entries.
            if i >= out.len() {
                return Err(H3Error::Failed);
            }
            out[i] = *c;
            i += 1;
        }
    }
    Ok(out)
}

// --- Local IJ (localij.c) -------------------------------------------------------------------

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

/// C `gridDistance`.
pub fn grid_distance(origin: u64, h3: u64) -> H3Result<i64> {
    let o = cell_to_local_ijk(origin, origin)?;
    let d = cell_to_local_ijk(origin, h3)?;
    Ok(i64::from(o.distance(&d)))
}

/// C `gridPathCellsSize`.
pub fn grid_path_cells_size(start: u64, end: u64) -> H3Result<i64> {
    Ok(grid_distance(start, end)? + 1)
}

/// C `cubeRound`.
fn cube_round(i: f64, j: f64, k: f64) -> CoordIjk {
    let mut ri = i.round() as i32;
    let mut rj = j.round() as i32;
    let mut rk = k.round() as i32;
    let i_diff = (f64::from(ri) - i).abs();
    let j_diff = (f64::from(rj) - j).abs();
    let k_diff = (f64::from(rk) - k).abs();
    if i_diff > j_diff && i_diff > k_diff {
        ri = rj.wrapping_neg().wrapping_sub(rk);
    } else if j_diff > k_diff {
        rj = ri.wrapping_neg().wrapping_sub(rk);
    } else {
        rk = ri.wrapping_neg().wrapping_sub(rj);
    }
    ijk(ri, rj, rk)
}

/// C `gridPathCellsInterpolate`.
fn grid_path_cells_interpolate(start: u64, end: u64, distance: i64, out: &mut [u64], reverse: bool) -> H3Result<()> {
    let mut start_ijk = cell_to_local_ijk(start, start)?;
    let mut end_ijk = cell_to_local_ijk(start, end)?;
    start_ijk.to_cube();
    end_ijk.to_cube();
    let inv = 1.0 / distance as f64;
    let i_step = f64::from(end_ijk.i.wrapping_sub(start_ijk.i)) * inv;
    let j_step = f64::from(end_ijk.j.wrapping_sub(start_ijk.j)) * inv;
    let k_step = f64::from(end_ijk.k.wrapping_sub(start_ijk.k)) * inv;
    for n in 0..=distance {
        let nf = n as f64;
        let mut current = cube_round(
            f64::from(start_ijk.i) + i_step * nf,
            f64::from(start_ijk.j) + j_step * nf,
            f64::from(start_ijk.k) + k_step * nf,
        );
        current.from_cube();
        let idx = if reverse { (distance - n) as usize } else { n as usize };
        out[idx] = local_ijk_to_cell(start, &current)?;
    }
    Ok(())
}

/// C `gridPathCells`.
pub fn grid_path_cells(start: u64, end: u64) -> H3Result<Vec<u64>> {
    let distance = grid_distance(start, end)?;
    let mut out = alloc_zeroed(distance + 1)?;
    if distance == 0 {
        out[0] = start;
        return Ok(out);
    }
    let first = grid_path_cells_interpolate(start, end, distance, &mut out, false);
    if first.is_ok() {
        return Ok(out);
    }
    if grid_path_cells_interpolate(end, start, distance, &mut out, true).is_ok() {
        return Ok(out);
    }
    first.map(|_| out)
}

/// C `gridDisk(origin, 1, buf)` as used by `areNeighborCells`: returns the 7-slot buffer as C
/// leaves it, even when C's call fails (C ignores that error and scans the partial buffer).
pub(crate) fn grid_disk1_buffer(origin: u64) -> [u64; 7] {
    let mut out = [0u64; 7];
    if grid_disk_distances_unsafe_into(origin, 1, &mut out, None).is_err() {
        out = [0; 7];
        let mut d = [0i32; 7];
        let _ = grid_disk_distances_internal(origin, 1, &mut out, &mut d);
    }
    out
}
