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

### Errors

| Situation                                                                                                                                   | Error                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Wrong argument type                                                                                                                         | `TypeError`                                                                       |
| Out-of-range or fractional resolution, negative ring size, malformed index, non-finite coordinate, unknown unit or flag, non-boolean switch | `RangeError`                                                                      |
| The H3 algorithm rejects a value (invalid cell bits, pentagon distortion, not neighbors, ...)                                               | `Error` with `name: "H3Error"` and the numeric C `code`                           |
| First-use instantiation is not allowed by the environment (see Initialization)                                                              | `Error` with `name: "H3InitializationError"`                                      |
| Request over a resource limit                                                                                                               | `RangeError` with `name: "H3ResourceLimitError"`, `limit`, `requested`, `maximum` |

`isValidCell`, `isValidIndex`, `isValidDirectedEdge`, and `isValidVertex` never throw after
initialization. `isPentagon` and `isResClassIII` return `false`, and `getResolution` returns `-1`,
for values that are not valid cells. No function returns `null` as a failure sentinel.

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

Indexes are computed from those coordinates, so a point that lies within about 1e-14 radians of a
cell edge can be assigned to a different cell by a different libm. No committed fixture hits such
a point, and they are rare. Cross-machine identical integer output is promised only by the
WebAssembly build and by the `libm` feature at a pinned crate version. If you store derived data
and need reruns on another machine to match exactly, enable the feature (Cargo features are
additive: if any crate in your build enables it, it is on for all). The polygon order of
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
yarn test:runtimes          # Node, Worker bundle, wrangler dev, Vite and webpack in Chromium
yarn test:package           # packed tarball and native crate in clean consumers
yarn benchmark              # see benchmarks/
H3_C_SOURCE=/path/to/h3 yarn generate:fixtures   # only to regenerate C reference fixtures
```

`docs/build.md` lists the pinned toolchain and prerequisites, `docs/api-decisions.md` the API
contract, and `docs/implementation-status.md` what has been verified. Licensed under MIT; portions translated from H3 remain subject to the Apache License 2.0 (`LICENSE-APACHE-2.0`);
see `NOTICE` and `THIRD_PARTY_NOTICES.md`.

## API Reference

The reference below is adapted from h3-js. Where it differs from `docs/api-decisions.md` (errors,
initialization, argument validation), the decisions document is authoritative.

<a name="module_h3"></a>

## h3

- [@sister.software/h3](#sistersoftwareh3)
  - [Usage](#usage)
    - [Useful algorithms](#useful-algorithms)
  - [API Reference](#api-reference)
  - [h3](#h3)
    - [h3.UNITS](#h3units)
    - [h3.POLYGON\_TO\_CELLS\_FLAGS](#h3polygon_to_cells_flags)
    - [h3.h3IndexToSplitLong(h3Index) ⇒ SplitLong](#h3h3indextosplitlongh3index--splitlong)
    - [h3.splitLongToH3Index(lower, upper) ⇒ H3Index](#h3splitlongtoh3indexlower-upper--h3index)
    - [h3.isValidCell(h3Index) ⇒ boolean](#h3isvalidcellh3index--boolean)
    - [h3.isValidIndex(h3Index) ⇒ boolean](#h3isvalidindexh3index--boolean)
    - [h3.isPentagon(h3Index) ⇒ boolean](#h3ispentagonh3index--boolean)
    - [h3.isResClassIII(h3Index) ⇒ boolean](#h3isresclassiiih3index--boolean)
    - [h3.getBaseCellNumber(h3Index) ⇒ number](#h3getbasecellnumberh3index--number)
    - [h3.getIndexDigit(h3Index, digit) ⇒ number](#h3getindexdigith3index-digit--number)
    - [h3.getIcosahedronFaces(h3Index) ⇒ Array.\<number\>](#h3geticosahedronfacesh3index--arraynumber)
    - [h3.getResolution(h3Index) ⇒ number](#h3getresolutionh3index--number)
    - [h3.constructCell(baseCellNumber, digits, res) ⇒ H3Index](#h3constructcellbasecellnumber-digits-res--h3index)
    - [h3.latLngToCell(lat, lng, res) ⇒ H3Index](#h3latlngtocelllat-lng-res--h3index)
    - [h3.cellToLatLng(h3Index) ⇒ CoordPair](#h3celltolatlngh3index--coordpair)
    - [h3.cellToBoundary(h3Index, \[formatAsGeoJson\]) ⇒ Array.\<CoordPair\>](#h3celltoboundaryh3index-formatasgeojson--arraycoordpair)
    - [h3.cellToParent(h3Index, res) ⇒ H3Index](#h3celltoparenth3index-res--h3index)
    - [h3.cellToChildren(h3Index, res) ⇒ Array.\<H3Index\>](#h3celltochildrenh3index-res--arrayh3index)
    - [h3.cellToChildrenSize(h3Index, res) ⇒ number](#h3celltochildrensizeh3index-res--number)
    - [h3.cellToCenterChild(h3Index, res) ⇒ H3Index](#h3celltocenterchildh3index-res--h3index)
    - [h3.cellToChildPos(h3Index, parentRes) ⇒ number](#h3celltochildposh3index-parentres--number)
    - [h3.childPosToCell(childPos, h3Index, childRes) ⇒ H3Index](#h3childpostocellchildpos-h3index-childres--h3index)
    - [h3.gridDisk(h3Index, ringSize) ⇒ Array.\<H3Index\>](#h3griddiskh3index-ringsize--arrayh3index)
    - [h3.gridDiskDistances(h3Index, ringSize) ⇒ Array.\<Array.\<H3Index\>\>](#h3griddiskdistancesh3index-ringsize--arrayarrayh3index)
    - [h3.gridRing(h3Index, ringSize) ⇒ Array.\<H3Index\>](#h3gridringh3index-ringsize--arrayh3index)
    - [h3.gridRingUnsafe(h3Index, ringSize) ⇒ Array.\<H3Index\>](#h3gridringunsafeh3index-ringsize--arrayh3index)
    - [h3.polygonToCells(coordinates, res, \[isGeoJson\]) ⇒ Array.\<H3Index\>](#h3polygontocellscoordinates-res-isgeojson--arrayh3index)
    - [h3.polygonToCellsExperimental(coordinates, res, flags, \[isGeoJson\]) ⇒ Array.\<H3Index\>](#h3polygontocellsexperimentalcoordinates-res-flags-isgeojson--arrayh3index)
    - [h3.cellsToMultiPolygon(h3Indexes, \[formatAsGeoJson\]) ⇒ Array.\<Array.\<Array.\<CoordPair\>\>\>](#h3cellstomultipolygonh3indexes-formatasgeojson--arrayarrayarraycoordpair)
    - [h3.compactCells(h3Set) ⇒ Array.\<H3Index\>](#h3compactcellsh3set--arrayh3index)
    - [h3.uncompactCells(compactedSet, res) ⇒ Array.\<H3Index\>](#h3uncompactcellscompactedset-res--arrayh3index)
    - [h3.areNeighborCells(origin, destination) ⇒ boolean](#h3areneighborcellsorigin-destination--boolean)
    - [h3.cellsToDirectedEdge(origin, destination) ⇒ H3Index](#h3cellstodirectededgeorigin-destination--h3index)
    - [h3.getDirectedEdgeOrigin(edgeIndex) ⇒ H3Index](#h3getdirectededgeoriginedgeindex--h3index)
    - [h3.getDirectedEdgeDestination(edgeIndex) ⇒ H3Index](#h3getdirectededgedestinationedgeindex--h3index)
    - [h3.isValidDirectedEdge(edgeIndex) ⇒ boolean](#h3isvaliddirectededgeedgeindex--boolean)
    - [h3.directedEdgeToCells(edgeIndex) ⇒ Array.\<H3Index\>](#h3directededgetocellsedgeindex--arrayh3index)
    - [h3.originToDirectedEdges(h3Index) ⇒ Array.\<H3Index\>](#h3origintodirectededgesh3index--arrayh3index)
    - [h3.directedEdgeToBoundary(edgeIndex, \[formatAsGeoJson\]) ⇒ Array.\<CoordPair\>](#h3directededgetoboundaryedgeindex-formatasgeojson--arraycoordpair)
    - [h3.reverseDirectedEdge(edgeIndex) ⇒ H3Index](#h3reversedirectededgeedgeindex--h3index)
    - [h3.gridDistance(origin, destination) ⇒ number](#h3griddistanceorigin-destination--number)
    - [h3.gridPathCells(origin, destination) ⇒ Array.\<H3Index\>](#h3gridpathcellsorigin-destination--arrayh3index)
    - [h3.cellToLocalIj(origin, destination) ⇒ CoordIJ](#h3celltolocalijorigin-destination--coordij)
    - [h3.localIjToCell(origin, coords) ⇒ H3Index](#h3localijtocellorigin-coords--h3index)
    - [h3.greatCircleDistance(latLng1, latLng2, unit) ⇒ number](#h3greatcircledistancelatlng1-latlng2-unit--number)
    - [h3.cellArea(h3Index, unit) ⇒ number](#h3cellareah3index-unit--number)
    - [h3.edgeLength(edge, unit) ⇒ number](#h3edgelengthedge-unit--number)
    - [h3.getHexagonAreaAvg(res, unit) ⇒ number](#h3gethexagonareaavgres-unit--number)
    - [h3.getHexagonEdgeLengthAvg(res, unit) ⇒ number](#h3gethexagonedgelengthavgres-unit--number)
    - [h3.cellToVertex(h3Index, vertexNum) ⇒ H3Index](#h3celltovertexh3index-vertexnum--h3index)
    - [h3.cellToVertexes(h3Index) ⇒ Array.\<H3Index\>](#h3celltovertexesh3index--arrayh3index)
    - [h3.vertexToLatLng(h3Index) ⇒ CoordPair](#h3vertextolatlngh3index--coordpair)
    - [h3.isValidVertex(h3Index) ⇒ boolean](#h3isvalidvertexh3index--boolean)
    - [h3.getNumCells(res) ⇒ number](#h3getnumcellsres--number)
    - [h3.getRes0Cells() ⇒ Array.\<H3Index\>](#h3getres0cells--arrayh3index)
    - [h3.getPentagons(res) ⇒ Array.\<H3Index\>](#h3getpentagonsres--arrayh3index)
    - [h3.degsToRads(deg) ⇒ number](#h3degstoradsdeg--number)
    - [h3.radsToDegs(rad) ⇒ number](#h3radstodegsrad--number)
    - [h3.H3Index : string](#h3h3index--string)
    - [h3.H3IndexInput : string | Array.\<number\>](#h3h3indexinput--string--arraynumber)
    - [h3.CoordIJ](#h3coordij)
    - [h3.H3Error](#h3h3error)
    - [h3.CoordPair : Array.\<number\>](#h3coordpair--arraynumber)
    - [h3.SplitLong : Array.\<number\>](#h3splitlong--arraynumber)
    - [Benchmarks](#benchmarks)

---

<a name="module_h3.UNITS"></a>

### h3.UNITS

Length/Area units

**Properties**

| Name  | Type                |
| ----- | ------------------- |
| m     | <code>string</code> |
| m2    | <code>string</code> |
| km    | <code>string</code> |
| km2   | <code>string</code> |
| rads  | <code>string</code> |
| rads2 | <code>string</code> |

---

<a name="module_h3.POLYGON_TO_CELLS_FLAGS"></a>

### h3.POLYGON\_TO\_CELLS\_FLAGS

Mode flags for polygonToCells

**Properties**

| Name                       | Type                |
| -------------------------- | ------------------- |
| containmentCenter          | <code>string</code> |
| containmentFull            | <code>string</code> |
| containmentOverlapping     | <code>string</code> |
| containmentOverlappingBbox | <code>string</code> |

---

<a name="module_h3.h3IndexToSplitLong"></a>

### h3.h3IndexToSplitLong(h3Index) ⇒ <code>SplitLong</code>

Convert an H3 index (64-bit hexidecimal string) into a "split long" - a pair of 32-bit ints

**Returns**: <code>SplitLong</code> - A two-element array with 32 lower bits and 32 upper bits

| Param   | Type                      | Description       |
| ------- | ------------------------- | ----------------- |
| h3Index | <code>H3IndexInput</code> | H3 index to check |

---

<a name="module_h3.splitLongToH3Index"></a>

### h3.splitLongToH3Index(lower, upper) ⇒ <code>H3Index</code>

Get a H3 index string from a split long (pair of 32-bit ints)

**Returns**: <code>H3Index</code> - H3 index

| Param | Type                | Description   |
| ----- | ------------------- | ------------- |
| lower | <code>number</code> | Lower 32 bits |
| upper | <code>number</code> | Upper 32 bits |

---

<a name="module_h3.isValidCell"></a>

### h3.isValidCell(h3Index) ⇒ <code>boolean</code>

Whether a given string represents a valid H3 cell index

**Returns**: <code>boolean</code> - Whether the cell index is valid

| Param   | Type                      | Description       |
| ------- | ------------------------- | ----------------- |
| h3Index | <code>H3IndexInput</code> | H3 index to check |

---

<a name="module_h3.isValidIndex"></a>

### h3.isValidIndex(h3Index) ⇒ <code>boolean</code>

Whether a given string represents a valid H3 index
(e.g. it may be a cell, directed edge, vertex.)
Use <code>isValidCell</code> to check for a valid
hexagon (or pentagon) cell ID.

**Returns**: <code>boolean</code> - Whether the index is valid

| Param   | Type                      | Description       |
| ------- | ------------------------- | ----------------- |
| h3Index | <code>H3IndexInput</code> | H3 index to check |

---

<a name="module_h3.isPentagon"></a>

### h3.isPentagon(h3Index) ⇒ <code>boolean</code>

Whether the given H3 index is a pentagon

**Returns**: <code>boolean</code> - isPentagon

| Param   | Type                      | Description       |
| ------- | ------------------------- | ----------------- |
| h3Index | <code>H3IndexInput</code> | H3 index to check |

---

<a name="module_h3.isResClassIII"></a>

### h3.isResClassIII(h3Index) ⇒ <code>boolean</code>

Whether the given H3 index is in a Class III resolution (rotated versus
the icosahedron and subject to shape distortion adding extra points on
icosahedron edges, making them not true hexagons).

**Returns**: <code>boolean</code> - isResClassIII

| Param   | Type                      | Description       |
| ------- | ------------------------- | ----------------- |
| h3Index | <code>H3IndexInput</code> | H3 index to check |

---

<a name="module_h3.getBaseCellNumber"></a>

### h3.getBaseCellNumber(h3Index) ⇒ <code>number</code>

Get the number of the base cell for a given H3 index

**Returns**: <code>number</code> - Index of the base cell (0-121)

| Param   | Type                      | Description                       |
| ------- | ------------------------- | --------------------------------- |
| h3Index | <code>H3IndexInput</code> | H3 index to get the base cell for |

---

<a name="module_h3.getIndexDigit"></a>

### h3.getIndexDigit(h3Index, digit) ⇒ <code>number</code>

Get the number of the indexing digit for an H3 index

**Returns**: <code>number</code> - Digit (0-7)

| Param   | Type                      | Description                        |
| ------- | ------------------------- | ---------------------------------- |
| h3Index | <code>H3IndexInput</code> | H3 index to get the digit for      |
| digit   | <code>number</code>       | Indexing digit to get the valeu of |

---

<a name="module_h3.getIcosahedronFaces"></a>

### h3.getIcosahedronFaces(h3Index) ⇒ <code>Array.&lt;number&gt;</code>

Get the indices of all icosahedron faces intersected by a given H3 index

**Returns**: <code>Array.&lt;number&gt;</code> - Indices (0-19) of all intersected faces
**Throws**:

- <code>H3Error</code> If input is invalid

| Param   | Type                      | Description               |
| ------- | ------------------------- | ------------------------- |
| h3Index | <code>H3IndexInput</code> | H3 index to get faces for |

---

<a name="module_h3.getResolution"></a>

### h3.getResolution(h3Index) ⇒ <code>number</code>

Returns the resolution of an H3 index

**Returns**: <code>number</code> - The number (0-15) resolution, or -1 if invalid

| Param   | Type                      | Description                |
| ------- | ------------------------- | -------------------------- |
| h3Index | <code>H3IndexInput</code> | H3 index to get resolution |

---

<a name="module_h3.constructCell"></a>

### h3.constructCell(baseCellNumber, digits, res) ⇒ <code>H3Index</code>

Creates a cell from its components (resolution, base cell number, and indexing digits).
This is the inverse operation of `getResolution`, `getBaseCellNumber`, and `getIndexDigit`.
Only allows creating valid cells.

**Returns**: <code>H3Index</code> - H3 index
**Throws**:

- <code>H3Error</code> If input is invalid

| Param          | Type                              | Description                                                                             |
| -------------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| baseCellNumber | <code>number</code>               | Base cell number of cell to return                                                      |
| digits         | <code>Array.&lt;number&gt;</code> | Indexing digits of cell to return                                                       |
| res            | <code>number</code>               | Resolution of cell to return. Optional, if not specified, will be inferred from digits. |

---

<a name="module_h3.latLngToCell"></a>

### h3.latLngToCell(lat, lng, res) ⇒ <code>H3Index</code>

Get the hexagon (or pentagon) containing a lat,lon point

**Returns**: <code>H3Index</code> - H3 index
**Throws**:

- <code>H3Error</code> If input is invalid

| Param | Type                | Description                  |
| ----- | ------------------- | ---------------------------- |
| lat   | <code>number</code> | Latitude of point            |
| lng   | <code>number</code> | Longtitude of point          |
| res   | <code>number</code> | Resolution of cell to return |

---

<a name="module_h3.cellToLatLng"></a>

### h3.cellToLatLng(h3Index) ⇒ <code>CoordPair</code>

Get the lat,lon center of a given hexagon (or pentagon)

**Returns**: <code>CoordPair</code> - Point as a [lat, lng] pair
**Throws**:

- <code>H3Error</code> If input is invalid

| Param   | Type                      | Description |
| ------- | ------------------------- | ----------- |
| h3Index | <code>H3IndexInput</code> | H3 index    |

---

<a name="module_h3.cellToBoundary"></a>

### h3.cellToBoundary(h3Index, [formatAsGeoJson]) ⇒ <code>Array.&lt;CoordPair&gt;</code>

Get the vertices of a given hexagon (or pentagon), as an array of [lat, lng]
points. For pentagons and hexagons on the edge of an icosahedron face, this
function may return up to 10 vertices.

**Returns**: <code>Array.&lt;CoordPair&gt;</code> - Array of [lat, lng] pairs
**Throws**:

- <code>H3Error</code> If input is invalid

| Param             | Type                      | Description                                                 |
| ----------------- | ------------------------- | ----------------------------------------------------------- |
| h3Index           | <code>H3IndexInput</code> | H3 index                                                    |
| [formatAsGeoJson] | <code>boolean</code>      | Whether to provide GeoJSON output: [lng, lat], closed loops |

---

<a name="module_h3.cellToParent"></a>

### h3.cellToParent(h3Index, res) ⇒ <code>H3Index</code>

Get the parent of the given hexagon at a particular resolution

**Returns**: <code>H3Index</code> - H3 index of parent
**Throws**:

- <code>H3Error</code> If input is invalid

| Param   | Type                      | Description                     |
| ------- | ------------------------- | ------------------------------- |
| h3Index | <code>H3IndexInput</code> | H3 index to get parent for      |
| res     | <code>number</code>       | Resolution of hexagon to return |

---

<a name="module_h3.cellToChildren"></a>

### h3.cellToChildren(h3Index, res) ⇒ <code>Array.&lt;H3Index&gt;</code>

Get the children/descendents of the given hexagon at a particular resolution

**Returns**: <code>Array.&lt;H3Index&gt;</code> - H3 indexes of children, or empty array for invalid input
**Throws**:

- <code>H3Error</code> If resolution is invalid or output is too large for JS

| Param   | Type                      | Description                      |
| ------- | ------------------------- | -------------------------------- |
| h3Index | <code>H3IndexInput</code> | H3 index to get children for     |
| res     | <code>number</code>       | Resolution of hexagons to return |

---

<a name="module_h3.cellToChildrenSize"></a>

### h3.cellToChildrenSize(h3Index, res) ⇒ <code>number</code>

Get the number of children for a cell at a given resolution

**Returns**: <code>number</code> - Number of children at res for the given cell
**Throws**:

- <code>H3Error</code> If cell or parentRes are invalid

| Param   | Type                      | Description                     |
| ------- | ------------------------- | ------------------------------- |
| h3Index | <code>H3IndexInput</code> | H3 index to get child count for |
| res     | <code>number</code>       | Child resolution                |

---

<a name="module_h3.cellToCenterChild"></a>

### h3.cellToCenterChild(h3Index, res) ⇒ <code>H3Index</code>

Get the center child of the given hexagon at a particular resolution

**Returns**: <code>H3Index</code> - H3 index of child
**Throws**:

- <code>H3Error</code> If resolution is invalid

| Param   | Type                      | Description                      |
| ------- | ------------------------- | -------------------------------- |
| h3Index | <code>H3IndexInput</code> | H3 index to get center child for |
| res     | <code>number</code>       | Resolution of cell to return     |

---

<a name="module_h3.cellToChildPos"></a>

### h3.cellToChildPos(h3Index, parentRes) ⇒ <code>number</code>

Get the position of the cell within an ordered list of all children of the
cell's parent at the specified resolution.

**Returns**: <code>number</code> - Position of child within parent at parentRes
**Throws**:

- <code>H3Error</code> If cell or parentRes are invalid

| Param     | Type                      | Description                    |
| --------- | ------------------------- | ------------------------------ |
| h3Index   | <code>H3IndexInput</code> | H3 index to get child pos for  |
| parentRes | <code>number</code>       | Resolution of reference parent |

---

<a name="module_h3.childPosToCell"></a>

### h3.childPosToCell(childPos, h3Index, childRes) ⇒ <code>H3Index</code>

Get the child cell at a given position within an ordered list of all children
at the specified resolution

**Returns**: <code>H3Index</code> - H3 index of child
**Throws**:

- <code>H3Error</code> If input is invalid

| Param    | Type                      | Description                        |
| -------- | ------------------------- | ---------------------------------- |
| childPos | <code>number</code>       | Position of the child cell to get  |
| h3Index  | <code>H3IndexInput</code> | H3 index of the parent cell        |
| childRes | <code>number</code>       | Resolution of child cell to return |

---

<a name="module_h3.gridDisk"></a>

### h3.gridDisk(h3Index, ringSize) ⇒ <code>Array.&lt;H3Index&gt;</code>

Get all hexagons in a k-ring around a given center. The order of the hexagons is undefined.

**Returns**: <code>Array.&lt;H3Index&gt;</code> - H3 indexes for all hexagons in ring
**Throws**:

- <code>H3Error</code> If input is invalid or output is too large to allocate

| Param    | Type                      | Description                |
| -------- | ------------------------- | -------------------------- |
| h3Index  | <code>H3IndexInput</code> | H3 index of center hexagon |
| ringSize | <code>number</code>       | Radius of k-ring           |

---

<a name="module_h3.gridDiskDistances"></a>

### h3.gridDiskDistances(h3Index, ringSize) ⇒ <code>Array.&lt;Array.&lt;H3Index&gt;&gt;</code>

Get all hexagons in a k-ring around a given center, in an array of arrays
ordered by distance from the origin. The order of the hexagons within each ring is undefined.

**Returns**: <code>Array.&lt;Array.&lt;H3Index&gt;&gt;</code> - Array of arrays with H3 indexes for all hexagons each ring
**Throws**:

- <code>H3Error</code> If input is invalid or output is too large to allocate

| Param    | Type                      | Description                |
| -------- | ------------------------- | -------------------------- |
| h3Index  | <code>H3IndexInput</code> | H3 index of center hexagon |
| ringSize | <code>number</code>       | Radius of k-ring           |

---

<a name="module_h3.gridRing"></a>

### h3.gridRing(h3Index, ringSize) ⇒ <code>Array.&lt;H3Index&gt;</code>

Get all hexagons in a hollow hexagonal ring centered at origin with sides of a given length.

**Returns**: <code>Array.&lt;H3Index&gt;</code> - H3 indexes for all hexagons in ring
**Throws**:

- <code>Error</code> If the algorithm could not calculate the ring
- <code>H3Error</code> If input is invalid

| Param    | Type                      | Description                |
| -------- | ------------------------- | -------------------------- |
| h3Index  | <code>H3IndexInput</code> | H3 index of center hexagon |
| ringSize | <code>number</code>       | Radius of ring             |

---

<a name="module_h3.gridRingUnsafe"></a>

### h3.gridRingUnsafe(h3Index, ringSize) ⇒ <code>Array.&lt;H3Index&gt;</code>

Get all hexagons in a hollow hexagonal ring centered at origin with sides of a given length.
Unlike gridDisk, this function will throw an error if there is a pentagon anywhere in the ring.

**Returns**: <code>Array.&lt;H3Index&gt;</code> - H3 indexes for all hexagons in ring
**Throws**:

- <code>Error</code> If the algorithm could not calculate the ring
- <code>H3Error</code> If input is invalid

| Param    | Type                      | Description                |
| -------- | ------------------------- | -------------------------- |
| h3Index  | <code>H3IndexInput</code> | H3 index of center hexagon |
| ringSize | <code>number</code>       | Radius of ring             |

---

<a name="module_h3.polygonToCells"></a>

### h3.polygonToCells(coordinates, res, [isGeoJson]) ⇒ <code>Array.&lt;H3Index&gt;</code>

Get all hexagons with centers contained in a given polygon. The polygon
is specified with GeoJson semantics as an array of loops. Each loop is
an array of [lat, lng] pairs (or [lng, lat] if isGeoJson is specified).
The first loop is the perimeter of the polygon, and subsequent loops are
expected to be holes.

**Returns**: <code>Array.&lt;H3Index&gt;</code> - H3 indexes for all hexagons in polygon
**Throws**:

- <code>H3Error</code> If input is invalid or output is too large for JS

| Param       | Type                                                                                                             | Description                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| coordinates | <code>Array.&lt;Array.&lt;number&gt;&gt;</code> \| <code>Array.&lt;Array.&lt;Array.&lt;number&gt;&gt;&gt;</code> | Array of loops, or a single loop                                       |
| res         | <code>number</code>                                                                                              | Resolution of hexagons to return                                       |
| [isGeoJson] | <code>boolean</code>                                                                                             | Whether to expect GeoJson-style [lng, lat] pairs instead of [lat, lng] |

---

<a name="module_h3.polygonToCellsExperimental"></a>

### h3.polygonToCellsExperimental(coordinates, res, flags, [isGeoJson]) ⇒ <code>Array.&lt;H3Index&gt;</code>

Get all hexagons with centers contained in a given polygon. The polygon
is specified with GeoJson semantics as an array of loops. Each loop is
an array of [lat, lng] pairs (or [lng, lat] if isGeoJson is specified).
The first loop is the perimeter of the polygon, and subsequent loops are
expected to be holes.

**Returns**: <code>Array.&lt;H3Index&gt;</code> - H3 indexes for all hexagons in polygon
**Throws**:

- <code>H3Error</code> If input is invalid or output is too large for JS

| Param       | Type                                                                                                             | Description                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| coordinates | <code>Array.&lt;Array.&lt;number&gt;&gt;</code> \| <code>Array.&lt;Array.&lt;Array.&lt;number&gt;&gt;&gt;</code> | Array of loops, or a single loop                                       |
| res         | <code>number</code>                                                                                              | Resolution of hexagons to return                                       |
| flags       | <code>string</code>                                                                                              | Value from POLYGON_TO_CELLS_FLAGS                                      |
| [isGeoJson] | <code>boolean</code>                                                                                             | Whether to expect GeoJson-style [lng, lat] pairs instead of [lat, lng] |

---

<a name="module_h3.cellsToMultiPolygon"></a>

### h3.cellsToMultiPolygon(h3Indexes, [formatAsGeoJson]) ⇒ <code>Array.&lt;Array.&lt;Array.&lt;CoordPair&gt;&gt;&gt;</code>

Get the outlines of a set of H3 hexagons, returned in GeoJSON MultiPolygon
format (an array of polygons, each with an array of loops, each an array of
coordinates). Coordinates are returned as [lat, lng] pairs unless GeoJSON
is requested.

It is the responsibility of the caller to ensure that all hexagons in the
set have the same resolution and that the set contains no duplicates. Behavior
is undefined if duplicates or multiple resolutions are present, and the
algorithm may produce unexpected or invalid polygons.

**Returns**: <code>Array.&lt;Array.&lt;Array.&lt;CoordPair&gt;&gt;&gt;</code> - MultiPolygon-style output.
**Throws**:

- <code>H3Error</code> If input is invalid

| Param             | Type                                    | Description                                                 |
| ----------------- | --------------------------------------- | ----------------------------------------------------------- |
| h3Indexes         | <code>Array.&lt;H3IndexInput&gt;</code> | H3 indexes to get outlines for                              |
| [formatAsGeoJson] | <code>boolean</code>                    | Whether to provide GeoJSON output: [lng, lat], closed loops |

---

<a name="module_h3.compactCells"></a>

### h3.compactCells(h3Set) ⇒ <code>Array.&lt;H3Index&gt;</code>

Compact a set of hexagons of the same resolution into a set of hexagons across
multiple levels that represents the same area.

**Returns**: <code>Array.&lt;H3Index&gt;</code> - Compacted H3 indexes
**Throws**:

- <code>H3Error</code> If the input is invalid (e.g. duplicate hexagons)

| Param | Type                                    | Description           |
| ----- | --------------------------------------- | --------------------- |
| h3Set | <code>Array.&lt;H3IndexInput&gt;</code> | H3 indexes to compact |

---

<a name="module_h3.uncompactCells"></a>

### h3.uncompactCells(compactedSet, res) ⇒ <code>Array.&lt;H3Index&gt;</code>

Uncompact a compacted set of hexagons to hexagons of the same resolution

**Returns**: <code>Array.&lt;H3Index&gt;</code> - The uncompacted H3 indexes
**Throws**:

- <code>H3Error</code> If the input is invalid (e.g. invalid resolution)

| Param        | Type                                    | Description                    |
| ------------ | --------------------------------------- | ------------------------------ |
| compactedSet | <code>Array.&lt;H3IndexInput&gt;</code> | H3 indexes to uncompact        |
| res          | <code>number</code>                     | The resolution to uncompact to |

---

<a name="module_h3.areNeighborCells"></a>

### h3.areNeighborCells(origin, destination) ⇒ <code>boolean</code>

Whether two H3 indexes are neighbors (share an edge)

**Returns**: <code>boolean</code> - Whether the hexagons share an edge
**Throws**:

- <code>H3Error</code> If the input is invalid

| Param       | Type                      | Description               |
| ----------- | ------------------------- | ------------------------- |
| origin      | <code>H3IndexInput</code> | Origin hexagon index      |
| destination | <code>H3IndexInput</code> | Destination hexagon index |

---

<a name="module_h3.cellsToDirectedEdge"></a>

### h3.cellsToDirectedEdge(origin, destination) ⇒ <code>H3Index</code>

Get an H3 index representing a unidirectional edge for a given origin and destination

**Returns**: <code>H3Index</code> - H3 index of the edge; throws `H3Error` (code 11) if the cells are not neighbors
**Throws**:

- <code>H3Error</code> If the input is invalid

| Param       | Type                      | Description               |
| ----------- | ------------------------- | ------------------------- |
| origin      | <code>H3IndexInput</code> | Origin hexagon index      |
| destination | <code>H3IndexInput</code> | Destination hexagon index |

---

<a name="module_h3.getDirectedEdgeOrigin"></a>

### h3.getDirectedEdgeOrigin(edgeIndex) ⇒ <code>H3Index</code>

Get the origin hexagon from an H3 index representing a unidirectional edge

**Returns**: <code>H3Index</code> - H3 index of the edge origin
**Throws**:

- <code>H3Error</code> If the input is invalid

| Param     | Type                      | Description          |
| --------- | ------------------------- | -------------------- |
| edgeIndex | <code>H3IndexInput</code> | H3 index of the edge |

---

<a name="module_h3.getDirectedEdgeDestination"></a>

### h3.getDirectedEdgeDestination(edgeIndex) ⇒ <code>H3Index</code>

Get the destination hexagon from an H3 index representing a unidirectional edge

**Returns**: <code>H3Index</code> - H3 index of the edge destination
**Throws**:

- <code>H3Error</code> If the input is invalid

| Param     | Type                      | Description          |
| --------- | ------------------------- | -------------------- |
| edgeIndex | <code>H3IndexInput</code> | H3 index of the edge |

---

<a name="module_h3.isValidDirectedEdge"></a>

### h3.isValidDirectedEdge(edgeIndex) ⇒ <code>boolean</code>

Whether the input is a valid unidirectional edge

**Returns**: <code>boolean</code> - Whether the index is valid

| Param     | Type                      | Description          |
| --------- | ------------------------- | -------------------- |
| edgeIndex | <code>H3IndexInput</code> | H3 index of the edge |

---

<a name="module_h3.directedEdgeToCells"></a>

### h3.directedEdgeToCells(edgeIndex) ⇒ <code>Array.&lt;H3Index&gt;</code>

Get the [origin, destination] pair represented by a unidirectional edge

**Returns**: <code>Array.&lt;H3Index&gt;</code> - [origin, destination] pair as H3 indexes
**Throws**:

- <code>H3Error</code> If the input is invalid

| Param     | Type                      | Description          |
| --------- | ------------------------- | -------------------- |
| edgeIndex | <code>H3IndexInput</code> | H3 index of the edge |

---

<a name="module_h3.originToDirectedEdges"></a>

### h3.originToDirectedEdges(h3Index) ⇒ <code>Array.&lt;H3Index&gt;</code>

Get all of the unidirectional edges with the given H3 index as the origin (i.e. an edge to
every neighbor)

**Returns**: <code>Array.&lt;H3Index&gt;</code> - List of unidirectional edges
**Throws**:

- <code>H3Error</code> If the input is invalid

| Param   | Type                      | Description                    |
| ------- | ------------------------- | ------------------------------ |
| h3Index | <code>H3IndexInput</code> | H3 index of the origin hexagon |

---

<a name="module_h3.directedEdgeToBoundary"></a>

### h3.directedEdgeToBoundary(edgeIndex, [formatAsGeoJson]) ⇒ <code>Array.&lt;CoordPair&gt;</code>

Get the vertices of a given edge as an array of [lat, lng] points. Note that for edges that
cross the edge of an icosahedron face, this may return 3 coordinates.

**Returns**: <code>Array.&lt;CoordPair&gt;</code> - Array of geo coordinate pairs
**Throws**:

- <code>H3Error</code> If the input is invalid

| Param             | Type                      | Description                                   |
| ----------------- | ------------------------- | --------------------------------------------- |
| edgeIndex         | <code>H3IndexInput</code> | H3 index of the edge                          |
| [formatAsGeoJson] | <code>boolean</code>      | Whether to provide GeoJSON output: [lng, lat] |

---

<a name="module_h3.reverseDirectedEdge"></a>

### h3.reverseDirectedEdge(edgeIndex) ⇒ <code>H3Index</code>

Returns the directed edge with origin and destination cells reversed

**Returns**: <code>H3Index</code> - Directed edge, reversed
**Throws**:

- <code>H3Error</code> If input is invalid

| Param     | Type                      | Description         |
| --------- | ------------------------- | ------------------- |
| edgeIndex | <code>H3IndexInput</code> | Directed edge index |

---

<a name="module_h3.gridDistance"></a>

### h3.gridDistance(origin, destination) ⇒ <code>number</code>

Get the grid distance between two hex indexes. This function may fail
to find the distance between two indexes if they are very far apart or
on opposite sides of a pentagon.

**Returns**: <code>number</code> - Distance between hexagons
**Throws**:

- <code>H3Error</code> If input is invalid or the distance could not be calculated

| Param       | Type                      | Description               |
| ----------- | ------------------------- | ------------------------- |
| origin      | <code>H3IndexInput</code> | Origin hexagon index      |
| destination | <code>H3IndexInput</code> | Destination hexagon index |

---

<a name="module_h3.gridPathCells"></a>

### h3.gridPathCells(origin, destination) ⇒ <code>Array.&lt;H3Index&gt;</code>

Given two H3 indexes, return the line of indexes between them (inclusive).

This function may fail to find the line between two indexes, for
example if they are very far apart. It may also fail when finding
distances for indexes on opposite sides of a pentagon.

Notes:

- The specific output of this function should not be considered stable
  across library versions. The only guarantees the library provides are
  that the line length will be `h3Distance(start, end) + 1` and that
  every index in the line will be a neighbor of the preceding index.
- Lines are drawn in grid space, and may not correspond exactly to either
  Cartesian lines or great arcs.

**Returns**: <code>Array.&lt;H3Index&gt;</code> - H3 indexes connecting origin and destination
**Throws**:

- <code>H3Error</code> If input is invalid or the line cannot be calculated

| Param       | Type                      | Description               |
| ----------- | ------------------------- | ------------------------- |
| origin      | <code>H3IndexInput</code> | Origin hexagon index      |
| destination | <code>H3IndexInput</code> | Destination hexagon index |

---

<a name="module_h3.cellToLocalIj"></a>

### h3.cellToLocalIj(origin, destination) ⇒ <code>CoordIJ</code>

Produces IJ coordinates for an H3 index anchored by an origin.

- The coordinate space used by this function may have deleted
  regions or warping due to pentagonal distortion.
- Coordinates are only comparable if they come from the same
  origin index.
- Failure may occur if the index is too far away from the origin
  or if the index is on the other side of a pentagon.
- This function is experimental, and its output is not guaranteed
  to be compatible across different versions of H3.

**Returns**: <code>CoordIJ</code> - Coordinates as an `{i, j}` pair
**Throws**:

- <code>H3Error</code> If the IJ coordinates cannot be calculated

| Param       | Type                      | Description                                     |
| ----------- | ------------------------- | ----------------------------------------------- |
| origin      | <code>H3IndexInput</code> | Origin H3 index                                 |
| destination | <code>H3IndexInput</code> | H3 index for which to find relative coordinates |

---

<a name="module_h3.localIjToCell"></a>

### h3.localIjToCell(origin, coords) ⇒ <code>H3Index</code>

Produces an H3 index for IJ coordinates anchored by an origin.

- The coordinate space used by this function may have deleted
  regions or warping due to pentagonal distortion.
- Coordinates are only comparable if they come from the same
  origin index.
- Failure may occur if the index is too far away from the origin
  or if the index is on the other side of a pentagon.
- This function is experimental, and its output is not guaranteed
  to be compatible across different versions of H3.

**Returns**: <code>H3Index</code> - H3 index at the relative coordinates
**Throws**:

- <code>H3Error</code> If the H3 index cannot be calculated

| Param  | Type                      | Description                     |
| ------ | ------------------------- | ------------------------------- |
| origin | <code>H3IndexInput</code> | Origin H3 index                 |
| coords | <code>CoordIJ</code>      | Coordinates as an `{i, j}` pair |

---

<a name="module_h3.greatCircleDistance"></a>

### h3.greatCircleDistance(latLng1, latLng2, unit) ⇒ <code>number</code>

Great circle distance between two geo points. This is not specific to H3,
but is implemented in the library and provided here as a convenience.

**Returns**: <code>number</code> - Great circle distance
**Throws**:

- <code>H3Error</code> If the unit is invalid

| Param   | Type                              | Description                                             |
| ------- | --------------------------------- | ------------------------------------------------------- |
| latLng1 | <code>Array.&lt;number&gt;</code> | Origin coordinate as [lat, lng]                         |
| latLng2 | <code>Array.&lt;number&gt;</code> | Destination coordinate as [lat, lng]                    |
| unit    | <code>string</code>               | Distance unit (either UNITS.m, UNITS.km, or UNITS.rads) |

---

<a name="module_h3.cellArea"></a>

### h3.cellArea(h3Index, unit) ⇒ <code>number</code>

Exact area of a given cell

**Returns**: <code>number</code> - Cell area
**Throws**:

- <code>H3Error</code> If the input is invalid

| Param   | Type                      | Description                                                |
| ------- | ------------------------- | ---------------------------------------------------------- |
| h3Index | <code>H3IndexInput</code> | H3 index of the hexagon to measure                         |
| unit    | <code>string</code>       | Distance unit (either UNITS.m2, UNITS.km2, or UNITS.rads2) |

---

<a name="module_h3.edgeLength"></a>

### h3.edgeLength(edge, unit) ⇒ <code>number</code>

Calculate length of a given unidirectional edge

**Returns**: <code>number</code> - Cell area
**Throws**:

- <code>H3Error</code> If the input is invalid

| Param | Type                      | Description                                             |
| ----- | ------------------------- | ------------------------------------------------------- |
| edge  | <code>H3IndexInput</code> | H3 index of the edge to measure                         |
| unit  | <code>string</code>       | Distance unit (either UNITS.m, UNITS.km, or UNITS.rads) |

---

<a name="module_h3.getHexagonAreaAvg"></a>

### h3.getHexagonAreaAvg(res, unit) ⇒ <code>number</code>

Average hexagon area at a given resolution

**Returns**: <code>number</code> - Average area
**Throws**:

- <code>H3Error</code> If the input is invalid

| Param | Type                | Description                                            |
| ----- | ------------------- | ------------------------------------------------------ |
| res   | <code>number</code> | Hexagon resolution                                     |
| unit  | <code>string</code> | Area unit (either UNITS.m2, UNITS.km2, or UNITS.rads2) |

---

<a name="module_h3.getHexagonEdgeLengthAvg"></a>

### h3.getHexagonEdgeLengthAvg(res, unit) ⇒ <code>number</code>

Average hexagon edge length at a given resolution

**Returns**: <code>number</code> - Average edge length
**Throws**:

- <code>H3Error</code> If the input is invalid

| Param | Type                | Description                                             |
| ----- | ------------------- | ------------------------------------------------------- |
| res   | <code>number</code> | Hexagon resolution                                      |
| unit  | <code>string</code> | Distance unit (either UNITS.m, UNITS.km, or UNITS.rads) |

---

<a name="module_h3.cellToVertex"></a>

### h3.cellToVertex(h3Index, vertexNum) ⇒ <code>H3Index</code>

Find the index for a vertex of a cell.

**Returns**: <code>H3Index</code> - Vertex index
**Throws**:

- <code>H3Error</code> If the input is invalid

| Param     | Type                      | Description                               |
| --------- | ------------------------- | ----------------------------------------- |
| h3Index   | <code>H3IndexInput</code> | Cell to find the vertex for               |
| vertexNum | <code>number</code>       | Number (index) of the vertex to calculate |

---

<a name="module_h3.cellToVertexes"></a>

### h3.cellToVertexes(h3Index) ⇒ <code>Array.&lt;H3Index&gt;</code>

Find the indexes for all vertexes of a cell.

**Returns**: <code>Array.&lt;H3Index&gt;</code> - All vertex indexes of this cell
**Throws**:

- <code>H3Error</code> If the input is invalid

| Param   | Type                      | Description                   |
| ------- | ------------------------- | ----------------------------- |
| h3Index | <code>H3IndexInput</code> | Cell to find all vertexes for |

---

<a name="module_h3.vertexToLatLng"></a>

### h3.vertexToLatLng(h3Index) ⇒ <code>CoordPair</code>

Get the lat, lng of a given vertex

**Returns**: <code>CoordPair</code> - Latitude, longitude coordinates of the vertex
**Throws**:

- <code>H3Error</code> If the input is invalid

| Param   | Type                      | Description    |
| ------- | ------------------------- | -------------- |
| h3Index | <code>H3IndexInput</code> | A vertex index |

---

<a name="module_h3.isValidVertex"></a>

### h3.isValidVertex(h3Index) ⇒ <code>boolean</code>

Returns true if the input is a valid vertex index.

**Returns**: <code>boolean</code> - True if the index represents a vertex

| Param   | Type                      | Description                               |
| ------- | ------------------------- | ----------------------------------------- |
| h3Index | <code>H3IndexInput</code> | An index to test for being a vertex index |

---

<a name="module_h3.getNumCells"></a>

### h3.getNumCells(res) ⇒ <code>number</code>

The total count of hexagons in the world at a given resolution. Note that above
resolution 8 the exact count cannot be represented in a JavaScript 32-bit number,
so consumers should use caution when applying further operations to the output.

**Returns**: <code>number</code> - Count
**Throws**:

- <code>H3Error</code> If the resolution is invalid

| Param | Type                | Description        |
| ----- | ------------------- | ------------------ |
| res   | <code>number</code> | Hexagon resolution |

---

<a name="module_h3.getRes0Cells"></a>

### h3.getRes0Cells() ⇒ <code>Array.&lt;H3Index&gt;</code>

Get all H3 indexes at resolution 0. As every index at every resolution > 0 is
the descendant of a res 0 index, this can be used with h3ToChildren to iterate
over H3 indexes at any resolution.

**Returns**: <code>Array.&lt;H3Index&gt;</code> - All H3 indexes at res 0

---

<a name="module_h3.getPentagons"></a>

### h3.getPentagons(res) ⇒ <code>Array.&lt;H3Index&gt;</code>

Get the twelve pentagon indexes at a given resolution.

**Returns**: <code>Array.&lt;H3Index&gt;</code> - All H3 pentagon indexes at res
**Throws**:

- <code>H3Error</code> If the resolution is invalid

| Param | Type                | Description        |
| ----- | ------------------- | ------------------ |
| res   | <code>number</code> | Hexagon resolution |

---

<a name="module_h3.degsToRads"></a>

### h3.degsToRads(deg) ⇒ <code>number</code>

Convert degrees to radians

**Returns**: <code>number</code> - Value in radians

| Param | Type                | Description      |
| ----- | ------------------- | ---------------- |
| deg   | <code>number</code> | Value in degrees |

---

<a name="module_h3.radsToDegs"></a>

### h3.radsToDegs(rad) ⇒ <code>number</code>

Convert radians to degrees

**Returns**: <code>number</code> - Value in degrees

| Param | Type                | Description      |
| ----- | ------------------- | ---------------- |
| rad   | <code>number</code> | Value in radians |

---

<a name="module_h3.H3Index"></a>

### h3.H3Index : <code>string</code>

64-bit hexidecimal string representation of an H3 index

---

<a name="module_h3.H3IndexInput"></a>

### h3.H3IndexInput : <code>string</code> \| <code>Array.&lt;number&gt;</code>

64-bit hexidecimal string representation of an H3 index,
or two 32-bit integers in little endian order in an array.

---

<a name="module_h3.CoordIJ"></a>

### h3.CoordIJ

Coordinates as an `{i, j}` pair

**Properties**

| Name | Type                |
| ---- | ------------------- |
| i    | <code>number</code> |
| j    | <code>number</code> |

---

<a name="module_h3.H3Error"></a>

### h3.H3Error

Custom JS Error instance with an attached error code. Error codes come from the
core H3 library and can be found [in the H3 docs](https://h3geo.org/docs/library/errors#table-of-error-codes).

**Properties**

| Name    | Type                |
| ------- | ------------------- |
| message | <code>string</code> |
| code    | <code>number</code> |

---

<a name="module_h3.CoordPair"></a>

### h3.CoordPair : <code>Array.&lt;number&gt;</code>

Pair of lat,lng coordinates (or lng,lat if GeoJSON output is specified)

---

<a name="module_h3.SplitLong"></a>

### h3.SplitLong : <code>Array.&lt;number&gt;</code>

Pair of lower,upper 32-bit ints representing a 64-bit value

---

### Benchmarks

`yarn benchmark` compares this package with h3-js 4.5.0 under Node for the priority functions and
reports median, spread, and throughput with the runtime, hardware, and machine load recorded. See
`benchmarks/README.md` for the method and the latest recorded results.
