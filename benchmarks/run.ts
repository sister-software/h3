/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */
import { readFileSync } from "node:fs"
import { loadavg } from "node:os"
import { join } from "node:path"

import { measureBoundary } from "#benchmarks/boundary"
import { prepare, samples, reportDir } from "#benchmarks/context"
import { measureJavaScript } from "#benchmarks/javascript"
import { measureNative } from "#benchmarks/native"
import { measureInit, measureNodeMemory } from "#benchmarks/probes"
import { writeReports } from "#benchmarks/report"
import type { BenchmarkReport } from "#benchmarks/types"
import { measureWorkerMemory } from "#benchmarks/worker"
import { root } from "#scripts/support/paths"

const environment = prepare()
const ours = await import("@sister.software/h3")
const reference = await import("h3-js")
await ours.init({ bytes: readFileSync(join(root, "wasm/h3.wasm")) })
const { js, cells, pts } = measureJavaScript(ours, reference)
const boundary = await measureBoundary(ours, cells, pts)
const init = measureInit()
const native = measureNative()
const node = measureNodeMemory()
const worker = await measureWorkerMemory()

const report: BenchmarkReport = {
	schemaVersion: 2,
	environment: { ...environment, loadAverageAfter: loadavg().map((x) => Number(x.toFixed(2))) },
	samples,
	js,
	boundary,
	init,
	native,
	memory: { node, worker },
}

await writeReports(report, reportDir)

console.log(`benchmark: wrote ${reportDir}/RESULTS.md and ${reportDir}/results/latest.json`)

if (worker.status === "failed") {
	console.error(worker.detail)

	process.exitCode = 1
}
