//! Icosahedral face projection: conversion between unit-sphere points, face-centered hex
//! coordinates, and cell boundaries.
//!
//! Translated from H3 C `faceijk.c` (Apache-2.0, Copyright Uber Technologies, Inc.).

use crate::constants::*;
use crate::coords::{CoordIjk, FaceIjk, Vec2d, Vec3d, ijk, v2d_intersect};
use crate::index::is_resolution_class_iii;
use crate::latlng::pos_angle_rads;
use crate::math::Trig;
use crate::tables::{
    ADJACENT_FACE_DIR, FACE_AXES_AZ_RADS_CII, FACE_CENTER_POINT, FACE_NEIGHBORS, MAX_DIM_BY_CII_RES,
    UNIT_SCALE_BY_CII_RES,
};
use crate::{CellBoundary, LatLng};

/// Overage type (C `Overage`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Overage {
    None = 0,
    FaceEdge = 1,
    NewFace = 2,
}

/// C `_vec3ToFaceIjk`.
pub(crate) fn vec3_to_face_ijk(p: Vec3d, res: i32) -> FaceIjk {
    let (face, v) = vec3_to_hex2d(&p, res);
    FaceIjk { face, coord: v.to_coord_ijk() }
}

/// C `_vec3TangentBasis`.
#[inline]
fn vec3_tangent_basis(p: Vec3d) -> (Vec3d, Vec3d) {
    let north_pole = Vec3d { x: 0.0, y: 0.0, z: 1.0 };
    let mut north = Vec3d::lin_comb(1.0, north_pole, -north_pole.dot(p), p);
    north.normalize();
    let east = north.cross(p);
    (north, east)
}

/// C `_vec3AzimuthRads`.
#[inline]
fn vec3_azimuth_rads(p1: Vec3d, p2: Vec3d) -> f64 {
    let (north, east) = vec3_tangent_basis(p1);
    let mut proj = Vec3d::lin_comb(1.0, p2, -p2.dot(p1), p1);
    proj.normalize();
    proj.dot(east).h3_atan2(proj.dot(north))
}

/// C `_vec3ToClosestFace`: returns (face, squared distance to face center).
fn vec3_to_closest_face(v: &Vec3d) -> (i32, f64) {
    let mut face = 0;
    let mut sqd = 5.0;
    for (f, center) in FACE_CENTER_POINT.iter().enumerate() {
        let t = center.dist_sq(*v);
        if t < sqd {
            face = f as i32;
            sqd = t;
        }
    }
    (face, sqd)
}

/// C `_vec3ToHex2d`.
fn vec3_to_hex2d(p: &Vec3d, res: i32) -> (i32, Vec2d) {
    let (face, sqd) = vec3_to_closest_face(p);
    let mut r = (1.0 - sqd * 0.5).h3_acos();
    if r < EPSILON {
        return (face, Vec2d { x: 0.0, y: 0.0 });
    }
    let f = face as usize;
    let mut theta =
        pos_angle_rads(FACE_AXES_AZ_RADS_CII[f][0] - pos_angle_rads(vec3_azimuth_rads(FACE_CENTER_POINT[f], *p)));
    if is_resolution_class_iii(res) {
        theta = pos_angle_rads(theta - M_AP7_ROT_RADS);
    }
    r = r.h3_tan();
    r *= INV_RES0_U_GNOMONIC;
    for _ in 0..res {
        r *= M_SQRT7;
    }
    (face, Vec2d { x: r * theta.h3_cos(), y: r * theta.h3_sin() })
}

/// C `_hex2dToVec3`.
pub(crate) fn hex2d_to_vec3(v: &Vec2d, face: i32, res: i32, substrate: bool) -> Vec3d {
    let f = face as usize;
    let mut r = v.mag();
    if r < EPSILON {
        return FACE_CENTER_POINT[f];
    }
    let mut theta = v.y.h3_atan2(v.x);
    for _ in 0..res {
        r *= M_RSQRT7;
    }
    if substrate {
        r *= M_ONETHIRD;
        if is_resolution_class_iii(res) {
            r *= M_RSQRT7;
        }
    }
    r *= RES0_U_GNOMONIC;
    r = r.h3_atan();
    if !substrate && is_resolution_class_iii(res) {
        theta = pos_angle_rads(theta + M_AP7_ROT_RADS);
    }
    theta = pos_angle_rads(FACE_AXES_AZ_RADS_CII[f][0] - theta);
    let (north, east) = vec3_tangent_basis(FACE_CENTER_POINT[f]);
    let dir = Vec3d::lin_comb(theta.h3_cos(), north, theta.h3_sin(), east);
    let mut out = Vec3d::lin_comb(r.h3_cos(), FACE_CENTER_POINT[f], r.h3_sin(), dir);
    out.normalize();
    out
}

