/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import type { Stat } from "#benchmarks/stats"

export interface MemorySnapshot {
	heapUsedBytes: number
	arrayBuffersBytes: number
	externalBytes: number
	wasmMemoryBytes: number
}

export interface NodeMemory {
	stages: Record<string, MemorySnapshot>
	repeatedWorkloadWasmBytes: number[]
	compactCellsInput: number
}

export interface WorkerSnapshot {
	wasmMemoryBytes: number
	jsHeapUsedBytes: number
	jsHeapTotalBytes: number
	backingStorageBytes: number
}

export type WorkerMemory =
	| { status: "measured"; stages: Record<string, WorkerSnapshot> }
	| { status: "unavailable" | "failed"; detail: string }

export interface InitMeasurement {
	importMs: number
	initMs: number
	firstCallMs: number
	secondCallMs: number
}

export interface JavaScriptMeasurement {
	ours: Stat
	h3js: Stat
	validation: string
	oursOpsPerSec: number
	h3jsOpsPerSec: number
}

export interface BenchmarkReport {
	schemaVersion: 2
	environment: {
		date: string
		node: string
		cpu: string
		cores: number
		memoryGiB: number
		loadAverageBefore: number[]
		loadAverageAfter: number[]
		rustc: string
		wasmBytes: number
		h3js: string
	}
	samples: number
	js: Record<string, JavaScriptMeasurement>
	boundary: Record<string, Stat>
	init: Record<"importMs" | "firstCallMs" | "secondCallMs" | "explicitInitMs" | "explicitFirstCallMs", Stat>
	native: Record<string, { rust: Stat; rustLibm: Stat; c?: Stat; checksumMatch?: boolean }>
	memory: { node: NodeMemory; worker: WorkerMemory }
}
