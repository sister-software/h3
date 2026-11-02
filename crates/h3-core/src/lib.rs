//! An independent Rust implementation of the [H3] hexagonal hierarchical geospatial index.
//!
//! The algorithms are translated from the H3 C library (version 4.5.0, Apache-2.0, Copyright Uber
//! Technologies, Inc.); see `THIRD_PARTY_NOTICES.md`. Index bits, error codes, and algorithm
//! behaviour follow C. Angles are radians throughout the core; use [`degs_to_rads`] and
//! [`rads_to_degs`] to convert.
//!
//! Two layers are exposed:
//!
//! - [`raw`]: C-equivalent functions over raw `u64` indexes. Like C, most of them do not
//!   validate their index arguments and return whatever the C algorithm computes.
//! - Typed wrappers ([`CellIndex`], [`DirectedEdgeIndex`], [`VertexIndex`]) that validate on
//!   construction and delegate to [`raw`].
//!
//! ```
//! use sister_h3::{CellIndex, DirectedEdgeIndex, LatLng, raw};
//!
//! // Typed API, radians in and out.
//! let cell = CellIndex::from_lat_lng(LatLng::from_degrees(37.3615593, -122.0553238), 7)?;
//! assert_eq!(cell.to_string(), "87283472bffffff");
//! assert_eq!(cell.parent(5)?.to_string(), "85283473fffffff");
//! assert_eq!(cell.children(8)?.count(), 7);
//!
//! // C-equivalent API over raw u64 indexes, with C error codes.
//! let disk = raw::grid_disk(cell.get(), 1)?;
//! assert_eq!(disk.iter().filter(|&&h| h != 0).count(), 7);
//! assert_eq!(raw::cell_to_parent(cell.get(), 9).unwrap_err().code(), 12); // E_RES_MISMATCH
//!
//! let neighbor = CellIndex::new(disk[1])?;
//! let edge = DirectedEdgeIndex::between(cell, neighbor)?;
//! assert_eq!(edge.destination()?, neighbor);
//! # Ok::<(), sister_h3::H3Error>(())
//! ```
//!
//! [H3]: https://h3geo.org

#![forbid(unsafe_code)]

mod area;
mod bbox;
mod cell;
mod constants;
mod coords;
mod edge;
mod errors;
mod faceijk;
mod hierarchy;
mod index;
mod latlng;
mod math;
mod multipoly;
mod polyfill;
mod polygon;
mod tables;
mod traversal;
mod typed;
mod vertex;

pub use constants::{EARTH_RADIUS_KM, MAX_CELL_BNDRY_VERTS, MAX_H3_RES, NUM_BASE_CELLS, NUM_PENTAGONS};
pub use errors::{H3Error, H3Result};
pub use hierarchy::ChildIter;
pub use latlng::{degs_to_rads, rads_to_degs};
pub use polygon::{ContainmentMode, GeoPolygon};
pub use typed::*;

/// A latitude/longitude pair in **radians**.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LatLng {
    /// Latitude in radians.
    pub lat: f64,
    /// Longitude in radians.
    pub lng: f64,
}

impl LatLng {
    /// Creates a coordinate from radians.
    pub const fn from_radians(lat: f64, lng: f64) -> LatLng {
        LatLng { lat, lng }
    }

    /// Creates a coordinate from degrees.
    pub const fn from_degrees(lat: f64, lng: f64) -> LatLng {
        LatLng { lat: degs_to_rads(lat), lng: degs_to_rads(lng) }
    }

    /// Latitude in degrees.
    pub const fn lat_degrees(&self) -> f64 {
        rads_to_degs(self.lat)
    }

    /// Longitude in degrees.
    pub const fn lng_degrees(&self) -> f64 {
        rads_to_degs(self.lng)
    }
}

/// A cell or edge boundary: up to [`MAX_CELL_BNDRY_VERTS`] vertices in counter-clockwise order.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct CellBoundary {
    len: usize,
    verts: [LatLng; MAX_CELL_BNDRY_VERTS],
}

impl CellBoundary {
    pub(crate) fn push(&mut self, v: LatLng) {
        self.verts[self.len] = v;
        self.len += 1;
    }

    /// The boundary vertices.
    pub fn as_slice(&self) -> &[LatLng] {
        &self.verts[..self.len]
    }

    /// Number of vertices.
    pub fn len(&self) -> usize {
        self.len
    }

    /// Whether the boundary has no vertices.
    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
}

impl core::ops::Deref for CellBoundary {
    type Target = [LatLng];
    fn deref(&self) -> &[LatLng] {
        self.as_slice()
    }
}

/// Local IJ coordinates (C `CoordIJ`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct CoordIJ {
    /// I component.
    pub i: i32,
    /// J component.
    pub j: i32,
}

/// C-equivalent operations on raw `u64` indexes, named after the C functions.
pub mod raw {
    pub use crate::area::{cell_area_km2, cell_area_m2, cell_area_rads2};
    pub use crate::cell::{cell_to_boundary, cell_to_lat_lng, get_icosahedron_faces, lat_lng_to_cell, max_face_count};
    pub use crate::edge::{
        are_neighbor_cells, cells_to_directed_edge, directed_edge_to_boundary, directed_edge_to_cells, edge_length_km,
        edge_length_m, edge_length_rads, get_directed_edge_destination, get_directed_edge_origin,
        is_valid_directed_edge, is_valid_index, origin_to_directed_edges, reverse_directed_edge,
    };
    pub use crate::hierarchy::{
        cell_to_center_child, cell_to_child_pos, cell_to_children, cell_to_children_size, cell_to_parent,
        child_pos_to_cell, compact_cells, uncompact_cells, uncompact_cells_into, uncompact_cells_size,
    };
    pub use crate::index::{
        construct_cell, get_base_cell_number, get_index_digit_checked as get_index_digit, get_num_cells, get_pentagons,
        get_res0_cells, get_resolution_raw as get_resolution, h3_to_string, is_pentagon, is_res_class_iii,
        is_valid_cell, pentagon_count, res0_cell_count, string_to_h3,
    };
    pub use crate::latlng::{
        degs_to_rads, get_hexagon_area_avg_km2, get_hexagon_area_avg_m2, get_hexagon_edge_length_avg_km,
        get_hexagon_edge_length_avg_m, great_circle_distance_km, great_circle_distance_m, great_circle_distance_rads,
        rads_to_degs,
    };
    pub use crate::multipoly::{cells_to_linked_multi_polygon, cells_to_multi_polygon};
    pub use crate::polyfill::{
        max_polygon_to_cells_size, max_polygon_to_cells_size_experimental, polygon_to_cells,
        polygon_to_cells_experimental,
    };
    pub use crate::traversal::{
        cell_to_local_ij, grid_disk, grid_disk_distances, grid_disk_distances_safe, grid_disk_distances_unsafe,
        grid_disk_into, grid_disk_unsafe, grid_disks_unsafe, grid_distance, grid_path_cells, grid_path_cells_size,
        grid_ring, grid_ring_unsafe, local_ij_to_cell, max_grid_disk_size, max_grid_ring_size,
    };
    pub use crate::vertex::{cell_to_vertex, cell_to_vertexes, is_valid_vertex, vertex_to_lat_lng};
}
