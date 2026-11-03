/**
 * Measurements: distances, areas, edge lengths, resolution averages.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { type Bindings, ready, statusError } from "../runtime/state.ts"
import { call } from "./call.ts"
import { type CoordPair, finiteArg, type H3IndexInput, parseIndex, resArg } from "./indexes.ts"

function unitArg(unit: unknown, allowed: Record<string, number>): number {
	if (typeof unit !== "string") throw new TypeError("unit must be a string from UNITS")
	const code = allowed[unit]

	if (code === undefined) {
		throw new RangeError(`unit must be one of ${Object.keys(allowed).join(", ")}; got ${JSON.stringify(unit)}`)
	}

	return code
}

function coordArg(x: unknown, name: string): CoordPair {
	if (!Array.isArray(x) || x.length !== 2) throw new TypeError(`${name} must be a [lat, lng] pair`)

	return [finiteArg(x[0], `${name}[0]`), finiteArg(x[1], `${name}[1]`)]
}

function checkFloat(w: Bindings, v: number): number {
	const status = w.last_error()

	if (status !== 0) throw statusError(w, status)

	return v
}

const LENGTH_UNITS = { rads: 0, km: 1, m: 2 }
const AREA_UNITS = { rads2: 0, km2: 1, m2: 2 }

/**
 * Returns the great-circle distance between two `[lat, lng]` degree points, in `km`, `m`, or `rads`.
 */
export function greatCircleDistance(latLng1: CoordPair, latLng2: CoordPair, unit: "km" | "m" | "rads"): number {
	const w = ready()
	const a = coordArg(latLng1, "latLng1")
	const b = coordArg(latLng2, "latLng2")
	const u = unitArg(unit, LENGTH_UNITS)

	return call(() => w.great_circle_distance(a[0], a[1], b[0], b[1], u))
}

/**
 * Returns the exact area of a cell, in `km2`, `m2`, or `rads2`.
 */
export function cellArea(h3Index: H3IndexInput, unit: "km2" | "m2" | "rads2"): number {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")
	const u = unitArg(unit, AREA_UNITS)

	return call(() => checkFloat(w, w.cell_area(h, u)))
}

/**
 * Returns the exact length of a directed edge, in `km`, `m`, or `rads`.
 */
export function edgeLength(edge: H3IndexInput, unit: "km" | "m" | "rads"): number {
	const w = ready()
	const e = parseIndex(edge, "edge")
	const u = unitArg(unit, LENGTH_UNITS)

	return call(() => checkFloat(w, w.edge_length(e, u)))
}

/**
 * Returns the average hexagon area at `res`, in `km2` or `m2`.
 */
export function getHexagonAreaAvg(res: number, unit: "km2" | "m2"): number {
	const w = ready()
	const r = resArg(res)
	const u = unitArg(unit, { km2: 1, m2: 2 })

	return call(() => checkFloat(w, w.get_hexagon_area_avg(r, u)))
}

/**
 * Returns the average hexagon edge length at `res`, in `km` or `m`.
 */
export function getHexagonEdgeLengthAvg(res: number, unit: "km" | "m"): number {
	const w = ready()
	const r = resArg(res)
	const u = unitArg(unit, { km: 1, m: 2 })

	return call(() => checkFloat(w, w.get_hexagon_edge_length_avg(r, u)))
}
