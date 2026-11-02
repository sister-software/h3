//! Cell hierarchy: parents, children, child positions, compaction.
//!
//! Translated from H3 C `h3Index.c` and `iterators.c` (Apache-2.0, Copyright Uber Technologies,
//! Inc.). The C hash-set compaction is ported with the same probing so that output order matches.

use crate::constants::*;
use crate::coords::{INVALID_DIGIT, K_AXES_DIGIT};
use crate::errors::{H3Error, H3Result};
use crate::index::*;

/// C `cellToParent`.
pub fn cell_to_parent(h: u64, parent_res: i32) -> H3Result<u64> {
    let child_res = get_resolution(h);
    if !(0..=MAX_H3_RES).contains(&parent_res) {
        return Err(H3Error::ResDomain);
    } else if parent_res > child_res {
        return Err(H3Error::ResMismatch);
    } else if parent_res == child_res {
        return Ok(h);
    }
    let mut p = set_resolution(h, parent_res);
    for i in parent_res + 1..=child_res {
        p = set_index_digit(p, i, H3_DIGIT_MASK);
    }
    Ok(p)
}

/// C `_hasChildAtRes`.
#[inline]
fn has_child_at_res(h: u64, child_res: i32) -> bool {
    let parent_res = get_resolution(h);
    !(child_res < parent_res || child_res > MAX_H3_RES)
}

/// C `cellToChildrenSize`.
pub fn cell_to_children_size(h: u64, child_res: i32) -> H3Result<i64> {
    if !has_child_at_res(h, child_res) {
        return Err(H3Error::ResDomain);
    }
    let n = i64::from(child_res - get_resolution(h));
    Ok(if is_pentagon(h) { 1 + 5 * (ipow(7, n) - 1) / 6 } else { ipow(7, n) })
}

/// C `cellToCenterChild`.
pub fn cell_to_center_child(h: u64, child_res: i32) -> H3Result<u64> {
    if !has_child_at_res(h, child_res) {
        return Err(H3Error::ResDomain);
    }
    let z = zero_index_digits(h, get_resolution(h) + 1, child_res);
    Ok(set_resolution(z, child_res))
}

/// Iterator over the children of a cell (C `IterCellsChildren`), in C order.
#[derive(Clone, Debug)]
pub struct ChildIter {
    h: u64,
    parent_res: i32,
    skip_digit: i32,
}

impl ChildIter {
    /// C `iterInitParent`. Yields nothing for an invalid child resolution or `H3_NULL`.
    pub fn new(h: u64, child_res: i32) -> ChildIter {
        let parent_res = get_resolution(h);
        if child_res < parent_res || child_res > MAX_H3_RES || h == H3_NULL {
            return ChildIter { h: H3_NULL, parent_res: -1, skip_digit: -1 };
        }
        let mut c = zero_index_digits(h, parent_res + 1, child_res);
        c = set_resolution(c, child_res);
        let skip_digit = if is_pentagon(c) { child_res } else { -1 };
        ChildIter { h: c, parent_res, skip_digit }
    }

    #[inline]
    fn increment_res_digit(&mut self, res: i32) {
        let val: u64 = 1 << (H3_PER_DIGIT_OFFSET * (MAX_H3_RES - res) as u32);
        self.h = self.h.wrapping_add(val);
    }

    /// C `iterStepChild`.
    fn step(&mut self) {
        if self.h == H3_NULL {
            return;
        }
        let child_res = get_resolution(self.h);
        self.increment_res_digit(child_res);
        let mut i = child_res;
        while i >= self.parent_res {
            if i == self.parent_res {
                *self = ChildIter { h: H3_NULL, parent_res: -1, skip_digit: -1 };
                return;
            }
            if i == self.skip_digit && get_index_digit(self.h, i) == K_AXES_DIGIT {
                self.increment_res_digit(i);
                self.skip_digit -= 1;
                return;
            }
            if get_index_digit(self.h, i) == INVALID_DIGIT {
                self.increment_res_digit(i);
            } else {
                break;
            }
            i -= 1;
        }
    }
}

impl Iterator for ChildIter {
    type Item = u64;
    fn next(&mut self) -> Option<u64> {
        if self.h == H3_NULL {
            return None;
        }
        let out = self.h;
        self.step();
        Some(out)
    }
}

/// C `cellToChildren`. Like C, an invalid child resolution yields an empty result; callers that
/// need the C error should call [`cell_to_children_size`] first, as the C API requires.
pub fn cell_to_children(h: u64, child_res: i32) -> ChildIter {
    ChildIter::new(h, child_res)
}

