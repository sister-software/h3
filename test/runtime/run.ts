/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */
import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { fixtureRecords, pack } from "../../scripts/support/consumer.ts"
import { root } from "../../scripts/support/paths.ts"
import { checkBrowsers } from "./browsers.ts"
import { RuntimeChecks } from "./checks.ts"
import { checkNode } from "./node.ts"
import { checkWorker } from "./worker.ts"

const work = join(root, "target/runtime")
rmSync(work, { recursive: true, force: true })
const tarball = pack(work)
const records = fixtureRecords()
writeFileSync(join(work, "cases.json"), JSON.stringify(records))
const checks = new RuntimeChecks(records.length)

try {
	checkNode(work, tarball, checks)
	await checkWorker(work, tarball, checks)
	await checkBrowsers(work, tarball, checks)
} finally {
	writeFileSync(join(work, "report.json"), JSON.stringify(checks.results, null, "\t"))
}

const bad = checks.results.filter((check) => check.status !== "pass")

console.log(
	`test:runtimes: ${checks.results.length - bad.length}/${checks.results.length} checks passed; report at target/runtime/report.json`
)

process.exitCode = bad.length ? 1 : 0
