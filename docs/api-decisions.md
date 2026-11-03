# API decisions

This document is the contract for `@sister.software/h3` (JavaScript) and `sister-h3` (Rust). The
per-function inventory lives in [`test/api-manifest.json`](../test/api-manifest.json); this file
records the cross-cutting decisions and every intentional difference from h3-js 4.5.0.

Authorities, in order: the pinned H3 C library (`24946ad1c5e9016a6eab96d4f9ee4d0c993720e5`,
`git describe` `v4.5.0-67-g24946ad1`: 67 commits after the v4.5.0 tag, `VERSION` file `4.5.0`; still
the head of upstream `master` when re-fetched on 2026-11-02)
for algorithm behaviour, idiomatic JavaScript for the JavaScript interface, h3o for Rust design ideas
only, and h3-js 4.5.0 as a migration comparison target.

## Native Rust crate (`sister-h3`, library `sister_h3`)

Two layers:

- **`sister_h3::raw`**: C-equivalent free functions over raw `u64` indexes, named after the C
  functions in snake case (`raw::lat_lng_to_cell`, `raw::cell_to_parent`, …). They return
  `Result<T, H3Error>` where C returns an `H3Error`, and plain values where C returns plain values.
  Like C, most of them **do not validate** index arguments: for example `raw::cell_to_parent` on
  an invalid index returns whatever the C bit manipulation produces. This layer is what the
  JavaScript adapter calls, so JavaScript inherits C's error behaviour exactly.
- **Typed wrappers**: `CellIndex`, `DirectedEdgeIndex`, `VertexIndex` validate on construction
  (`CellIndex::new(u64)`, `TryFrom<u64>`, `FromStr`) and delegate to `raw`. `Display` prints the C
  `h3ToString` form.

Common types: `LatLng { lat, lng }` in **radians** (`LatLng::from_degrees` converts),
`CellBoundary` (up to 10 vertices, derefs to `[LatLng]`), `CoordIJ`, `ContainmentMode`, and
`H3Error`, a `#[repr(u32)]` enum whose discriminants are the C codes (`H3Error::code()`).

Units: the core uses C-compatible radians. `degs_to_rads` and `rads_to_degs` are exported; no
operation silently switches units.

Variable-length results return `Vec` (or an iterator such as `ChildIter`). Native bounded
operations accept explicit limits (see "Resource limits"); they never read JavaScript state.

String parsing (`raw::string_to_h3`) accepts 1–16 ASCII hexadecimal digits in either case and
nothing else; it is deliberately stricter than C `sscanf("%" PRIx64)`.

## JavaScript package

### Representation

- `H3Index` is a canonical lowercase hexadecimal string, no `0x`, no padding: the C `h3ToString`
  form, byte-for-byte compatible with stored h3-js output.
- `H3IndexInput` is `string | readonly [number, number]`. Strings must be 1–16 ASCII hex digits in
  either case. A `SplitLong` tuple is `[lower, upper]`; each word must be an integer in
  `-0x80000000..0xffffffff` and is normalized with unsigned 32-bit semantics.
- Whole indexes never pass through a JavaScript `number`.
- `h3IndexToSplitLong` returns unsigned words. `splitLongToH3Index(lower, upper)` formats `upper`
  in unpadded lowercase hex followed by exactly eight lowercase hex digits of `lower` (so
  `splitLongToH3Index(0, 0)` is `"000000000"`, as in h3-js). This arbitrary-word conversion is
  distinct from canonical output.
- Coordinates are degrees, `[lat, lng]` by default and `[lng, lat]` when a GeoJSON switch is
  `true`. GeoJSON output closes loops (first vertex repeated at the end).
- Counts and positions are `number`s; Rust checks the safe-integer bound before conversion and
  throws `RangeError` rather than rounding.

### TypeScript output brands

`H3Cell`, `H3DirectedEdge`, and `H3Vertex` use separate private `unique symbol` properties on `string`.
Their declarations are exported as types; they add no runtime symbols, values, or validation.
`H3Index` remains a general string alias for compatibility.

