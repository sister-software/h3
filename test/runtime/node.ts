/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { copyFileSync } from "node:fs"
import { join } from "node:path"

import { buildConsumer, installConsumer } from "../../scripts/support/consumer.ts"
import { root } from "../../scripts/support/paths.ts"
import { run } from "../../scripts/support/process.ts"
import type { RuntimeChecks, ProbeResult } from "./checks.ts"

interface NodeResult extends ProbeResult {
	afterImport: Record<string, number>
	first: string
	instances: number
}

export function checkNode(work: string, tarball: string, checks: RuntimeChecks): void {
	const dir = installConsumer(work, "node", tarball)
	copyFileSync(join(work, "cases.json"), join(dir, "cases.json"))
	buildConsumer(join(root, "test/runtime/consumers/node.ts"), dir, "main.mjs")

	for (const variant of ["lazy", "bytes", "module"]) {
		const out = JSON.parse(run(process.execPath, [join(dir, "main.mjs"), variant], dir)) as NodeResult
		const label = variant === "lazy" ? "no init (first-use instantiation)" : `init({ ${variant} })`
		checks.judge(`node ${process.version} ${label}`, out)
		const importClean = Object.values(out.afterImport).every((n) => n === 0)

		checks.record(
			`node import does no WASM work; one instance (${variant})`,
			importClean && out.instances === 1 && out.first === "87283472bffffff" ? "pass" : "fail",
			`WebAssembly calls during import ${JSON.stringify(out.afterImport)}; instances ${out.instances}; first call ${out.first}`
		)
	}
}
