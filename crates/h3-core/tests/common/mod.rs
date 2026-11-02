//! Shared fixture loading for C parity tests.

#![allow(dead_code)]

use serde_json::Value;
use std::path::PathBuf;

pub struct Record {
    pub args: Value,
    pub error: u32,
    pub result: Value,
    pub line: usize,
}

pub fn load(operation: &str) -> Vec<Record> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(format!("{operation}.jsonl"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("reading {}: {e}", path.display()));
    let records: Vec<Record> = text
        .lines()
        .enumerate()
        .map(|(i, l)| {
            let v: Value = serde_json::from_str(l).unwrap();
            assert_eq!(v["schemaVersion"], 1);
            assert_eq!(v["operation"], operation);
            Record {
                args: v["args"].clone(),
                error: v["error"].as_u64().unwrap() as u32,
                result: v["result"].clone(),
                line: i + 1,
            }
        })
        .collect();
    assert!(!records.is_empty(), "{operation}: no fixture records");
    records
}

pub fn idx(v: &Value) -> u64 {
    u64::from_str_radix(v.as_str().unwrap(), 16).unwrap()
}

pub fn idxs(v: &Value) -> Vec<u64> {
    v.as_array().unwrap().iter().map(idx).collect()
}

pub fn f(v: &Value) -> f64 {
    match v {
        Value::String(s) => match s.as_str() {
            "nan" => f64::NAN,
            "inf" => f64::INFINITY,
            "-inf" => f64::NEG_INFINITY,
            _ => panic!("bad float tag {s}"),
        },
        _ => v.as_f64().unwrap(),
    }
}

pub fn i(v: &Value) -> i64 {
    v.as_i64().unwrap()
}

pub fn err<T>(r: Result<T, sister_h3::H3Error>) -> (u32, Option<T>) {
    match r {
        Ok(v) => (0, Some(v)),
        Err(e) => (e.code(), None),
    }
}

/// Tracks the maximum absolute floating-point difference for reporting.
#[derive(Default)]
pub struct MaxErr {
    pub max: f64,
    pub count: usize,
}

impl MaxErr {
    pub fn check(&mut self, got: f64, want: f64, tol: f64, ctx: &str) {
        let d = (got - want).abs();
        self.count += 1;
        if d > self.max {
            self.max = d;
        }
        assert!(d <= tol, "{ctx}: got {got:e}, want {want:e}, |diff| {d:e} > {tol:e}");
    }
}
