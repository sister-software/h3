//! Native Rust versus pinned H3 C fixtures: (polygons).
//!
//! `polygonToCells` output order is unspecified by contract, but the native port reproduces C's
//! hash-set buffer, so the non-zero entries are compared in C buffer order (stronger than set
//! equality). Experimental fill is compared in C iteration order.
//!
//! `cellsToLinkedMultiPolygon` polygon order is unspecified (docs/api-decisions.md): C orders
//! polygons by hashing vertex coordinates, so last-bit differences in the platform libm can
//! permute them. On the reference platform (`common::EXACT`) the outline is compared bit for bit
//! in C order, including loop/polygon grouping; elsewhere each expected polygon must match a
//! distinct produced polygon with the same loops, vertex order, and coordinates within 1e-12
//! degrees.

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

type Outline = Vec<Vec<(f64, f64)>>;

fn want_outline(wp: &Value) -> Outline {
    wp.as_array()
        .unwrap()
        .iter()
        .map(|wl| wl.as_array().unwrap().iter().map(|w| (f(&w[0]), f(&w[1]))).collect())
        .collect()
}

/// Whether two polygons have the same loops, vertex counts, and vertex order, coordinates within tolerance.
fn same_polygon(got: &Outline, want: &Outline) -> Result<f64, String> {
    if got.len() != want.len() {
        return Err(format!("loop count {} vs {}", got.len(), want.len()));
    }
    let mut worst: f64 = 0.0;
    for (li, (gl, wl)) in got.iter().zip(want).enumerate() {
        if gl.len() != wl.len() {
            return Err(format!("loop {li}: vertex count {} vs {}", gl.len(), wl.len()));
        }
        for (g, w) in gl.iter().zip(wl) {
            worst = worst.max(float_matches(g.0, w.0, Kind::Coord).map_err(|e| format!("loop {li}: {e}"))?);
            worst = worst.max(float_matches(g.1, w.1, Kind::Coord).map_err(|e| format!("loop {li}: {e}"))?);
        }
    }
    Ok(worst)
}

#[test]
fn cells_to_linked_multi_polygon() {
    let mut worst: f64 = 0.0;
    for r in load("cellsToLinkedMultiPolygon") {
        let (e, v) = err(raw::cells_to_linked_multi_polygon(&idxs(&r.args["indexes"])));
        assert_eq!(e, r.error, "line {}", r.line);
        let Some(v) = v else { continue };
        let got: Vec<Outline> =
            v.iter().map(|p| p.iter().map(|l| l.iter().map(|g| (g.lat, g.lng)).collect()).collect()).collect();
        let want: Vec<Outline> = r.result["polygonsRadians"].as_array().unwrap().iter().map(want_outline).collect();
        assert_eq!(got.len(), want.len(), "line {}: polygon count", r.line);
        if EXACT {
            for (pi, (g, w)) in got.iter().zip(&want).enumerate() {
                if let Err(e) = same_polygon(g, w) {
                    panic!("line {} polygon {pi}: {e}", r.line);
                }
            }
            continue;
        }
        // Order-independent: each expected polygon claims one distinct produced polygon.
        let mut used = vec![false; got.len()];
        for (pi, w) in want.iter().enumerate() {
            let hit = got.iter().enumerate().find_map(|(gi, g)| match used[gi] {
                true => None,
                false => same_polygon(g, w).ok().map(|d| (gi, d)),
            });
            let Some((gi, d)) = hit else {
                panic!("line {} expected polygon {pi}: no produced polygon matches", r.line);
            };
            used[gi] = true;
            worst = worst.max(d);
        }
    }
    report("cellsToLinkedMultiPolygon", worst);
}
