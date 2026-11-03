# JavaScript API reference

This reference is generated from this package's declarations and source documentation.
Run `yarn docs:api` to update it after changing a public signature or description.

Indexes use `H3IndexInput` (a hexadecimal string or a pair of 32-bit words) and return canonical lowercase `H3Index` strings.
Coordinates use degree pairs. GeoJSON switches reverse the coordinate order and close output loops.

Cell, directed-edge, and vertex outputs default to the string brands `H3Cell`, `H3DirectedEdge`, and `H3Vertex`. Index-producing functions accept `T extends string` to select an application brand or plain `string`. The type argument changes only the output annotation. Existing string and split-long inputs remain accepted; `H3Index` remains the general string alias.

Argument type errors throw `TypeError`; invalid binding ranges throw `RangeError`; algorithm failures throw an error named `H3Error` with its numeric C `code`.
Predicates and inspection functions document their sentinel results below. [API decisions](api-decisions.md) describe the shared behavior and migration differences.

## Initialization

### init

```ts
function init(options?: InitOptions): Promise<void>
```

Optionally initializes the H3 WebAssembly instance ahead of first use. Calling it is never required: the first H3
call instantiates the package's binary synchronously.

Use it to preload during startup, to set resource limits (which must happen before the first H3 call), or to supply
your own `module` (a compiled `WebAssembly.Module`) or `bytes` (the contents of `@sister.software/h3/h3.wasm`). With
no source it initializes from the package's binary. If H3 is already initialized with the same limits it resolves
immediately, whatever the source.

## Constants

### UNITS

```ts
const UNITS = {
	m: "m",
	m2: "m2",
	km: "km",
	km2: "km2",
	rads: "rads",
	rads2: "rads2",
} as const
```

Length and area units accepted by the measurement functions.

### POLYGON_TO_CELLS_FLAGS

```ts
const POLYGON_TO_CELLS_FLAGS = {
	containmentCenter: "containmentCenter",
	containmentFull: "containmentFull",
	containmentOverlapping: "containmentOverlapping",
	containmentOverlappingBbox: "containmentOverlappingBbox",
} as const
```

Containment modes for `polygonToCellsExperimental` (C flags 0–3).

## Index representation

### h3IndexToSplitLong

```ts
function h3IndexToSplitLong(h3Index: H3IndexInput): SplitLong
```

Converts an H3 index to a split long: `[lower, upper]` unsigned 32-bit words. Pure; works before initialization.

### splitLongToH3Index

```ts
function splitLongToH3Index<T extends string = H3Index>(lower: number, upper: number): T
```

Converts a split long to an index string: the upper word in unpadded lowercase hex followed by exactly eight hex
digits of the lower word. Pure; works before initialization.

## Inspection

### isValidCell

```ts
function isValidCell(h3Index: unknown): boolean
```

Returns whether a value is a valid H3 cell. Never throws after initialization; `false` for any other value.

### isPentagon

```ts
function isPentagon(h3Index: H3IndexInput): boolean
```

Returns whether a well-formed index is a pentagon. Invalid cell bits return `false`. Malformed inputs follow the
shared argument-validation rules.

### isResClassIII

```ts
function isResClassIII(h3Index: H3IndexInput): boolean
```

Returns whether a well-formed cell index has an odd resolution (Class III). Invalid cell bits return `false`.
Malformed inputs follow the shared argument-validation rules.

### getResolution

```ts
function getResolution(h3Index: H3IndexInput): number
```

Returns the resolution of a valid cell, or `-1` for any value that is not a valid cell (including malformed strings
and valid directed edges or vertexes). Wrong argument types throw `TypeError`.

### getBaseCellNumber

```ts
function getBaseCellNumber(h3Index: H3IndexInput): number
```

Returns the base cell number (0–121) encoded in an index (C `getBaseCellNumber`).

### getIndexDigit

```ts
function getIndexDigit(h3Index: H3IndexInput, digit: number): number
```

Returns the indexing digit at one-based position `digit` (1–15). Positions past the cell resolution return the stored
unused digit (7 for a valid cell).

### constructCell

```ts
function constructCell<T extends string = H3Cell>(baseCellNumber: number, digits: readonly number[], res?: number): T
```

Constructs a cell from its base cell number and digits. `res` defaults to `digits.length` and, when given, must equal
it. Out-of-domain base cells and digits throw `H3Error` with the C code.

### getRes0Cells

```ts
function getRes0Cells<T extends string = H3Cell>(): T[]
```

All 122 resolution 0 cells, in base cell order.

### getPentagons

```ts
function getPentagons<T extends string = H3Cell>(res: number): T[]
```

The 12 pentagons at `res`, in base cell order.

### getNumCells

```ts
function getNumCells(res: number): number
```

The number of cells at `res`.

### degsToRads

```ts
function degsToRads(deg: number): number
```

