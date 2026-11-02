//! Measures how often two math libraries put a point near a cell edge in different cells.
//!
//! Exact float parity holds only between builds that use the same math library (README,
//! "Reproducibility across machines"). Elsewhere `latLngToCell` can disagree for points within a
//! few ULP of an edge. This tool measures that band: it places points at known arc distances from
//! real cell edges and compares the cells two builds assign them. Not part of the published crate.
//!
//! `scripts/boundary-stress.ts` runs the three steps; by hand:
//!
//! ```sh
//! cargo run -p sister-h3 --example boundary_stress --release --locked -- gen <dir> [samples]
//! cargo run -p sister-h3 --example boundary_stress --release --locked -- eval <dir> platform
//! cargo run -p sister-h3 --example boundary_stress --release --locked --features libm -- eval <dir> libm
//! cargo run -p sister-h3 --example boundary_stress --release --locked -- report <dir> platform libm
//! ```
//!
//! `gen` picks random cells per resolution, walks the great circle from each center to a random
//! neighbor's center, bisects to the edge crossing, and writes points at each offset in `OFFSETS`
//! on both sides, plus uniformly random control points. The point bits are written once, so every
//! build evaluates identical inputs. `eval` writes the cell each point lands in. `report` counts
//! disagreements per resolution and offset, and estimates the chance that a uniformly random point
//! flips: near an edge, the density of distance-to-edge is perimeter/area per radian, so the chance
//! is (perimeter/area) × ∫ flip fraction d(offset), integrated over the measured offsets.

use sister_h3::{LatLng, raw};
use std::fmt::Write as _;
use std::fs;
use std::path::Path;

const RESOLUTIONS: [i32; 6] = [0, 3, 6, 9, 12, 15];

/// Arc offsets from the edge in radians: 10^(k/4) for k in -64..=-32 (1e-16 to 1e-8).
fn offsets() -> Vec<f64> {
    (-64..=-32).map(|k| 10f64.powf(k as f64 / 4.0)).collect()
}

/// splitmix64, so every run generates the same points.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }

    /// A point uniform on the sphere.
    fn sphere(&mut self) -> LatLng {
        let z = 2.0 * self.unit() - 1.0;
        LatLng { lat: z.asin(), lng: (2.0 * self.unit() - 1.0) * std::f64::consts::PI }
    }
}

type V3 = [f64; 3];

fn to_v3(g: &LatLng) -> V3 {
    [g.lat.cos() * g.lng.cos(), g.lat.cos() * g.lng.sin(), g.lat.sin()]
}

fn to_ll(v: V3) -> LatLng {
    let n = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    LatLng { lat: (v[2] / n).asin(), lng: v[1].atan2(v[0]) }
}

/// The point at arc parameter `t` (0 at `a`, 1 at `b`) along the great circle from `a` to `b`.
fn slerp(a: V3, b: V3, omega: f64, t: f64) -> LatLng {
    let (wa, wb) = (((1.0 - t) * omega).sin(), (t * omega).sin());
    to_ll([wa * a[0] + wb * b[0], wa * a[1] + wb * b[1], wa * a[2] + wb * b[2]])
}

fn cell(g: &LatLng, res: i32) -> u64 {
    raw::lat_lng_to_cell(g, res).expect("finite point")
}

fn perimeter_over_area(h: u64) -> f64 {
    let b = raw::cell_to_boundary(h).unwrap();
    let n = b.len();
    let p: f64 = (0..n).map(|i| raw::great_circle_distance_rads(&b[i], &b[(i + 1) % n])).sum();
    p / raw::cell_area_rads2(h).unwrap()
}

