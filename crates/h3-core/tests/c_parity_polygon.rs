//! Native Rust versus pinned H3 C fixtures: Phase G (polygons).
//!
//! `polygonToCells` output order is unspecified by contract, but the native port reproduces C's
//! hash-set buffer, so the non-zero entries are compared in C buffer order (stronger than set
//! equality). Experimental fill is compared in C iteration order. Outlines are compared exactly,
//! including vertex order and loop/polygon grouping.

mod common;
use common::*;
use serde_json::Value;
use sister_h3::{GeoPolygon, LatLng, raw};

fn polygon(args: &Value) -> GeoPolygon {
    let loops: Vec<Vec<LatLng>> = args["loopsRadians"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l.as_array().unwrap().iter().map(|v| LatLng::from_radians(f(&v[0]), f(&v[1]))).collect())
        .collect();
    let mut it = loops.into_iter();
    GeoPolygon { exterior: it.next().unwrap_or_default(), holes: it.collect() }
}

fn res_flags(r: &Record) -> (i32, u32) {
    (i(&r.args["res"]) as i32, i(&r.args["flags"]) as u32)
}

#[test]
fn max_sizes() {
    for r in load("maxPolygonToCellsSize") {
        let (res, flags) = res_flags(&r);
        let (e, v) = err(raw::max_polygon_to_cells_size(&polygon(&r.args), res, flags));
        assert_eq!(e, r.error, "line {} {}", r.line, r.args["name"]);
        if let Some(v) = v {
            assert_eq!(v, i(&r.result["value"]), "line {} {}", r.line, r.args["name"]);
        }
    }
    for r in load("maxPolygonToCellsSizeExperimental") {
        let (res, flags) = res_flags(&r);
        let (e, v) = err(raw::max_polygon_to_cells_size_experimental(&polygon(&r.args), res, flags));
        assert_eq!(e, r.error, "line {} {}", r.line, r.args["name"]);
        if let Some(v) = v {
            assert_eq!(v, i(&r.result["value"]), "line {} {}", r.line, r.args["name"]);
        }
    }
}

#[test]
fn polygon_to_cells() {
    for r in load("polygonToCells") {
        let (res, flags) = res_flags(&r);
        let (e, v) = err(raw::polygon_to_cells(&polygon(&r.args), res, flags));
        assert_eq!(e, r.error, "line {} {}", r.line, r.args["name"]);
        if let Some(v) = v {
            let got: Vec<u64> = v.into_iter().filter(|&c| c != 0).collect();
            assert_eq!(got, idxs(&r.result["indexes"]), "line {} {}", r.line, r.args["name"]);
        }
    }
}

#[test]
fn polygon_to_cells_experimental() {
    for r in load("polygonToCellsExperimental") {
        let (res, flags) = res_flags(&r);
        let p = polygon(&r.args);
        // The runner sizes the output with maxPolygonToCellsSizeExperimental, as h3-js does.
        let size = match raw::max_polygon_to_cells_size_experimental(&p, res, flags) {
            Ok(s) => s,
            Err(e) => {
                assert_eq!(e.code(), r.error, "line {} {}", r.line, r.args["name"]);
                continue;
            }
        };
        let (e, v) = err(raw::polygon_to_cells_experimental(&p, res, flags, size));
        assert_eq!(e, r.error, "line {} {}", r.line, r.args["name"]);
        if let Some(v) = v {
            assert_eq!(v, idxs(&r.result["indexes"]), "line {} {} flags {flags}", r.line, r.args["name"]);
        }
    }
}

#[test]
fn cells_to_linked_multi_polygon() {
    for r in load("cellsToLinkedMultiPolygon") {
        let (e, v) = err(raw::cells_to_linked_multi_polygon(&idxs(&r.args["indexes"])));
        assert_eq!(e, r.error, "line {}", r.line);
        if let Some(v) = v {
            let want = r.result["polygonsRadians"].as_array().unwrap();
            assert_eq!(v.len(), want.len(), "line {}: polygon count", r.line);
            for (pi, (gp, wp)) in v.iter().zip(want).enumerate() {
                let wp = wp.as_array().unwrap();
                assert_eq!(gp.len(), wp.len(), "line {} polygon {pi}: loop count", r.line);
                for (li, (gl, wl)) in gp.iter().zip(wp).enumerate() {
                    let wl = wl.as_array().unwrap();
                    assert_eq!(gl.len(), wl.len(), "line {} polygon {pi} loop {li}: vertex count", r.line);
                    for (g, w) in gl.iter().zip(wl) {
                        assert_eq!(
                            (g.lat.to_bits(), g.lng.to_bits()),
                            (f(&w[0]).to_bits(), f(&w[1]).to_bits()),
                            "line {} polygon {pi} loop {li}",
                            r.line
                        );
                    }
                }
            }
        }
    }
}
