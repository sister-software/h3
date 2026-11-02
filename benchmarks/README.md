# Benchmarks

```sh
yarn benchmark                 # writes benchmarks/RESULTS.md and benchmarks/results/latest.json
H3_BENCH_SAMPLES=31 yarn benchmark
```

What is measured (`benchmarks/run.ts`):

| Section                                  | Method                                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public JavaScript API versus h3-js 4.5.0 | The six priority functions on fixed seeded inputs (10,000 points at res 9; see `RESULTS.md` for each workload). Three warmup runs, then interleaved samples that alternate which implementation runs first; median and interquartile range of ns per operation; output checksums compared. |
| Boundary costs                           | Index string to `BigInt` and back alone; the raw WASM export alone; the public function.                                                                                                                                                                                                   |
| Cold start                               | Fresh Node processes: module import, `init({ bytes })` (compile and instantiate), first call.                                                                                                                                                                                              |
| Native Rust versus C                     | `crates/h3-core/examples/bench.rs` and `benchmarks/c/bench.c` on identical workloads and inputs (same SplitMix64 sequence), with checksums. C runs only if `target/reference/h3-c` exists (`yarn generate:fixtures` builds it).                                                            |
| Memory (Node)                            | Fresh process with `--expose-gc`: JS heap used, `ArrayBuffer` bytes, and WASM `memory.buffer.byteLength` before import, after import, after `init`, and after scalar, disk, compact, and polygon workloads; then five rounds of the same workloads to show the plateau.                    |
| Memory (workerd)                         | Local `wrangler dev`; the Worker imports a workspace bundle on demand and runs the same stages; JS heap and backing storage come from the inspector's `Runtime.getHeapUsage` (which excludes WASM memory, reported separately).                                                            |

Caveats:

- The development machine is shared. Every report records the load average before and after, and
  results taken with nonzero load are indicative, not authoritative. Compare ratios within one run
  rather than absolute numbers across runs.
- h3-js and this package use different WebAssembly math libraries and C revisions, so `cellToLatLng`
  outputs are compared after rounding to 1e-6 degrees.
- WASM memory never shrinks; a plateau across repeated identical workloads (rather than growth)
  distinguishes reusable capacity from a leak.
