/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { mkdirSync, readFileSync } from "node:fs"
import { cpus, loadavg, totalmem } from "node:os"
import { join } from "node:path"

import { root } from "../scripts/support/paths.ts"
import { run } from "../scripts/support/process.ts"

export const reportDir = process.env.H3_BENCH_OUTPUT ?? join(root, "benchmarks")
export const out = join(root, "target/benchmark")
export const samples = Number(process.env.H3_BENCH_SAMPLES ?? 15)

if (!Number.isSafeInteger(samples) || samples < 1) throw new RangeError("H3_BENCH_SAMPLES must be a positive integer")
export const jobs = process.env.H3_BUILD_JOBS ?? "4"

export function prepare() {
	mkdirSync(out, { recursive: true })
	mkdirSync(join(reportDir, "results"), { recursive: true })
	run("yarn", ["compile"])

	return {
		date: new Date().toISOString(),
		node: process.version,
		cpu: cpus()[0]?.model ?? "unknown",
		cores: cpus().length,
		memoryGiB: Math.round(totalmem() / 2 ** 30),
		loadAverageBefore: loadavg().map((x) => Number(x.toFixed(2))),
		rustc: run("rustc", ["--version"]).trim(),
		wasmBytes: readFileSync(join(root, "wasm/h3.wasm")).length,
		h3js: JSON.parse(readFileSync(join(root, "node_modules/h3-js/package.json"), "utf8")).version as string,
	}
}
