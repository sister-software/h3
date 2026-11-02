//! Spherical coordinate helpers and measurement constants.
//!
//! Translated from H3 C `latLng.c` (Apache-2.0, Copyright Uber Technologies, Inc.).

use crate::LatLng;
use crate::constants::*;
use crate::errors::{H3Error, H3Result};
use crate::math::Trig;

/// C `_posAngleRads`: normalizes radians to `[0, 2π)`.
#[inline]
pub(crate) fn pos_angle_rads(rads: f64) -> f64 {
    let mut tmp = if rads < 0.0 { rads + M_2PI } else { rads };
    if rads >= M_2PI {
        tmp -= M_2PI;
    }
    tmp
}

/// C `degsToRads`.
#[inline]
pub const fn degs_to_rads(degrees: f64) -> f64 {
    degrees * M_PI_180
}

/// C `radsToDegs`.
#[inline]
pub const fn rads_to_degs(radians: f64) -> f64 {
    radians * M_180_PI
}

/// C `constrainLng`.
pub(crate) fn constrain_lng(mut lng: f64) -> f64 {
    while lng > M_PI {
        lng -= 2.0 * M_PI;
    }
    while lng < -M_PI {
        lng += 2.0 * M_PI;
    }
    lng
}

/// C `LongitudeNormalization`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LngNormalization {
    None,
    East,
    West,
}

/// C `normalizeLng`.
#[inline]
pub(crate) fn normalize_lng(lng: f64, n: LngNormalization) -> f64 {
    match n {
        LngNormalization::East => {
            if lng < 0.0 {
                lng + M_2PI
            } else {
                lng
            }
        }
        LngNormalization::West => {
            if lng > 0.0 {
                lng - M_2PI
            } else {
                lng
            }
        }
        LngNormalization::None => lng,
    }
}

/// C `greatCircleDistanceRads` (haversine).
pub fn great_circle_distance_rads(a: &LatLng, b: &LatLng) -> f64 {
    let sin_lat = ((b.lat - a.lat) * 0.5).h3_sin();
    let sin_lng = ((b.lng - a.lng) * 0.5).h3_sin();
    let aa = sin_lat * sin_lat + a.lat.h3_cos() * b.lat.h3_cos() * sin_lng * sin_lng;
    2.0 * aa.sqrt().h3_atan2((1.0 - aa).sqrt())
}

/// C `greatCircleDistanceKm`.
pub fn great_circle_distance_km(a: &LatLng, b: &LatLng) -> f64 {
    great_circle_distance_rads(a, b) * EARTH_RADIUS_KM
}

/// C `greatCircleDistanceM`.
pub fn great_circle_distance_m(a: &LatLng, b: &LatLng) -> f64 {
    great_circle_distance_km(a, b) * 1000.0
}

fn res_table(res: i32, table: &[f64; 16]) -> H3Result<f64> {
    if !(0..=MAX_H3_RES).contains(&res) {
        return Err(H3Error::ResDomain);
    }
    Ok(table[res as usize])
}

/// C `getHexagonAreaAvgKm2`.
pub fn get_hexagon_area_avg_km2(res: i32) -> H3Result<f64> {
    res_table(
        res,
        &[
            4.357449416078383e+06,
            6.097884417941332e+05,
            8.680178039899720e+04,
            1.239343465508816e+04,
            1.770347654491307e+03,
            2.529038581819449e+02,
            3.612906216441245e+01,
            5.161293359717191e+00,
            7.373275975944177e-01,
            1.053325134272067e-01,
            1.504750190766435e-02,
            2.149643129451879e-03,
            3.070918756316060e-04,
            4.387026794728296e-05,
            6.267181135324313e-06,
            8.953115907605790e-07,
        ],
    )
}

/// C `getHexagonAreaAvgM2`.
pub fn get_hexagon_area_avg_m2(res: i32) -> H3Result<f64> {
    res_table(
        res,
        &[
            4.357449416078390e+12,
            6.097884417941339e+11,
            8.680178039899731e+10,
            1.239343465508818e+10,
            1.770347654491309e+09,
            2.529038581819452e+08,
            3.612906216441250e+07,
            5.161293359717198e+06,
            7.373275975944188e+05,
            1.053325134272069e+05,
            1.504750190766437e+04,
            2.149643129451882e+03,
            3.070918756316063e+02,
            4.387026794728301e+01,
            6.267181135324322e+00,
            8.953115907605802e-01,
        ],
    )
}

/// C `getHexagonEdgeLengthAvgKm`.
pub fn get_hexagon_edge_length_avg_km(res: i32) -> H3Result<f64> {
    res_table(
        res,
        &[
            1281.256011,
            483.0568391,
            182.5129565,
            68.97922179,
            26.07175968,
            9.854090990,
            3.724532667,
            1.406475763,
            0.531414010,
            0.200786148,
            0.075863783,
            0.028663897,
            0.010830188,
            0.004092010,
            0.001546100,
            0.000584169,
        ],
    )
}

/// C `getHexagonEdgeLengthAvgM`.
pub fn get_hexagon_edge_length_avg_m(res: i32) -> H3Result<f64> {
    res_table(
        res,
        &[
            1281256.011,
            483056.8391,
            182512.9565,
            68979.22179,
            26071.75968,
            9854.090990,
            3724.532667,
            1406.475763,
            531.4140101,
            200.7861476,
            75.86378287,
            28.66389748,
            10.83018784,
            4.092010473,
            1.546099657,
            0.584168630,
        ],
    )
}
