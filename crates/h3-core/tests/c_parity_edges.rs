//! Native Rust versus pinned H3 C fixtures: Phase E (directed edges, vertexes) and Phase F
//! (measurements). Floating-point results are compared exactly: native builds use the same
//! platform libm as the C reference.

mod common;
use common::*;
use sister_h3::{H3Result, LatLng, raw};

fn index_op(op: &str, f: impl Fn(u64) -> H3Result<u64>) {
    for r in load(op) {
        let (e, v) = err(f(idx(&r.args["index"])));
        assert_eq!(e, r.error, "{op} line {} {:?}", r.line, r.args);
        if let Some(v) = v {
            assert_eq!(v, idx(&r.result["index"]), "{op} line {}", r.line);
        }
    }
}

fn bool_op(op: &str, f: impl Fn(u64) -> bool) {
    for r in load(op) {
        assert_eq!(f(idx(&r.args["index"])), r.result["value"].as_bool().unwrap(), "{op} line {}", r.line);
    }
}

fn float_op(op: &str, op_fn: impl Fn(u64) -> H3Result<f64>) {
    for r in load(op) {
        let (e, v) = err(op_fn(idx(&r.args["index"])));
        assert_eq!(e, r.error, "{op} line {} {:?}", r.line, r.args);
        if let Some(v) = v {
            assert_eq!(v.to_bits(), f(&r.result["value"]).to_bits(), "{op} line {}: {v:e}", r.line);
        }
    }
}

fn boundary_op(op: &str, op_fn: impl Fn(u64) -> H3Result<sister_h3::CellBoundary>) {
    for r in load(op) {
        let (e, v) = err(op_fn(idx(&r.args["index"])));
        assert_eq!(e, r.error, "{op} line {} {:?}", r.line, r.args);
        if let Some(v) = v {
            let want = r.result["verticesRadians"].as_array().unwrap();
            assert_eq!(v.len(), want.len(), "{op} line {}", r.line);
            for (g, w) in v.iter().zip(want) {
                assert_eq!(
                    (g.lat.to_bits(), g.lng.to_bits()),
                    (f(&w[0]).to_bits(), f(&w[1]).to_bits()),
                    "{op} line {}",
                    r.line
                );
            }
        }
    }
}

fn pair_op<T: PartialEq + std::fmt::Debug>(
    op: &str,
    f: impl Fn(u64, u64) -> H3Result<T>,
    want: impl Fn(&serde_json::Value) -> T,
) {
    for r in load(op) {
        let (e, v) = err(f(idx(&r.args["origin"]), idx(&r.args["destination"])));
        assert_eq!(e, r.error, "{op} line {} {:?}", r.line, r.args);
        if let Some(v) = v {
            assert_eq!(v, want(&r.result), "{op} line {}", r.line);
        }
    }
}

#[test]
fn directed_edges() {
    for r in load("originToDirectedEdges") {
        assert_eq!(
            raw::origin_to_directed_edges(idx(&r.args["index"])).to_vec(),
            idxs(&r.result["indexes"]),
            "line {}",
            r.line
        );
    }
    bool_op("isValidDirectedEdge", raw::is_valid_directed_edge);
    index_op("getDirectedEdgeOrigin", raw::get_directed_edge_origin);
    index_op("getDirectedEdgeDestination", raw::get_directed_edge_destination);
    index_op("reverseDirectedEdge", raw::reverse_directed_edge);
    for r in load("directedEdgeToCells") {
        let (e, v) = err(raw::directed_edge_to_cells(idx(&r.args["index"])));
        assert_eq!(e, r.error, "line {}", r.line);
        if let Some(v) = v {
            assert_eq!(v.to_vec(), idxs(&r.result["indexes"]), "line {}", r.line);
        }
    }
    boundary_op("directedEdgeToBoundary", raw::directed_edge_to_boundary);
    pair_op("areNeighborCells", raw::are_neighbor_cells, |v| v["value"].as_bool().unwrap());
    pair_op("cellsToDirectedEdge", raw::cells_to_directed_edge, |v| idx(&v["index"]));
}

