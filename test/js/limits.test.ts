/**
 * Resource limits with small explicit budgets (docs/api-decisions.md, "Resource limits"). This file runs in its own
 * module graph, so its limits do not affect other suites.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, test, vi } from "vitest"

const root = join(import.meta.dirname, "../..")
const bytes = readFileSync(join(root, "wasm/h3.wasm"))
const CELL = "87283472bffffff"

async function withLimits(limits: Record<string, number>) {
	vi.resetModules()
	const h3 = await import("../../index.ts")
	await h3.init({ bytes, limits })

	return h3
}

function rejection(fn: () => unknown): Record<string, unknown> {
	try {
		fn()
	} catch (error) {
		return error as never
	}

	throw new Error("did not throw")
}

describe("maxResultItems", () => {
	test("a seven-cell disk is rejected at 6 and accepted at exactly 7", async () => {
		let h3 = await withLimits({ maxResultItems: 6 })
		const e = rejection(() => h3.gridDisk(CELL, 1))
		expect(e).toBeInstanceOf(RangeError)
		expect(e).toMatchObject({ name: "H3ResourceLimitError", limit: "maxResultItems", requested: 7, maximum: 6 })
		h3 = await withLimits({ maxResultItems: 7 })
		expect(h3.gridDisk(CELL, 1)).toHaveLength(7)
	})

	test("applies to every variable-length operation", async () => {
		const h3 = await withLimits({ maxResultItems: 6 })
		const check = (fn: () => unknown) => expect(rejection(fn)).toMatchObject({ name: "H3ResourceLimitError" })
		check(() => h3.cellToChildren(CELL, 8))
		check(() => h3.uncompactCells([CELL], 8))
		check(() => h3.gridRing(CELL, 2))
		check(() => h3.gridDiskDistances(CELL, 1))
		check(() => h3.getRes0Cells())
		check(() => h3.getPentagons(3))
		check(() => h3.compactCells(new Array(7).fill(CELL)))

		check(() =>
			h3.polygonToCells(
				[
					[37, -122],
					[37.5, -122],
					[37.5, -122.5],
				],
				7
			)
		)

		check(() =>
			h3.polygonToCellsExperimental(
				[
					[37, -122],
					[37.5, -122],
					[37.5, -122.5],
				],
				7,
				"containmentCenter"
			)
		)

		check(() => h3.cellsToMultiPolygon([CELL]))
		check(() => h3.gridPathCells(CELL, h3.gridRingUnsafe(CELL, 3)[0]!))
		// Scalars are not affected.
		expect(h3.cellToParent(CELL, 5)).toBe("85283473fffffff")
	})
})

describe("maxResultBytes and maxWorkspaceBytes", () => {
	test("result bytes", async () => {
		const h3 = await withLimits({ maxResultBytes: 100 })

		expect(rejection(() => h3.gridDisk(CELL, 1))).toMatchObject({
			name: "H3ResourceLimitError",
			limit: "maxResultBytes",
		})
	})

	test("workspace bytes", async () => {
		const h3 = await withLimits({ maxWorkspaceBytes: 10 })

		expect(rejection(() => h3.compactCells([CELL, CELL]))).toMatchObject({
			name: "H3ResourceLimitError",
			limit: "maxWorkspaceBytes",
		})
	})

	test("rejection leaves the instance usable", async () => {
		const h3 = await withLimits({ maxResultItems: 6 })
		expect(() => h3.gridDisk(CELL, 1)).toThrow("maxResultItems")
		expect(h3.gridDisk(CELL, 0)).toEqual([CELL])
		expect(h3.latLngToCell(37.3615593, -122.0553238, 7)).toBe(CELL)
	})
})
