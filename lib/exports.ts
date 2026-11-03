/**
 * The public API, shared by the default entry (`index.ts`) and the workerd entry (`workerd.ts`), which differ only in
 * where the first call finds the WebAssembly binary.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

export { init, type InitOptions, type ResourceLimits } from "./runtime/state.ts"
export { POLYGON_TO_CELLS_FLAGS, type PolygonToCellsFlag, type Unit, UNITS } from "./api/constants.ts"
export type { H3Error, H3ResourceLimitError, ResourceLimitName } from "./runtime/errors.ts"

export {
	h3IndexToSplitLong,
	splitLongToH3Index,
	type CoordPair,
	type H3Index,
	type H3Cell,
	type H3DirectedEdge,
	type H3Vertex,
	type H3IndexInput,
	type SplitLong,
} from "./api/indexes.ts"

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
} from "./api/inspection.ts"

export { cellToBoundary, cellToLatLng, getIcosahedronFaces, latLngToCell } from "./api/coordinates.ts"

export {
	cellToCenterChild,
	cellToChildPos,
	cellToChildren,
	cellToChildrenSize,
	cellToParent,
	childPosToCell,
	compactCells,
	uncompactCells,
} from "./api/hierarchy.ts"

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
} from "./api/traversal.ts"

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
} from "./api/edges.ts"

export {
	cellArea,
	edgeLength,
	getHexagonAreaAvg,
	getHexagonEdgeLengthAvg,
	greatCircleDistance,
} from "./api/measurements.ts"

export { cellsToMultiPolygon, polygonToCells, polygonToCellsExperimental } from "./api/polygons.ts"
