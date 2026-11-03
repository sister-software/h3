/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { deepStrictEqual } from "node:assert"

import { samples } from "./context.ts"
import { points } from "./inputs.ts"
import { stat } from "./stats.ts"
import type { JavaScriptMeasurement } from "./types.ts"

interface BenchmarkApi {
	latLngToCell(lat: number, lng: number, res: number): string
	cellToParent(cell: string, res: number): string
	cellToLatLng(cell: string): [number, number]
	cellToChildren(cell: string, res: number): string[]
	gridDisk(cell: string, k: number): string[]
	compactCells(cells: string[]): string[]
	polygonToCells(polygon: number[][], res: number): string[]
	radsToDegs(radians: number): number
}

interface Workload {
	name: string
	ops: number
	run: (api: BenchmarkApi) => unknown
	validate: (ours: BenchmarkApi, reference: BenchmarkApi) => void
	validation: string
}

function sameCells(ours: string[], reference: string[]): void {
	deepStrictEqual(ours.toSorted(), reference.toSorted())
}

export function measureJavaScript(ours: BenchmarkApi, reference: BenchmarkApi) {
	const pts = points(10_000)
	const cells = pts.map(([lat, lng]) => ours.latLngToCell(lat, lng, 9))
	const diskOrigins = cells.slice(0, 1000)
	const compactInput = ours.cellToChildren(ours.cellToParent(cells[0]!, 5), 9)

	const polygon = [
		[0.659966917655, -2.1364398519396],
		[0.6595011102219, -2.1359434279405],
		[0.6583348114025, -2.1354884206045],
		[0.6581220034068, -2.1382437718946],
		[0.6594479998527, -2.1384597563896],
		[0.6599990002976, -2.1376771158464],
	].map(([lat, lng]) => [ours.radsToDegs(lat!), ours.radsToDegs(lng!)])

	const workloads: Workload[] = [
		{
			name: "latLngToCell",
			ops: pts.length,
			run: (api) => pts.map(([lat, lng]) => api.latLngToCell(lat, lng, 9)),
			validate: (a, b) =>
				deepStrictEqual(
					pts.map(([lat, lng]) => a.latLngToCell(lat, lng, 9)),
					pts.map(([lat, lng]) => b.latLngToCell(lat, lng, 9))
				),
			validation: "10,000 indexes exact",
		},
		{
			name: "cellToParent",
			ops: cells.length,
			run: (api) => cells.map((cell) => api.cellToParent(cell, 5)),
			validate: (a, b) =>
				deepStrictEqual(
					cells.map((cell) => a.cellToParent(cell, 5)),
					cells.map((cell) => b.cellToParent(cell, 5))
				),
			validation: "10,000 indexes exact",
		},
		{
			name: "cellToLatLng",
			ops: cells.length,
			run: (api) => cells.map((cell) => api.cellToLatLng(cell)),
			validate: (a, b) => {
				for (const cell of cells) {
					const got = a.cellToLatLng(cell)
					const want = b.cellToLatLng(cell)

					if (!got.every((coordinate, axis) => Math.abs(coordinate - want[axis]!) <= 1e-12)) {
						throw new Error(`${cell}: center ${JSON.stringify(got)} differs from ${JSON.stringify(want)}`)
					}
				}
			},
			validation: "20,000 coordinates within 1e-12 degrees",
		},
		{
			name: "gridDisk",
			ops: diskOrigins.length,
			run: (api) => diskOrigins.map((cell) => api.gridDisk(cell, 2)),
			validate: (a, b) => {
				for (const cell of diskOrigins) {
					sameCells(a.gridDisk(cell, 2), b.gridDisk(cell, 2))
				}
			},
			validation: "1,000 complete cell sets exact",
		},
		{
			name: "compactCells",
			ops: 1,
			run: (api) => api.compactCells(compactInput),
			validate: (a, b) => sameCells(a.compactCells(compactInput), b.compactCells(compactInput)),
			validation: "complete cell set exact",
		},
		{
			name: "polygonToCells",
			ops: 1,
			run: (api) => api.polygonToCells(polygon, 9),
			validate: (a, b) => sameCells(a.polygonToCells(polygon, 9), b.polygonToCells(polygon, 9)),
			validation: "complete cell set exact",
		},
	]

	const js: Record<string, JavaScriptMeasurement> = {}

	for (const workload of workloads) {
		workload.validate(ours, reference)

		for (let i = 0; i < 3; i++) {
			workload.run(ours)
			workload.run(reference)
		}

		const timings = { ours: [] as number[], reference: [] as number[] }
		let output: unknown

		for (let sample = 0; sample < samples; sample++) {
			const order = sample % 2 ? (["ours", "reference"] as const) : (["reference", "ours"] as const)

			for (const implementation of order) {
				const start = performance.now()
				output = workload.run(implementation === "ours" ? ours : reference)
				timings[implementation].push(((performance.now() - start) * 1e6) / workload.ops)
			}
		}

		if (output === undefined) throw new Error(`${workload.name} returned no benchmark output`)
		const a = stat(timings.ours)
		const b = stat(timings.reference)

		js[workload.name] = {
			ours: a,
			h3js: b,
			validation: workload.validation,
			oursOpsPerSec: 1e9 / a.median,
			h3jsOpsPerSec: 1e9 / b.median,
		}

		console.log(
			`js ${workload.name}: ours ${a.median.toFixed(1)} ns/op, h3-js ${b.median.toFixed(1)} ns/op; ${workload.validation}`
		)
	}

	return { js, cells, pts }
}
