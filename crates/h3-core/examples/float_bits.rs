//! Prints the exact bits of every libm-dependent float result over the committed fixture inputs.
//!
//! `scripts/check-libm-wasm.ts` runs this with `--features libm` and compares it, line for line,
//! with the same values read from the WebAssembly exports. With the feature, native and WASM use
//! the same `libm` crate version, so the two must be bit-identical (README, "Reproducibility
//! across machines"). Not part of the published crate.
//!
//! Usage: `cargo run -p sister-h3 --example float_bits --features libm --locked -- <fixtures dir>`

use serde_json::Value;
use sister_h3::raw;
use std::fmt::Write as _;

fn bits(out: &mut String, xs: impl IntoIterator<Item = f64>) {
    for x in xs {
        write!(out, " {:016x}", x.to_bits()).unwrap();
    }
}

fn main() {
    let dir = std::env::args().nth(1).expect("usage: float_bits <fixtures dir>");
    let mut out = String::new();
    for op in [
        "cellToLatLng",
        "cellToBoundary",
        "vertexToLatLng",
        "directedEdgeToBoundary",
        "cellAreaRads2",
        "edgeLengthRads",
    ] {
        let text = std::fs::read_to_string(format!("{dir}/{op}.jsonl")).expect("fixture");
        for line in text.lines() {
            let v: Value = serde_json::from_str(line).unwrap();
            let index = v["args"]["index"].as_str().unwrap();
            let h = u64::from_str_radix(index, 16).unwrap();
            write!(out, "{op} {index}").unwrap();
            let r: Result<Vec<f64>, sister_h3::H3Error> = match op {
                "cellToLatLng" => raw::cell_to_lat_lng(h).map(|g| vec![g.lat, g.lng]),
                "vertexToLatLng" => raw::vertex_to_lat_lng(h).map(|g| vec![g.lat, g.lng]),
                "cellToBoundary" => raw::cell_to_boundary(h).map(|b| b.iter().flat_map(|g| [g.lat, g.lng]).collect()),
                "directedEdgeToBoundary" => {
                    raw::directed_edge_to_boundary(h).map(|b| b.iter().flat_map(|g| [g.lat, g.lng]).collect())
                }
                "cellAreaRads2" => raw::cell_area_rads2(h).map(|a| vec![a]),
                _ => raw::edge_length_rads(h).map(|a| vec![a]),
            };
            match r {
                Ok(xs) => bits(&mut out, xs),
                Err(e) => write!(out, " error {}", e.code()).unwrap(),
            }
            out.push('\n');
        }
    }
    print!("{out}");
}
