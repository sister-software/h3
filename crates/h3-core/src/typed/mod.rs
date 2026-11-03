//! Validated H3 index types delegate numerical operations to the raw API.
//!
//! Resolution arguments remain `i32` for compatibility. The raw operations validate their range.

mod cell;
mod edge;
mod vertex;

pub use cell::CellIndex;
pub use edge::DirectedEdgeIndex;
pub use vertex::VertexIndex;
