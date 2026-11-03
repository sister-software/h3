/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { join } from "node:path"

import { samples } from "#benchmarks/context"
import { stat } from "#benchmarks/stats"
import type { InitMeasurement, NodeMemory } from "#benchmarks/types"
import { root } from "#scripts/support/paths"
import { run } from "#scripts/support/process"

export function measureInit() {
	const script = join(root, "benchmarks/probes/init.ts")

	const runs = (mode: string) =>
		Array.from(
			{ length: Math.min(samples, 9) },
			() => JSON.parse(run(process.execPath, [script, "--mode", mode])) as InitMeasurement
		)

	const lazy = runs("lazy")
	const explicit = runs("explicit")

	return {
		importMs: stat(lazy.map((measurement) => measurement.importMs)),
		firstCallMs: stat(lazy.map((measurement) => measurement.firstCallMs)),
		secondCallMs: stat(lazy.map((measurement) => measurement.secondCallMs)),
		explicitInitMs: stat(explicit.map((measurement) => measurement.initMs)),
		explicitFirstCallMs: stat(explicit.map((measurement) => measurement.firstCallMs)),
	}
}

export function measureNodeMemory(): NodeMemory {
	const script = join(root, "benchmarks/probes/node-memory.ts")

	return JSON.parse(run(process.execPath, ["--expose-gc", script])) as NodeMemory
}
