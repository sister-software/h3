# Benchmarks

```sh
yarn benchmark
H3_BENCH_SAMPLES=31 yarn benchmark
H3_BENCH_SAMPLES=3 H3_BENCH_OUTPUT="$PWD/target/benchmark-smoke" yarn benchmark
```

The default output is `benchmarks/RESULTS.md` and `benchmarks/results/latest.json`.
`H3_BENCH_OUTPUT` selects a separate report directory for smoke runs.

| Measurement           | Method                                                                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public JavaScript API | Six operations use fixed seeded inputs. Each implementation receives three warmup runs. Samples alternate execution order and report median and interquartile range in nanoseconds per operation.                      |
| Boundary costs        | Separate loops measure index conversion, raw WASM exports, and public functions.                                                                                                                                       |
| Cold start            | Fresh Node processes measure import, first-use initialization, subsequent calls, and explicit preloading.                                                                                                              |
| Native Rust and C     | Matching seeded workloads run in the native Rust example and C benchmark. Rust uses both default math and portable `libm`. C is included when `target/reference/h3-c/lib/libh3.a` exists.                              |
| Node memory           | A fresh process with `--expose-gc` records JavaScript heap, array buffers, and WASM linear memory after each workload and repeated rounds.                                                                             |
| workerd memory        | A managed Wrangler process exposes heap usage through its inspector. The report distinguishes measured data, an unavailable inspector target, and failed execution. Failed execution makes the benchmark command fail. |

## Measurement schema 2

JavaScript timings include API calls and collection of their returned results. They exclude validation,
string joining, checksums, and report formatting. The outer collection cost remains part of bulk workloads.

Validation runs before warmup. Index operations compare every index; unordered outputs compare sorted
collections with multiplicity preserved. Coordinate operations compare both coordinates of every center
with an absolute tolerance of `1e-12` degrees. A validation mismatch aborts the run.

Schema 1 included string joining, reductions, and formatting inside timed workloads. Its abbreviated
checks did not compare full outputs. Schema 2 results are not directly comparable with those measurements.
The committed result files retain their original measurement conditions until a new full run replaces them.
Native checksum comparisons remain checksums and are labelled accordingly.

## Implementation

`run.ts` sequences measurements and writes reports. `javascript.ts`, `boundary.ts`, `native.ts`,
`probes.ts`, and `worker.ts` own their measurement protocols. Executable probes live under `probes/`.
`report.ts` renders measured data without running workloads. Shared process helpers own readiness and termination.

Machine load is recorded with each report and affects interpretation of timing samples.
WASM linear memory does not shrink; repeated workloads measure whether its capacity reaches a plateau.
