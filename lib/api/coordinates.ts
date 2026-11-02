/**
 * Coordinates and boundaries (Phase B). Degrees at the boundary; radians inside WASM.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { ready, statusError, trapped } from "../runtime/state.ts"
import { checkIndex, checkVec, M_180_PI, radPairsToDegrees, readF64 } from "./call.ts"
import { boolArg, type CoordPair, finiteArg, type H3Index, type H3IndexInput, parseIndex, resArg } from "./indexes.ts"

/**
 * The cell containing a point (degrees) at `res`. Non-finite coordinates throw `RangeError`.
 */
export function latLngToCell(lat: number, lng: number, res: number): H3Index {
	const w = ready()
	const la = finiteArg(lat, "lat")
	const ln = finiteArg(lng, "lng")
	const r = resArg(res)
	let h: bigint

	try {
		h = w.lat_lng_to_cell(la, ln, r)
	} catch (error) {
		throw trapped(error)
	}

	return checkIndex(w, h)
}

/**
 * The center of a cell as `[lat, lng]` in degrees.
 */
export function cellToLatLng(h3Index: H3IndexInput): CoordPair {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")
	let status: number

	try {
		status = w.cell_to_lat_lng(h)
	} catch (error) {
		throw trapped(error)
	}

	if (status !== 0) throw statusError(w, status)

	return [w.out_f64(0) * M_180_PI, w.out_f64(1) * M_180_PI]
}

/**
 * The boundary of a cell in degrees, counter-clockwise. With `formatAsGeoJson`, pairs are `[lng, lat]` and the loop is
 * closed (first vertex repeated).
 */
export function cellToBoundary(h3Index: H3IndexInput, formatAsGeoJson?: boolean): CoordPair[] {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")
	const geoJson = boolArg(formatAsGeoJson, "formatAsGeoJson")
	let v: Float64Array

	try {
		v = readF64(w, w.cell_to_boundary(h))
	} catch (error) {
		throw trapped(error)
	}

	return radPairsToDegrees(v, geoJson, geoJson)
}

/**
 * The icosahedron faces (0–19) a cell intersects.
 */
export function getIcosahedronFaces(h3Index: H3IndexInput): number[] {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")
	let v: Int32Array

	try {
		v = checkVec(w, w.get_icosahedron_faces(h))
	} catch (error) {
		throw trapped(error)
	}

	const out: number[] = []

	for (const f of v)
		if (f >= 0) {
			out.push(f)
		}

	return out
}
