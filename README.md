# @sister.software/h3

An independent Rust implementation of [H3](https://h3geo.org), the hexagonal hierarchical
geospatial index, usable as a native Rust crate (`sister-h3`) and as an npm package
(`@sister.software/h3`) for Node, browsers, and Cloudflare Workers through WebAssembly.

- The algorithms are translated from the H3 C library (pinned at `v4.5.0-67-g24946ad1`) and are
  tested against it: every index matches C exactly, and floats match bit for bit on the reference
  platform and within documented bounds elsewhere. See
  [reproducibility across machines](#reproducibility-across-machines).
- The JavaScript API keeps the familiar h3-js 4.x function names, argument order and result shapes,
  with predictable JavaScript errors. See [migrating from h3-js](#migrating-from-h3-js).
- Importing the package allocates nothing. The first H3 call instantiates a small (~174 KB)
  WebAssembly module whose memory starts small and grows on demand; no setup call is needed.

## Installation

```sh
npm install @sister.software/h3
```

## Initialization

None is needed. Import and call, as with h3-js:

```ts
import { latLngToCell } from "@sister.software/h3"

latLngToCell(37.3615593, -122.0553238, 7) // "87283472bffffff"
```

Importing does no WebAssembly work. The first H3 call compiles and instantiates the package's binary
synchronously (about 2 ms in Node), and every call is synchronous. In Node and browsers the binary
is embedded in the package's JavaScript; under the `workerd` export condition (Cloudflare Workers
bundled by wrangler) the package imports its own `h3.wasm`, which wrangler compiles at deploy time.

`init` is optional. Use it to preload during startup, to set [resource limits](#resource-limits)
(which must happen before the first H3 call), or to supply the binary yourself, for example from a
separately served asset:

```ts
import { init } from "@sister.software/h3"

await init({ limits: { maxResultItems: 5_000_000 } }) // the package's own binary
await init({ bytes: await (await fetch(wasmUrl)).arrayBuffer() }) // your own copy of h3.wasm
await init({ module: compiledModule }) // a compiled WebAssembly.Module
```

`init` resolves immediately if H3 is already running with the same limits, and rejects with
`H3InitializationError` if the limits differ. Environments that forbid synchronous WebAssembly
compilation (none of the tested ones do: Node, Chromium 156, Firefox 157, workerd) need an awaited
`init({ module })` or `init({ bytes })` before the first call; the first-call error says so.

## Usage

```js
import {
	latLngToCell,
	cellToLatLng,
	cellToBoundary,
	gridDisk,
	polygonToCells,
	cellsToMultiPolygon,
} from "@sister.software/h3"

const h3Index = latLngToCell(37.3615593, -122.0553238, 7)
// -> '87283472bffffff'

cellToLatLng(h3Index)
// -> [37.351718201832725, -122.05032565263947]

cellToBoundary(h3Index)
// -> [[37.34109909323569, -122.04156135164338], ...]

gridDisk(h3Index, 1)
// -> ['87283472bffffff', '87283472affffff', ...]

const polygon = [
	[37.813318999983238, -122.4089866999972145],
	[37.7198061999978478, -122.3544736999993603],
	[37.8151571999998453, -122.4798767000009008],
]
const hexagons = polygonToCells(polygon, 7)
// -> ['87283082bffffff', '872830870ffffff', ...]

cellsToMultiPolygon(hexagons, true)
// -> [[[[-122.40326874464051, 37.79707086149342], [-122.4120877673798, 37.807601004224495], ...]]]
```

### Indexes, units, and coordinates

- Indexes are lowercase hexadecimal strings (`"87283472bffffff"`). Inputs may also be upper case or
  a `[lower, upper]` pair of 32-bit words. Indexes never pass through a JavaScript `number`.
- Coordinates are degrees, `[lat, lng]`, or `[lng, lat]` when a GeoJSON switch is `true` (GeoJSON
  loops are closed). Measurement units come from `UNITS` (`km`, `m`, `rads`, `km2`, `m2`, `rads2`).

### TypeScript index brands

Cell, directed-edge, and vertex outputs default to `H3Cell`, `H3DirectedEdge`, and `H3Vertex`.
These are distinct string brands with no runtime representation. Existing string and split-long inputs remain accepted,
and `H3Index` remains the general string type.

An index-producing function accepts a string type parameter for an application's existing brand:

```ts
import { latLngToCell, gridDisk } from "@sister.software/h3"

declare const appCellBrand: unique symbol
type AppCell = string & { readonly [appCellBrand]: true }

const origin = latLngToCell<AppCell>(37.3615593, -122.0553238, 7)
const nearby = gridDisk<AppCell>(origin, 1) // AppCell[]
```

Omit the type argument for this package's default brand, or use `<string>` for unbranded outputs.
The type argument changes the annotation; it does not convert index values or validate application-specific rules.

### Errors

| Situation                                                                                                                                   | Error                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Wrong argument type                                                                                                                         | `TypeError`                                                                       |
| Out-of-range or fractional resolution, negative ring size, malformed index, non-finite coordinate, unknown unit or flag, non-boolean switch | `RangeError`                                                                      |
| The H3 algorithm rejects a value (invalid cell bits, pentagon distortion, not neighbors, ...)                                               | `Error` with `name: "H3Error"` and the numeric C `code`                           |
| First-use instantiation is not allowed by the environment (see Initialization)                                                              | `Error` with `name: "H3InitializationError"`                                      |
| Request over a resource limit                                                                                                               | `RangeError` with `name: "H3ResourceLimitError"`, `limit`, `requested`, `maximum` |

`isValidCell`, `isValidIndex`, `isValidDirectedEdge`, and `isValidVertex` never throw after
initialization. `isPentagon` and `isResClassIII` return `false` for well-formed indexes with invalid cell bits.
`getResolution` returns `-1` for invalid cells, including malformed index strings. No function returns `null` as a failure sentinel.

### Resource limits

Every variable-length result is checked against per-call budgets before anything is allocated, and
results are never truncated:

```ts
await init({ bytes, limits: { maxResultItems: 1_000_000, maxResultBytes: 256 << 20, maxWorkspaceBytes: 128 << 20 } })
```

Defaults are 1,000,000 result values, 128 MiB of estimated result memory, and 64 MiB of estimated
workspace per call, sized so one maximal call fits comfortably in a Cloudflare Worker (128 MB for JS
heap and WASM together). Node tools that need larger single results, such as children of a coarse
cell at a fine resolution, should raise them in `init`.

### Migrating from h3-js

Change the import. Results are the same strings and shapes, and there is no setup step.
The intentional differences, each covered by `test/migration/h3-js.test.ts`, are listed in
[`docs/api-decisions.md`](docs/api-decisions.md#differences-from-h3-js-450); the most visible are
`RangeError`s for out-of-range arguments (instead of an `Error` with code 4) and `name: "H3Error"`
on algorithm errors (`code` is unchanged).

## Rust

```toml
[dependencies]
sister-h3 = { git = "https://github.com/sister-software/h3" }
```

```rust
use sister_h3::{CellIndex, LatLng, raw};

let cell = CellIndex::from_lat_lng(LatLng::from_degrees(37.3615593, -122.0553238), 7)?;
assert_eq!(cell.to_string(), "87283472bffffff");
assert_eq!(raw::cell_to_parent(cell.get(), 9).unwrap_err().code(), 12);
# Ok::<(), sister_h3::H3Error>(())
```

`sister_h3::raw` mirrors the C API over raw `u64` indexes in radians; `CellIndex`,
`DirectedEdgeIndex`, and `VertexIndex` validate on construction. See `crates/h3-core/README.md`.

## Reproducibility across machines

H3 computes cells with trigonometry, and math libraries (glibc, Apple's, Bionic, musl, Windows)
are not guaranteed to agree in the last bit of `sin`, `cos`, or `atan2`. Which results are
identical where:

| Build                               | Results                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| npm package (WebAssembly), any host | identical on every OS, CPU, browser, and runtime (one portable libm inside the binary) |
| `sister-h3`, default features       | the platform's libm: matches H3 C built on the same machine                            |
| `sister-h3`, `features = ["libm"]`  | identical on every platform, and identical to the npm package's WebAssembly            |

Native builds use the platform libm by default because that is what a locally built H3 C uses.
On linux x86-64 with glibc, where the reference fixtures are generated, native results are
bit-identical to C on every committed case. Elsewhere, coordinates differ from those fixtures by a
few units in the last place (at most about 1e-14 relative on Apple Silicon). That is far inside the
documented bounds (`docs/api-decisions.md`).

Indexes are computed from those coordinates, so a point that lies extremely close to a cell edge
can be assigned to a different cell by a different libm. Measured with `yarn stress:boundary`
against the `libm` crate, that band is about 1e-15 radians, a few nanometres on the ground: glibc
on linux x86-64 has no flips at 1e-15 rad from an edge, and Apple's libm on macOS arm64 has none
at 1.8e-15 rad. For a uniformly random point the estimated chance of a flip is below 1e-12 at
resolution 9 and below 3e-10 at resolution 15. Real data can be far denser on edges than random
points: in one Overture POI layer, 1,490 of 14.7 million places (about 1e-4) lay within 3e-16 rad of
a res-9 edge and got the neighboring cell from h3-js. Cross-machine identical integer output is
promised only by the WebAssembly build and by the `libm` feature at a pinned crate version. If
you store derived data and need reruns on another machine to match exactly, enable the feature
(Cargo features are additive: if any crate in your build enables it, it is on for all). The polygon order of
`cellsToMultiPolygon` / `cells_to_linked_multi_polygon` is unspecified and can change with the
libm, though the polygons themselves do not.

## Development

```sh
yarn install --immutable
yarn build:wasm             # requires wasm-bindgen-cli 0.2.130 (see docs/build.md)
yarn check:wasm-artifact    # committed binary equals a fresh build
yarn compile && yarn test --run
cargo test -p sister-h3 --locked                  # bit-exact on linux x86-64 glibc
cargo test -p sister-h3 --features libm --locked  # portable libm, within documented bounds
yarn check:libm-wasm        # native with the libm feature equals the WASM build bit for bit
yarn stress:boundary        # cell flips near edges, platform libm vs the libm crate
yarn test:runtimes          # Node, Worker bundle, wrangler dev, Vite and webpack in Chromium
yarn test:package           # packed tarball and native crate in clean consumers
yarn benchmark              # see benchmarks/
H3_C_SOURCE=/path/to/h3 yarn generate:fixtures   # only to regenerate C reference fixtures
```

`docs/build.md` lists the pinned toolchain and prerequisites, `docs/api-decisions.md` the API
contract, and `docs/implementation-status.md` what has been verified. Licensed under MIT; portions translated from H3 remain subject to the Apache License 2.0 (`LICENSE-APACHE-2.0`);
see `NOTICE` and `THIRD_PARTY_NOTICES.md`.

## API reference

The [JavaScript reference](docs/api-reference.md) contains signatures and descriptions generated from
this package's declarations. The same descriptions appear in editor tooltips.
[API decisions](docs/api-decisions.md) describe validation, errors, resource limits, reproducibility,
and intentional differences from h3-js.
