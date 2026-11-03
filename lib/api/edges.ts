/**
 * Directed edges and vertexes.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { ready, statusError } from "../runtime/state.ts"
import { call, checkIndex, M_180_PI, radPairsToDegrees, readF64, readIndexes } from "./call.ts"
import {
	boolArg,
	type CoordPair,
	type H3Cell,
	type H3DirectedEdge,
	type H3Vertex,
	type H3IndexInput,
	intArg,
	parseIndex,
	tryParseIndex,
} from "./indexes.ts"

/**
 * Returns whether two cells are neighbors. Throws `H3Error` for invalid cells or mismatched resolutions.
 */
export function areNeighborCells(origin: H3IndexInput, destination: H3IndexInput): boolean {
	const w = ready()
	const a = parseIndex(origin, "origin")
	const b = parseIndex(destination, "destination")
	const v = call(() => w.are_neighbor_cells(a, b))

	if (v < 0) throw statusError(w, -v)

	return v === 1
}

/**
 * Returns the directed edge from `origin` to neighboring `destination`.
 */
export function cellsToDirectedEdge<T extends string = H3DirectedEdge>(
	origin: H3IndexInput,
	destination: H3IndexInput
): T {
	const w = ready()
	const a = parseIndex(origin, "origin")
	const b = parseIndex(destination, "destination")

	return call(() => checkIndex<T>(w, w.cells_to_directed_edge(a, b)))
}

/**
 * Returns the origin cell of a directed edge.
 */
export function getDirectedEdgeOrigin<T extends string = H3Cell>(edgeIndex: H3IndexInput): T {
	const w = ready()
	const e = parseIndex(edgeIndex, "edgeIndex")

	return call(() => checkIndex<T>(w, w.get_directed_edge_origin(e)))
}

/**
 * Returns the destination cell of a directed edge.
 */
export function getDirectedEdgeDestination<T extends string = H3Cell>(edgeIndex: H3IndexInput): T {
	const w = ready()
	const e = parseIndex(edgeIndex, "edgeIndex")

	return call(() => checkIndex<T>(w, w.get_directed_edge_destination(e)))
}

/**
 * Returns whether a value is a valid directed edge. Never throws after initialization.
 */
export function isValidDirectedEdge(edgeIndex: unknown): boolean {
	const w = ready()
	const e = tryParseIndex(edgeIndex)

	if (e === undefined) return false

	return call(() => w.is_valid_directed_edge(e))
}

/**
 * Returns whether a value is a valid cell, directed edge, or vertex. Never throws after initialization.
 */
export function isValidIndex(h3Index: unknown): boolean {
	const w = ready()
	const h = tryParseIndex(h3Index)

	if (h === undefined) return false

	return call(() => w.is_valid_index(h))
}

/**
 * `[origin, destination]` of a directed edge.
 */
export function directedEdgeToCells<T extends string = H3Cell>(edgeIndex: H3IndexInput): [T, T] {
	const w = ready()
	const e = parseIndex(edgeIndex, "edgeIndex")
	const v = call(() => readIndexes<T>(w, w.directed_edge_to_cells(e)))

	return [v[0]!, v[1]!]
}

/**
 * Returns the directed edges originating at a cell (five for a pentagon).
 */
export function originToDirectedEdges<T extends string = H3DirectedEdge>(h3Index: H3IndexInput): T[] {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")

	return call(() => readIndexes<T>(w, w.origin_to_directed_edges(h)))
}

/**
 * The boundary of a directed edge, in degrees. GeoJSON order is `[lng, lat]` (not closed).
 */
export function directedEdgeToBoundary(edgeIndex: H3IndexInput, formatAsGeoJson?: boolean): CoordPair[] {
	const w = ready()
	const e = parseIndex(edgeIndex, "edgeIndex")
	const geoJson = boolArg(formatAsGeoJson, "formatAsGeoJson")
	const v = call(() => readF64(w, w.directed_edge_to_boundary(e)))

	return radPairsToDegrees(v, geoJson, false)
}

/**
 * The reverse of a directed edge.
 */
export function reverseDirectedEdge<T extends string = H3DirectedEdge>(edgeIndex: H3IndexInput): T {
	const w = ready()
	const e = parseIndex(edgeIndex, "edgeIndex")

	return call(() => checkIndex<T>(w, w.reverse_directed_edge(e)))
}

/**
 * Returns the vertex `vertexNum` (0–5, or 0–4 for pentagons) of a cell.
 */
export function cellToVertex<T extends string = H3Vertex>(h3Index: H3IndexInput, vertexNum: number): T {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")
	// Integers outside the cell's vertex range are reported by C as E_DOMAIN.
	const v = intArg(vertexNum, "vertexNum", -0x80_00_00_00, 0x7f_ff_ff_ff)

	return call(() => checkIndex<T>(w, w.cell_to_vertex(h, v)))
}

/**
 * All vertexes of a cell (five for a pentagon).
 */
export function cellToVertexes<T extends string = H3Vertex>(h3Index: H3IndexInput): T[] {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")

	return call(() => readIndexes<T>(w, w.cell_to_vertexes(h)))
}

/**
 * The coordinates of a vertex as `[lat, lng]` in degrees.
 */
export function vertexToLatLng(h3Index: H3IndexInput): CoordPair {
	const w = ready()
	const v = parseIndex(h3Index, "h3Index")
	const status = call(() => w.vertex_to_lat_lng(v))

	if (status !== 0) throw statusError(w, status)

	return [w.out_f64(0) * M_180_PI, w.out_f64(1) * M_180_PI]
}

/**
 * Returns whether a value is a valid canonical vertex. Never throws after initialization.
 */
export function isValidVertex(h3Index: unknown): boolean {
	const w = ready()
	const v = tryParseIndex(h3Index)

	if (v === undefined) return false

	return call(() => w.is_valid_vertex(v))
}