Index-producing functions use `T extends string` with a default for the output category.
For example, `gridDisk<T extends string = H3Cell>(index, ringSize)` returns `T[]`;
`gridDiskDistances` returns `T[][]`, and `directedEdgeToCells` returns `[T, T]` with the cell default.
Directed-edge and vertex producers default to their corresponding brands.
`splitLongToH3Index` defaults to `H3Index` because arbitrary words do not establish an index category.

Callers can select their existing full-index string brand through the type argument, or select `string`.
This annotation does not shorten an index, constrain its resolution, or check application-specific rules.
Inputs retain `H3IndexInput`, so existing ordinary strings, external brands, and split-long tuples remain accepted.
The brands describe output categories; algorithm validity and failure behavior remain operation-specific.

### Errors

| Situation                                                                               | Thrown                                                                            |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Wrong or missing top-level argument type                                                | `TypeError`                                                                       |
| Well-typed argument out of the binding's accepted range (see below)                     | `RangeError`                                                                      |
| Syntactically valid 64-bit value that C rejects                                         | `Error` with `name: "H3Error"` and numeric `code` (the C code)                    |
| Synchronous first-use instantiation fails; any call while an explicit `init` is pending | `Error` with `name: "H3InitializationError"` (`cause` attached)                   |
| Request over a resolved resource limit                                                  | `RangeError` with `name: "H3ResourceLimitError"`, `limit`, `requested`, `maximum` |
| Unexpected WASM trap; every later call                                                  | `Error` with `name: "H3RuntimeError"`, `cause` = the trap                         |

`RangeError` cases: fractional or out-of-range resolutions (`0..15`, integers only), negative or
fractional `ringSize`, malformed index strings and tuples, invalid split words, unknown units and
flags, non-finite coordinates, and any non-boolean value for an optional boolean switch other than
`undefined` (switches are never coerced by truthiness).

Finite out-of-range latitudes and longitudes are **not** rejected; they follow pinned C behaviour
(C `latLngToCell` only rejects non-finite input), and the differential fixtures include such cases.

`H3Error` is not a runtime export (it is a TypeScript type for the error shape). Its `message` is
the C `describeH3Error` text.

### Exceptions to "invalid input throws"

- `isValidCell`, `isValidIndex`, `isValidDirectedEdge`, `isValidVertex` accept `unknown` after
  initialization and return `false`, never throw, for wrong types, malformed strings or words,
  invalid bits, or the wrong index mode.
- `isPentagon` and `isResClassIII` return `false` for a well-formed value that is not a valid cell
  (instead of exposing raw bit-field results). Wrong top-level types still throw `TypeError`.
- `getResolution` returns the resolution of a valid cell and `-1` for any well-formed value that is
  not a valid cell (including valid directed edges and vertexes). Wrong top-level types throw
  `TypeError`; malformed strings return `-1`, matching its "not a valid cell" rule.
- An empty array is only ever a valid empty result, never a failure sentinel. Nothing returns
  `null` or `0` as a failure sentinel.

### Initialization

```ts
type InitOptions =
	| { module?: never; bytes?: never; limits?: ResourceLimits }
	| { module: WebAssembly.Module; bytes?: never; limits?: ResourceLimits }
	| { bytes: ArrayBuffer | ArrayBufferView; module?: never; limits?: ResourceLimits }

function init(options?: InitOptions): Promise<void>
```

**Changed 2026-11-02 (operator decision):** initialization is implicit. The original guide required
an awaited `init` before any call, on the premise that WebAssembly loading is asynchronous in
browsers and Workers. Measured on the pinned runtimes, synchronous compile and instantiate of the
175 KB binary is allowed in Node, on the Chromium 156 and Firefox 157 main threads, and in workerd
for a bundler-compiled module (WebKit/Safari is unverified: its Playwright build cannot run on the
development host). A required async step was a foot gun for an otherwise synchronous library.

