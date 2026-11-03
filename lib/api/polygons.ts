/**
 * Polygons: polygon fill in every containment mode and cell set outlines.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { ready } from "../runtime/state.ts"
import { call, checkVec, M_180_PI, readIndexes } from "./call.ts"
import { POLYGON_TO_CELLS_FLAGS } from "./constants.ts"
import {
	boolArg,
	type CoordPair,
	finiteArg,
	type H3Index,
	type H3IndexInput,
	parseIndexArray,
	resArg,
} from "./indexes.ts"

const FLAG_CODES: Record<string, number> = {
	[POLYGON_TO_CELLS_FLAGS.containmentCenter]: 0,
	[POLYGON_TO_CELLS_FLAGS.containmentFull]: 1,
	[POLYGON_TO_CELLS_FLAGS.containmentOverlapping]: 2,
	[POLYGON_TO_CELLS_FLAGS.containmentOverlappingBbox]: 3,
}

/**
 * Flattens `coordinates` (one loop, or an array of loops with holes after the exterior) into degree `[lat, lng, ...]`
 * and per-loop lengths. A single loop is recognised, as in h3-js, by its first element being a coordinate pair of
 * numbers.
 */
function flattenPolygon(coordinates: unknown, geoJson: boolean): { coords: Float64Array; lengths: Uint32Array } {
	if (!Array.isArray(coordinates)) throw new TypeError("coordinates must be an array of loops or coordinate pairs")
	const first = coordinates[0]

	const loops: unknown[] =
		coordinates.length && Array.isArray(first) && typeof first[0] === "number" ? [coordinates] : coordinates

	if (!loops.length) {
		loops.push([])
	}

	let total = 0

	for (let l = 0; l < loops.length; l++) {
		const lp = loops[l]

		if (!Array.isArray(lp)) throw new TypeError(`coordinates[${l}] must be an array of coordinate pairs`)
		total += lp.length
	}

	const coords = new Float64Array(total * 2)
	const lengths = new Uint32Array(loops.length)
	const latIndex = geoJson ? 1 : 0
	const lngIndex = geoJson ? 0 : 1
	let at = 0

	for (let l = 0; l < loops.length; l++) {
		const lp = loops[l] as unknown[]
		lengths[l] = lp.length

		for (let v = 0; v < lp.length; v++) {
			const pair = lp[v]

			if (!Array.isArray(pair) || pair.length < 2) {
				throw new TypeError(`coordinates loop ${l} vertex ${v} must be a coordinate pair`)
			}

			coords[at++] = finiteArg(pair[latIndex], `loop ${l} vertex ${v} latitude`)
			coords[at++] = finiteArg(pair[lngIndex], `loop ${l} vertex ${v} longitude`)
		}
	}

	return { coords, lengths }
}

/**
 * Returns cells whose centers lie inside a polygon (C `polygonToCells`). `coordinates` is one loop or an array of loops
 * (exterior first, then holes) of `[lat, lng]` degree pairs, or `[lng, lat]` with `isGeoJson`. Output order is
 * unspecified.
 */
export function polygonToCells(coordinates: number[][] | number[][][], res: number, isGeoJson?: boolean): H3Index[] {
	const w = ready()
	const r = resArg(res)
	const { coords, lengths } = flattenPolygon(coordinates, boolArg(isGeoJson, "isGeoJson"))

	return call(() => readIndexes(w, w.polygon_to_cells(coords, lengths, r)))
}

/**
 * Returns cells covering a polygon under a containment mode from {@link POLYGON_TO_CELLS_FLAGS} (C
 * `polygonToCellsExperimental`). Output is in C iteration order.
 */
export function polygonToCellsExperimental(
	coordinates: number[][] | number[][][],
	res: number,
	flags: string,
	isGeoJson?: boolean
): H3Index[] {
	const w = ready()
	const r = resArg(res)

	if (typeof flags !== "string") throw new TypeError("flags must be a string from POLYGON_TO_CELLS_FLAGS")
	const code = FLAG_CODES[flags]

	if (code === undefined) throw new RangeError(`unknown POLYGON_TO_CELLS_FLAGS value ${JSON.stringify(flags)}`)
	const { coords, lengths } = flattenPolygon(coordinates, boolArg(isGeoJson, "isGeoJson"))

	return call(() => readIndexes(w, w.polygon_to_cells_experimental(coords, lengths, r, code)))
}

/**
 * Returns the outlines of a set of same-resolution unique cells, as polygons of loops (outer loop first, then holes) of
 * degree coordinate pairs, ordered by decreasing outer area. With `formatAsGeoJson`, pairs are `[lng, lat]` and every
 * loop is closed.
 */
export function cellsToMultiPolygon(h3Indexes: readonly H3IndexInput[], formatAsGeoJson?: boolean): CoordPair[][][] {
	const w = ready()
	const cells = parseIndexArray(h3Indexes, "h3Indexes")
	const geoJson = boolArg(formatAsGeoJson, "formatAsGeoJson")
	const flat = call(() => checkVec(w, w.cells_to_multi_polygon(cells)))

	if (!flat.length) return []
	let at = 0
	const out: CoordPair[][][] = new Array(flat[at++]!)

	for (let p = 0; p < out.length; p++) {
		const loops: CoordPair[][] = new Array(flat[at++]!)

		for (let l = 0; l < loops.length; l++) {
			const n = flat[at++]!
			const lp: CoordPair[] = new Array(geoJson ? n + 1 : n)

			for (let v = 0; v < n; v++) {
				const lat = flat[at++]! * M_180_PI
				const lng = flat[at++]! * M_180_PI
				lp[v] = geoJson ? [lng, lat] : [lat, lng]
			}

			if (geoJson && n > 0) {
				lp[n] = [lp[0]![0], lp[0]![1]]
			}

			loops[l] = lp
		}

		out[p] = loops
	}

	return out
}
