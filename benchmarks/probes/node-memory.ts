/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { readFileSync } from "node:fs"

import type { MemorySnapshot, NodeMemory } from "../types.ts"

const gc = globalThis.gc!

const snap = (wasm: () => number): MemorySnapshot => {
	gc()
	gc()
	const m = process.memoryUsage()

	return {
		heapUsedBytes: m.heapUsed,
		arrayBuffersBytes: m.arrayBuffers,
		externalBytes: m.external,
		wasmMemoryBytes: wasm(),
	}
}

const stages: Record<string, MemorySnapshot> = { beforeImport: snap(() => 0) }
const h3 = (await import(process.argv[2]!)) as typeof import("../../index.ts")
const state = (await import(process.argv[3]!)) as typeof import("../../lib/runtime/state.ts")
stages.afterImport = snap(state.wasmMemoryBytes)
await h3.init({ bytes: readFileSync(process.argv[4]!) })
stages.afterInit = snap(state.wasmMemoryBytes)
const cell = h3.latLngToCell(37.3615593, -122.0553238, 9)

for (let i = 0; i < 100_000; i++) {
	h3.latLngToCell(37 + i * 1e-6, -122, 9)
}

stages.afterScalar = snap(state.wasmMemoryBytes)

for (let i = 0; i < 20; i++) {
	h3.gridDisk(cell, 100)
}

stages.afterDisk100 = snap(state.wasmMemoryBytes)
const kids = h3.cellToChildren(h3.cellToParent(cell, 4), 9)
h3.compactCells(kids)
stages.afterCompact = snap(state.wasmMemoryBytes)

const poly = [
	[37.7, -122.5],
	[37.8, -122.5],
	[37.8, -122.35],
	[37.7, -122.35],
]

h3.polygonToCells(poly, 10)
stages.afterPolygon = snap(state.wasmMemoryBytes)
const plateau = []

for (let r = 0; r < 5; r++) {
	for (let i = 0; i < 20; i++) {
		h3.gridDisk(cell, 100)
		h3.compactCells(kids)
		h3.polygonToCells(poly, 10)
	}

	plateau.push(state.wasmMemoryBytes())
}

const result: NodeMemory = { stages, repeatedWorkloadWasmBytes: plateau, compactCellsInput: kids.length }

console.log(JSON.stringify(result))