- Importing the package compiles, instantiates, fetches, and allocates nothing beyond ordinary
  module objects (the embedded binary is a string constant). There is no top-level `await`, no
  default asset URL, and no `globalThis.process` detection.
- The first H3 call instantiates synchronously from the entry's registered binary: the embedded
  copy (`lib/generated/h3-embedded.js`, base64) for the default entry, or the package's own
  `h3.wasm` imported by the `workerd` entry (`exports["."].workerd`), which wrangler compiles. The
  Worker bundle therefore does not contain the embedded copy.
- If that fails (for example under a policy that forbids synchronous compilation), the call throws
  `H3InitializationError` with the cause and the advice to await `init({ module })` or
  `init({ bytes })`; the state stays `uninitialized`, so a later call or `init` can retry.

`init` is optional. With no source it initializes from the package's binary (synchronously, behind
a resolved promise). State machine: `uninitialized → initializing → ready`, and `ready → poisoned`
after an unexpected trap.

1. Limits must be set before the first H3 call; they are frozen when the instance starts.
2. If H3 is already ready from the package's binary (first use or a source-less `init`), `init`
   with the same limits resolves, whatever source it names; different limits reject with
   `H3InitializationError`.
3. After an explicit `module` or `bytes` source, `init` with the same source and limits resolves;
   a different source or different limits reject and leave the live instance.
4. Concurrent `init` calls with the same source (`===`) and equal limits share one promise and one
   instance. A call to an H3 function while an explicit `init` is pending throws
   `H3InitializationError` (it does not start a second instance).
5. A failed explicit attempt rejects every waiter with the original cause, clears the state to
   `uninitialized`, and allows a retry; a different source while pending rejects without
   cancelling the pending attempt.
6. All computation is synchronous; there is no fallback backend.

`bytes` are copied synchronously before the first asynchronous gap and compiled with
`WebAssembly.compile` (refused under workerd); `module` accepts a bundler-supplied compiled module.

Cost to existing h3-js callers: change the import from `"h3-js"` to `"@sister.software/h3"`.
Nothing else is required.

### Resource limits

```ts
interface ResourceLimits {
	maxResultItems?: number
	maxResultBytes?: number
	maxWorkspaceBytes?: number
}
```

Values must be non-negative safe integers; they are resolved and frozen at `init`.

Defaults: `maxResultItems` 1,000,000, `maxResultBytes` 128 MiB, `maxWorkspaceBytes` 64 MiB. Basis
(2026-11-02, Node 26.2): an index string in a result array measured 27–40 bytes of JS heap (the
estimate uses 56 + 8), WASM memory starts at 1.06 MiB and reached 22.6 MiB transiently for an
823,543-cell result and 16.3 MiB for a 1,472,101-cell disk, and repeated workloads plateau. One
million results therefore stay near 50 MiB, inside a Worker's 128 MB for JS heap plus WASM. Rejection happens
before allocation, with checked arithmetic, and a request exactly at a limit passes. Results are
never truncated. Accounting formulas are per operation and documented with each adapter:

- `items`: every scalar value in the returned JavaScript result (an index string counts as 1, a
  coordinate number as 1).
- `resultBytes`: flattened WASM output bytes plus a JavaScript expansion estimate (an index string
  is estimated at 48 bytes, a number at 8 bytes, an array at 16 bytes plus 8 per element).
- `workspaceBytes`: live native input plus temporary workspace, excluding result storage.

## Private WASM ABI

The adapter (`crates/h3-wasm`) is built with `wasm-bindgen` `=0.2.130` (`--target web
--omit-default-module-path`). The generated module is private, kept under `lib/generated/`, and
wrapped by `lib/runtime/`. Exports are numeric:

- Index inputs are `u64` (JavaScript `bigint`); bulk index inputs are `&[u64]`
  (`BigUint64Array`) and bulk coordinates `&[f64]` (`Float64Array`). JavaScript converts strings
  with `BigInt("0x" + s)` after validating them, and formats outputs with `toString(16)`.
