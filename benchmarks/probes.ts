/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { bin, root } from "../scripts/support/paths.ts"
import { run } from "../scripts/support/process.ts"
import { out, samples } from "./context.ts"
import { stat } from "./stats.ts"
import type { InitMeasurement, NodeMemory } from "./types.ts"

function compileProbe(name: string): string {
	const script = join(out, `${name}.mjs`)
	run(bin("esbuild"), [join(root, `benchmarks/probes/${name}.ts`), "--format=esm", `--outfile=${script}`])

	return script
}

export function measureInit() {
	const script = compileProbe("init")

	const runs = (mode: string) =>
		Array.from(
			{ length: Math.min(samples, 9) },
			() =>
				JSON.parse(
					run(process.execPath, [
						script,
						mode,
						pathToFileURL(join(root, "out/index.js")).href,
						join(root, "wasm/h3.wasm"),
					])
				) as InitMeasurement
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
	const script = compileProbe("node-memory")

	return JSON.parse(
		run(process.execPath, [
			"--expose-gc",
			script,
			pathToFileURL(join(root, "out/index.js")).href,
			pathToFileURL(join(root, "out/lib/runtime/state.js")).href,
			join(root, "wasm/h3.wasm"),
		])
	) as NodeMemory
}
