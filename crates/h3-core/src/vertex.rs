//! Cell vertexes.
//!
//! Translated from H3 C `vertex.c` (Apache-2.0, Copyright Uber Technologies, Inc.).

use crate::LatLng;
use crate::cell::h3_to_face_ijk;
use crate::constants::*;
use crate::coords::*;
use crate::errors::{H3Error, H3Result};
use crate::faceijk::{face_ijk_pent_to_cell_boundary, face_ijk_to_cell_boundary};
use crate::index::*;
use crate::tables::BASE_CELL_DATA;
use crate::traversal::{direction_for_neighbor, h3_neighbor_rotations};

pub(crate) const INVALID_VERTEX_NUM: i32 = -1;
const DIRECTION_INDEX_OFFSET: usize = 2;

/// (base cell, faces for each axial direction starting with J).
const PENTAGON_DIRECTION_FACES: [(i32, [i32; 5]); 12] = [
    (4, [4, 0, 2, 1, 3]),
    (14, [6, 11, 2, 7, 1]),
    (24, [5, 10, 1, 6, 0]),
    (38, [7, 12, 3, 8, 2]),
    (49, [9, 14, 0, 5, 4]),
    (58, [8, 13, 4, 9, 3]),
    (63, [11, 6, 15, 10, 16]),
    (72, [12, 7, 16, 11, 17]),
    (83, [10, 5, 19, 14, 15]),
    (97, [13, 8, 17, 12, 18]),
    (107, [14, 9, 18, 13, 19]),
    (117, [15, 19, 17, 18, 16]),
];

/// C `vertexRotations`.
fn vertex_rotations(cell: u64) -> H3Result<i32> {
    let fijk = h3_to_face_ijk(cell)?;
    let base_cell = get_base_cell(cell);
    let leading = leading_non_zero_digit(cell);
    let base_fijk = BASE_CELL_DATA[base_cell as usize].home_fijk;
    let mut ccw_rot60 = base_cell_to_ccwrot60(base_cell, fijk.face);
    if is_base_cell_pentagon(base_cell) {
        let Some((_, faces)) = PENTAGON_DIRECTION_FACES.iter().find(|(bc, _)| *bc == base_cell) else {
            return Err(H3Error::Failed);
        };
        let ik_face = faces[IK_AXES_DIGIT as usize - DIRECTION_INDEX_OFFSET];
        let jk_face = faces[JK_AXES_DIGIT as usize - DIRECTION_INDEX_OFFSET];
        if fijk.face != base_fijk.face && (is_base_cell_polar_pentagon(base_cell) || fijk.face == ik_face) {
            ccw_rot60 = (ccw_rot60 + 1) % 6;
        }
        if leading == JK_AXES_DIGIT && fijk.face == ik_face {
            ccw_rot60 = (ccw_rot60 + 5) % 6;
        } else if leading == IK_AXES_DIGIT && fijk.face == jk_face {
            ccw_rot60 = (ccw_rot60 + 1) % 6;
        }
    }
    Ok(ccw_rot60)
}

const DIRECTION_TO_VERTEX_NUM_HEX: [i32; 7] = [7, 3, 1, 2, 5, 4, 0];
const DIRECTION_TO_VERTEX_NUM_PENT: [i32; 7] = [7, 7, 1, 2, 4, 3, 0];

/// C `vertexNumForDirection`.
pub(crate) fn vertex_num_for_direction(origin: u64, direction: Direction) -> i32 {
    let pent = is_pentagon(origin);
    if direction == CENTER_DIGIT || direction >= INVALID_DIGIT || (pent && direction == K_AXES_DIGIT) {
        return INVALID_VERTEX_NUM;
    }
    let Ok(rotations) = vertex_rotations(origin) else {
        return INVALID_VERTEX_NUM;
    };
    if pent {
        (DIRECTION_TO_VERTEX_NUM_PENT[direction as usize] + NUM_PENT_VERTS as i32 - rotations) % NUM_PENT_VERTS as i32
    } else {
        (DIRECTION_TO_VERTEX_NUM_HEX[direction as usize] + NUM_HEX_VERTS as i32 - rotations) % NUM_HEX_VERTS as i32
    }
}

const VERTEX_NUM_TO_DIRECTION_HEX: [Direction; 6] =
    [IJ_AXES_DIGIT, J_AXES_DIGIT, JK_AXES_DIGIT, K_AXES_DIGIT, IK_AXES_DIGIT, I_AXES_DIGIT];
const VERTEX_NUM_TO_DIRECTION_PENT: [Direction; 5] =
    [IJ_AXES_DIGIT, J_AXES_DIGIT, JK_AXES_DIGIT, IK_AXES_DIGIT, I_AXES_DIGIT];

/// C `directionForVertexNum`.
fn direction_for_vertex_num(origin: u64, vertex_num: i32) -> Direction {
    let pent = is_pentagon(origin);
    let n = if pent { NUM_PENT_VERTS } else { NUM_HEX_VERTS } as i32;
    if vertex_num < 0 || vertex_num > n - 1 {
        return INVALID_DIGIT;
    }
    let Ok(rotations) = vertex_rotations(origin) else {
        return INVALID_DIGIT;
    };
    let pos = ((vertex_num + rotations) % n) as usize;
    if pent { VERTEX_NUM_TO_DIRECTION_PENT[pos] } else { VERTEX_NUM_TO_DIRECTION_HEX[pos] }
}

