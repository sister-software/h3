/**
 * Directed edges and vertexes (Phase E).
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { ready, statusError, trapped } from "../runtime/state.ts"
import { checkIndex, M_180_PI, radPairsToDegrees, readF64, readIndexes } from "./call.ts"
import {
	boolArg,
	type CoordPair,
	type H3Index,
	type H3IndexInput,
	intArg,
	parseIndex,
	tryParseIndex,
} from "./indexes.ts"

/**
 * Whether two cells are neighbors. Throws `H3Error` for invalid cells or mismatched resolutions.
 */
export function areNeighborCells(origin: H3IndexInput, destination: H3IndexInput): boolean {
	const w = ready()
	const a = parseIndex(origin, "origin")
	const b = parseIndex(destination, "destination")
	let v: number

	try {
		v = w.are_neighbor_cells(a, b)
	} catch (error) {
		throw trapped(error)
	}

	if (v < 0) throw statusError(w, -v)

	return v === 1
}

/**
 * The directed edge from `origin` to neighboring `destination`.
 */
export function cellsToDirectedEdge(origin: H3IndexInput, destination: H3IndexInput): H3Index {
	const w = ready()
	const a = parseIndex(origin, "origin")
	const b = parseIndex(destination, "destination")

	try {
		return checkIndex(w, w.cells_to_directed_edge(a, b))
	} catch (error) {
		throw trapped(error)
	}
}

/**
 * The origin cell of a directed edge.
 */
export function getDirectedEdgeOrigin(edgeIndex: H3IndexInput): H3Index {
	const w = ready()
	const e = parseIndex(edgeIndex, "edgeIndex")

	try {
		return checkIndex(w, w.get_directed_edge_origin(e))
	} catch (error) {
		throw trapped(error)
	}
}

/**
 * The destination cell of a directed edge.
 */
export function getDirectedEdgeDestination(edgeIndex: H3IndexInput): H3Index {
	const w = ready()
	const e = parseIndex(edgeIndex, "edgeIndex")

	try {
		return checkIndex(w, w.get_directed_edge_destination(e))
	} catch (error) {
		throw trapped(error)
	}
}

/**
 * Whether a value is a valid directed edge. Never throws after initialization.
 */
export function isValidDirectedEdge(edgeIndex: unknown): boolean {
	const w = ready()
	const e = tryParseIndex(edgeIndex)

	if (e === undefined) return false

	try {
		return w.is_valid_directed_edge(e)
	} catch (error) {
		throw trapped(error)
	}
}

/**
 * Whether a value is a valid cell, directed edge, or vertex. Never throws after initialization.
 */
export function isValidIndex(h3Index: unknown): boolean {
	const w = ready()
	const h = tryParseIndex(h3Index)

	if (h === undefined) return false

	try {
		return w.is_valid_index(h)
	} catch (error) {
		throw trapped(error)
	}
}

/**
 * `[origin, destination]` of a directed edge.
 */
export function directedEdgeToCells(edgeIndex: H3IndexInput): [H3Index, H3Index] {
	const w = ready()
	const e = parseIndex(edgeIndex, "edgeIndex")
	let v: string[]

	try {
		v = readIndexes(w, w.directed_edge_to_cells(e))
	} catch (error) {
		throw trapped(error)
	}

	return [v[0]!, v[1]!]
}

/**
 * The directed edges originating at a cell (five for a pentagon).
 */
export function originToDirectedEdges(h3Index: H3IndexInput): H3Index[] {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")

	try {
		return readIndexes(w, w.origin_to_directed_edges(h))
	} catch (error) {
		throw trapped(error)
	}
}

/**
 * The boundary of a directed edge, in degrees. GeoJSON order is `[lng, lat]` (not closed).
 */
export function directedEdgeToBoundary(edgeIndex: H3IndexInput, formatAsGeoJson?: boolean): CoordPair[] {
	const w = ready()
	const e = parseIndex(edgeIndex, "edgeIndex")
	const geoJson = boolArg(formatAsGeoJson, "formatAsGeoJson")
	let v: Float64Array

	try {
		v = readF64(w, w.directed_edge_to_boundary(e))
	} catch (error) {
		throw trapped(error)
	}

	return radPairsToDegrees(v, geoJson, false)
}

/**
 * The reverse of a directed edge.
 */
export function reverseDirectedEdge(edgeIndex: H3IndexInput): H3Index {
	const w = ready()
	const e = parseIndex(edgeIndex, "edgeIndex")

	try {
		return checkIndex(w, w.reverse_directed_edge(e))
	} catch (error) {
		throw trapped(error)
	}
}

/**
 * The vertex `vertexNum` (0–5, or 0–4 for pentagons) of a cell.
 */
export function cellToVertex(h3Index: H3IndexInput, vertexNum: number): H3Index {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")
	// Integers outside the cell's vertex range are reported by C as E_DOMAIN.
	const v = intArg(vertexNum, "vertexNum", -0x80_00_00_00, 0x7f_ff_ff_ff)

	try {
		return checkIndex(w, w.cell_to_vertex(h, v))
	} catch (error) {
		throw trapped(error)
	}
}

/**
 * All vertexes of a cell (five for a pentagon).
 */
export function cellToVertexes(h3Index: H3IndexInput): H3Index[] {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")

	try {
		return readIndexes(w, w.cell_to_vertexes(h))
	} catch (error) {
		throw trapped(error)
	}
}

/**
 * The coordinates of a vertex as `[lat, lng]` in degrees.
 */
export function vertexToLatLng(h3Index: H3IndexInput): CoordPair {
	const w = ready()
	const v = parseIndex(h3Index, "h3Index")
	let status: number

	try {
		status = w.vertex_to_lat_lng(v)
	} catch (error) {
		throw trapped(error)
	}

	if (status !== 0) throw statusError(w, status)

	return [w.out_f64(0) * M_180_PI, w.out_f64(1) * M_180_PI]
}

/**
 * Whether a value is a valid canonical vertex. Never throws after initialization.
 */
export function isValidVertex(h3Index: unknown): boolean {
	const w = ready()
	const v = tryParseIndex(h3Index)

	if (v === undefined) return false

	try {
		return w.is_valid_vertex(v)
	} catch (error) {
		throw trapped(error)
	}
}
