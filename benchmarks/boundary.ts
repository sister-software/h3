/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { root } from "../scripts/support/paths.ts"
import { samples } from "./context.ts"
import { stat, type Stat } from "./stats.ts"

function timeLoop(n: number, fn: (i: number) => unknown): Stat {
	const xs: number[] = []

	for (let r = 0; r < samples; r++) {
		const t = performance.now()

		for (let i = 0; i < n; i++) {
			fn(i)
		}

		xs.push(((performance.now() - t) * 1e6) / n)
	}

	return stat(xs)
}

export async function measureBoundary(ours: typeof import("../index.ts"), cells: string[], pts: [number, number][]) {
	const glue = await import(pathToFileURL(join(root, "out/lib/generated/h3.js")).href)
	const big = cells.map((c) => BigInt("0x" + c))

	const boundary = {
		stringToBigInt: timeLoop(cells.length, (i) => BigInt("0x" + cells[i]!)),
		bigIntToString: timeLoop(cells.length, (i) => big[i]!.toString(16)),
		rawWasmCellToParent: timeLoop(cells.length, (i) => glue.cell_to_parent(big[i], 5)),
		publicCellToParent: timeLoop(cells.length, (i) => ours.cellToParent(cells[i]!, 5)),
		rawWasmLatLngToCell: timeLoop(pts.length, (i) => glue.lat_lng_to_cell(pts[i]![0], pts[i]![1], 9)),
		publicLatLngToCell: timeLoop(pts.length, (i) => ours.latLngToCell(pts[i]![0], pts[i]![1], 9)),
	}

	console.log(
		`boundary: ${JSON.stringify(Object.fromEntries(Object.entries(boundary).map(([k, v]) => [k, v.median.toFixed(1)])))}`
	)

	return boundary
}
