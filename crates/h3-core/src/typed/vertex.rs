//! Validated canonical vertex indexes.
use core::fmt;
use core::str::FromStr;

use super::CellIndex;
use crate::errors::{H3Error, H3Result};
use crate::{LatLng, raw};

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
        raw::cell_to_vertex(cell.get(), n).map(VertexIndex)
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

impl FromStr for VertexIndex {
    type Err = H3Error;
    fn from_str(value: &str) -> H3Result<VertexIndex> {
        VertexIndex::new(raw::string_to_h3(value).map_err(|_| H3Error::VertexInvalid)?)
    }
}

impl From<VertexIndex> for u64 {
    fn from(vertex: VertexIndex) -> u64 {
        vertex.0
    }
}
