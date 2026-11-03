/**
 * Index string and split-long conversion, and argument validation shared by all adapters. See docs/api-decisions.md,
 * "Representation".
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

/**
 * An H3 index as a canonical lowercase hexadecimal string, e.g. `"87283472bffffff"`.
 */
export type H3Index = string

declare const h3CellBrand: unique symbol
declare const h3DirectedEdgeBrand: unique symbol
declare const h3VertexBrand: unique symbol

/**
 * Represents a cell index returned by an H3 operation. The brand distinguishes cell outputs at compile time; input
 * validation remains operation-specific.
 */
export type H3Cell = string & { readonly [h3CellBrand]: true }

/**
 * Represents a directed edge index returned by an H3 operation.
 */
export type H3DirectedEdge = string & { readonly [h3DirectedEdgeBrand]: true }

/**
 * Represents a vertex index returned by an H3 operation.
 */
export type H3Vertex = string & { readonly [h3VertexBrand]: true }

/**
 * A split 64-bit index: `[lower, upper]` 32-bit words.
 */
export type SplitLong = [number, number]

/**
 * An index string (1–16 hex digits, either case) or a `[lower, upper]` split long.
 */
export type H3IndexInput = string | readonly [number, number]

/**
 * A `[lat, lng]` pair in degrees (or `[lng, lat]` when GeoJSON output is requested).
 */
export type CoordPair = [number, number]

const HEX = /^[0-9a-fA-F]{1,16}$/

/**
 * A short description of any value for error messages; never throws (bigints, cycles, symbols).
 *
 * @internal
 */
export function describe(x: unknown): string {
	if (typeof x === "bigint") return `${x}n`

	if (typeof x === "symbol" || typeof x === "function") return typeof x

	try {
		return JSON.stringify(x) ?? typeof x
	} catch {
		return typeof x
	}
}

function isWord(x: unknown): x is number {
	return typeof x === "number" && Number.isInteger(x) && x >= -0x80_00_00_00 && x <= 0xff_ff_ff_ff
}

/**
 * Parses an index argument to a bigint, or returns `undefined` if it is not well formed.
 *
 * @internal
 */
export function tryParseIndex(x: unknown): bigint | undefined {
	if (typeof x === "string") return HEX.test(x) ? BigInt("0x" + x) : undefined

	if (Array.isArray(x) && x.length === 2 && isWord(x[0]) && isWord(x[1])) {
		return (BigInt(x[1] >>> 0) << 32n) | BigInt(x[0] >>> 0)
	}

	return undefined
}

/**
 * Parses an index argument to a bigint: `TypeError` for a wrong container type, `RangeError` for a malformed string or
 * tuple.
 *
 * @internal
 */
export function parseIndex(x: unknown, name: string): bigint {
	if (typeof x === "string") {
		if (!HEX.test(x)) throw new RangeError(`${name} must be 1-16 hexadecimal digits; got ${JSON.stringify(x)}`)

		return BigInt("0x" + x)
	}

	if (Array.isArray(x)) {
		if (x.length === 2 && isWord(x[0]) && isWord(x[1])) return (BigInt(x[1] >>> 0) << 32n) | BigInt(x[0] >>> 0)
		throw new RangeError(`${name} must be a [lower, upper] pair of 32-bit integers`)
	}

	throw new TypeError(`${name} must be an H3 index string or a [lower, upper] pair`)
}

/**
 * Parses an array of index arguments.
 *
 * @internal
 */
export function parseIndexArray(xs: unknown, name: string): BigUint64Array {
	if (!Array.isArray(xs)) throw new TypeError(`${name} must be an array of H3 indexes`)
	const out = new BigUint64Array(xs.length)

	for (let i = 0; i < xs.length; i++) {
		out[i] = parseIndex(xs[i], `${name}[${i}]`)
	}

	return out
}

/**
 * @internal
 */
export function formatIndex<T extends string = H3Index>(h: bigint): T {
	return h.toString(16) as T
}

/**
 * @internal
 */
export function formatIndexArray<T extends string = H3Index>(xs: BigUint64Array): T[] {
	const out: T[] = new Array(xs.length)

	for (let i = 0; i < xs.length; i++) {
		out[i] = xs[i]!.toString(16) as T
	}

	return out
}

/**
 * Validates an integer argument within an inclusive range. @internal
 */
export function intArg(x: unknown, name: string, min: number, max: number): number {
	if (typeof x !== "number") throw new TypeError(`${name} must be a number`)

	if (!Number.isInteger(x) || x < min || x > max) {
		throw new RangeError(`${name} must be an integer from ${min} to ${max}; got ${x}`)
	}

	return x
}

/**
 * Validates a resolution argument (0–15). @internal
 */
export function resArg(x: unknown, name = "res"): number {
	return intArg(x, name, 0, 15)
}

/**
 * Validates a finite number argument. @internal
 */
export function finiteArg(x: unknown, name: string): number {
	if (typeof x !== "number") throw new TypeError(`${name} must be a number`)

	if (!Number.isFinite(x)) throw new RangeError(`${name} must be finite; got ${x}`)

	return x
}

/**
 * Validates an optional boolean switch: `undefined` or an actual boolean. @internal
 */
export function boolArg(x: unknown, name: string): boolean {
	if (x === undefined) return false

	if (typeof x !== "boolean") throw new RangeError(`${name} must be a boolean or undefined; got ${describe(x)}`)

	return x
}

/**
 * Converts an H3 index to a split long: `[lower, upper]` unsigned 32-bit words. Pure; works before initialization.
 */
export function h3IndexToSplitLong(h3Index: H3IndexInput): SplitLong {
	const h = parseIndex(h3Index, "h3Index")

	return [Number(h & 0xff_ff_ff_ffn), Number(h >> 32n)]
}

/**
 * Converts a split long to an index string: the upper word in unpadded lowercase hex followed by exactly eight hex
 * digits of the lower word. Pure; works before initialization.
 */
export function splitLongToH3Index<T extends string = H3Index>(lower: number, upper: number): T {
	if (typeof lower !== "number" || typeof upper !== "number") throw new TypeError("lower and upper must be numbers")

	if (!isWord(lower) || !isWord(upper)) {
		throw new RangeError("lower and upper must be integers from -0x80000000 to 0xffffffff")
	}

	return ((upper >>> 0).toString(16) + (lower >>> 0).toString(16).padStart(8, "0")) as T
}