- Index results are returned as `u64`. A `0` result is checked with `last_error()`: nonzero means
  failure, while zero means C itself returned `H3_NULL` successfully (for example
  `cellToParent(0, 0)`), which is reported as the index string `"0"`.
- Non-negative integer results (counts, resolutions, digits, distances, positions) are returned as
  `f64` holding either the exact value (≥ 0, checked against `2^53 - 1` in Rust) or the negated
  error code.
- Boolean results are `i32`: `0`/`1`, or the negated error code.
- Two-value results (`cellToLatLng`, `vertexToLatLng`, `cellToLocalIj`) return a `u32` status
  (0 or the C code) and leave the values in a fixed slot read with `out_f64(0)` and `out_f64(1)`.
- Index-array results (children, compaction, disks, rings, paths, edges, vertexes, polygon fill)
  and boundaries return an `f64` count, or a negated status, and leave the values in a Rust-owned
  reused buffer (`out_u64_ptr()`, `out_f64_ptr()`). Ownership: the buffer belongs to the adapter
  and is replaced by the next call that writes it. The runtime creates a fresh typed-array view on
  `memory.buffer` after each call (memory may have grown) and copies the values into ordinary
  JavaScript strings or numbers before making any other WASM call, so no view outlives its data.
  An index buffer whose capacity exceeds 65,536 entries and four times its latest result is shrunk.
- The rarely used variable-length results (`getIcosahedronFaces`, `gridDiskDistances`,
  `cellsToMultiPolygon`) are returned as `Vec<i32>` / `Vec<u64>` / `Vec<f64>`, copied out by the
  generated glue; `last_error()` distinguishes an empty success from a failure.
- Every export that can fail sets `last_error()` (0 on success).
- Resource-limit rejections use status codes above 1000 (`1001` items, `1002` result bytes, `1003`
  workspace), with `limit_requested()` and `limit_maximum()` describing the rejection.

Measured basis for these choices (Node 26.2, load average ≈ 3 on 16 cores, so indicative only):
returning `Vec`s through the generated glue cost about 200 ns per `cellToLatLng` and about 550 ns
per `gridDisk(k=2)` for the allocate/copy/free round trip; the fixed slot and reused buffer removed
most of that (`cellToLatLng` 479 → ~360 ns, `gridDisk` 1,955 → ~1,100 ns). Index strings use
`BigInt("0x" + s)` (~60 ns) and `toString(16)` (~40 ns); an informal comparison found split
32-bit words no faster, so the BigInt transport stays. See `benchmarks/RESULTS.md`.

## Comparison rules

| Quantity                                               | Native Rust vs C                                                      | WASM vs C                      |
| ------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------ |
| Index bits, counts, validity, C error codes            | exact                                                                 | exact                          |
| Floats through libm (coordinates, measures)            | exact on linux x86-64 glibc, default features; bounds below elsewhere | bounds below                   |
| Floats without libm (unit conversions, average tables) | exact                                                                 | exact                          |
| Collections with C-guaranteed order                    | exact order                                                           | exact order                    |
| `polygonToCells*` output                               | set equality + no duplicates + cardinality                            | same                           |
| `cellsToLinkedMultiPolygon` polygon order              | exact C order on the reference platform; unspecified elsewhere        | unspecified (matched as a set) |

The reference platform is the one the fixtures are generated on: linux x86-64, glibc, C built with
`-ffp-contract=off`. `crates/h3-core/tests/common` (`EXACT`) selects the mode, and CI sets
`H3_EXPECT_EXACT` so that a build silently falling back to tolerances fails. `cargo test
--workspace` would do exactly that, because the WASM adapter enables the `libm` feature for the
whole build. Native with `features = ["libm"]` and the WASM build use the same `libm` crate
version and are checked to be bit-identical (`yarn check:libm-wasm`, 15,956 values).

Polygon order of `cellsToLinkedMultiPolygon` / `cellsToMultiPolygon` is unspecified. C orders the
polygons by hashing vertex coordinates, so last-bit libm differences can permute them. This was
observed for one 122-cell fixture with C built on Apple Silicon. Loop grouping and vertex order
within a loop are stable.