/// C `compactCells`. `cells` must all share one resolution.
pub fn compact_cells(h3_set: &[u64]) -> H3Result<Vec<u64>> {
    let num_hexes = h3_set.len();
    if num_hexes == 0 {
        return Ok(Vec::new());
    }
    let mut out: Vec<u64> = Vec::with_capacity(num_hexes);
    let res = get_resolution(h3_set[0]);
    if res == 0 {
        out.extend_from_slice(h3_set);
        return Ok(out);
    }
    let mut remaining: Vec<u64> = h3_set.to_vec();
    let mut hash_set: Vec<u64> = vec![0; num_hexes];
    let mut num_remaining = num_hexes;
    while num_remaining > 0 {
        let res = get_resolution(remaining[0]);
        let parent_res = res - 1;
        let nr = num_remaining as u64;

        if parent_res >= 0 {
            for &curr in &remaining[..num_remaining] {
                if curr == 0 {
                    continue;
                }
                if get_reserved_bits(curr) != 0 {
                    return Err(H3Error::CellInvalid);
                }
                let mut parent = cell_to_parent(curr, parent_res)?;
                let mut loc = (parent % nr) as usize;
                let mut loop_count = 0usize;
                while hash_set[loc] != 0 {
                    if loop_count > num_remaining {
                        return Err(H3Error::Failed);
                    }
                    let temp = hash_set[loc] & !H3_RESERVED_MASK;
                    if temp == parent {
                        let count = get_reserved_bits(hash_set[loc]) + 1;
                        let mut limit = 7;
                        if is_pentagon(temp & !H3_RESERVED_MASK) {
                            limit -= 1;
                        }
                        if count + 1 > limit {
                            return Err(H3Error::DuplicateInput);
                        }
                        parent = set_reserved_bits(parent, count);
                        hash_set[loc] = H3_NULL;
                    } else {
                        loc = (loc + 1) % num_remaining;
                    }
                    loop_count += 1;
                }
                hash_set[loc] = parent;
            }
        }

        let max_compactable = num_remaining / 6;
        if max_compactable == 0 {
            out.extend_from_slice(&remaining[..num_remaining]);
            break;
        }
        let mut compactable: Vec<u64> = Vec::with_capacity(max_compactable);
        for slot in hash_set.iter_mut().take(num_remaining) {
            if *slot == 0 {
                continue;
            }
            let mut count = get_reserved_bits(*slot) + 1;
            if is_pentagon(*slot & !H3_RESERVED_MASK) {
                *slot = set_reserved_bits(*slot, count);
                count += 1;
            }
            if count == 7 {
                // C writes into a buffer of size numRemaining / 6; more than that is impossible for
                // non-duplicate input, and is reported as a failure rather than overflowing.
                if compactable.len() >= max_compactable {
                    return Err(H3Error::Failed);
                }
                compactable.push(*slot & !H3_RESERVED_MASK);
            }
        }

        for &curr in &remaining[..num_remaining] {
            if curr == H3_NULL {
                continue;
            }
            let mut uncompactable = true;
            if parent_res >= 0 {
                let parent = cell_to_parent(curr, parent_res)?;
                let mut loc = (parent % nr) as usize;
                let mut loop_count = 0usize;
                loop {
                    if loop_count > num_remaining {
                        return Err(H3Error::Failed);
                    }
                    let temp = hash_set[loc] & !H3_RESERVED_MASK;
                    if temp == parent {
                        let count = get_reserved_bits(hash_set[loc]) + 1;
                        if count == 7 {
                            uncompactable = false;
                        }
                        break;
                    } else {
                        loc = (loc + 1) % num_remaining;
                    }
                    loop_count += 1;
                    if hash_set[loc] == parent {
                        break;
                    }
                }
            }
            if uncompactable {
                out.push(curr);
            }
        }

        hash_set.iter_mut().for_each(|x| *x = 0);
        num_remaining = compactable.len();
        remaining[..num_remaining].copy_from_slice(&compactable);
    }
    Ok(out)
}

/// C `uncompactCellsSize`.
pub fn uncompact_cells_size(compacted: &[u64], res: i32) -> H3Result<i64> {
    let mut n: i64 = 0;
    for &c in compacted {
        if c == H3_NULL {
            continue;
        }
        let size = cell_to_children_size(c, res).map_err(|_| H3Error::ResMismatch)?;
        n = n.checked_add(size).ok_or(H3Error::MemoryAlloc)?;
    }
    Ok(n)
}

