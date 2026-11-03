/**
 * The JavaScript argument, result, and error contract (docs/api-decisions.md), the export inventory, and resource
 * limits at the defaults.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { beforeAll, describe, expect, test } from "vitest"

import * as h3 from "../../index.ts"
import manifest from "../api-manifest.json" with { type: "json" }
import { SUPPORTED_OPERATIONS } from "../shared/fixture-cases.ts"

const root = join(import.meta.dirname, "../..")
const CELL = "87283472bffffff"

beforeAll(async () => {
	await h3.init({ bytes: readFileSync(join(root, "wasm/h3.wasm")) })
})

function thrown(fn: () => unknown): { name?: string; code?: number; constructor?: unknown } {
	try {
		fn()
	} catch (error) {
		return error as never
	}

	throw new Error("did not throw")
}

describe("exports", () => {
	test("root runtime exports equal the manifest", () => {
		expect(Object.keys(h3).toSorted()).toEqual(manifest.entries.map((e) => e.name).toSorted())
		expect(manifest.entries).toHaveLength(59)
	})

	test("every manifest row links to fixture evidence exercised by the dispatcher", () => {
		for (const entry of manifest.entries) {
			expect(entry.tests.length, entry.name).toBeGreaterThan(0)

			for (const t of entry.tests.filter((x) => x.includes("fixtures/"))) {
				const file = t.split(" ")[0]!

				expect(existsSync(join(root, file)), file).toBe(true)
				expect(SUPPORTED_OPERATIONS, file).toContain(file.replace(/^.*\/(\w+)\.jsonl$/, "$1"))
			}
		}
	})

	test("H3Error is a type, not a runtime constructor", () => {
		expect("H3Error" in h3).toBe(false)
	})

	test("constants are frozen", () => {
		expect(Object.isFrozen(h3.UNITS)).toBe(true)
		expect(Object.isFrozen(h3.POLYGON_TO_CELLS_FLAGS)).toBe(true)
	})
})

describe("index representation", () => {
	test("accepts either case and split longs; returns canonical lowercase", () => {
		expect(h3.cellToParent(CELL.toUpperCase(), 5)).toBe(h3.cellToParent(CELL, 5))
		expect(h3.cellToParent(h3.h3IndexToSplitLong(CELL), 5)).toBe(h3.cellToParent(CELL, 5))
		expect(h3.cellToParent(CELL, 5)).toMatch(/^[0-9a-f]+$/)
	})

	test("split longs accept signed and unsigned words", () => {
		const [lo, hi] = h3.h3IndexToSplitLong(CELL)
		expect(h3.splitLongToH3Index(lo | 0, hi | 0)).toBe(CELL)
		expect(h3.splitLongToH3Index(lo, hi)).toBe(CELL)
		expect(h3.splitLongToH3Index(0, 0)).toBe("000000000")
		expect(h3.h3IndexToSplitLong("ffffffffffffffff")).toEqual([0xff_ff_ff_ff, 0xff_ff_ff_ff])
	})

	test("malformed strings and tuples are RangeErrors; wrong containers are TypeErrors", () => {
		for (const bad of ["", "0x1", " 1", "-1", "+1", "11111111111111111", "xyz", "1.5"]) {
			expect(
				thrown(() => h3.cellToParent(bad, 1)),
				bad
			).toBeInstanceOf(RangeError)
		}

		for (const bad of [[1], [1, 2, 3], [1.5, 0], [0x1_00_00_00_00, 0], [-0x80_00_00_01, 0], ["1", 0]]) {
			expect(
				thrown(() => h3.cellToParent(bad as never, 1)),
				JSON.stringify(bad)
			).toBeInstanceOf(RangeError)
		}

		for (const [lo, hi] of [
			[1.5, 0],
			[0x1_00_00_00_00, 0],
			[0, -0x80_00_00_01],
			[Number.NaN, 0],
		]) {
			expect(thrown(() => h3.splitLongToH3Index(lo!, hi!))).toBeInstanceOf(RangeError)
		}

		expect(thrown(() => h3.splitLongToH3Index("1" as never, 0))).toBeInstanceOf(TypeError)

		for (const bad of [5, 5n, null, undefined, {}, true]) {
			expect(
				thrown(() => h3.cellToParent(bad as never, 1)),
				typeof bad === "bigint" ? `${bad}n` : (JSON.stringify(bad) ?? typeof bad)
			).toBeInstanceOf(TypeError)
		}
	})
})

describe("argument validation", () => {
	test("resolutions must be integers 0-15", () => {
		for (const res of [-1, 16, 7.5, Number.NaN, Infinity]) {
			expect(
				thrown(() => h3.latLngToCell(0, 0, res)),
				String(res)
			).toBeInstanceOf(RangeError)
		}

		expect(thrown(() => h3.latLngToCell(0, 0, "7" as never))).toBeInstanceOf(TypeError)
	})

	test("ringSize must be a non-negative integer", () => {
		for (const k of [-1, 1.5, Number.NaN]) {
			expect(thrown(() => h3.gridDisk(CELL, k))).toBeInstanceOf(RangeError)
		}

		expect(thrown(() => h3.gridDisk(CELL, "1" as never))).toBeInstanceOf(TypeError)
	})

	test("non-finite coordinates are RangeErrors; finite out-of-range follows C", () => {
		for (const v of [Number.NaN, Infinity, -Infinity]) {
			expect(thrown(() => h3.latLngToCell(v, 0, 5))).toBeInstanceOf(RangeError)
			expect(thrown(() => h3.greatCircleDistance([v, 0], [0, 0], "km"))).toBeInstanceOf(RangeError)

			expect(
				thrown(() =>
					h3.polygonToCells(
						[
							[0, 0],
							[1, v],
							[1, 1],
						],
						5
					)
				)
			).toBeInstanceOf(RangeError)
		}

		expect(h3.isValidCell(h3.latLngToCell(100, 0, 5))).toBe(true)
		expect(h3.isValidCell(h3.latLngToCell(0, 540, 5))).toBe(true)
	})

	test("optional switches must be undefined or boolean", () => {
		expect(h3.cellToBoundary(CELL, undefined)).toHaveLength(6)
		expect(h3.cellToBoundary(CELL, true)).toHaveLength(7)

		for (const v of [1, 0, "true", null]) {
			expect(
				thrown(() => h3.cellToBoundary(CELL, v as never)),
				String(v)
			).toBeInstanceOf(RangeError)
		}
	})

	test("units and flags are validated", () => {
		expect(thrown(() => h3.cellArea(CELL, "km" as never))).toBeInstanceOf(RangeError)
		expect(thrown(() => h3.cellArea(CELL, 1 as never))).toBeInstanceOf(TypeError)
		expect(thrown(() => h3.greatCircleDistance([0, 0], [1, 1], "km2" as never))).toBeInstanceOf(RangeError)

		expect(
			thrown(() =>
				h3.polygonToCellsExperimental(
					[
						[0, 0],
						[1, 0],
						[1, 1],
					],
					5,
					"nope"
				)
			)
		).toBeInstanceOf(RangeError)
	})

	test("constructCell keeps JavaScript argument order and checks res against digits", () => {
		expect(h3.constructCell(20, [1, 2, 3])).toBe(h3.constructCell(20, [1, 2, 3], 3))
		expect(thrown(() => h3.constructCell(20, [1, 2, 3], 4))).toBeInstanceOf(RangeError)
		expect(thrown(() => h3.constructCell(122, []))).toMatchObject({ name: "H3Error", code: 17 })
		expect(thrown(() => h3.constructCell(0, [7]))).toMatchObject({ name: "H3Error", code: 18 })
		expect(thrown(() => h3.constructCell(4, [1]))).toMatchObject({ name: "H3Error", code: 19 })
	})
})

describe("results and documented exceptions", () => {
	test("C errors become H3Error with the numeric code and C description", () => {
		const e = thrown(() => h3.cellToParent(CELL, 9)) as Error & { code: number }
		expect(e.name).toBe("H3Error")
		expect(e.code).toBe(12)
		expect(e.message).toBe("Cell arguments had incompatible resolutions")
		expect(e).toBeInstanceOf(Error)
	})

	test("validation predicates never throw", () => {
		for (const v of [undefined, null, 5, 5n, {}, [], "xyz", "", [1.5, 2], "ffffffffffffffff", CELL]) {
			for (const fn of [h3.isValidCell, h3.isValidIndex, h3.isValidDirectedEdge, h3.isValidVertex]) {
				expect(typeof fn(v)).toBe("boolean")
			}
		}

		expect(h3.isValidCell(CELL)).toBe(true)
	})

	test("isPentagon and isResClassIII are false for non-cells; getResolution is -1", () => {
		const edge = h3.originToDirectedEdges(CELL)[0]!
		expect(h3.isPentagon("ffffffffffffffff")).toBe(false)
		expect(h3.isResClassIII("ffffffffffffffff")).toBe(false)
		expect(h3.getResolution(edge)).toBe(-1)
		expect(h3.getResolution("xyz")).toBe(-1)
		expect(h3.getResolution(CELL)).toBe(7)
		expect(thrown(() => h3.getResolution(5 as never))).toBeInstanceOf(TypeError)
		expect(thrown(() => h3.isPentagon(5 as never))).toBeInstanceOf(TypeError)
	})

	test("getIndexDigit returns the stored unused digit 7 past the resolution", () => {
		expect(h3.getIndexDigit(CELL, 8)).toBe(7)
		expect(thrown(() => h3.getIndexDigit(CELL, 0))).toBeInstanceOf(RangeError)
	})

	test("GeoJSON output closes loops and swaps order", () => {
		const plain = h3.cellToBoundary(CELL)
		const geo = h3.cellToBoundary(CELL, true)
		expect(geo[0]).toEqual([plain[0]![1], plain[0]![0]])
		expect(geo.at(-1)).toEqual(geo[0])
		const mp = h3.cellsToMultiPolygon([CELL], true)
		expect(mp[0]![0]!.at(-1)).toEqual(mp[0]![0]![0])
		expect(h3.directedEdgeToBoundary(h3.originToDirectedEdges(CELL)[0]!, true)).toHaveLength(2)
	})

	test("results are copies that survive later calls", () => {
		const first = h3.gridDisk(CELL, 2)
		const copy = [...first]
		h3.gridDisk(h3.latLngToCell(10, 10, 9), 30)

		h3.polygonToCells(
			[
				[37, -122],
				[37.5, -122],
				[37.5, -122.5],
			],
			7
		)

		expect(first).toEqual(copy)
	})

	test("README example", () => {
		expect(h3.latLngToCell(37.3615593, -122.0553238, 7)).toBe("87283472bffffff")
	})
})

describe("resource limits at the defaults", () => {
	test("oversized requests are rejected before allocation", () => {
		const e = thrown(() => h3.cellToChildren("8001fffffffffff", 15)) as RangeError & Record<string, unknown>
		expect(e).toBeInstanceOf(RangeError)
		expect(e.name).toBe("H3ResourceLimitError")
		expect(e.limit).toBe("maxResultItems")
		expect(e.requested).toBe(7 ** 15)
		expect(e.maximum).toBe(1_000_000)
		expect(thrown(() => h3.gridDisk(CELL, 100_000))).toMatchObject({ name: "H3ResourceLimitError" })
		expect(thrown(() => h3.uncompactCells(["8001fffffffffff"], 15))).toMatchObject({ name: "H3ResourceLimitError" })
		// The instance remains usable.
		expect(h3.gridDisk(CELL, 1)).toHaveLength(7)
	})
})