const DIRECTIONS: [Direction; 6] =
    [J_AXES_DIGIT, JK_AXES_DIGIT, K_AXES_DIGIT, IK_AXES_DIGIT, I_AXES_DIGIT, IJ_AXES_DIGIT];
const REV_NEIGHBOR_DIRECTIONS_HEX: [i32; 7] = [7, 5, 3, 4, 1, 0, 2];

/// C `cellToVertex`.
pub fn cell_to_vertex(cell: u64, vertex_num: i32) -> H3Result<u64> {
    let cell_is_pentagon = is_pentagon(cell);
    let cell_num_verts = if cell_is_pentagon { NUM_PENT_VERTS } else { NUM_HEX_VERTS } as i32;
    let res = get_resolution(cell);
    if vertex_num < 0 || vertex_num > cell_num_verts - 1 {
        return Err(H3Error::Domain);
    }
    let mut owner = cell;
    let mut owner_vertex_num = vertex_num;

    if res == 0 || get_index_digit(cell, res) != CENTER_DIGIT {
        let left = direction_for_vertex_num(cell, vertex_num);
        if left == INVALID_DIGIT {
            return Err(H3Error::Failed);
        }
        let mut l_rotations = 0;
        let left_neighbor = h3_neighbor_rotations(cell, left, &mut l_rotations)?;
        if left_neighbor < owner {
            owner = left_neighbor;
        }

        if res == 0 || get_index_digit(left_neighbor, res) != CENTER_DIGIT {
            let right = direction_for_vertex_num(cell, (vertex_num - 1 + cell_num_verts) % cell_num_verts);
            if right == INVALID_DIGIT {
                return Err(H3Error::Failed);
            }
            let mut r_rotations = 0;
            let right_neighbor = h3_neighbor_rotations(cell, right, &mut r_rotations)?;
            if right_neighbor < owner {
                owner = right_neighbor;
                let dir = if is_pentagon(owner) {
                    direction_for_neighbor(owner, cell)
                } else {
                    DIRECTIONS[((REV_NEIGHBOR_DIRECTIONS_HEX[right as usize] + r_rotations) % 6) as usize]
                };
                owner_vertex_num = vertex_num_for_direction(owner, dir);
            }
        }

        if owner == left_neighbor {
            let owner_is_pentagon = is_pentagon(owner);
            let dir = if owner_is_pentagon {
                direction_for_neighbor(owner, cell)
            } else {
                DIRECTIONS[((REV_NEIGHBOR_DIRECTIONS_HEX[left as usize] + l_rotations) % 6) as usize]
            };
            owner_vertex_num = vertex_num_for_direction(owner, dir) + 1;
            if owner_vertex_num == NUM_HEX_VERTS as i32
                || (owner_is_pentagon && owner_vertex_num == NUM_PENT_VERTS as i32)
            {
                owner_vertex_num = 0;
            }
        }
    }

    // C `H3_SET_RESERVED_BITS` shifts `(uint64_t)ownerVertexNum` left by 56 without masking, so an
    // unexpected negative value also overwrites the mode and high bits; `as u64` sign-extends the
    // same way.
    Ok(set_reserved_bits(set_mode(owner, H3_VERTEX_MODE), owner_vertex_num as u64))
}

/// C `cellToVertexes`: six slots; a pentagon's last slot is `0`.
pub fn cell_to_vertexes(cell: u64) -> H3Result<[u64; 6]> {
    let pent = is_pentagon(cell);
    let mut out = [0u64; 6];
    for (i, v) in out.iter_mut().enumerate() {
        if !(i == 5 && pent) {
            *v = cell_to_vertex(cell, i as i32)?;
        }
    }
    Ok(out)
}

/// C `vertexToLatLng`. Returns radians.
pub fn vertex_to_lat_lng(vertex: u64) -> H3Result<LatLng> {
    let vertex_num = get_reserved_bits(vertex) as usize;
    let owner = set_reserved_bits(set_mode(vertex, H3_CELL_MODE), 0);
    let fijk = h3_to_face_ijk(owner)?;
    let res = get_resolution(owner);
    let gb = if is_pentagon(owner) {
        face_ijk_pent_to_cell_boundary(&fijk, res, vertex_num, 1)
    } else {
        face_ijk_to_cell_boundary(&fijk, res, vertex_num, 1)
    };
    Ok(gb[0])
}

/// C `isValidVertex`.
pub fn is_valid_vertex(vertex: u64) -> bool {
    if get_mode(vertex) != H3_VERTEX_MODE {
        return false;
    }
    let vertex_num = get_reserved_bits(vertex) as i32;
    let owner = set_reserved_bits(set_mode(vertex, H3_CELL_MODE), 0);
    if !is_valid_cell(owner) {
        return false;
    }
    match cell_to_vertex(owner, vertex_num) {
        Ok(canonical) => vertex == canonical,
        Err(_) => false,
    }
}
