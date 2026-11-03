//! Grid traversal: neighbors, disks, rings, local IJ coordinates, distances, and paths.
//!
//! Translated from H3 C `algos.c` and `localij.c` (Apache-2.0, Copyright Uber Technologies, Inc.).
//!
//! Disk and ring functions return the C output buffer: length `maxGridDiskSize(k)` (or
//! `maxGridRingSize(k)`), in C order, with unused slots `0`. The C recursive safe disk algorithm is
//! implemented with an explicit stack that visits cells in exactly the recursive order, so results
//! (including hash-set placement) are identical while stack use is bounded on the heap.

mod disk;
mod localij;
mod neighbors;
mod path;

pub(crate) use disk::grid_disk1_buffer;
pub use disk::{
    grid_disk, grid_disk_distances, grid_disk_distances_safe, grid_disk_distances_unsafe, grid_disk_into,
    grid_disk_unsafe, grid_disks_unsafe, grid_ring, grid_ring_unsafe, max_grid_disk_size, max_grid_ring_size,
};
pub use localij::{cell_to_local_ij, local_ij_to_cell};
pub(crate) use neighbors::{direction_for_neighbor, h3_neighbor_rotations};
pub use path::{grid_distance, grid_path_cells, grid_path_cells_size};