`compactCells` is compared against C's whole output buffer (unused slots `0`) in C order.

## Comparison tolerances (non-reference math versus C)

Off the reference platform, or with the portable libm (the WASM build and the `libm` feature),
transcendental results can differ from the fixtures in the last bits. Index results remain exact
on every fixture. Floats are bounded by the same limits in the JavaScript suite
(`test/shared/fixture-cases.ts`) and the native suites (`crates/h3-core/tests/common`):

| Quantity                     | Bound                                       | Observed maximum (2026-11-02) |
| ---------------------------- | ------------------------------------------- | ----------------------------- |
| Coordinates (degrees)        | 1e-12 absolute                              | 6.4e-14                       |
| Lengths, distances (radians) | 1e-13 absolute, in radian units             | 8.9e-16                       |
| Areas (square radians)       | 1e-14 × √area (error scales with perimeter) | 1.8e-15 (on a 0.1 sr cell)    |

Native observations against the same bounds, as the worst difference divided by its bound:

- **`libm` feature, linux x86-64:** coordinates 0.064, areas 0.56, lengths 0.006.
- **C built on macOS arm64** (Apple libm, `-ffp-contract=off`) against the Linux fixtures:
  coordinates up to 74 ULP, areas 0.07, lengths 0.006.

Cell assignment depends on these coordinates, so a point close enough to a cell edge can change
cells between math libraries. No fixture hits such a point, so integer outputs are exact on the
fixtures but are not promised to be identical across libms in general (README, "Reproducibility
across machines").

`yarn stress:boundary` measures the band (`crates/h3-core/examples/boundary_stress.rs`). For 2,000
random edge crossings per resolution it bisects to the edge and compares `latLngToCell` from the
platform build and the `libm` build at offsets from 1e-16 to 1e-8 rad on both sides. The tables
give the fraction of points assigned different cells, measured 2026-11-02 against `libm` 0.2.16.

Linux x86-64, glibc:

| Offset from edge   | res 0 | res 3 | res 6 | res 9 | res 12 | res 15 |
| ------------------ | ----- | ----- | ----- | ----- | ------ | ------ |
| 1.0e-16 rad        | 1.8%  | 2.1%  | 2.0%  | 2.5%  | 2.2%   | 2.3%   |
| 3.2e-16 rad        | 0.57% | 0.27% | 0.37% | 0.20% | 0.20%  | 0.45%  |
| 5.6e-16 rad        | 0.15% | 0     | 0.03% | 0     | 0      | 0.03%  |
| 1.0e-15 rad and up | 0     | 0     | 0     | 0     | 0      | 0      |

macOS arm64, Apple libm (run by the operator):

| Offset from edge   | res 0 | res 3 | res 6 | res 9 | res 12 | res 15 |
| ------------------ | ----- | ----- | ----- | ----- | ------ | ------ |
| 1.0e-16 rad        | 2.8%  | 3.6%  | 4.0%  | 4.0%  | 4.0%   | 3.8%   |
| 3.2e-16 rad        | 0.43% | 0.75% | 0.88% | 0.95% | 0.80%  | 0.80%  |
| 5.6e-16 rad        | 0.05% | 0.15% | 0.08% | 0.05% | 0.13%  | 0.05%  |
| 1.0e-15 rad        | 0     | 0     | 0     | 0     | 0.03%  | 0      |
| 1.8e-15 rad and up | 0     | 0     | 0     | 0     | 0      | 0      |

The band is the same width in radians at every resolution, so the chance that a uniformly random
point flips scales with perimeter/area. Estimated per random point:

| Platform libm | res 0 | res 9   | res 15  |
| ------------- | ----- | ------- | ------- |
| glibc         | 6e-17 | 3.5e-13 | 1.4e-10 |
| Apple         | 7e-17 | 7.5e-13 | 2.4e-10 |

None of the 12,000 random control points flipped on either platform.

These rates hold only for points placed independently of the grid. Data derived from H3 geometry, or
snapped to it upstream, can sit exactly on edges. Mailwoman's Overture POI layer (`poi.db`,
2026-08-19 build) is the measured case. Recomputing its res-9 column with this package moved 1,490
of 14,664,001 rows (1.0e-4) to an adjacent cell relative to the h3-js 4.5.0 build. Bisection put
every one of those points within about 3e-16 rad of the edge, with the two libraries' edges at most
4.6e-16 rad apart. Most of those rows share one Overture confidence score, which points to a
single upstream source. The UPRN layer (41,629,393 Ordnance Survey points) matched on every row.

