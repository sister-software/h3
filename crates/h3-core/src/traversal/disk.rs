//! Disks and rings translated from H3 C `algos.c` (Apache-2.0), preserving output-buffer order.
use super::neighbors::h3_neighbor_rotations;
use crate::constants::*;
use crate::coords::*;
use crate::errors::{H3Error, H3Result};
use crate::index::*;
const DIRECTIONS: [Direction; 6] =
    [J_AXES_DIGIT, JK_AXES_DIGIT, K_AXES_DIGIT, IK_AXES_DIGIT, I_AXES_DIGIT, IJ_AXES_DIGIT];
const NEXT_RING_DIRECTION: Direction = I_AXES_DIGIT;

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

pub(super) fn alloc_zeroed<T: Clone + Default>(n: i64) -> H3Result<Vec<T>> {
    let n = usize::try_from(n).map_err(|_| H3Error::MemoryAlloc)?;
    let mut v = Vec::new();
    v.try_reserve_exact(n).map_err(|_| H3Error::MemoryAlloc)?;
    v.resize(n, T::default());
    Ok(v)
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
    struct Frame {
        cell: u64,
        distance: i32,
        next_direction: usize,
    }
    let mut stack: Vec<Frame> = Vec::new();
    stack.try_reserve(k as usize + 1).map_err(|_| H3Error::MemoryAlloc)?;
    stack.push(Frame { cell: origin, distance: 0, next_direction: 0 });
    while let Some(top) = stack.last_mut() {
        if top.next_direction >= 6 {
            stack.pop();
            continue;
        }
        let (cell, cur_k, i) = (top.cell, top.distance, top.next_direction);
        top.next_direction += 1;
        let mut rotations = 0;
        match h3_neighbor_rotations(cell, DIRECTIONS[i], &mut rotations) {
            Err(H3Error::Pentagon) => {}
            Err(e) => return Err(e),
            Ok(n) => {
                if enter(n, cur_k + 1) {
                    stack.push(Frame { cell: n, distance: cur_k + 1, next_direction: 0 });
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
