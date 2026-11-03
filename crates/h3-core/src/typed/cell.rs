//! Validated cell indexes and their operations.
use core::fmt;
use core::str::FromStr;

use crate::errors::{H3Error, H3Result};
use crate::{CellBoundary, LatLng, raw};

/// A valid H3 cell index (hexagon or pentagon).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct CellIndex(pub(super) u64);

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

    /// Returns the cells within grid distance `k`, omitting unused C buffer slots.
    pub fn disk(self, k: i32) -> H3Result<impl Iterator<Item = CellIndex>> {
        Ok(raw::grid_disk(self.0, k)?.into_iter().filter(|&cell| cell != 0).map(CellIndex))
    }

    /// Returns the cells at exactly grid distance `k`.
    pub fn ring(self, k: i32) -> H3Result<impl Iterator<Item = CellIndex>> {
        Ok(raw::grid_ring(self.0, k)?.into_iter().filter(|&cell| cell != 0).map(CellIndex))
    }

    /// Returns the grid distance to another cell, or an error across unsupported distortion.
    pub fn distance_to(self, destination: CellIndex) -> H3Result<i64> {
        raw::grid_distance(self.0, destination.0)
    }

    /// Returns an adjacent-cell path to another cell, including both endpoints.
    pub fn path_to(self, destination: CellIndex) -> H3Result<impl Iterator<Item = CellIndex>> {
        Ok(raw::grid_path_cells(self.0, destination.0)?.into_iter().map(CellIndex))
    }

    /// Returns the cell area in square radians.
    pub fn area_rads2(self) -> H3Result<f64> {
        raw::cell_area_rads2(self.0)
    }

    /// Returns the cell area in square kilometres.
    pub fn area_km2(self) -> H3Result<f64> {
        raw::cell_area_km2(self.0)
    }

    /// Returns the cell area in square metres.
    pub fn area_m2(self) -> H3Result<f64> {
        raw::cell_area_m2(self.0)
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
