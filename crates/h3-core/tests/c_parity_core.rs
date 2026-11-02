//! Native Rust versus pinned H3 C fixtures: Phases A (index inspection), B (coordinates and
//! boundaries), and C (hierarchy).
//!
//! Comparison rules (see docs/api-decisions.md, "Comparison rules"):
//! - Index bits, counts, validity and C error codes: exact.
//! - Coordinates (radians): native builds use the same platform libm as the C reference, so the
//!   expected difference is zero; the asserted bound is `COORD_TOL` and the observed maximum is
//!   printed with `--nocapture`.

mod common;
use common::*;
use sister_h3::{LatLng, raw};

/// Absolute tolerance for radian coordinates in native parity (observed maximum is reported).
const COORD_TOL: f64 = 0.0;

#[test]
fn is_valid_cell() {
    for r in load("isValidCell") {
        assert_eq!(raw::is_valid_cell(idx(&r.args["index"])), r.result["value"].as_bool().unwrap(), "line {}", r.line);
    }
}

#[test]
fn is_pentagon() {
    for r in load("isPentagon") {
        assert_eq!(raw::is_pentagon(idx(&r.args["index"])), r.result["value"].as_bool().unwrap(), "line {}", r.line);
    }
}

#[test]
fn is_res_class_iii() {
    for r in load("isResClassIII") {
        let got = raw::is_res_class_iii(idx(&r.args["index"]));
        assert_eq!(got, r.result["value"].as_bool().unwrap(), "line {}", r.line);
    }
}

#[test]
fn get_resolution_and_base_cell() {
    for r in load("getResolution") {
        assert_eq!(i64::from(raw::get_resolution(idx(&r.args["index"]))), i(&r.result["value"]), "line {}", r.line);
    }
    for r in load("getBaseCellNumber") {
        let got = raw::get_base_cell_number(idx(&r.args["index"]));
        assert_eq!(i64::from(got), i(&r.result["value"]), "line {}", r.line);
    }
}

#[test]
fn get_index_digit() {
    for r in load("getIndexDigit") {
        let (e, v) = err(raw::get_index_digit(idx(&r.args["index"]), i(&r.args["digit"]) as i32));
        assert_eq!(e, r.error, "line {}", r.line);
        if let Some(v) = v {
            assert_eq!(i64::from(v), i(&r.result["value"]), "line {}", r.line);
        }
    }
}

#[test]
fn construct_cell() {
    for r in load("constructCell") {
        let digits: Vec<i32> = r.args["digits"].as_array().unwrap().iter().map(|d| i(d) as i32).collect();
        let (e, v) = err(raw::construct_cell(i(&r.args["res"]) as i32, i(&r.args["baseCellNumber"]) as i32, &digits));
        assert_eq!(e, r.error, "line {}", r.line);
        if let Some(v) = v {
            assert_eq!(v, idx(&r.result["index"]), "line {}", r.line);
        }
    }
}

#[test]
fn enumeration() {
    for r in load("getRes0Cells") {
        assert_eq!(raw::get_res0_cells(), idxs(&r.result["indexes"]));
    }
    for r in load("getPentagons") {
        let (e, v) = err(raw::get_pentagons(i(&r.args["res"]) as i32));
        assert_eq!(e, r.error, "line {}", r.line);
        if let Some(v) = v {
            assert_eq!(v, idxs(&r.result["indexes"]), "line {}", r.line);
        }
    }
    for r in load("getNumCells") {
        let (e, v) = err(raw::get_num_cells(i(&r.args["res"]) as i32));
        assert_eq!(e, r.error, "line {}", r.line);
        if let Some(v) = v {
            assert_eq!(v, i(&r.result["value"]), "line {}", r.line);
        }
    }
}

#[test]
fn lat_lng_to_cell() {
    for r in load("latLngToCell") {
        let g = LatLng::from_radians(f(&r.args["latRadians"]), f(&r.args["lngRadians"]));
        let (e, v) = err(raw::lat_lng_to_cell(&g, i(&r.args["res"]) as i32));
        assert_eq!(e, r.error, "line {} {:?}", r.line, r.args);
        if let Some(v) = v {
            assert_eq!(raw::h3_to_string(v), r.result["index"].as_str().unwrap(), "line {} {:?}", r.line, r.args);
        }
    }
}

#[test]
fn readme_example() {
    let g = LatLng::from_degrees(37.3615593, -122.0553238);
    assert_eq!(raw::h3_to_string(raw::lat_lng_to_cell(&g, 7).unwrap()), "87283472bffffff");
}

#[test]
fn cell_to_lat_lng() {
    let mut m = MaxErr::default();
    for r in load("cellToLatLng") {
        let (e, v) = err(raw::cell_to_lat_lng(idx(&r.args["index"])));
        assert_eq!(e, r.error, "line {}", r.line);
        if let Some(v) = v {
            let ctx = format!("line {}", r.line);
            m.check(v.lat, f(&r.result["latRadians"]), COORD_TOL, &ctx);
            m.check(v.lng, f(&r.result["lngRadians"]), COORD_TOL, &ctx);
        }
    }
    println!("cellToLatLng: {} values, max |diff| {:e} rad", m.count, m.max);
}

