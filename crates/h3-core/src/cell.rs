//! Cell encoding and decoding: points to cells, cells to centers, boundaries, and faces.
//!
//! Translated from H3 C `h3Index.c` (Apache-2.0, Copyright Uber Technologies, Inc.).

use crate::constants::*;
use crate::coords::{FaceIjk, K_AXES_DIGIT, Vec3d};
use crate::errors::{H3Error, H3Result};
use crate::faceijk::{
    Overage, adjust_overage_class_ii, adjust_pent_vert_overage, face_ijk_pent_to_cell_boundary, face_ijk_pent_to_verts,
    face_ijk_to_cell_boundary, face_ijk_to_vec3, face_ijk_to_verts, vec3_to_face_ijk,
};
use crate::index::*;
use crate::tables::BASE_CELL_DATA;
use crate::{CellBoundary, LatLng};

/// C `_faceIjkToH3`. Returns `H3_NULL` (0) for out-of-range input.
pub(crate) fn face_ijk_to_h3(fijk: &FaceIjk, res: i32) -> u64 {
    let mut h = set_mode(H3_INIT, H3_CELL_MODE);
    h = set_resolution(h, res);

    if res == 0 {
        if fijk.coord.i > MAX_FACE_COORD || fijk.coord.j > MAX_FACE_COORD || fijk.coord.k > MAX_FACE_COORD {
            return H3_NULL;
        }
        return set_base_cell(h, face_ijk_to_base_cell(fijk));
    }

    let mut bc_fijk = *fijk;
    for r in (0..res).rev() {
        let last_ijk = bc_fijk.coord;
        let mut last_center;
        if is_resolution_class_iii(r + 1) {
            bc_fijk.coord.up_ap7();
            last_center = bc_fijk.coord;
            last_center.down_ap7();
        } else {
            bc_fijk.coord.up_ap7r();
            last_center = bc_fijk.coord;
            last_center.down_ap7r();
        }
        let diff = last_ijk.sub(last_center).normalized();
        h = set_index_digit(h, r + 1, u64::from(diff.to_unit_digit()));
    }

    if bc_fijk.coord.i > MAX_FACE_COORD || bc_fijk.coord.j > MAX_FACE_COORD || bc_fijk.coord.k > MAX_FACE_COORD {
        return H3_NULL;
    }

    let base_cell = face_ijk_to_base_cell(&bc_fijk);
    h = set_base_cell(h, base_cell);

    let num_rots = face_ijk_to_base_cell_ccwrot60(&bc_fijk);
    if is_base_cell_pentagon(base_cell) {
        if leading_non_zero_digit(h) == K_AXES_DIGIT {
            h = if base_cell_is_cw_offset(base_cell, bc_fijk.face) { rotate60cw(h) } else { rotate60ccw(h) };
        }
        for _ in 0..num_rots {
            h = rotate_pent60ccw(h);
        }
    } else {
        for _ in 0..num_rots {
            h = rotate60ccw(h);
        }
    }
    h
}

/// C `latLngToCell`. Coordinates are in radians.
pub fn lat_lng_to_cell(g: &LatLng, res: i32) -> H3Result<u64> {
    if !(0..=MAX_H3_RES).contains(&res) {
        return Err(H3Error::ResDomain);
    }
    if !g.lat.is_finite() || !g.lng.is_finite() {
        return Err(H3Error::LatLngDomain);
    }
    vec3_to_cell(&Vec3d::from_lat_lng(g.lat, g.lng), res)
}

/// C `vec3ToCell`.
pub(crate) fn vec3_to_cell(v: &Vec3d, res: i32) -> H3Result<u64> {
    if !(0..=MAX_H3_RES).contains(&res) {
        return Err(H3Error::ResDomain);
    }
    if !v.x.is_finite() || !v.y.is_finite() || !v.z.is_finite() {
        return Err(H3Error::Domain);
    }
    let fijk = vec3_to_face_ijk(*v, res);
    let out = face_ijk_to_h3(&fijk, res);
    if out != 0 { Ok(out) } else { Err(H3Error::Failed) }
}

/// C `_h3ToFaceIjkWithInitializedFijk`. Returns whether overage is possible.
pub(crate) fn h3_to_face_ijk_with_initialized_fijk(h: u64, fijk: &mut FaceIjk) -> bool {
    let res = get_resolution(h);
    let mut possible_overage = true;
    if !is_base_cell_pentagon(get_base_cell(h))
        && (res == 0 || (fijk.coord.i == 0 && fijk.coord.j == 0 && fijk.coord.k == 0))
    {
        possible_overage = false;
    }
    for r in 1..=res {
        if is_resolution_class_iii(r) {
            fijk.coord.down_ap7();
        } else {
            fijk.coord.down_ap7r();
        }
        fijk.coord.neighbor(get_index_digit(h, r));
    }
    possible_overage
}

