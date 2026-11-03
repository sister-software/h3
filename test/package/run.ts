/**
 * Package tests against installed artifacts, never workspace source:
 *
 * 1. Npm: pack the tarball, inspect its file list, install it into a fresh consumer, check the export map, typecheck a
 *    TypeScript consumer against the shipped declarations, and run the README example and the C-fixture probe under
 *    each required Node version.
 * 2. Native: build and run an external Cargo consumer of the packaged `sister-h3` crate (the unpacked `cargo package`
 *    output), with no access to the workspace, the WASM adapter, or C.
 *
 *    yarn test:package
 *
 * Node versions: the floor of every range in `package.json` `engines` (one per supported LTS line) and the `.nvmrc`
 * version, plus the running Node when `engines` admits it. They are looked up in
 * `target/tools/node-v<version>-linux-x64/bin/node`, then in `~/.nvm/versions/node`. A missing version is reported as
 * NOT RUN and fails the command.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { buildConsumer, fixtureRecords, installConsumer, pack } from "#scripts/support/consumer"
import { root } from "#scripts/support/paths"
import { run as sh } from "#scripts/support/process"
import { checkNativePackage } from "#test/package/native"
import { nodeBinary, nodeVersions } from "#test/package/node-versions"
import { checkTarball, checkDeclarations } from "#test/package/npm"

const work = join(root, "target", "package-test")
const results: { name: string; status: "pass" | "fail" | "not run"; detail: string }[] = []

function record(name: string, status: "pass" | "fail" | "not run", detail: string) {
	results.push({ name, status, detail })

	console.log(`${status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "NOT RUN"}  ${name}: ${detail}`)
}

function attempt(name: string, fn: () => string) {
	try {
		record(name, "pass", fn())
	} catch (error) {
		const e = error as { stderr?: string; stdout?: string; message: string }
		record(name, "fail", (e.stderr || e.stdout || e.message).toString().slice(0, 1500))
	}
}

rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })

// ---------------------------------------------------------------------------------------------
// npm tarball.

const tarball = pack(work)

attempt("tarball contents", () => checkTarball(tarball))

const consumer = installConsumer(work, "npm-consumer", tarball)
const records = fixtureRecords()

writeFileSync(join(consumer, "cases.json"), JSON.stringify(records))

// The README Node example, verbatim, plus the probe.
buildConsumer(join(root, "test/package/consumers/readme.ts"), consumer, "readme.mjs")

buildConsumer(join(root, "test/package/consumers/probe.ts"), consumer, "probe-run.mjs")

buildConsumer(join(root, "test/package/consumers/exports.ts"), consumer, "exports.mjs")

for (const version of nodeVersions) {
	const node = version === process.version.slice(1) ? process.execPath : nodeBinary(version)

	if (!node) {
		record(`node ${version}`, "not run", `Node ${version} is not installed (expected in target/tools or ~/.nvm)`)

		continue
	}

	attempt(`node ${version}: README example`, () => {
		const out = sh(node, ["readme.mjs"], consumer).trim()

		if (out !== "87283472bffffff") throw new Error(`printed ${out}`)

		return out
	})

	attempt(`node ${version}: export map`, () => {
		const out = JSON.parse(sh(node, ["exports.mjs"], consumer))

		if (out.packageJson !== "@sister.software/h3" || out.deepImport !== "ERR_PACKAGE_PATH_NOT_EXPORTED" || !out.wasm) {
			throw new Error(JSON.stringify(out))
		}

		return JSON.stringify(out)
	})

	attempt(`node ${version}: C fixture probe`, () => {
		const out = JSON.parse(sh(node, ["probe-run.mjs"], consumer))

		if (out.failed !== 0 || out.total !== records.length) throw new Error(JSON.stringify(out))

		return `${out.total}/${records.length} fixture cases match C`
	})
}

attempt("TypeScript consumer against shipped declarations", () => checkDeclarations(consumer))

// ---------------------------------------------------------------------------------------------
// Native crate consumer.

attempt("native crate: external consumer of the packaged sister-h3", () => checkNativePackage(work))

writeFileSync(join(work, "report.json"), JSON.stringify(results, null, "\t"))
const bad = results.filter((r) => r.status !== "pass")

console.log(`\ntest:package: ${results.length - bad.length}/${results.length} checks passed`)

process.exit(!bad.length ? 0 : 1)
