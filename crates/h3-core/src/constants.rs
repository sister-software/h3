//! Numeric constants from H3 C `constants.h` and `faceijk.c` (Apache-2.0, Copyright Uber
//! Technologies, Inc.). Decimal literals are kept as written in C; Rust and C both round them to
//! the nearest `f64`.

#![allow(clippy::approx_constant)]

pub(crate) const M_PI: f64 = 3.14159265358979323846;
pub(crate) const M_PI_2: f64 = 1.5707963267948966;
pub(crate) const M_2PI: f64 = 6.28318530717958647692528676655900576839433;
pub(crate) const M_PI_180: f64 = 0.0174532925199432957692369076848861271111;
pub(crate) const M_180_PI: f64 = 57.29577951308232087679815481410517033240547;
pub(crate) const EPSILON: f64 = 0.0000000000000001;
pub(crate) const M_SQRT3_2: f64 = 0.8660254037844386467637231707529361834714;
pub(crate) const M_RSIN60: f64 = 1.1547005383792515290182975610039149112953;
pub(crate) const M_ONETHIRD: f64 = 0.333333333333333333333333333333333333333;
pub(crate) const M_ONESEVENTH: f64 = 0.14285714285714285714285714285714285;
pub(crate) const M_AP7_ROT_RADS: f64 = 0.333473172251832115336090755351601070065900389;
/// Earth radius in kilometers using the WGS84 authalic radius.
pub const EARTH_RADIUS_KM: f64 = 6371.007180918475;
pub(crate) const RES0_U_GNOMONIC: f64 = 0.38196601125010500003;
pub(crate) const INV_RES0_U_GNOMONIC: f64 = 2.61803398874989588842;
pub(crate) const M_SQRT7: f64 = 2.6457513110645905905016157536392604257102;
pub(crate) const M_RSQRT7: f64 = 0.37796447300922722721451653623418006081576;

/// The finest H3 resolution.
pub const MAX_H3_RES: i32 = 15;
pub(crate) const NUM_ICOSA_FACES: usize = 20;
/// Number of resolution 0 cells.
pub const NUM_BASE_CELLS: i32 = 122;
pub(crate) const NUM_HEX_VERTS: usize = 6;
pub(crate) const NUM_PENT_VERTS: usize = 5;
/// Number of pentagons at every resolution.
pub const NUM_PENTAGONS: i32 = 12;

pub(crate) const H3_CELL_MODE: u64 = 1;
pub(crate) const H3_DIRECTEDEDGE_MODE: u64 = 2;
pub(crate) const H3_VERTEX_MODE: u64 = 4;

/// Maximum number of vertices in a cell boundary, including distortion vertices.
pub const MAX_CELL_BNDRY_VERTS: usize = 10;

pub(crate) const INVALID_BASE_CELL: i32 = 127;
pub(crate) const MAX_FACE_COORD: i32 = 2;
pub(crate) const INVALID_ROTATIONS: i32 = -1;
pub(crate) const INVALID_FACE: i32 = -1;

/// Face quadrant directions (C `IJ`, `KI`, `JK`).
pub(crate) const IJ: i32 = 1;
pub(crate) const KI: i32 = 2;
pub(crate) const JK: i32 = 3;