/// C `_h3ToFaceIjk`.
pub(crate) fn h3_to_face_ijk(mut h: u64) -> H3Result<FaceIjk> {
    let base_cell = get_base_cell(h);
    if base_cell >= NUM_BASE_CELLS {
        return Err(H3Error::CellInvalid);
    }
    if is_base_cell_pentagon(base_cell) && leading_non_zero_digit(h) == 5 {
        h = rotate60cw(h);
    }
    let mut fijk = BASE_CELL_DATA[base_cell as usize].home_fijk;
    if !h3_to_face_ijk_with_initialized_fijk(h, &mut fijk) {
        return Ok(fijk);
    }

    let orig_ijk = fijk.coord;
    let mut res = get_resolution(h);
    if is_resolution_class_iii(res) {
        fijk.coord.down_ap7r();
        res += 1;
    }

    let pent_leading4 = is_base_cell_pentagon(base_cell) && leading_non_zero_digit(h) == 4;
    if adjust_overage_class_ii(&mut fijk, res, pent_leading4, false) != Overage::None {
        if is_base_cell_pentagon(base_cell) {
            while adjust_overage_class_ii(&mut fijk, res, false, false) != Overage::None {}
        }
        if res != get_resolution(h) {
            fijk.coord.up_ap7r();
        }
    } else if res != get_resolution(h) {
        fijk.coord = orig_ijk;
    }
    Ok(fijk)
}

/// C `cellToVec3`.
pub(crate) fn cell_to_vec3(h: u64) -> H3Result<Vec3d> {
    let fijk = h3_to_face_ijk(h)?;
    Ok(face_ijk_to_vec3(&fijk, get_resolution(h)))
}

/// C `cellToLatLng`. Returns radians.
pub fn cell_to_lat_lng(h: u64) -> H3Result<LatLng> {
    let (lat, lng) = cell_to_vec3(h)?.to_lat_lng();
    Ok(LatLng { lat, lng })
}

/// C `cellToBoundary`. Returns radians.
pub fn cell_to_boundary(h: u64) -> H3Result<CellBoundary> {
    let fijk = h3_to_face_ijk(h)?;
    let res = get_resolution(h);
    Ok(if is_pentagon(h) {
        face_ijk_pent_to_cell_boundary(&fijk, res, 0, NUM_PENT_VERTS)
    } else {
        face_ijk_to_cell_boundary(&fijk, res, 0, NUM_HEX_VERTS)
    })
}

/// C `maxFaceCount`.
pub fn max_face_count(h: u64) -> i32 {
    if is_pentagon(h) { 5 } else { 2 }
}

/// C `makeDirectChild`.
pub(crate) fn make_direct_child(h: u64, cell_number: u64) -> u64 {
    let child_res = get_resolution(h) + 1;
    set_index_digit(set_resolution(h, child_res), child_res, cell_number)
}

/// C `getIcosahedronFaces`. Returns the C sparse array of length `maxFaceCount`, where unused
/// slots are `-1` (C `INVALID_FACE`).
pub fn get_icosahedron_faces(h: u64) -> H3Result<Vec<i32>> {
    let mut res = get_resolution(h);
    let is_pent = is_pentagon(h);
    if is_pent && !is_resolution_class_iii(res) {
        return get_icosahedron_faces(make_direct_child(h, 0));
    }
    let mut fijk = h3_to_face_ijk(h)?;
    let mut verts = [FaceIjk::default(); NUM_HEX_VERTS];
    let vertex_count = if is_pent {
        verts[..NUM_PENT_VERTS].copy_from_slice(&face_ijk_pent_to_verts(&mut fijk, &mut res));
        NUM_PENT_VERTS
    } else {
        verts = face_ijk_to_verts(&mut fijk, &mut res);
        NUM_HEX_VERTS
    };
    let face_count = max_face_count(h) as usize;
    let mut out = vec![INVALID_FACE; face_count];
    for vert in verts.iter_mut().take(vertex_count) {
        if is_pent {
            adjust_pent_vert_overage(vert, res);
        } else {
            adjust_overage_class_ii(vert, res, false, true);
        }
        let face = vert.face;
        let mut pos = 0;
        while out[pos] != INVALID_FACE && out[pos] != face {
            pos += 1;
            if pos >= face_count {
                return Err(H3Error::Failed);
            }
        }
        out[pos] = face;
    }
    Ok(out)
}