#[test]
fn cell_to_boundary() {
    let mut m = MaxErr::default();
    for r in load("cellToBoundary") {
        let (e, v) = err(raw::cell_to_boundary(idx(&r.args["index"])));
        assert_eq!(e, r.error, "line {}", r.line);
        if let Some(v) = v {
            let want = r.result["verticesRadians"].as_array().unwrap();
            assert_eq!(v.len(), want.len(), "line {}: vertex count", r.line);
            for (k, (g, w)) in v.iter().zip(want).enumerate() {
                let ctx = format!("line {} vertex {k}", r.line);
                m.check(g.lat, f(&w[0]), COORD_TOL, &ctx);
                m.check(g.lng, f(&w[1]), COORD_TOL, &ctx);
            }
        }
    }
    println!("cellToBoundary: {} values, max |diff| {:e} rad", m.count, m.max);
}

#[test]
fn get_icosahedron_faces() {
    for r in load("getIcosahedronFaces") {
        let (e, v) = err(raw::get_icosahedron_faces(idx(&r.args["index"])));
        assert_eq!(e, r.error, "line {}", r.line);
        if let Some(v) = v {
            let want: Vec<i32> = r.result["faces"].as_array().unwrap().iter().map(|x| i(x) as i32).collect();
            assert_eq!(v, want, "line {}", r.line);
        }
    }
}

fn index_res_op(op: &str, f: impl Fn(u64, i32) -> Result<i64, sister_h3::H3Error>, result_is_index: bool) {
    for r in load(op) {
        let (e, v) = err(f(idx(&r.args["index"]), i(&r.args["res"]) as i32));
        assert_eq!(e, r.error, "{op} line {} {:?}", r.line, r.args);
        if let Some(v) = v {
            if result_is_index {
                assert_eq!(v as u64, idx(&r.result["index"]), "{op} line {}", r.line);
            } else {
                assert_eq!(v, i(&r.result["value"]), "{op} line {}", r.line);
            }
        }
    }
}

#[test]
fn hierarchy_scalars() {
    index_res_op("cellToParent", |h, r| raw::cell_to_parent(h, r).map(|x| x as i64), true);
    index_res_op("cellToCenterChild", |h, r| raw::cell_to_center_child(h, r).map(|x| x as i64), true);
    index_res_op("cellToChildrenSize", raw::cell_to_children_size, false);
    index_res_op("cellToChildPos", raw::cell_to_child_pos, false);
}

#[test]
fn cell_to_children() {
    for r in load("cellToChildren") {
        let h = idx(&r.args["index"]);
        let res = i(&r.args["res"]) as i32;
        let (e, _) = err(raw::cell_to_children_size(h, res));
        assert_eq!(e, r.error, "line {}", r.line);
        if e == 0 {
            let got: Vec<u64> = raw::cell_to_children(h, res).collect();
            assert_eq!(got, idxs(&r.result["indexes"]), "line {}", r.line);
        }
    }
}

#[test]
fn child_pos_to_cell() {
    for r in load("childPosToCell") {
        let (e, v) =
            err(raw::child_pos_to_cell(i(&r.args["childPos"]), idx(&r.args["index"]), i(&r.args["childRes"]) as i32));
        assert_eq!(e, r.error, "line {} {:?}", r.line, r.args);
        if let Some(v) = v {
            assert_eq!(v, idx(&r.result["index"]), "line {}", r.line);
        }
    }
}

#[test]
fn compact_cells() {
    for r in load("compactCells") {
        let input = idxs(&r.args["indexes"]);
        let (e, v) = err(raw::compact_cells(&input));
        assert_eq!(e, r.error, "line {}", r.line);
        if let Some(mut v) = v {
            // The fixture is C's whole output buffer (input length, unused slots zero).
            assert!(v.len() <= input.len(), "line {}", r.line);
            v.resize(input.len(), 0);
            assert_eq!(v, idxs(&r.result["indexes"]), "line {} (C order)", r.line);
        }
    }
}

#[test]
fn uncompact_cells() {
    for r in load("uncompactCellsSize") {
        let (e, v) = err(raw::uncompact_cells_size(&idxs(&r.args["indexes"]), i(&r.args["res"]) as i32));
        assert_eq!(e, r.error, "line {}", r.line);
        if let Some(v) = v {
            assert_eq!(v, i(&r.result["value"]), "line {}", r.line);
        }
    }
    for r in load("uncompactCells") {
        let (e, v) = err(raw::uncompact_cells(&idxs(&r.args["indexes"]), i(&r.args["res"]) as i32));
        assert_eq!(e, r.error, "line {}", r.line);
        if let Some(v) = v {
            assert_eq!(v, idxs(&r.result["indexes"]), "line {}", r.line);
        }
    }
}
