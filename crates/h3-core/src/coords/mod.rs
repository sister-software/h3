//! Coordinate primitives: IJK hex coordinates, 2D/3D vectors, and face-local addresses.
//!
//! Translated from H3 C `coordijk.h`, `vec2d.c`, `vec3d.h`, and `faceijk.h` (Apache-2.0,
//! Copyright Uber Technologies, Inc.). Floating-point operation order follows the C source so
//! that results are bit-identical where the platform math library is identical.
//!
//! Integer arithmetic uses wrapping operations: the C code relies on two's-complement behaviour
//! in the few places that can overflow, and guards the meaningful cases explicitly.

mod ijk;
mod vector;

pub(crate) use ijk::*;
pub(crate) use vector::*;

/// Face number and IJK coordinates on that face-centered coordinate system.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct FaceIjk {
    pub face: i32,
    pub coord: CoordIjk,
}

/// Information to transform into an adjacent face IJK system.
#[derive(Clone, Copy, Debug)]
pub(crate) struct FaceOrientIjk {
    pub face: i32,
    pub translate: CoordIjk,
    pub ccw_rot60: i32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_digit_round_trip() {
        for (d, v) in UNIT_VECS.iter().enumerate() {
            assert_eq!(v.to_unit_digit(), d as Direction);
        }
        assert_eq!(ijk(2, 0, 0).to_unit_digit(), INVALID_DIGIT);
    }

    #[test]
    fn rotations_are_inverse() {
        for d in 0..7 {
            assert_eq!(rotate_digit60cw(rotate_digit60ccw(d)), d);
            let mut c = UNIT_VECS[d as usize];
            c.rotate60ccw();
            c.rotate60cw();
            assert_eq!(c, UNIT_VECS[d as usize]);
        }
    }

    #[test]
    fn ap7_round_trip() {
        let mut c = ijk(2, 0, 1);
        let orig = c;
        c.down_ap7();
        c.up_ap7();
        assert_eq!(c, orig.normalized());
        let mut c = orig;
        c.down_ap7r();
        c.up_ap7r();
        assert_eq!(c, orig.normalized());
    }

    #[test]
    fn hex2d_origin() {
        assert_eq!(Vec2d { x: 0.0, y: 0.0 }.to_coord_ijk(), ijk(0, 0, 0));
        assert_eq!(Vec2d { x: 1.0, y: 0.0 }.to_coord_ijk(), ijk(1, 0, 0));
    }
}