/// C `uncompactCells`, writing into `out`. Returns the number of cells written.
pub fn uncompact_cells_into(compacted: &[u64], res: i32, out: &mut [u64]) -> H3Result<usize> {
    let mut i = 0usize;
    for &c in compacted {
        if !has_child_at_res(c, res) {
            return Err(H3Error::ResMismatch);
        }
        for child in ChildIter::new(c, res) {
            if i >= out.len() {
                return Err(H3Error::MemoryBounds);
            }
            out[i] = child;
            i += 1;
        }
    }
    Ok(i)
}

/// C `uncompactCellsSize` followed by `uncompactCells`.
pub fn uncompact_cells(compacted: &[u64], res: i32) -> H3Result<Vec<u64>> {
    let size = uncompact_cells_size(compacted, res)?;
    let size = usize::try_from(size).map_err(|_| H3Error::MemoryAlloc)?;
    let mut out = Vec::new();
    out.try_reserve_exact(size).map_err(|_| H3Error::MemoryAlloc)?;
    out.resize(size, 0);
    let n = uncompact_cells_into(compacted, res, &mut out)?;
    out.truncate(n);
    Ok(out)
}

fn validate_child_pos(child_pos: i64, parent: u64, child_res: i32) -> H3Result<()> {
    let max = cell_to_children_size(parent, child_res)?;
    if child_pos < 0 || child_pos >= max {
        return Err(H3Error::Domain);
    }
    Ok(())
}

/// C `cellToChildPos`.
pub fn cell_to_child_pos(child: u64, parent_res: i32) -> H3Result<i64> {
    let child_res = get_resolution(child);
    let original_parent = cell_to_parent(child, parent_res)?;
    let mut out: i64 = 0;
    if is_pentagon(original_parent) {
        let mut res = child_res;
        while res > parent_res {
            let parent = cell_to_parent(child, res - 1)?;
            let parent_is_pentagon = is_pentagon(parent);
            let raw = i64::from(get_index_digit(child, res));
            if raw == i64::from(INVALID_DIGIT) || (parent_is_pentagon && raw == i64::from(K_AXES_DIGIT)) {
                return Err(H3Error::CellInvalid);
            }
            let digit = if parent_is_pentagon && raw > 0 { raw - 1 } else { raw };
            if digit != 0 {
                let hex_child_count = ipow(7, i64::from(child_res - res));
                out += (if parent_is_pentagon { 1 + (5 * (hex_child_count - 1)) / 6 } else { hex_child_count })
                    + (digit - 1) * hex_child_count;
            }
            res -= 1;
        }
    } else {
        let mut res = child_res;
        while res > parent_res {
            let digit = i64::from(get_index_digit(child, res));
            if digit == i64::from(INVALID_DIGIT) {
                return Err(H3Error::CellInvalid);
            }
            out += digit * ipow(7, i64::from(child_res - res));
            res -= 1;
        }
    }
    if validate_child_pos(out, original_parent, child_res).is_err() {
        return Err(H3Error::Failed);
    }
    Ok(out)
}

/// C `childPosToCell`.
pub fn child_pos_to_cell(child_pos: i64, parent: u64, child_res: i32) -> H3Result<u64> {
    if !(0..=MAX_H3_RES).contains(&child_res) {
        return Err(H3Error::ResDomain);
    }
    let parent_res = get_resolution(parent);
    if child_res < parent_res {
        return Err(H3Error::ResMismatch);
    }
    validate_child_pos(child_pos, parent, child_res)?;
    let res_offset = child_res - parent_res;
    let mut child = set_resolution(parent, child_res);
    let mut idx = child_pos;
    if is_pentagon(parent) {
        let mut in_pent = true;
        for res in 1..=res_offset {
            let res_width = ipow(7, i64::from(res_offset - res));
            if in_pent {
                let pent_width = 1 + (5 * (res_width - 1)) / 6;
                if idx < pent_width {
                    child = set_index_digit(child, parent_res + res, 0);
                } else {
                    idx -= pent_width;
                    in_pent = false;
                    child = set_index_digit(child, parent_res + res, (idx / res_width + 2) as u64);
                    idx %= res_width;
                }
            } else {
                child = set_index_digit(child, parent_res + res, (idx / res_width) as u64);
                idx %= res_width;
            }
        }
    } else {
        for res in 1..=res_offset {
            let res_width = ipow(7, i64::from(res_offset - res));
            child = set_index_digit(child, parent_res + res, (idx / res_width) as u64);
            idx %= res_width;
        }
    }
    Ok(child)
}
