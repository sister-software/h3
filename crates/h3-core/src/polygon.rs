//! Polygon primitives: bounding boxes, point-in-polygon, and boundary intersection tests.
//!
//! Translated from H3 C `polygon.c` and `polygonAlgos.h` (Apache-2.0, Copyright Uber
//! Technologies, Inc.), specialised to vertex slices.

use crate::bbox::{BBox, bbox_normalization};
use crate::constants::*;
use crate::errors::{H3Error, H3Result};
use crate::latlng::normalize_lng;
use crate::{CellBoundary, LatLng};

/// A polygon: an exterior loop and zero or more holes, vertices in radians. Loops are implicitly
/// closed (the last vertex connects to the first).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct GeoPolygon {
    /// The exterior loop.
    pub exterior: Vec<LatLng>,
    /// Interior loops (holes).
    pub holes: Vec<Vec<LatLng>>,
}

/// Polygon-to-cells containment mode (C `ContainmentMode`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u32)]
pub enum ContainmentMode {
    /// Cell center is contained in the shape.
    Center = 0,
    /// Cell is fully contained in the shape.
    Full = 1,
    /// Cell overlaps the shape at any point.
    Overlapping = 2,
    /// Cell bounding box overlaps the shape.
    OverlappingBbox = 3,
}

const FLAG_CONTAINMENT_MODE_MASK: u32 = 15;

/// C `validatePolygonFlags`.
pub(crate) fn validate_polygon_flags(flags: u32) -> H3Result<()> {
    if flags & !FLAG_CONTAINMENT_MODE_MASK != 0 || (flags & FLAG_CONTAINMENT_MODE_MASK) >= 4 {
        return Err(H3Error::OptionInvalid);
    }
    Ok(())
}

#[inline]
fn normalize_lng_tm(lng: f64, is_transmeridian: bool) -> f64 {
    if is_transmeridian && lng < 0.0 { lng + M_2PI } else { lng }
}

/// C `pointInsideGeoLoop` (ray casting).
pub(crate) fn point_inside_geo_loop(lp: &[LatLng], bbox: &BBox, coord: &LatLng) -> bool {
    if !bbox.contains(coord) {
        return false;
    }
    let is_tm = bbox.is_transmeridian();
    let mut contains = false;
    let mut lat = coord.lat;
    let mut lng = normalize_lng_tm(coord.lng, is_tm);
    let n = lp.len();
    for idx in 0..n {
        let mut a = lp[idx];
        let mut b = lp[(idx + 1) % n];
        if a.lat > b.lat {
            core::mem::swap(&mut a, &mut b);
        }
        if lat == a.lat || lat == b.lat {
            lat += f64::EPSILON;
        }
        if lat < a.lat || lat > b.lat {
            continue;
        }
        let a_lng = normalize_lng_tm(a.lng, is_tm);
        let b_lng = normalize_lng_tm(b.lng, is_tm);
        if a_lng == lng || b_lng == lng {
            lng -= f64::EPSILON;
        }
        let ratio = (lat - a.lat) / (b.lat - a.lat);
        let test_lng = normalize_lng_tm(a_lng + (b_lng - a_lng) * ratio, is_tm);
        if test_lng > lng {
            contains = !contains;
        }
    }
    contains
}

/// C `bboxFromGeoLoop`.
pub(crate) fn bbox_from_geo_loop(lp: &[LatLng]) -> BBox {
    if lp.is_empty() {
        return BBox::default();
    }
    let mut bbox = BBox { south: f64::MAX, west: f64::MAX, north: -f64::MAX, east: -f64::MAX };
    let mut min_pos_lng = f64::MAX;
    let mut max_neg_lng = -f64::MAX;
    let mut is_tm = false;
    let n = lp.len();
    for idx in 0..n {
        let coord = lp[idx];
        let next = lp[(idx + 1) % n];
        let (lat, lng) = (coord.lat, coord.lng);
        if lat < bbox.south {
            bbox.south = lat;
        }
        if lng < bbox.west {
            bbox.west = lng;
        }
        if lat > bbox.north {
            bbox.north = lat;
        }
        if lng > bbox.east {
            bbox.east = lng;
        }
        if lng > 0.0 && lng < min_pos_lng {
            min_pos_lng = lng;
        }
        if lng < 0.0 && lng > max_neg_lng {
            max_neg_lng = lng;
        }
        if (lng - next.lng).abs() > M_PI {
            is_tm = true;
        }
    }
    if is_tm {
        bbox.east = max_neg_lng;
        bbox.west = min_pos_lng;
    }
    if bbox.north > M_PI_2 {
        bbox.north = M_PI_2;
    }
    if bbox.south < -M_PI_2 {
        bbox.south = -M_PI_2;
    }
    bbox
}

/// C `isClockwiseGeoLoop`.
#[allow(dead_code)]
pub(crate) fn is_clockwise_geo_loop(lp: &[LatLng]) -> bool {
    fn normalized(lp: &[LatLng], is_tm: bool) -> bool {
        let mut sum = 0.0;
        let n = lp.len();
        for idx in 0..n {
            let a = lp[idx];
            let b = lp[(idx + 1) % n];
            if !is_tm && (a.lng - b.lng).abs() > M_PI {
                return normalized(lp, true);
            }
            sum += (normalize_lng_tm(b.lng, is_tm) - normalize_lng_tm(a.lng, is_tm)) * (b.lat + a.lat);
        }
        sum > 0.0
    }
    normalized(lp, false)
}

