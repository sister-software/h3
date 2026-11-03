/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */
import { readFileSync } from "node:fs"
import { loadavg } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { root } from "../scripts/support/paths.ts"
import { measureBoundary } from "./boundary.ts"
import { prepare, samples, reportDir } from "./context.ts"
import { measureJavaScript } from "./javascript.ts"
import { measureNative } from "./native.ts"
import { measureInit, measureNodeMemory } from "./probes.ts"
import { writeReports } from "./report.ts"
import type { BenchmarkReport } from "./types.ts"
import { measureWorkerMemory } from "./worker.ts"

const environment = prepare()
const ours = (await import(pathToFileURL(join(root, "out/index.js")).href)) as typeof import("../index.ts")
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
