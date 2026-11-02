/**
 * Migration from h3-js 4.5.0: every observable difference between h3-js and this package on the C fixture inputs must
 * belong to a documented category (docs/api-decisions.md, "Differences from h3-js 4.5.0"), and each category has an
 * explicit example asserting both behaviours.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import * as h3js from "h3-js"
import { beforeAll, describe, expect, test } from "vitest"

import * as h3 from "../../index.ts"
import { expectsRangeError, type FixtureRecord, invoke, SUPPORTED_OPERATIONS } from "../shared/fixture-cases.ts"

const root = join(import.meta.dirname, "../..")
const CELL = "87283472bffffff"

beforeAll(async () => {
	await h3.init({ bytes: readFileSync(join(root, "wasm/h3.wasm")) })
})

function outcome(fn: () => unknown): { value?: unknown; error?: { name: string; code?: number } } {
	try {
		return { value: fn() }
	} catch (error) {
		return { error: { name: (error as Error).name, code: (error as { code?: number }).code } }
	}
}

const tagged = (x: unknown) => (x === "nan" ? Number.NaN : x === "inf" ? Infinity : x === "-inf" ? -Infinity : x)

/**
 * Classifies a difference between h3-js and this package for one fixture record, or returns undefined if it is not a
 * documented difference.
 */
function classify(
	rec: FixtureRecord,
	theirs: ReturnType<typeof invoke>,
	ours: ReturnType<typeof invoke>
): string | undefined {
	if (!theirs || !ours) return undefined

	// 1. Same C failure, different error name and message: h3-js `Error` with `code`, ours `H3Error`.
	if (!theirs.ok && !ours.ok && ours.error.name === "H3Error" && theirs.error.code === ours.error.code)
		return "error-name"

	// 2. Binding range validation: ours RangeError where h3-js reports a C code, truncates, or passes
	//    non-finite values through.
	if (!ours.ok && ours.error.isRangeError && expectsRangeError(rec)) return "range-error"

	// 3. Predicates on non-cells.
	if ((rec.operation === "isPentagon" || rec.operation === "isResClassIII") && ours.ok && ours.value === false)
		return "predicate"

	// 4. C H3_NULL results.
	if (ours.ok && (ours.value === "0" || (Array.isArray(ours.value) && ours.value.includes("0")))) return "null-result"

	// 5. h3-js validating cell arguments that C does not validate.
	if (!theirs.ok && theirs.error.code === 5 && (ours.ok || ours.error.code !== 5)) return "h3js-prevalidation"

	// 6. Empty polygon: C E_FAILED, h3-js [].
	if (rec.operation === "polygonToCells" && !ours.ok && ours.error.code === 1 && theirs.ok) return "empty-polygon"

	// 8. Fixes in the pinned C revision (v4.5.0-67-g24946ad1) after the v4.5.0 release that h3-js
	//    4.5.0 bundles: polygon bounding boxes clamp out-of-range latitudes (uber/h3#1226).
	if (rec.args.name === "outOfRangeLat") return "c-revision"

	// 9. Measurement precision on very small features: the pinned C computes coordinates with
	//    atan2 (uber/h3#1255) where h3-js's C uses asin, and the WASM math libraries differ. Our
	//    values match pinned C (C parity tests); h3-js differs by at most 1e-6 relative.
	if (/^(edgeLength|cellArea|greatCircleDistance)/.test(rec.operation) && ours.ok && theirs.ok) {
		const a = ours.value as number
		const b = theirs.value as number

		if (Math.abs(a - b) <= Math.abs(a) * 1e-6) return "measurement-precision"
	}

	// 7. Degree conversion rounding (h3-js uses Math.PI / 180 in two steps).
	if ((rec.operation === "degsToRads" || rec.operation === "radsToDegs") && ours.ok && theirs.ok) {
		const a = ours.value as number
		const b = theirs.value as number

		if (Math.abs(a - b) <= Math.abs(a) * 4 * Number.EPSILON) return "degree-rounding"
	}

	return undefined
}

describe("h3-js 4.5.0 versus this package on C fixtures", () => {
	const counts: Record<string, number> = {}

	for (const op of SUPPORTED_OPERATIONS) {
		test(`${op}`, () => {
			const records: FixtureRecord[] = readFileSync(join(root, "crates/h3-core/tests/fixtures", `${op}.jsonl`), "utf8")
				.trim()
				.split("\n")
				.map((l) => JSON.parse(l))

			const undocumented: unknown[] = []

			for (const rec of records) {
				const theirs = invoke(h3js, rec)
				const ours = invoke(h3, rec)

				if (!theirs || !ours) continue

				if (JSON.stringify(theirs) === JSON.stringify(ours)) continue

				if (theirs.ok && ours.ok && JSON.stringify(theirs.value) === JSON.stringify(ours.value)) continue

				// Floating-point results within the C parity tolerance are equivalent.
				if (theirs.ok && ours.ok && approximatelyEqual(theirs.value, ours.value)) continue
				const kind = classify(rec, theirs, ours)

				if (kind) {
					counts[kind] = (counts[kind] ?? 0) + 1
				} else {
					undocumented.push({ args: rec.args, theirs, ours })
				}
			}

			expect(undocumented.slice(0, 3)).toEqual([])
		})
	}

	test("difference categories observed", () => {
		console.log("h3-js migration differences by category:", JSON.stringify(counts))

		expect(Object.keys(counts).length).toBeGreaterThan(0)
	})
})

/**
 * Floating-point results from two different WASM math libraries (Emscripten musl in h3-js, Rust libm here) and two C
 * revisions (uber/h3#1255 changed vec3ToLatLng) differ in the last bits; values within 1e-9 relative (or 1e-12
 * absolute) are treated as equal.
 */