#[test]
fn edge_lengths() {
    float_op("edgeLengthRads", raw::edge_length_rads);
    float_op("edgeLengthKm", raw::edge_length_km);
    float_op("edgeLengthM", raw::edge_length_m);
}

#[test]
fn vertexes() {
    for r in load("cellToVertexes") {
        let (e, v) = err(raw::cell_to_vertexes(idx(&r.args["index"])));
        assert_eq!(e, r.error, "line {}", r.line);
        if let Some(v) = v {
            assert_eq!(v.to_vec(), idxs(&r.result["indexes"]), "line {}", r.line);
        }
    }
    for r in load("cellToVertex") {
        let (e, v) = err(raw::cell_to_vertex(idx(&r.args["index"]), i(&r.args["vertexNum"]) as i32));
        assert_eq!(e, r.error, "line {} {:?}", r.line, r.args);
        if let Some(v) = v {
            assert_eq!(v, idx(&r.result["index"]), "line {}", r.line);
        }
    }
    bool_op("isValidVertex", raw::is_valid_vertex);
    for r in load("vertexToLatLng") {
        let (e, v) = err(raw::vertex_to_lat_lng(idx(&r.args["index"])));
        assert_eq!(e, r.error, "line {}", r.line);
        if let Some(v) = v {
            assert_eq!(v.lat.to_bits(), f(&r.result["latRadians"]).to_bits(), "line {}", r.line);
            assert_eq!(v.lng.to_bits(), f(&r.result["lngRadians"]).to_bits(), "line {}", r.line);
        }
    }
    bool_op("isValidIndex", raw::is_valid_index);
}

#[test]
fn areas() {
    float_op("cellAreaRads2", raw::cell_area_rads2);
    float_op("cellAreaKm2", raw::cell_area_km2);
    float_op("cellAreaM2", raw::cell_area_m2);
}

#[test]
fn distances_and_tables() {
    for (op, fun) in [
        ("greatCircleDistanceRads", raw::great_circle_distance_rads as fn(&LatLng, &LatLng) -> f64),
        ("greatCircleDistanceKm", raw::great_circle_distance_km),
        ("greatCircleDistanceM", raw::great_circle_distance_m),
    ] {
        for r in load(op) {
            let a = LatLng::from_radians(f(&r.args["aLatRadians"]), f(&r.args["aLngRadians"]));
            let b = LatLng::from_radians(f(&r.args["bLatRadians"]), f(&r.args["bLngRadians"]));
            let got = fun(&a, &b);
            let want = f(&r.result["value"]);
            assert!(got.to_bits() == want.to_bits() || (got.is_nan() && want.is_nan()), "{op} line {}", r.line);
        }
    }
    for (op, fun) in [
        ("getHexagonAreaAvgKm2", raw::get_hexagon_area_avg_km2 as fn(i32) -> H3Result<f64>),
        ("getHexagonAreaAvgM2", raw::get_hexagon_area_avg_m2),
        ("getHexagonEdgeLengthAvgKm", raw::get_hexagon_edge_length_avg_km),
        ("getHexagonEdgeLengthAvgM", raw::get_hexagon_edge_length_avg_m),
    ] {
        for r in load(op) {
            let (e, v) = err(fun(i(&r.args["res"]) as i32));
            assert_eq!(e, r.error, "{op} line {}", r.line);
            if let Some(v) = v {
                assert_eq!(v.to_bits(), f(&r.result["value"]).to_bits(), "{op} line {}", r.line);
            }
        }
    }
    for (op, fun) in [("degsToRads", raw::degs_to_rads as fn(f64) -> f64), ("radsToDegs", raw::rads_to_degs)] {
        for r in load(op) {
            let got = fun(f(&r.args["value"]));
            let want = f(&r.result["value"]);
            assert!(got.to_bits() == want.to_bits() || (got.is_nan() && want.is_nan()), "{op} line {}", r.line);
        }
    }
}
