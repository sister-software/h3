//! Grid distances and paths translated from H3 C `localij.c` (Apache-2.0).
use super::disk::alloc_zeroed;
use super::localij::{cell_to_local_ijk, local_ijk_to_cell};
use crate::coords::*;
use crate::errors::H3Result;
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