Degrees to radians (C `degsToRads`). Pure; works before initialization.

### radsToDegs

```ts
function radsToDegs(rad: number): number
```

Radians to degrees (C `radsToDegs`). Pure; works before initialization.

## Coordinates

### latLngToCell

```ts
function latLngToCell<T extends string = H3Cell>(lat: number, lng: number, res: number): T
```

Returns the cell containing a point (degrees) at `res`. Non-finite coordinates throw `RangeError`.

### cellToLatLng

```ts
function cellToLatLng(h3Index: H3IndexInput): CoordPair
```

Returns the center of a cell as `[lat, lng]` in degrees.

### cellToBoundary

```ts
function cellToBoundary(h3Index: H3IndexInput, formatAsGeoJson?: boolean): CoordPair[]
```

Returns the boundary of a cell in degrees, counter-clockwise. With `formatAsGeoJson`, pairs are `[lng, lat]` and the
loop is closed (first vertex repeated).

### getIcosahedronFaces

```ts
function getIcosahedronFaces(h3Index: H3IndexInput): number[]
```

Returns the icosahedron faces (0–19) a cell intersects.

## Hierarchy

### cellToParent

```ts
function cellToParent<T extends string = H3Cell>(h3Index: H3IndexInput, res: number): T
```

Returns the parent of a cell at `res`.

### cellToChildren

```ts
function cellToChildren<T extends string = H3Cell>(h3Index: H3IndexInput, res: number): T[]
```

All children of a cell at `res`, in C iteration order.

### cellToChildrenSize

```ts
function cellToChildrenSize(h3Index: H3IndexInput, res: number): number
```

Returns the number of children of a cell at `res`.

### cellToCenterChild

```ts
function cellToCenterChild<T extends string = H3Cell>(h3Index: H3IndexInput, res: number): T
```

Returns the center child of a cell at `res`.

### cellToChildPos

```ts
function cellToChildPos(h3Index: H3IndexInput, parentRes: number): number
```

Returns the position of a cell within its parent's ordered children at `parentRes`.

### childPosToCell

```ts
function childPosToCell<T extends string = H3Cell>(childPos: number, h3Index: H3IndexInput, childRes: number): T
```

The child of `h3Index` at `childRes` with ordered position `childPos`.

### compactCells

```ts
function compactCells<T extends string = H3Cell>(h3Set: readonly H3IndexInput[]): T[]
```

Compacts a set of same-resolution cells into the minimal covering set (C order).

### uncompactCells

```ts
function uncompactCells<T extends string = H3Cell>(compactedSet: readonly H3IndexInput[], res: number): T[]
```

Expands a compacted set to cells at `res`.

## Traversal

### gridDisk

```ts
function gridDisk<T extends string = H3Cell>(h3Index: H3IndexInput, ringSize: number): T[]
```

Returns all cells within grid distance `ringSize` of a cell (unspecified order, no gaps).

### gridDiskDistances

```ts
function gridDiskDistances<T extends string = H3Cell>(h3Index: H3IndexInput, ringSize: number): T[][]
```

Returns cells within `ringSize`, grouped by distance: element `d` holds the cells at distance `d`.

### gridRing

```ts
function gridRing<T extends string = H3Cell>(h3Index: H3IndexInput, ringSize: number): T[]
```

Returns the hollow ring of cells at exactly grid distance `ringSize`.

### gridRingUnsafe

```ts
function gridRingUnsafe<T extends string = H3Cell>(h3Index: H3IndexInput, ringSize: number): T[]
```

Returns the hollow ring at `ringSize`; throws `H3Error` (`E_PENTAGON`) near pentagon distortion.

### gridDistance

```ts
function gridDistance(origin: H3IndexInput, destination: H3IndexInput): number
```

Returns the grid distance between two cells.

### gridPathCells

```ts
function gridPathCells<T extends string = H3Cell>(origin: H3IndexInput, destination: H3IndexInput): T[]
```

Returns a line of adjacent cells from `origin` to `destination`, inclusive.

### cellToLocalIj

```ts
function cellToLocalIj(origin: H3IndexInput, destination: H3IndexInput): CoordIJ
```

Local IJ coordinates of `destination` anchored at `origin` (C mode 0).

### localIjToCell

```ts
function localIjToCell<T extends string = H3Cell>(origin: H3IndexInput, coords: CoordIJ): T
```

The cell at local IJ coordinates anchored at `origin` (C mode 0).

## Edges and vertices

### areNeighborCells

```ts
function areNeighborCells(origin: H3IndexInput, destination: H3IndexInput): boolean
```

Returns whether two cells are neighbors. Throws `H3Error` for invalid cells or mismatched resolutions.

### cellsToDirectedEdge

```ts
function cellsToDirectedEdge<T extends string = H3DirectedEdge>(origin: H3IndexInput, destination: H3IndexInput): T
```