fn generate(dir: &Path, samples: usize) {
    let offsets = offsets();
    let mut rng = Rng(0x5157_e5f7_0b0e_d123);
    let mut points = Vec::<u8>::new();
    let mut push = |g: LatLng| {
        points.extend_from_slice(&g.lat.to_le_bytes());
        points.extend_from_slice(&g.lng.to_le_bytes());
    };
    let mut meta = format!("{{\"samples\":{samples},\"offsets\":{offsets:?},\"resolutions\":[");
    for (ri, &res) in RESOLUTIONS.iter().enumerate() {
        let mut pa = 0.0;
        for _ in 0..samples {
            let origin = cell(&rng.sphere(), res);
            pa += perimeter_over_area(origin);
            let ring: Vec<u64> =
                raw::grid_disk(origin, 1).unwrap().into_iter().filter(|&h| h != 0 && h != origin).collect();
            let neighbor = ring[(rng.next() % ring.len() as u64) as usize];
            let a = to_v3(&raw::cell_to_lat_lng(origin).unwrap());
            let b = to_v3(&raw::cell_to_lat_lng(neighbor).unwrap());
            let omega = raw::great_circle_distance_rads(&to_ll(a), &to_ll(b));
            // Bisect for the last parameter still inside `origin`.
            let (mut lo, mut hi) = (0.0f64, 1.0f64);
            for _ in 0..64 {
                let mid = 0.5 * (lo + hi);
                if cell(&slerp(a, b, omega, mid), res) == origin {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            let edge = 0.5 * (lo + hi);
            for &d in &offsets {
                push(slerp(a, b, omega, edge - d / omega));
                push(slerp(a, b, omega, edge + d / omega));
            }
            push(rng.sphere());
        }
        let sep = if ri == 0 { "" } else { "," };
        write!(meta, "{sep}{{\"res\":{res},\"perimeterOverArea\":{}}}", pa / samples as f64).unwrap();
    }
    meta.push_str("]}\n");
    fs::create_dir_all(dir).unwrap();
    fs::write(dir.join("points.bin"), points).unwrap();
    fs::write(dir.join("meta.json"), meta).unwrap();
}

fn read_points(dir: &Path) -> Vec<LatLng> {
    let bytes = fs::read(dir.join("points.bin")).expect("run gen first");
    bytes
        .as_chunks::<16>()
        .0
        .iter()
        .map(|c| LatLng {
            lat: f64::from_le_bytes(c[..8].try_into().unwrap()),
            lng: f64::from_le_bytes(c[8..].try_into().unwrap()),
        })
        .collect()
}

/// Points per sample: two per offset, plus one random control.
fn per_sample() -> usize {
    2 * offsets().len() + 1
}

fn samples(dir: &Path) -> usize {
    let meta = fs::read_to_string(dir.join("meta.json")).unwrap();
    let rest = &meta[meta.find("\"samples\":").unwrap() + 10..];
    rest[..rest.find(',').unwrap()].parse().unwrap()
}

fn eval(dir: &Path, label: &str) {
    let points = read_points(dir);
    let per_res = samples(dir) * per_sample();
    let mut out = Vec::with_capacity(points.len() * 8);
    for (i, g) in points.iter().enumerate() {
        out.extend_from_slice(&cell(g, RESOLUTIONS[i / per_res]).to_le_bytes());
    }
    fs::write(dir.join(format!("cells-{label}.bin")), out).unwrap();
}

fn read_cells(dir: &Path, label: &str) -> Vec<u64> {
    let bytes = fs::read(dir.join(format!("cells-{label}.bin"))).expect("run eval first");
    bytes.as_chunks::<8>().0.iter().map(|c| u64::from_le_bytes(*c)).collect()
}

fn report(dir: &Path, left: &str, right: &str) {
    let (x, y) = (read_cells(dir, left), read_cells(dir, right));
    assert_eq!(x.len(), y.len());
    let meta = fs::read_to_string(dir.join("meta.json")).unwrap();
    let offsets = offsets();
    let n = samples(dir);
    let per_res = n * per_sample();
    // Sanity: at the largest offset, both builds must put the two sides of every crossing in
    // different cells, or the generator did not find an edge.
    let last = 2 * (offsets.len() - 1);
    for build in [&x, &y] {
        let straddling = (0..RESOLUTIONS.len() * n)
            .filter(|i| {
                let b = (i / n) * per_res + (i % n) * per_sample() + last;
                build[b] != build[b + 1]
            })
            .count();
        assert_eq!(straddling, RESOLUTIONS.len() * n, "points at the largest offset do not straddle an edge");
    }
    println!("{left} vs {right}: {n} edge crossings per resolution, {} points in all", x.len());
    println!();
    print!("| offset (rad) | ~distance |");
    for res in RESOLUTIONS {
        print!(" res {res} |");
    }
    println!();
    println!("|---|---|{}", "---|".repeat(RESOLUTIONS.len()));
    let mut fractions = vec![vec![0.0; offsets.len()]; RESOLUTIONS.len()];
    let mut controls = vec![0usize; RESOLUTIONS.len()];
    for (ri, row) in fractions.iter_mut().enumerate() {
        for s in 0..n {
            let base = ri * per_res + s * per_sample();
            for (oi, f) in row.iter_mut().enumerate() {
                for side in 0..2 {
                    let i = base + 2 * oi + side;
                    if x[i] != y[i] {
                        *f += 1.0;
                    }
                }
            }
            let c = base + 2 * offsets.len();
            if x[c] != y[c] {
                controls[ri] += 1;
            }
        }
        for f in row.iter_mut() {
            *f /= (2 * n) as f64;
        }
    }
    for (oi, &d) in offsets.iter().enumerate() {
        let any = fractions.iter().any(|r| r[oi] > 0.0);
        if !any && oi > 0 && !fractions.iter().any(|r| r[oi - 1] > 0.0) {
            continue;
        }
        let km = d * sister_h3::EARTH_RADIUS_KM;
        let dist = if km >= 1e-3 { format!("{:.3} m", km * 1e3) } else { format!("{:.3} µm", km * 1e9) };
        print!("| {d:.1e} | {dist} |");
        for row in &fractions {
            print!(" {:.4} |", row[oi]);
        }
        println!();
    }
    println!();
    println!("Uniform random control points that flipped:");
    for (ri, &res) in RESOLUTIONS.iter().enumerate() {
        // Trapezoid rule over the offsets, with the flip fraction taken as constant below the
        // smallest offset (it is ~0.5 there: both builds are guessing at rounding noise).
        let f = &fractions[ri];
        let mut integral = f[0] * offsets[0];
        for i in 1..offsets.len() {
            integral += 0.5 * (f[i] + f[i - 1]) * (offsets[i] - offsets[i - 1]);
        }
        let key = format!("\"res\":{res},\"perimeterOverArea\":");
        let rest = &meta[meta.find(&key).unwrap() + key.len()..];
        let pa: f64 = rest[..rest.find('}').unwrap()].parse().unwrap();
        println!(
            "- res {res}: {} of {n} control points; estimated flip chance for a random point {:.1e}",
            controls[ri],
            pa * integral
        );
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let usage = "usage: boundary_stress gen <dir> [samples] | eval <dir> <label> | report <dir> <left> <right>";
    let dir = Path::new(args.get(1).expect(usage));
    match args.first().map(String::as_str) {
        Some("gen") => generate(dir, args.get(2).map_or(2000, |s| s.parse().expect(usage))),
        Some("eval") => eval(dir, args.get(2).expect(usage)),
        Some("report") => report(dir, args.get(2).expect(usage), args.get(3).expect(usage)),
        _ => panic!("{usage}"),
    }
}
