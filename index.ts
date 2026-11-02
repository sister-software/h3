/**
 * H3 hexagonal hierarchical geospatial indexing, implemented in Rust and compiled to WebAssembly.
 *
 * Call {@link init} once at startup; every other function except the pure exports is synchronous afterwards. See
 * README.md and docs/api-decisions.md.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

export { init, type InitOptions, type ResourceLimits } from "./lib/runtime/state.ts"
export { POLYGON_TO_CELLS_FLAGS, type PolygonToCellsFlag, type Unit, UNITS } from "./lib/api/constants.ts"
export type { H3Error, H3ResourceLimitError, ResourceLimitName } from "./lib/runtime/errors.ts"

export {
	h3IndexToSplitLong,
	splitLongToH3Index,
	type CoordPair,
	type H3Index,
	type H3IndexInput,
	type SplitLong,
} from "./lib/api/indexes.ts"

export {
	constructCell,
	degsToRads,
	getBaseCellNumber,
	getIndexDigit,
	getNumCells,
	getPentagons,
	getRes0Cells,
	getResolution,
	isPentagon,
	isResClassIII,
	isValidCell,
	radsToDegs,
} from "./lib/api/inspection.ts"

export { cellToBoundary, cellToLatLng, getIcosahedronFaces, latLngToCell } from "./lib/api/coordinates.ts"

export {
	cellToCenterChild,
	cellToChildPos,
	cellToChildren,
	cellToChildrenSize,
	cellToParent,
	childPosToCell,
	compactCells,
	uncompactCells,
} from "./lib/api/hierarchy.ts"

export {
	cellToLocalIj,
	type CoordIJ,
	gridDisk,
	gridDiskDistances,
	gridDistance,
	gridPathCells,
	gridRing,
	gridRingUnsafe,
	localIjToCell,
} from "./lib/api/traversal.ts"

export {
	areNeighborCells,
	cellsToDirectedEdge,
	cellToVertex,
	cellToVertexes,
	directedEdgeToBoundary,
	directedEdgeToCells,
	getDirectedEdgeDestination,
	getDirectedEdgeOrigin,
	isValidDirectedEdge,
	isValidIndex,
	isValidVertex,
	originToDirectedEdges,
	reverseDirectedEdge,
	vertexToLatLng,
} from "./lib/api/edges.ts"

export {
	cellArea,
	edgeLength,
	getHexagonAreaAvg,
	getHexagonEdgeLengthAvg,
	greatCircleDistance,
} from "./lib/api/measurements.ts"

export { cellsToMultiPolygon, polygonToCells, polygonToCellsExperimental } from "./lib/api/polygons.ts"