Returns the directed edge from `origin` to neighboring `destination`.

### getDirectedEdgeOrigin

```ts
function getDirectedEdgeOrigin<T extends string = H3Cell>(edgeIndex: H3IndexInput): T
```

Returns the origin cell of a directed edge.

### getDirectedEdgeDestination

```ts
function getDirectedEdgeDestination<T extends string = H3Cell>(edgeIndex: H3IndexInput): T
```

Returns the destination cell of a directed edge.

### isValidDirectedEdge

```ts
function isValidDirectedEdge(edgeIndex: unknown): boolean
```

Returns whether a value is a valid directed edge. Never throws after initialization.

### isValidIndex

```ts
function isValidIndex(h3Index: unknown): boolean
```

Returns whether a value is a valid cell, directed edge, or vertex. Never throws after initialization.

### directedEdgeToCells

```ts
function directedEdgeToCells<T extends string = H3Cell>(edgeIndex: H3IndexInput): [T, T]
```

`[origin, destination]` of a directed edge.

### originToDirectedEdges

```ts
function originToDirectedEdges<T extends string = H3DirectedEdge>(h3Index: H3IndexInput): T[]
```

Returns the directed edges originating at a cell (five for a pentagon).

### directedEdgeToBoundary

```ts
function directedEdgeToBoundary(edgeIndex: H3IndexInput, formatAsGeoJson?: boolean): CoordPair[]
```

The boundary of a directed edge, in degrees. GeoJSON order is `[lng, lat]` (not closed).

### reverseDirectedEdge

```ts
function reverseDirectedEdge<T extends string = H3DirectedEdge>(edgeIndex: H3IndexInput): T
```

The reverse of a directed edge.

### cellToVertex

```ts
function cellToVertex<T extends string = H3Vertex>(h3Index: H3IndexInput, vertexNum: number): T
```

Returns the vertex `vertexNum` (0–5, or 0–4 for pentagons) of a cell.

### cellToVertexes

```ts
function cellToVertexes<T extends string = H3Vertex>(h3Index: H3IndexInput): T[]
```

All vertexes of a cell (five for a pentagon).

### vertexToLatLng

```ts
function vertexToLatLng(h3Index: H3IndexInput): CoordPair
```

The coordinates of a vertex as `[lat, lng]` in degrees.

### isValidVertex

```ts
function isValidVertex(h3Index: unknown): boolean
```

Returns whether a value is a valid canonical vertex. Never throws after initialization.

## Measurements

### greatCircleDistance

```ts
function greatCircleDistance(latLng1: CoordPair, latLng2: CoordPair, unit: "km" | "m" | "rads"): number
```

Returns the great-circle distance between two `[lat, lng]` degree points, in `km`, `m`, or `rads`.

### cellArea

```ts
function cellArea(h3Index: H3IndexInput, unit: "km2" | "m2" | "rads2"): number
```

Returns the exact area of a cell, in `km2`, `m2`, or `rads2`.

### edgeLength

```ts
function edgeLength(edge: H3IndexInput, unit: "km" | "m" | "rads"): number
```

Returns the exact length of a directed edge, in `km`, `m`, or `rads`.

### getHexagonAreaAvg

```ts
function getHexagonAreaAvg(res: number, unit: "km2" | "m2"): number
```

Returns the average hexagon area at `res`, in `km2` or `m2`.

### getHexagonEdgeLengthAvg

```ts
function getHexagonEdgeLengthAvg(res: number, unit: "km" | "m"): number
```

Returns the average hexagon edge length at `res`, in `km` or `m`.

## Polygons

### polygonToCells

```ts
function polygonToCells<T extends string = H3Cell>(
	coordinates: number[][] | number[][][],
	res: number,
	isGeoJson?: boolean
): T[]
```

Returns cells whose centers lie inside a polygon (C `polygonToCells`). `coordinates` is one loop or an array of loops
(exterior first, then holes) of `[lat, lng]` degree pairs, or `[lng, lat]` with `isGeoJson`. Output order is
unspecified.

### polygonToCellsExperimental

```ts
function polygonToCellsExperimental<T extends string = H3Cell>(
	coordinates: number[][] | number[][][],
	res: number,
	flags: string,
	isGeoJson?: boolean
): T[]
```

Returns cells covering a polygon under a containment mode from `POLYGON_TO_CELLS_FLAGS` (C
`polygonToCellsExperimental`). Output is in C iteration order.

### cellsToMultiPolygon

```ts
function cellsToMultiPolygon(h3Indexes: readonly H3IndexInput[], formatAsGeoJson?: boolean): CoordPair[][][]
```

Returns the outlines of a set of same-resolution unique cells, as polygons of loops (outer loop first, then holes) of
degree coordinate pairs, ordered by decreasing outer area. With `formatAsGeoJson`, pairs are `[lng, lat]` and every
loop is closed.