/// C `bboxesFromGeoPolygon`.
pub(crate) fn bboxes_from_polygon(p: &GeoPolygon) -> Vec<BBox> {
    let mut out = Vec::with_capacity(p.holes.len() + 1);
    out.push(bbox_from_geo_loop(&p.exterior));
    out.extend(p.holes.iter().map(|h| bbox_from_geo_loop(h)));
    out
}

/// C `pointInsidePolygon`.
pub(crate) fn point_inside_polygon(p: &GeoPolygon, bboxes: &[BBox], coord: &LatLng) -> bool {
    let contains = point_inside_geo_loop(&p.exterior, &bboxes[0], coord);
    if contains && !p.holes.is_empty() {
        for (i, h) in p.holes.iter().enumerate() {
            if point_inside_geo_loop(h, &bboxes[i + 1], coord) {
                return false;
            }
        }
    }
    contains
}

/// C `cellBoundaryInsidePolygon`.
pub(crate) fn cell_boundary_inside_polygon(
    p: &GeoPolygon,
    bboxes: &[BBox],
    boundary: &CellBoundary,
    boundary_bbox: &BBox,
) -> bool {
    if !point_inside_polygon(p, bboxes, &boundary[0]) {
        return false;
    }
    if cell_boundary_crosses_geo_loop(&p.exterior, &bboxes[0], boundary, boundary_bbox) {
        return false;
    }
    for (i, h) in p.holes.iter().enumerate() {
        if !h.is_empty()
            && (point_inside_geo_loop(boundary, boundary_bbox, &h[0])
                || cell_boundary_crosses_geo_loop(h, &bboxes[i + 1], boundary, boundary_bbox))
        {
            return false;
        }
    }
    true
}

/// C `cellBoundaryCrossesPolygon`.
pub(crate) fn cell_boundary_crosses_polygon(
    p: &GeoPolygon,
    bboxes: &[BBox],
    boundary: &CellBoundary,
    boundary_bbox: &BBox,
) -> bool {
    if cell_boundary_crosses_geo_loop(&p.exterior, &bboxes[0], boundary, boundary_bbox) {
        return true;
    }
    p.holes.iter().enumerate().any(|(i, h)| cell_boundary_crosses_geo_loop(h, &bboxes[i + 1], boundary, boundary_bbox))
}

/// C `cellBoundaryCrossesGeoLoop`.
pub(crate) fn cell_boundary_crosses_geo_loop(
    lp: &[LatLng],
    loop_bbox: &BBox,
    boundary: &CellBoundary,
    boundary_bbox: &BBox,
) -> bool {
    if !loop_bbox.overlaps(boundary_bbox) {
        return false;
    }
    let (loop_n, boundary_n) = bbox_normalization(loop_bbox, boundary_bbox);
    let mut normal = *boundary;
    let nb: Vec<LatLng> = normal.iter().map(|v| LatLng { lat: v.lat, lng: normalize_lng(v.lng, boundary_n) }).collect();
    normal = CellBoundary::default();
    for v in &nb {
        normal.push(*v);
    }
    let nbb = BBox {
        north: boundary_bbox.north,
        south: boundary_bbox.south,
        east: normalize_lng(boundary_bbox.east, boundary_n),
        west: normalize_lng(boundary_bbox.west, boundary_n),
    };
    let n = lp.len();
    for i in 0..n {
        let mut l1 = lp[i];
        l1.lng = normalize_lng(l1.lng, loop_n);
        let mut l2 = lp[(i + 1) % n];
        l2.lng = normalize_lng(l2.lng, loop_n);
        if (l1.lat >= nbb.north && l2.lat >= nbb.north)
            || (l1.lat <= nbb.south && l2.lat <= nbb.south)
            || (l1.lng <= nbb.west && l2.lng <= nbb.west)
            || (l1.lng >= nbb.east && l2.lng >= nbb.east)
        {
            continue;
        }
        let m = normal.len();
        for j in 0..m {
            if line_crosses_line(&l1, &l2, &normal[j], &normal[(j + 1) % m]) {
                return true;
            }
        }
    }
    false
}

/// C `lineCrossesLine`.
pub(crate) fn line_crosses_line(a1: &LatLng, a2: &LatLng, b1: &LatLng, b2: &LatLng) -> bool {
    let denom = (b2.lng - b1.lng) * (a2.lat - a1.lat) - (b2.lat - b1.lat) * (a2.lng - a1.lng);
    if denom == 0.0 {
        return false;
    }
    let test = ((b2.lat - b1.lat) * (a1.lng - b1.lng) - (b2.lng - b1.lng) * (a1.lat - b1.lat)) / denom;
    if test < 0.0 || test > 1.0 {
        return false;
    }
    let test = ((a2.lat - a1.lat) * (a1.lng - b1.lng) - (a2.lng - a1.lng) * (a1.lat - b1.lat)) / denom;
    (0.0..=1.0).contains(&test)
}
