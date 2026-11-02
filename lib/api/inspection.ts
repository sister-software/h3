/**
 * Validation and inspection (Phase A) and enumeration.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { ready, trapped } from "../runtime/state.ts"
import { checkCount, checkIndex, M_180_PI, M_PI_180, readIndexes } from "./call.ts"
import { type H3Index, type H3IndexInput, intArg, parseIndex, resArg, tryParseIndex } from "./indexes.ts"

/**
 * Whether a value is a valid H3 cell. Never throws after initialization; `false` for any other value.
 */
export function isValidCell(h3Index: unknown): boolean {
	const w = ready()
	const h = tryParseIndex(h3Index)

	if (h === undefined) return false

	try {
		return w.is_valid_cell(h)
	} catch (error) {
		throw trapped(error)
	}
}

function requireIndexType(x: unknown, name: string): void {
	if (typeof x !== "string" && !Array.isArray(x)) {
		throw new TypeError(`${name} must be an H3 index string or a [lower, upper] pair`)
	}
}

/**
 * Whether a cell is a pentagon. `false` for any value that is not a valid cell.
 */
export function isPentagon(h3Index: H3IndexInput): boolean {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")

	try {
		return w.is_valid_cell(h) && w.is_pentagon(h)
	} catch (error) {
		throw trapped(error)
	}
}

/**
 * Whether a cell's resolution is Class III (odd). `false` for any value that is not a valid cell.
 */
export function isResClassIII(h3Index: H3IndexInput): boolean {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")

	try {
		return w.is_valid_cell(h) && w.is_res_class_iii(h)
	} catch (error) {
		throw trapped(error)
	}
}

/**
 * The resolution of a valid cell, or `-1` for any value that is not a valid cell (including malformed strings and valid
 * directed edges or vertexes). Wrong argument types throw `TypeError`.
 */
export function getResolution(h3Index: H3IndexInput): number {
	const w = ready()
	requireIndexType(h3Index, "h3Index")
	const h = tryParseIndex(h3Index)

	if (h === undefined) return -1

	try {
		return w.is_valid_cell(h) ? w.get_resolution(h) : -1
	} catch (error) {
		throw trapped(error)
	}
}

/**
 * The base cell number (0–121) encoded in an index (C `getBaseCellNumber`).
 */
export function getBaseCellNumber(h3Index: H3IndexInput): number {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")

	try {
		return w.get_base_cell_number(h)
	} catch (error) {
		throw trapped(error)
	}
}

/**
 * The indexing digit at one-based position `digit` (1–15). Positions past the cell resolution return the stored unused
 * digit (7 for a valid cell).
 */
export function getIndexDigit(h3Index: H3IndexInput, digit: number): number {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")
	const d = intArg(digit, "digit", 1, 15)

	try {
		return checkCount(w, w.get_index_digit(h, d))
	} catch (error) {
		throw trapped(error)
	}
}

/**
 * Constructs a cell from its base cell number and digits. `res` defaults to `digits.length` and, when given, must equal
 * it. Out-of-domain base cells and digits throw `H3Error` with the C code.
 */
export function constructCell(baseCellNumber: number, digits: readonly number[], res?: number): H3Index {
	const w = ready()

	if (typeof baseCellNumber !== "number") throw new TypeError("baseCellNumber must be a number")

	if (!Number.isInteger(baseCellNumber) || !Number.isSafeInteger(baseCellNumber)) {
		throw new RangeError(`baseCellNumber must be an integer; got ${baseCellNumber}`)
	}

	if (!Array.isArray(digits)) throw new TypeError("digits must be an array of numbers")

	if (digits.length > 15) throw new RangeError("digits must have at most 15 entries")
	const resolved = res === undefined ? digits.length : resArg(res)

	if (resolved !== digits.length) {
		throw new RangeError(`res (${resolved}) must equal digits.length (${digits.length})`)
	}

	const ds = new Int32Array(digits.length)

	for (let i = 0; i < digits.length; i++) {
		const d = digits[i]

		if (typeof d !== "number") throw new TypeError(`digits[${i}] must be a number`)

		if (!Number.isInteger(d)) throw new RangeError(`digits[${i}] must be an integer; got ${d}`)
		// Integers outside 0..6 are reported by C as E_DIGIT_DOMAIN; clamp into i32 for transport.
		ds[i] = Math.max(-1, Math.min(7, d))
	}

	// Base cells outside 0..121 are reported by C as E_BASE_CELL_DOMAIN.
	const bc = Math.max(-1, Math.min(122, baseCellNumber))

	try {
		return checkIndex(w, w.construct_cell(resolved, bc, ds))
	} catch (error) {
		throw trapped(error)
	}
}

/**
 * All 122 resolution 0 cells, in base cell order.
 */
export function getRes0Cells(): H3Index[] {
	const w = ready()

	try {
		return readIndexes(w, w.get_res0_cells())
	} catch (error) {
		throw trapped(error)
	}
}

/**
 * The 12 pentagons at `res`, in base cell order.
 */
export function getPentagons(res: number): H3Index[] {
	const w = ready()
	const r = resArg(res)

	try {
		return readIndexes(w, w.get_pentagons(r))
	} catch (error) {
		throw trapped(error)
	}
}

/**
 * The number of cells at `res`.
 */
export function getNumCells(res: number): number {
	const w = ready()
	const r = resArg(res)

	try {
		return checkCount(w, w.get_num_cells(r))
	} catch (error) {
		throw trapped(error)
	}
}

/**
 * Degrees to radians (C `degsToRads`). Pure; works before initialization.
 */
export function degsToRads(deg: number): number {
	if (typeof deg !== "number") throw new TypeError("deg must be a number")

	return deg * M_PI_180
}

/**
 * Radians to degrees (C `radsToDegs`). Pure; works before initialization.
 */
export function radsToDegs(rad: number): number {
	if (typeof rad !== "number") throw new TypeError("rad must be a number")

	return rad * M_180_PI
}
