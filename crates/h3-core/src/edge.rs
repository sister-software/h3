//! Directed edges.
//!
//! Translated from H3 C `directedEdge.c` and the edge-length routines in `latLng.c`
//! (Apache-2.0, Copyright Uber Technologies, Inc.).

use crate::CellBoundary;
use crate::cell::h3_to_face_ijk;
use crate::constants::*;
use crate::coords::*;
use crate::errors::{H3Error, H3Result};
use crate::faceijk::{face_ijk_pent_to_cell_boundary, face_ijk_to_cell_boundary};
use crate::hierarchy::cell_to_parent;
use crate::index::*;
use crate::latlng::great_circle_distance_rads;
use crate::traversal::{direction_for_neighbor, grid_disk1_buffer, h3_neighbor_rotations};
use crate::vertex::{INVALID_VERTEX_NUM, is_valid_vertex, vertex_num_for_direction};

/// C `areNeighborCells`.
pub fn are_neighbor_cells(origin: u64, destination: u64) -> H3Result<bool> {
    if get_mode(origin) != H3_CELL_MODE || get_mode(destination) != H3_CELL_MODE {
        return Err(H3Error::CellInvalid);
    }
    if origin == destination {
        return Ok(false);
    }
    if get_resolution(origin) != get_resolution(destination) {
        return Err(H3Error::ResMismatch);
    }
    let parent_res = get_resolution(origin) - 1;
    if parent_res > 0 {
        // C ignores cellToParent errors here (both share a valid resolution).
        let origin_parent = cell_to_parent(origin, parent_res).unwrap_or(0);
        let destination_parent = cell_to_parent(destination, parent_res).unwrap_or(0);
        if origin_parent == destination_parent {
            let od = get_index_digit(origin, parent_res + 1);
            let dd = get_index_digit(destination, parent_res + 1);
            if od == CENTER_DIGIT || dd == CENTER_DIGIT {
                return Ok(true);
            }
            if od >= INVALID_DIGIT {
                return Err(H3Error::CellInvalid);
            }
            if (od == K_AXES_DIGIT || dd == K_AXES_DIGIT) && is_pentagon(origin_parent) {
                return Err(H3Error::CellInvalid);
            }
            const CW: [Direction; 7] =
                [CENTER_DIGIT, JK_AXES_DIGIT, IJ_AXES_DIGIT, J_AXES_DIGIT, IK_AXES_DIGIT, K_AXES_DIGIT, I_AXES_DIGIT];
            const CCW: [Direction; 7] =
                [CENTER_DIGIT, IK_AXES_DIGIT, JK_AXES_DIGIT, K_AXES_DIGIT, IJ_AXES_DIGIT, I_AXES_DIGIT, J_AXES_DIGIT];
            if CW[od as usize] == dd || CCW[od as usize] == dd {
                return Ok(true);
            }
        }
    }
    Ok(grid_disk1_buffer(origin).contains(&destination))
}

/// C `cellsToDirectedEdge`.
pub fn cells_to_directed_edge(origin: u64, destination: u64) -> H3Result<u64> {
    let direction = direction_for_neighbor(origin, destination);
    if direction == INVALID_DIGIT {
        return Err(H3Error::NotNeighbors);
    }
    Ok(set_reserved_bits(set_mode(origin, H3_DIRECTEDEDGE_MODE), u64::from(direction)))
}

/// C `getDirectedEdgeOrigin`.
pub fn get_directed_edge_origin(edge: u64) -> H3Result<u64> {
    if get_mode(edge) != H3_DIRECTEDEDGE_MODE {
        return Err(H3Error::DirEdgeInvalid);
    }
    Ok(set_reserved_bits(set_mode(edge, H3_CELL_MODE), 0))
}

/// C `getDirectedEdgeDestination`.
pub fn get_directed_edge_destination(edge: u64) -> H3Result<u64> {
    let direction = get_reserved_bits(edge) as Direction;
    let origin = get_directed_edge_origin(edge)?;
    let mut rotations = 0;
    h3_neighbor_rotations(origin, direction, &mut rotations)
}

/// C `isValidDirectedEdge`.
pub fn is_valid_directed_edge(edge: u64) -> bool {
    let dir = get_reserved_bits(edge) as Direction;
    if dir == CENTER_DIGIT || dir >= NUM_DIGITS {
        return false;
    }
    let Ok(origin) = get_directed_edge_origin(edge) else {
        return false;
    };
    if is_pentagon(origin) && dir == K_AXES_DIGIT {
        return false;
    }
    is_valid_cell(origin)
}

/// C `isValidIndex`.
pub fn is_valid_index(h: u64) -> bool {
    is_valid_cell(h) || is_valid_directed_edge(h) || is_valid_vertex(h)
}

/// C `directedEdgeToCells`: `[origin, destination]`.
pub fn directed_edge_to_cells(edge: u64) -> H3Result<[u64; 2]> {
    Ok([get_directed_edge_origin(edge)?, get_directed_edge_destination(edge)?])
}

/// C `originToDirectedEdges`: six slots; a pentagon's deleted `k` direction is `0`.
pub fn origin_to_directed_edges(origin: u64) -> [u64; 6] {
    let pent = is_pentagon(origin);
    let mut edges = [0u64; 6];
    for (i, e) in edges.iter_mut().enumerate() {
        if !(pent && i == 0) {
            *e = set_reserved_bits(set_mode(origin, H3_DIRECTEDEDGE_MODE), i as u64 + 1);
        }
    }
    edges
}

/// C `directedEdgeToBoundary`. Returns radians.
pub fn directed_edge_to_boundary(edge: u64) -> H3Result<CellBoundary> {
    let direction = get_reserved_bits(edge) as Direction;
    let origin = get_directed_edge_origin(edge)?;
    let start = vertex_num_for_direction(origin, direction);
    if start == INVALID_VERTEX_NUM {
        return Err(H3Error::DirEdgeInvalid);
    }
    let fijk = h3_to_face_ijk(origin)?;
    let res = get_resolution(origin);
    Ok(if is_pentagon(origin) {
        face_ijk_pent_to_cell_boundary(&fijk, res, start as usize, 2)
    } else {
        face_ijk_to_cell_boundary(&fijk, res, start as usize, 2)
    })
}

/// C `reverseDirectedEdge`.
pub fn reverse_directed_edge(edge: u64) -> H3Result<u64> {
    let origin = get_directed_edge_origin(edge)?;
    let destination = get_directed_edge_destination(edge)?;
    cells_to_directed_edge(destination, origin)
}

/// C `edgeLengthRads`.
pub fn edge_length_rads(edge: u64) -> H3Result<f64> {
    let cb = directed_edge_to_boundary(edge)?;
    let mut length = 0.0;
    for w in cb.windows(2) {
        length += great_circle_distance_rads(&w[0], &w[1]);
    }
    Ok(length)
}

/// C `edgeLengthKm`.
pub fn edge_length_km(edge: u64) -> H3Result<f64> {
    Ok(edge_length_rads(edge)? * EARTH_RADIUS_KM)
}

/// C `edgeLengthM`.
pub fn edge_length_m(edge: u64) -> H3Result<f64> {
    Ok(edge_length_km(edge)? * 1000.0)
}
