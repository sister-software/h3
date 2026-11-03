//! Validated directed edge indexes.
use core::fmt;
use core::str::FromStr;

use super::CellIndex;
use crate::errors::{H3Error, H3Result};
use crate::{CellBoundary, raw};

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
        raw::cells_to_directed_edge(origin.get(), destination.get()).map(DirectedEdgeIndex)
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

    /// Returns the edge length in kilometres.
    pub fn length_km(self) -> H3Result<f64> {
        raw::edge_length_km(self.0)
    }

    /// Returns the edge length in metres.
    pub fn length_m(self) -> H3Result<f64> {
        raw::edge_length_m(self.0)
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

impl FromStr for DirectedEdgeIndex {
    type Err = H3Error;
    fn from_str(value: &str) -> H3Result<DirectedEdgeIndex> {
        DirectedEdgeIndex::new(raw::string_to_h3(value).map_err(|_| H3Error::DirEdgeInvalid)?)
    }
}

impl From<DirectedEdgeIndex> for u64 {
    fn from(edge: DirectedEdgeIndex) -> u64 {
        edge.0
    }
}
