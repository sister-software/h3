//! Typed, validated index wrappers over the C-equivalent [`crate::raw`] layer.

use core::fmt;
use core::str::FromStr;

use crate::errors::{H3Error, H3Result};
use crate::{CellBoundary, LatLng, raw};

/// A valid H3 cell index (hexagon or pentagon).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CellIndex(u64);

impl CellIndex {
    /// Validates a raw index as a cell.
    pub fn new(h: u64) -> H3Result<CellIndex> {
        if raw::is_valid_cell(h) { Ok(CellIndex(h)) } else { Err(H3Error::CellInvalid) }
    }

    /// The raw 64-bit index.
    pub const fn get(self) -> u64 {
        self.0
    }

    /// Indexes a point (radians) at `res`.
    pub fn from_lat_lng(point: LatLng, res: i32) -> H3Result<CellIndex> {
        raw::lat_lng_to_cell(&point, res).map(CellIndex)
    }

    /// The cell resolution, 0–15.
    pub fn resolution(self) -> i32 {
        raw::get_resolution(self.0)
    }

    /// The base cell number, 0–121.
    pub fn base_cell(self) -> i32 {
        raw::get_base_cell_number(self.0)
    }

    /// Whether this cell is a pentagon.
    pub fn is_pentagon(self) -> bool {
        raw::is_pentagon(self.0)
    }

    /// Whether this cell's resolution is Class III (odd).
    pub fn is_class_iii(self) -> bool {
        raw::is_res_class_iii(self.0)
    }

    /// The cell center in radians.
    pub fn center(self) -> LatLng {
        raw::cell_to_lat_lng(self.0).expect("valid cells always decode")
    }

    /// The cell boundary in radians.
    pub fn boundary(self) -> CellBoundary {
        raw::cell_to_boundary(self.0).expect("valid cells always decode")
    }

    /// The parent at `res`.
    pub fn parent(self, res: i32) -> H3Result<CellIndex> {
        raw::cell_to_parent(self.0, res).map(CellIndex)
    }

    /// The center child at `res`.
    pub fn center_child(self, res: i32) -> H3Result<CellIndex> {
        raw::cell_to_center_child(self.0, res).map(CellIndex)
    }

    /// The number of children at `res`.
    pub fn children_count(self, res: i32) -> H3Result<i64> {
        raw::cell_to_children_size(self.0, res)
    }

    /// Iterates over the children at `res`.
    pub fn children(self, res: i32) -> H3Result<impl Iterator<Item = CellIndex>> {
        raw::cell_to_children_size(self.0, res)?;
        Ok(raw::cell_to_children(self.0, res).map(CellIndex))
    }
}

impl From<CellIndex> for u64 {
    fn from(c: CellIndex) -> u64 {
        c.0
    }
}

impl TryFrom<u64> for CellIndex {
    type Error = H3Error;
    fn try_from(h: u64) -> H3Result<CellIndex> {
        CellIndex::new(h)
    }
}

impl fmt::Display for CellIndex {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:x}", self.0)
    }
}

impl FromStr for CellIndex {
    type Err = H3Error;
    fn from_str(s: &str) -> H3Result<CellIndex> {
        CellIndex::new(raw::string_to_h3(s).map_err(|_| H3Error::CellInvalid)?)
    }
}

/// A valid H3 directed edge index.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct DirectedEdgeIndex(u64);

impl DirectedEdgeIndex {
    /// Validates a raw index as a directed edge.
    pub fn new(h: u64) -> H3Result<DirectedEdgeIndex> {
        if raw::is_valid_directed_edge(h) { Ok(DirectedEdgeIndex(h)) } else { Err(H3Error::DirEdgeInvalid) }
    }

    /// The edge from `origin` to neighboring `destination`.
    pub fn between(origin: CellIndex, destination: CellIndex) -> H3Result<DirectedEdgeIndex> {
        raw::cells_to_directed_edge(origin.0, destination.0).map(DirectedEdgeIndex)
    }

    /// The raw 64-bit index.
    pub const fn get(self) -> u64 {
        self.0
    }

    /// The origin cell.
    pub fn origin(self) -> CellIndex {
        CellIndex(raw::get_directed_edge_origin(self.0).expect("valid edges have an origin"))
    }

    /// The destination cell.
    pub fn destination(self) -> H3Result<CellIndex> {
        raw::get_directed_edge_destination(self.0).map(CellIndex)
    }

    /// The reverse edge.
    pub fn reverse(self) -> H3Result<DirectedEdgeIndex> {
        raw::reverse_directed_edge(self.0).map(DirectedEdgeIndex)
    }

    /// The edge boundary in radians.
    pub fn boundary(self) -> H3Result<CellBoundary> {
        raw::directed_edge_to_boundary(self.0)
    }

    /// The edge length in radians.
    pub fn length_rads(self) -> H3Result<f64> {
        raw::edge_length_rads(self.0)
    }
}

impl fmt::Display for DirectedEdgeIndex {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:x}", self.0)
    }
}

impl TryFrom<u64> for DirectedEdgeIndex {
    type Error = H3Error;
    fn try_from(h: u64) -> H3Result<DirectedEdgeIndex> {
        DirectedEdgeIndex::new(h)
    }
}

/// A valid, canonical H3 vertex index.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct VertexIndex(u64);

impl VertexIndex {
    /// Validates a raw index as a canonical vertex.
    pub fn new(h: u64) -> H3Result<VertexIndex> {
        if raw::is_valid_vertex(h) { Ok(VertexIndex(h)) } else { Err(H3Error::VertexInvalid) }
    }

    /// Vertex `n` of a cell (0–5, or 0–4 for pentagons).
    pub fn of(cell: CellIndex, n: i32) -> H3Result<VertexIndex> {
        raw::cell_to_vertex(cell.0, n).map(VertexIndex)
    }

    /// The raw 64-bit index.
    pub const fn get(self) -> u64 {
        self.0
    }

    /// The vertex location in radians.
    pub fn lat_lng(self) -> H3Result<LatLng> {
        raw::vertex_to_lat_lng(self.0)
    }
}

impl fmt::Display for VertexIndex {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:x}", self.0)
    }
}

impl TryFrom<u64> for VertexIndex {
    type Error = H3Error;
    fn try_from(h: u64) -> H3Result<VertexIndex> {
        VertexIndex::new(h)
    }
}