/// C `_faceIjkToVec3`.
pub(crate) fn face_ijk_to_vec3(h: &FaceIjk, res: i32) -> Vec3d {
    hex2d_to_vec3(&h.coord.to_hex2d(), h.face, res, false)
}

#[inline]
fn to_latlng(v: Vec3d) -> LatLng {
    let (lat, lng) = v.to_lat_lng();
    LatLng { lat, lng }
}

fn face_edge_vertices(max_dim: i32) -> [Vec2d; 3] {
    let m = f64::from(max_dim);
    [
        Vec2d { x: 3.0 * m, y: 0.0 },
        Vec2d { x: -1.5 * m, y: 3.0 * M_SQRT3_2 * m },
        Vec2d { x: -1.5 * m, y: -3.0 * M_SQRT3_2 * m },
    ]
}

fn edge_for_dir(dir: i32, v: &[Vec2d; 3]) -> (Vec2d, Vec2d) {
    match dir {
        IJ => (v[0], v[1]),
        JK => (v[1], v[2]),
        _ => {
            debug_assert_eq!(dir, KI);
            (v[2], v[0])
        }
    }
}

/// C `_faceIjkPentToCellBoundary`.
pub(crate) fn face_ijk_pent_to_cell_boundary(h: &FaceIjk, res: i32, start: usize, length: usize) -> CellBoundary {
    let mut adj_res = res;
    let mut center = *h;
    let verts = face_ijk_pent_to_verts(&mut center, &mut adj_res);
    let additional = usize::from(length == NUM_PENT_VERTS);
    let mut g = CellBoundary::default();
    let mut last_fijk = FaceIjk::default();
    for vert in start..start + length + additional {
        let v = vert % NUM_PENT_VERTS;
        let mut fijk = verts[v];
        adjust_pent_vert_overage(&mut fijk, adj_res);

        if is_resolution_class_iii(res) && vert > start {
            let mut tmp = fijk;
            let orig2d0 = last_fijk.coord.to_hex2d();
            let current_to_last_dir = ADJACENT_FACE_DIR[tmp.face as usize][last_fijk.face as usize];
            let orient = &FACE_NEIGHBORS[tmp.face as usize][current_to_last_dir as usize];
            tmp.face = orient.face;
            for _ in 0..orient.ccw_rot60 {
                tmp.coord.rotate60ccw();
            }
            let trans = orient.translate.scale(UNIT_SCALE_BY_CII_RES[adj_res as usize] * 3);
            tmp.coord = tmp.coord.add(trans).normalized();
            let orig2d1 = tmp.coord.to_hex2d();

            let ev = face_edge_vertices(MAX_DIM_BY_CII_RES[adj_res as usize]);
            let (e0, e1) = edge_for_dir(i32::from(ADJACENT_FACE_DIR[tmp.face as usize][fijk.face as usize]), &ev);
            let inter = v2d_intersect(&orig2d0, &orig2d1, &e0, &e1);
            g.push(to_latlng(hex2d_to_vec3(&inter, tmp.face, adj_res, true)));
        }

        if vert < start + NUM_PENT_VERTS {
            let vec = fijk.coord.to_hex2d();
            g.push(to_latlng(hex2d_to_vec3(&vec, fijk.face, adj_res, true)));
        }
        last_fijk = fijk;
    }
    g
}

const PENT_VERTS_CII: [CoordIjk; 5] = [ijk(2, 1, 0), ijk(1, 2, 0), ijk(0, 2, 1), ijk(0, 1, 2), ijk(1, 0, 2)];
const PENT_VERTS_CIII: [CoordIjk; 5] = [ijk(5, 4, 0), ijk(1, 5, 0), ijk(0, 5, 4), ijk(0, 1, 5), ijk(4, 0, 5)];
const HEX_VERTS_CII: [CoordIjk; 6] =
    [ijk(2, 1, 0), ijk(1, 2, 0), ijk(0, 2, 1), ijk(0, 1, 2), ijk(1, 0, 2), ijk(2, 0, 1)];
const HEX_VERTS_CIII: [CoordIjk; 6] =
    [ijk(5, 4, 0), ijk(1, 5, 0), ijk(0, 5, 4), ijk(0, 1, 5), ijk(4, 0, 5), ijk(5, 0, 1)];

fn to_substrate(fijk: &mut FaceIjk, res: &mut i32) -> bool {
    let class_iii = is_resolution_class_iii(*res);
    fijk.coord.down_ap3();
    fijk.coord.down_ap3r();
    if class_iii {
        fijk.coord.down_ap7r();
        *res += 1;
    }
    class_iii
}

/// C `_faceIjkPentToVerts`.
pub(crate) fn face_ijk_pent_to_verts(fijk: &mut FaceIjk, res: &mut i32) -> [FaceIjk; NUM_PENT_VERTS] {
    let verts = if to_substrate(fijk, res) { &PENT_VERTS_CIII } else { &PENT_VERTS_CII };
    let mut out = [FaceIjk::default(); NUM_PENT_VERTS];
    for (o, v) in out.iter_mut().zip(verts) {
        *o = FaceIjk { face: fijk.face, coord: fijk.coord.add(*v).normalized() };
    }
    out
}

