/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { copyFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"

import { bin, root } from "../scripts/support/paths.ts"
import { run, startService } from "../scripts/support/process.ts"
import { freePort } from "../scripts/support/server.ts"
import { out } from "./context.ts"
import { connectInspector } from "./inspector.ts"
import type { WorkerMemory, WorkerSnapshot } from "./types.ts"

export async function measureWorkerMemory(): Promise<WorkerMemory> {
	const dir = join(out, "worker")
	mkdirSync(dir, { recursive: true })

	try {
		run(bin("esbuild"), [
			join(root, "benchmarks/probes/worker-entry.ts"),
			"--bundle",
			"--format=esm",
			"--platform=neutral",
			"--ignore-annotations",
			"--alias:@sister.software/h3/h3.wasm=./h3.wasm",
			"--external:./h3.wasm",
			`--outfile=${join(dir, "h3.mjs")}`,
		])

		run(bin("esbuild"), [
			join(root, "benchmarks/probes/worker-memory.ts"),
			"--bundle",
			"--format=esm",
			"--platform=neutral",
			"--alias:h3-memory=./h3.mjs",
			"--external:./h3.mjs",
			`--outfile=${join(dir, "worker.mjs")}`,
		])

		copyFileSync(join(root, "wasm/h3.wasm"), join(dir, "h3.wasm"))

		writeFileSync(
			join(dir, "wrangler.toml"),
			'name = "h3-memory"\nmain = "worker.mjs"\ncompatibility_date = "2026-10-01"\nfind_additional_modules = true\nrules = [{ type = "ESModule", globs = ["**/*.mjs"], fallthrough = true }]\n'
		)
	} catch (error) {
		return { status: "failed", detail: String(error) }
	}

	const port = await freePort()
	let inspectorPort = await freePort()

	while (inspectorPort === port) {
		inspectorPort = await freePort()
	}

	const base = `http://127.0.0.1:${port}`

	const service = startService(
		bin("wrangler"),
		[
			"dev",
			"--port",
			String(port),
			"--inspector-port",
			String(inspectorPort),
			"--ip",
			"127.0.0.1",
			"--log-level",
			"warn",
			"--show-interactive-dev-session=false",
		],
		dir,
		{ ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" }
	)

	try {
		await service.ready(base + "/baseline")

		const targets = (await (await fetch(`http://127.0.0.1:${inspectorPort}/json`)).json()) as {
			webSocketDebuggerUrl: string
		}[]

		if (!targets[0]) return { status: "unavailable", detail: "workerd exposed no inspector target" }
		const inspector = await connectInspector(targets[0].webSocketDebuggerUrl)

		try {
			const stages: Record<string, WorkerSnapshot> = {}

			for (const step of ["baseline", "import", "init", "scalar", "disk", "compact", "polygon"]) {
				const response = await fetch(`${base}/${step}`)

				if (!response.ok) throw new Error(`Worker stage ${step}: HTTP ${response.status}`)
				const result = (await response.json()) as { wasmMemoryBytes: number }
				// Wrangler does not reply to this command; the delay matches the measurement protocol.
				inspector.collectGarbage()
				await delay(1500)
				const heap = await inspector.heapUsage()

				stages[step] = {
					wasmMemoryBytes: result.wasmMemoryBytes,
					jsHeapUsedBytes: heap.usedSize,
					jsHeapTotalBytes: heap.totalSize,
					backingStorageBytes: heap.backingStorageSize,
				}
			}

			return { status: "measured", stages }
		} finally {
			inspector.close()
		}
	} catch (error) {
		return { status: "failed", detail: String(error) }
	} finally {
		await service.close()
	}
}
