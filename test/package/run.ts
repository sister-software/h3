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
 * Required Node versions: 24.22.1 (the `engines` floor) and the `.nvmrc` version. They are looked up in
 * `target/tools/node-v<version>-linux-x64/bin/node`, then in `~/.nvm/versions/node`. A missing version is reported as
 * NOT RUN and fails the command.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { SUPPORTED_OPERATIONS } from "../shared/fixture-cases.ts"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const work = join(root, "target", "package-test")
const bin = (name: string) => join(root, "node_modules/.bin", name)
const results: { name: string; status: "pass" | "fail" | "not run"; detail: string }[] = []

function record(name: string, status: "pass" | "fail" | "not run", detail: string) {
	results.push({ name, status, detail })

	console.log(`${status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "NOT RUN"}  ${name}: ${detail}`)
}

function sh(cmd: string, args: string[], cwd = root, env: NodeJS.ProcessEnv = process.env): string {
	return execFileSync(cmd, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 })
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

sh("yarn", ["compile"])
const tarball = join(work, "package.tgz")
sh("yarn", ["pack", "--out", tarball])

attempt("tarball contents", () => {
	const listing = sh("tar", ["-tzf", tarball])
		.split("\n")
		.filter(Boolean)
		.map((f) => f.replace(/^package\//, ""))

	const required = [
		"package.json",
		"README.md",
		"LICENSE",
		"LICENSE-APACHE-2.0",
		"NOTICE",
		"THIRD_PARTY_NOTICES.md",
		"wasm/h3.wasm",
		"out/index.js",
		"out/index.d.ts",
		"out/lib/generated/h3.js",
		"out/lib/generated/h3.d.ts",
		"out/lib/generated/h3-embedded.js",
		"out/workerd.js",
		"out/lib/runtime/state.js",
	]

	const missing = required.filter((f) => !listing.includes(f))

	const forbidden = listing.filter(
		(f) => /^(crates|scripts|test|target|lib|benchmarks|docs)\//.test(f) || f.endsWith(".rs")
	)

	if (missing.length || forbidden.length) {
		throw new Error(`missing ${JSON.stringify(missing)}; unexpected ${JSON.stringify(forbidden)}`)
	}

	const wasm = readFileSync(join(root, "wasm/h3.wasm"))

	return `${listing.length} files; wasm ${wasm.length} bytes; no sources, tests, or Rust files`
})

const consumer = join(work, "npm-consumer")
mkdirSync(consumer, { recursive: true })

writeFileSync(
	join(consumer, "package.json"),
	JSON.stringify({ name: "h3-package-consumer", private: true, type: "module" })
)

sh("npm", ["install", "--no-audit", "--no-fund", "--offline", "--loglevel=error", tarball], consumer)

// Probe with fixtures, as in the runtime tests.
sh(bin("esbuild"), [
	join(root, "test/shared/fixture-cases.ts"),
	"--format=esm",
	`--outfile=${join(consumer, "probe.mjs")}`,
])

const records = SUPPORTED_OPERATIONS.flatMap((op) =>
	readFileSync(join(root, "crates/h3-core/tests/fixtures", `${op}.jsonl`), "utf8")
		.trim()
		.split("\n")
		.map((l) => JSON.parse(l))
)

writeFileSync(join(consumer, "cases.json"), JSON.stringify(records))

// The README Node example, verbatim, plus the probe.
writeFileSync(
	join(consumer, "readme.mjs"),
	`import { latLngToCell } from "@sister.software/h3"

console.log(latLngToCell(37.3615593, -122.0553238, 7)) // "87283472bffffff"
`
)

writeFileSync(
	join(consumer, "probe-run.mjs"),
	`import { readFile } from "node:fs/promises"
import * as h3 from "@sister.software/h3"
import { runFixtureCases } from "./probe.mjs"
await h3.init({ bytes: await readFile(new URL(import.meta.resolve("@sister.software/h3/h3.wasm"))) })
const cases = JSON.parse(await readFile(new URL("./cases.json", import.meta.url), "utf8"))
const out = runFixtureCases(h3, cases)
const failed = out.filter((o) => !o.ok)
console.log(JSON.stringify({ total: out.length, failed: failed.length, first: failed.slice(0, 3) }))
`
)

writeFileSync(
	join(consumer, "exports.mjs"),
	`const out = {}
out.packageJson = (await import("@sister.software/h3/package.json", { with: { type: "json" } })).default.name
try { await import("@sister.software/h3/out/lib/runtime/state.js"); out.deepImport = "allowed" } catch (e) { out.deepImport = e.code }
out.wasm = import.meta.resolve("@sister.software/h3/h3.wasm").endsWith("/wasm/h3.wasm")
console.log(JSON.stringify(out))
`
)

function nodeBinary(version: string): string | undefined {
	for (const p of [
		join(root, "target/tools", `node-v${version}-linux-x64/bin/node`),
		join(homedir(), ".nvm/versions/node", `v${version}`, "bin/node"),
	]) {
		if (existsSync(p)) return p
	}

	return undefined
}

const nvmrc = readFileSync(join(root, ".nvmrc"), "utf8").trim().replace(/^v/, "")

for (const version of new Set([nvmrc, process.version.slice(1)])) {
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

attempt("TypeScript consumer against shipped declarations", () => {
	writeFileSync(
		join(consumer, "consumer.ts"),
		`import { cellToBoundary, gridDiskDistances, init, latLngToCell, polygonToCellsExperimental, POLYGON_TO_CELLS_FLAGS, type CoordPair, type H3Index, type H3Error, type ResourceLimits } from "@sister.software/h3"
const limits: ResourceLimits = { maxResultItems: 1000 }
declare const bytes: Uint8Array
await init({ bytes, limits })
const cell: H3Index = latLngToCell(37.3615593, -122.0553238, 7)
const boundary: CoordPair[] = cellToBoundary(cell, true)
const rings: H3Index[][] = gridDiskDistances(cell, 2)
const cells: H3Index[] = polygonToCellsExperimental([[0, 0], [1, 0], [1, 1]], 5, POLYGON_TO_CELLS_FLAGS.containmentFull)
function code(e: H3Error): number { return e.code }
// @ts-expect-error resolution must be a number
latLngToCell(0, 0, "7")
await init()
// @ts-expect-error init takes at most one source
await init({ bytes, module: {} as WebAssembly.Module })
export { boundary, rings, cells, code }
`
	)

	writeFileSync(
		join(consumer, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				target: "esnext",
				module: "nodenext",
				moduleResolution: "nodenext",
				strict: true,
				noEmit: true,
				skipLibCheck: false,
				lib: ["ESNext", "DOM"],
				types: [],
			},
			files: ["consumer.ts"],
		})
	)

	sh(bin("tsc"), ["-p", join(consumer, "tsconfig.json")], consumer)

	return "consumer.ts typechecks (including @ts-expect-error cases) with skipLibCheck false"
})

// ---------------------------------------------------------------------------------------------
// Native crate consumer.

const cargo = process.env.CARGO ?? "cargo"

attempt("native crate: external consumer of the packaged sister-h3", () => {
	sh(cargo, ["package", "-p", "sister-h3", "--locked", "--allow-dirty", "--no-verify"])

	const version = JSON.parse(sh(cargo, ["metadata", "--format-version", "1", "--no-deps"])).packages.find(
		(p: { name: string }) => p.name === "sister-h3"
	).version

	// Outside the repository, so Cargo cannot attach the crate to this workspace.
	const nativeWork = mkdtempSync(join(tmpdir(), "sister-h3-native-"))
	const unpacked = join(nativeWork, `sister-h3-${version}`)
	sh("tar", ["-xzf", join(root, "target/package", `sister-h3-${version}.crate`), "-C", nativeWork])

	if (existsSync(join(unpacked, "..", "h3-wasm"))) throw new Error("adapter leaked into the package")
	const app = join(nativeWork, "native-consumer")
	mkdirSync(join(app, "src"), { recursive: true })

	writeFileSync(
		join(app, "Cargo.toml"),
		`[package]
name = "native-consumer"
version = "0.0.0"
edition = "2024"
publish = false

[dependencies]
sister-h3 = { path = ${JSON.stringify(unpacked)} }

[workspace]
`
	)

	writeFileSync(
		join(app, "src/main.rs"),
		`use sister_h3::{CellIndex, LatLng, raw};
fn main() {
    let cell = CellIndex::from_lat_lng(LatLng::from_degrees(37.3615593, -122.0553238), 7).unwrap();
    assert_eq!(raw::cell_to_parent(cell.get(), 9).unwrap_err().code(), 12);
    println!("{cell}");
}
`
	)

	const env = { ...process.env, CARGO_TARGET_DIR: join(work, "native-target") }
	const out = sh(cargo, ["run", "--offline", "--quiet", "-j", process.env.H3_BUILD_JOBS ?? "4"], app, env).trim()

	if (out !== "87283472bffffff") throw new Error(`printed ${out}`)
	// The packaged crate's own tests (C fixtures included in the package).
	const tests = sh(cargo, ["test", "--offline", "--quiet", "-j", process.env.H3_BUILD_JOBS ?? "4"], unpacked, env)
	const passed = [...tests.matchAll(/test result: ok\. (\d+) passed/g)].reduce((n, m) => n + Number(m[1]), 0)

	if (/FAILED/.test(tests)) throw new Error(tests.slice(-1500))

	rmSync(nativeWork, { recursive: true, force: true })

	return `consumer printed ${out}; packaged crate tests passed (${passed} tests) without the workspace`
})

writeFileSync(join(work, "report.json"), JSON.stringify(results, null, "\t"))
const bad = results.filter((r) => r.status !== "pass")

console.log(`\ntest:package: ${results.length - bad.length}/${results.length} checks passed`)

process.exit(!bad.length ? 0 : 1)