/// C `_faceIjkToVerts`.
pub(crate) fn face_ijk_to_verts(fijk: &mut FaceIjk, res: &mut i32) -> [FaceIjk; NUM_HEX_VERTS] {
    let verts = if to_substrate(fijk, res) { &HEX_VERTS_CIII } else { &HEX_VERTS_CII };
    let mut out = [FaceIjk::default(); NUM_HEX_VERTS];
    for (o, v) in out.iter_mut().zip(verts) {
        *o = FaceIjk { face: fijk.face, coord: fijk.coord.add(*v).normalized() };
    }
    out
}

/// C `_faceIjkToCellBoundary`.
pub(crate) fn face_ijk_to_cell_boundary(h: &FaceIjk, res: i32, start: usize, length: usize) -> CellBoundary {
    let mut adj_res = res;
    let mut center = *h;
    let verts = face_ijk_to_verts(&mut center, &mut adj_res);
    let additional = usize::from(length == NUM_HEX_VERTS);
    let mut g = CellBoundary::default();
    let mut last_face = -1;
    let mut last_overage = Overage::None;
    for vert in start..start + length + additional {
        let v = vert % NUM_HEX_VERTS;
        let mut fijk = verts[v];
        let overage = adjust_overage_class_ii(&mut fijk, adj_res, false, true);

        if is_resolution_class_iii(res) && vert > start && fijk.face != last_face && last_overage != Overage::FaceEdge {
            let last_v = (v + 5) % NUM_HEX_VERTS;
            let orig2d0 = verts[last_v].coord.to_hex2d();
            let orig2d1 = verts[v].coord.to_hex2d();
            let ev = face_edge_vertices(MAX_DIM_BY_CII_RES[adj_res as usize]);
            let face2 = if last_face == center.face { fijk.face } else { last_face };
            let (e0, e1) = edge_for_dir(i32::from(ADJACENT_FACE_DIR[center.face as usize][face2 as usize]), &ev);
            let inter = v2d_intersect(&orig2d0, &orig2d1, &e0, &e1);
            let at_vertex = orig2d0.almost_equals(&inter) || orig2d1.almost_equals(&inter);
            if !at_vertex {
                g.push(to_latlng(hex2d_to_vec3(&inter, center.face, adj_res, true)));
            }
        }

        if vert < start + NUM_HEX_VERTS {
            let vec = fijk.coord.to_hex2d();
            g.push(to_latlng(hex2d_to_vec3(&vec, fijk.face, adj_res, true)));
        }
        last_face = fijk.face;
        last_overage = overage;
    }
    g
}

/// C `_adjustOverageClassII`.
pub(crate) fn adjust_overage_class_ii(fijk: &mut FaceIjk, res: i32, pent_leading4: bool, substrate: bool) -> Overage {
    let mut overage = Overage::None;
    let mut max_dim = MAX_DIM_BY_CII_RES[res as usize];
    if substrate {
        max_dim *= 3;
    }
    let c = fijk.coord;
    let sum = c.i.wrapping_add(c.j).wrapping_add(c.k);
    if substrate && sum == max_dim {
        overage = Overage::FaceEdge;
    } else if sum > max_dim {
        overage = Overage::NewFace;
        let orient = if fijk.coord.k > 0 {
            if fijk.coord.j > 0 {
                &FACE_NEIGHBORS[fijk.face as usize][JK as usize]
            } else {
                let o = &FACE_NEIGHBORS[fijk.face as usize][KI as usize];
                if pent_leading4 {
                    let origin = ijk(max_dim, 0, 0);
                    let mut tmp = fijk.coord.sub(origin);
                    tmp.rotate60cw();
                    fijk.coord = tmp.add(origin);
                }
                o
            }
        } else {
            &FACE_NEIGHBORS[fijk.face as usize][IJ as usize]
        };
        fijk.face = orient.face;
        for _ in 0..orient.ccw_rot60 {
            fijk.coord.rotate60ccw();
        }
        let mut unit_scale = UNIT_SCALE_BY_CII_RES[res as usize];
        if substrate {
            unit_scale *= 3;
        }
        fijk.coord = fijk.coord.add(orient.translate.scale(unit_scale)).normalized();
        let c = fijk.coord;
        if substrate && c.i.wrapping_add(c.j).wrapping_add(c.k) == max_dim {
            overage = Overage::FaceEdge;
        }
    }
    overage
}

/// C `_adjustPentVertOverage`.
pub(crate) fn adjust_pent_vert_overage(fijk: &mut FaceIjk, res: i32) -> Overage {
    loop {
        let o = adjust_overage_class_ii(fijk, res, false, true);
        if o != Overage::NewFace {
            return o;
        }
    }
}