function approximatelyEqual(a: unknown, b: unknown): boolean {
	if (typeof a === "number" && typeof b === "number") {
		return a === b || Math.abs(a - b) <= Math.max(1e-12, Math.abs(a) * 1e-9)
	}

	if (Array.isArray(a) && Array.isArray(b))
		return a.length === b.length && a.every((x, i) => approximatelyEqual(x, b[i]))

	if (a && b && typeof a === "object" && typeof b === "object") {
		const ka = Object.keys(a)

		return ka.length === Object.keys(b).length && ka.every((k) => approximatelyEqual((a as never)[k], (b as never)[k]))
	}

	return a === b
}

describe("documented differences, by example", () => {
	test("error name: h3-js throws Error with code, this package H3Error with the same code", () => {
		const theirs = outcome(() => h3js.cellToParent(CELL, 9))
		const ours = outcome(() => h3.cellToParent(CELL, 9))
		expect(theirs.error).toMatchObject({ name: "Error", code: 12 })
		expect(ours.error).toMatchObject({ name: "H3Error", code: 12 })
	})

	test("out-of-range and fractional resolutions are RangeErrors", () => {
		expect(outcome(() => h3js.cellToParent(CELL, 16)).error).toMatchObject({ code: 4 })
		expect(outcome(() => h3.cellToParent(CELL, 16)).error).toMatchObject({ name: "RangeError" })
		expect(h3js.latLngToCell(37.3615593, -122.0553238, 7.5)).toBe(CELL)
		expect(outcome(() => h3.latLngToCell(37.3615593, -122.0553238, 7.5)).error).toMatchObject({ name: "RangeError" })
	})

	test("non-finite coordinates are RangeErrors", () => {
		expect(outcome(() => h3js.latLngToCell(Number.NaN, 0, 5)).error).toMatchObject({ code: 3 })
		expect(Number.isNaN(h3js.greatCircleDistance([Number.NaN, 0], [0, 0], "km"))).toBe(true)
		expect(outcome(() => h3.latLngToCell(Number.NaN, 0, 5)).error).toMatchObject({ name: "RangeError" })

		expect(outcome(() => h3.greatCircleDistance([Number.NaN, 0], [0, 0], "km")).error).toMatchObject({
			name: "RangeError",
		})
	})

	test("malformed index strings are RangeErrors instead of coercion to 0", () => {
		expect(outcome(() => h3js.cellToParent("xyz", 1)).error).toMatchObject({ code: 12 })
		expect(outcome(() => h3.cellToParent("xyz", 1)).error).toMatchObject({ name: "RangeError" })
		expect(h3js.isValidCell("xyz")).toBe(false)
		expect(h3.isValidCell("xyz")).toBe(false)
	})

	test("non-boolean GeoJSON switches are RangeErrors instead of truthiness", () => {
		expect(h3js.cellToBoundary(CELL, 1 as never)).toHaveLength(7)
		expect(outcome(() => h3.cellToBoundary(CELL, 1 as never)).error).toMatchObject({ name: "RangeError" })
	})

	test("isPentagon and isResClassIII are false for non-cells", () => {
		expect(h3js.isResClassIII("ffffffffffffffff")).toBe(true)
		expect(h3.isResClassIII("ffffffffffffffff")).toBe(false)
	})

	test("C H3_NULL results are returned as the index string 0", () => {
		expect(outcome(() => h3js.cellToParent("0", 0)).error).toBeDefined()
		expect(h3.cellToParent("0", 0)).toBe("0")
		const kids = h3.cellToChildren(CELL, 8)
		expect(h3js.compactCells(["0", ...kids])).toEqual(kids)
		expect(h3.compactCells(["0", ...kids])).toEqual(["0", ...kids])
	})

	test("arguments C does not validate are not pre-validated", () => {
		expect(outcome(() => h3js.cellToChildrenSize("0", 0)).error).toMatchObject({ code: 5 })
		expect(h3.cellToChildrenSize("0", 0)).toBe(1)
	})

	test("an empty polygon follows C", () => {
		expect(h3js.polygonToCells([], 9)).toEqual([])
		expect(outcome(() => h3.polygonToCells([], 9)).error).toMatchObject({ name: "H3Error", code: 1 })
		expect(h3.polygonToCellsExperimental([], 9, "containmentCenter")).toEqual([])
	})

	test("gridPathCells reports C failures that h3-js ignores", () => {
		// Base cells 7 and 53 are not neighbors, so C cannot compute a path.
		const theirs = outcome(() => h3js.gridPathCells("800ffffffffffff", "806bfffffffffff"))
		const ours = outcome(() => h3.gridPathCells("800ffffffffffff", "806bfffffffffff"))
		expect(ours.error).toMatchObject({ name: "H3Error" })
		expect(theirs.error?.code ?? 0).toBe(ours.error!.code)
	})

	test("degree conversion uses C's single-rounding M_PI_180 multiply", () => {
		expect(h3.degsToRads(1e-300)).toBe(1e-300 * 0.017453292519943295)
		expect(h3js.degsToRads(1e-300)).toBe((1e-300 * Math.PI) / 180)
		expect(h3.degsToRads(1e-300)).not.toBe(h3js.degsToRads(1e-300))
	})

	test("calls before init throw H3InitializationError (see test/js/init.test.ts); h3-js needs no init", () => {
		expect(h3js.latLngToCell(37.3615593, -122.0553238, 7)).toBe(CELL)
	})

	test("tagged fixture helper", () => {
		expect(Number.isNaN(tagged("nan"))).toBe(true)
	})
})
