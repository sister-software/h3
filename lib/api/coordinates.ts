/**
 * Coordinates and boundaries. Degrees at the boundary; radians inside WASM.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { ready, statusError } from "../runtime/state.ts"
import { call, checkIndex, checkVec, M_180_PI, radPairsToDegrees, readF64 } from "./call.ts"
import { boolArg, type CoordPair, finiteArg, type H3Cell, type H3IndexInput, parseIndex, resArg } from "./indexes.ts"

/**
 * Returns the cell containing a point (degrees) at `res`. Non-finite coordinates throw `RangeError`.
 */
export function latLngToCell<T extends string = H3Cell>(lat: number, lng: number, res: number): T {
	const w = ready()
	const la = finiteArg(lat, "lat")
	const ln = finiteArg(lng, "lng")
	const r = resArg(res)
	const h = call(() => w.lat_lng_to_cell(la, ln, r))

	return checkIndex<T>(w, h)
}

/**
 * Returns the center of a cell as `[lat, lng]` in degrees.
 */
export function cellToLatLng(h3Index: H3IndexInput): CoordPair {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")
	const status = call(() => w.cell_to_lat_lng(h))

	if (status !== 0) throw statusError(w, status)

	return [w.out_f64(0) * M_180_PI, w.out_f64(1) * M_180_PI]
}

/**
 * Returns the boundary of a cell in degrees, counter-clockwise. With `formatAsGeoJson`, pairs are `[lng, lat]` and the
 * loop is closed (first vertex repeated).
 */
export function cellToBoundary(h3Index: H3IndexInput, formatAsGeoJson?: boolean): CoordPair[] {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")
	const geoJson = boolArg(formatAsGeoJson, "formatAsGeoJson")
	const v = call(() => readF64(w, w.cell_to_boundary(h)))

	return radPairsToDegrees(v, geoJson, geoJson)
}

/**
 * Returns the icosahedron faces (0–19) a cell intersects.
 */
export function getIcosahedronFaces(h3Index: H3IndexInput): number[] {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")
	const v = call(() => checkVec(w, w.get_icosahedron_faces(h)))

	const out: number[] = []

	for (const f of v)
		if (f >= 0) {
			out.push(f)
		}

	return out
}