## Differences from h3-js 4.5.0

`test/migration/h3-js.test.ts` runs h3-js 4.5.0 and this package over every JavaScript-expressible
C fixture and fails on any difference outside these categories; each category also has an explicit
example test. Counts are from the fixture run on 2026-11-02.

| Category              | Input (example)                                                           | h3-js 4.5.0                                    | This package                          | C                        | Migration action                       | Cases   |
| --------------------- | ------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------- | ------------------------ | -------------------------------------- | ------- |
| error-name            | `cellToParent(cell, 9)` on a res-7 cell                                   | `Error`, `code: 12`, message with `(code: 12)` | `H3Error`, `code: 12`, C description  | `E_RES_MISMATCH` (12)    | test `error.code`, not `error.name`    | 3656    |
| range-error           | `cellToParent(cell, 16)`, `gridDisk(cell, -1)`, `latLngToCell(NaN, 0, 5)` | `Error` with C code 4/2/3                      | `RangeError`                          | 4 / 2 / 3                | catch `RangeError` or validate         | 2872    |
| range-error           | `latLngToCell(lat, lng, 7.5)`                                             | truncated to 7                                 | `RangeError`                          | n/a                      | pass an integer                        | (incl.) |
| range-error           | `greatCircleDistance([NaN, 0], ...)`, polygons with NaN vertices          | `NaN`, or cells from NaN geometry              | `RangeError`                          | NaN / undefined geometry | validate coordinates                   | (incl.) |
| malformed index       | `cellToParent("xyz", 1)`                                                  | coerced to `[0,0]`, then C error 12            | `RangeError`                          | n/a                      | validate or catch                      | example |
| boolean switches      | `cellToBoundary(cell, 1)`                                                 | truthiness                                     | `RangeError`                          | n/a                      | pass a boolean                         | example |
| predicate             | `isResClassIII("ffffffffffffffff")`                                       | `true` (raw bits)                              | `false`                               | raw bits                 | none expected                          | 12      |
| null-result           | `cellToParent("0", 0)`; `compactCells(["0", ...kids])`                    | throws; drops `"0"` from output                | `"0"`; keeps C's copied `"0"`         | `H3_NULL` success        | filter `"0"` if relevant               | 5       |
| h3js-prevalidation    | `cellToChildrenSize("0", 0)`                                              | `Error` code 5                                 | `1` (C does not validate)             | 1                        | validate with `isValidCell` first      | 72      |
| empty-polygon         | `polygonToCells([], 9)`                                                   | `[]`                                           | `H3Error` code 1 (experimental: `[]`) | `E_FAILED` (1)           | guard empty input                      | 1       |
| gridPathCells failure | non-neighbor base cells                                                   | ignores the C path error                       | `H3Error` with the C code             | error                    | catch                                  | example |
| c-revision            | polygon with latitudes beyond ±90°                                        | C v4.5.0 (no clamp)                            | pinned C (uber/h3#1226 clamp)         | clamped                  | none                                   | 1       |
| measurement-precision | res-15 edge lengths and areas                                             | C v4.5.0 `asin` path, Emscripten libm          | pinned C `atan2` path (uber/h3#1255)  | as this package          | none (≤ 1e-6 relative, observed ~2e-9) | 57      |
| degree-rounding       | `degsToRads(1e-300)`                                                      | `x * Math.PI / 180` (two roundings)            | `x * M_PI_180` (C, one rounding)      | as this package          | none                                   | example |
