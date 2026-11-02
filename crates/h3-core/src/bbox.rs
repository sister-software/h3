#![allow(clippy::wrong_self_convention)] // names mirror C (`bboxToCellBoundary`)

//! Geographic bounding boxes.
//!
//! Translated from H3 C `bbox.c` (Apache-2.0, Copyright Uber Technologies, Inc.).

use crate::cell::{cell_to_boundary, cell_to_lat_lng};
use crate::constants::*;
use crate::errors::{H3Error, H3Result};
use crate::index::get_pentagons;
use crate::latlng::{LngNormalization, constrain_lng, great_circle_distance_km, normalize_lng};
use crate::{CellBoundary, LatLng};

/// A geographic bounding box in radians (C `BBox`).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct BBox {
    pub north: f64,
    pub south: f64,
    pub east: f64,
    pub west: f64,
}

impl BBox {
    pub const fn new(north: f64, south: f64, east: f64, west: f64) -> BBox {
        BBox { north, south, east, west }
    }

    /// C `bboxIsTransmeridian`.
    #[inline]
    pub fn is_transmeridian(&self) -> bool {
        self.east < self.west
    }

    /// C `bboxWidthRads`.
    pub fn width_rads(&self) -> f64 {
        if self.is_transmeridian() { self.east - self.west + M_2PI } else { self.east - self.west }
    }

    /// C `bboxHeightRads`.
    pub fn height_rads(&self) -> f64 {
        self.north - self.south
    }

    /// C `bboxCenter`.
    #[allow(dead_code)]
    pub fn center(&self) -> LatLng {
        let east = if self.is_transmeridian() { self.east + M_2PI } else { self.east };
        LatLng { lat: (self.north + self.south) * 0.5, lng: constrain_lng((east + self.west) * 0.5) }
    }

    /// C `bboxContains`.
    #[inline]
    pub fn contains(&self, p: &LatLng) -> bool {
        p.lat >= self.south
            && p.lat <= self.north
            && if self.is_transmeridian() {
                p.lng >= self.west || p.lng <= self.east
            } else {
                p.lng >= self.west && p.lng <= self.east
            }
    }

    /// C `bboxOverlapsBBox`.
    pub fn overlaps(&self, b: &BBox) -> bool {
        if self.north < b.south || self.south > b.north {
            return false;
        }
        let (an, bn) = bbox_normalization(self, b);
        !(normalize_lng(self.east, an) < normalize_lng(b.west, bn)
            || normalize_lng(self.west, an) > normalize_lng(b.east, bn))
    }

    /// C `bboxContainsBBox`.
    pub fn contains_bbox(&self, b: &BBox) -> bool {
        if self.north < b.north || self.south > b.south {
            return false;
        }
        let (an, bn) = bbox_normalization(self, b);
        normalize_lng(self.west, an) <= normalize_lng(b.west, bn)
            && normalize_lng(self.east, an) >= normalize_lng(b.east, bn)
    }

    /// C `bboxToCellBoundary`: counter-clockwise corners.
    pub fn to_cell_boundary(&self) -> CellBoundary {
        let mut b = CellBoundary::default();
        b.push(LatLng { lat: self.north, lng: self.east });
        b.push(LatLng { lat: self.north, lng: self.west });
        b.push(LatLng { lat: self.south, lng: self.west });
        b.push(LatLng { lat: self.south, lng: self.east });
        b
    }

    /// C `scaleBBox`.
    pub fn scale(&mut self, scale: f64) {
        let width = self.width_rads();
        let height = self.height_rads();
        let wb = (width * scale - width) * 0.5;
        let hb = (height * scale - height) * 0.5;
        self.north += hb;
        if self.north > M_PI_2 {
            self.north = M_PI_2;
        }
        self.south -= hb;
        if self.south < -M_PI_2 {
            self.south = -M_PI_2;
        }
        self.east += wb;
        if self.east > M_PI {
            self.east -= M_2PI;
        }
        if self.east < -M_PI {
            self.east += M_2PI;
        }
        self.west -= wb;
        if self.west > M_PI {
            self.west -= M_2PI;
        }
        if self.west < -M_PI {
            self.west += M_2PI;
        }
    }
}

/// C `bboxNormalization`.
pub(crate) fn bbox_normalization(a: &BBox, b: &BBox) -> (LngNormalization, LngNormalization) {
    let at = a.is_transmeridian();
    let bt = b.is_transmeridian();
    let a_to_b_trends_east = a.west - b.east < b.west - a.east;
    let an = if !at {
        LngNormalization::None
    } else if bt || a_to_b_trends_east {
        LngNormalization::East
    } else {
        LngNormalization::West
    };
    let bn = if !bt {
        LngNormalization::None
    } else if at {
        LngNormalization::East
    } else if a_to_b_trends_east {
        LngNormalization::West
    } else {
        LngNormalization::East
    };
    (an, bn)
}

/// C `_hexRadiusKm`.
fn hex_radius_km(h: u64) -> H3Result<f64> {
    let center = cell_to_lat_lng(h)?;
    let boundary = cell_to_boundary(h)?;
    Ok(great_circle_distance_km(&center, &boundary[0]))
}

fn pentagon_radius_km(res: i32) -> H3Result<f64> {
    hex_radius_km(get_pentagons(res)?[0])
}

/// C `bboxHexEstimate`.
pub(crate) fn bbox_hex_estimate(bbox: &BBox, res: i32) -> H3Result<i64> {
    let r = pentagon_radius_km(res)?;
    let pentagon_area_km2 = 0.8 * (2.59807621135 * r * r);
    let p1 = LatLng { lat: bbox.north, lng: bbox.east };
    let p2 = LatLng { lat: bbox.south, lng: bbox.west };
    let d = great_circle_distance_km(&p1, &p2);
    let lng_diff = (p1.lng - p2.lng).abs();
    let lat_diff = (p1.lat - p2.lat).abs();
    if lng_diff == 0.0 || lat_diff == 0.0 {
        return Err(H3Error::Failed);
    }
    let length = lng_diff.max(lat_diff);
    let width = lng_diff.min(lat_diff);
    let ratio = length / width;
    let a = d * d / 3.0f64.min(ratio);
    let estimate_double = (a / pentagon_area_km2).ceil();
    if !estimate_double.is_finite() {
        return Err(H3Error::Failed);
    }
    let estimate = estimate_double as i64;
    Ok(if estimate == 0 { 1 } else { estimate })
}

/// C `lineHexEstimate`.
pub(crate) fn line_hex_estimate(origin: &LatLng, destination: &LatLng, res: i32) -> H3Result<i64> {
    let r = pentagon_radius_km(res)?;
    let dist = great_circle_distance_km(origin, destination);
    let dist_ceil = (dist / (2.0 * r)).ceil();
    if !dist_ceil.is_finite() {
        return Err(H3Error::Failed);
    }
    let estimate = dist_ceil as i64;
    Ok(if estimate == 0 { 1 } else { estimate })
}
