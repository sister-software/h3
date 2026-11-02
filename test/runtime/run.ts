/**
 * Runtime verification against the packed npm tarball: Node (bytes and module initialization), a Worker-safety esbuild
 * bundle, local `wrangler dev` (workerd), and Vite and webpack production builds executed in headless Chromium.
 *
 *     yarn test:runtimes
 *
 * Each consumer is a fresh directory under target/runtime that installs the tarball; nothing imports workspace source.
 * The probe compares public API results with committed C fixtures. A prerequisite that is unavailable is reported as
 * NOT RUN and fails the command.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { execFileSync, spawn } from "node:child_process"
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs"
import { createServer, type Server } from "node:http"
import { dirname, extname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { SUPPORTED_OPERATIONS } from "../shared/fixture-cases.ts"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const work = join(root, "target", "runtime")
const fixtureDir = join(root, "crates/h3-core/tests/fixtures")
const bin = (name: string) => join(root, "node_modules/.bin", name)

interface Check {
	name: string
	status: "pass" | "fail" | "not run"
	detail: string
	data?: unknown
}

const checks: Check[] = []

function record(name: string, status: Check["status"], detail: string, data?: unknown) {
	checks.push({ name, status, detail, data })

	console.log(`${status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "NOT RUN"}  ${name}: ${detail}`)
}

function sh(cmd: string, args: string[], cwd = root): string {
	return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 })
}

// ---------------------------------------------------------------------------------------------
// Tarball and consumers.

rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })
sh("yarn", ["compile"])
const tarball = join(work, "package.tgz")
sh("yarn", ["pack", "--out", tarball])

function consumer(name: string, extraPackageJson: Record<string, unknown> = {}): string {
	const dir = join(work, name)
	mkdirSync(dir, { recursive: true })

	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({ name: `h3-runtime-${name}`, private: true, type: "module", ...extraPackageJson }, null, "\t")
	)

	sh("npm", ["install", "--no-audit", "--no-fund", "--offline", "--loglevel=error", tarball], dir)

	return dir
}

// The probe and its fixture cases, transpiled into each consumer as plain ESM.
const records = SUPPORTED_OPERATIONS.flatMap((op) =>
	readFileSync(join(fixtureDir, `${op}.jsonl`), "utf8")
		.trim()
		.split("\n")
		.map((l) => JSON.parse(l))
)

const expectedCases = records.length

function installProbe(dir: string) {
	sh(bin("esbuild"), [
		join(root, "test/shared/fixture-cases.ts"),
		"--format=esm",
		`--outfile=${join(dir, "probe.mjs")}`,
	])

	writeFileSync(join(dir, "cases.json"), JSON.stringify(records))
}

function summarize(outcomes: { ok: boolean; operation: string; detail?: string }[]) {
	const failed = outcomes.filter((o) => !o.ok)

	return {
		total: outcomes.length,
		failed: failed.length,
		firstFailures: failed.slice(0, 5),
	}
}

function judge(name: string, result: { outcomes?: { ok: boolean; operation: string }[] } & Record<string, unknown>) {
	const s = summarize(result.outcomes ?? [])
	const ok = s.total === expectedCases && s.failed === 0

	record(name, ok ? "pass" : "fail", `${s.total - s.failed}/${expectedCases} fixture cases match C`, {
		...result,
		outcomes: undefined,
		summary: s,
	})
}

// ---------------------------------------------------------------------------------------------
// Node.

{
	const dir = consumer("node")
	installProbe(dir)

	const common = `
import { readFile } from "node:fs/promises"
import { runFixtureCases } from "./probe.mjs"
const counts = { compile: 0, instantiate: 0, Module: 0, Instance: 0, Memory: 0 }
for (const key of ["compile", "instantiate"]) {
	const orig = WebAssembly[key]
	WebAssembly[key] = function (...args) { counts[key]++; return orig.apply(this, args) }
}
for (const key of ["Module", "Instance", "Memory"]) {
	const Orig = WebAssembly[key]
	WebAssembly[key] = new Proxy(Orig, { construct(t, args, nt) { counts[key]++; return Reflect.construct(t, args, nt) } })
}
const h3 = await import("@sister.software/h3")
const afterImport = { ...counts }
let beforeInit
try { h3.isValidCell("8001fffffffffff"); beforeInit = "did not throw" } catch (e) { beforeInit = e.name }
const pure = { split: h3.h3IndexToSplitLong("87283472bffffff"), join: h3.splitLongToH3Index(0x2bffffff, 0x8728347) }
const bytes = await readFile(new URL(import.meta.resolve("@sister.software/h3/h3.wasm")))
const cases = JSON.parse(await readFile(new URL("./cases.json", import.meta.url), "utf8"))
`

	writeFileSync(
		join(dir, "bytes.mjs"),
		common +
			`await h3.init({ bytes })
console.log(JSON.stringify({ afterImport, beforeInit, pure, outcomes: runFixtureCases(h3, cases) }))`
	)

	writeFileSync(
		join(dir, "module.mjs"),
		common +
			`await h3.init({ module: new WebAssembly.Module(bytes) })
console.log(JSON.stringify({ afterImport, beforeInit, outcomes: runFixtureCases(h3, cases) }))`
	)

	for (const variant of ["bytes", "module"]) {
		const out = JSON.parse(sh("node", [join(dir, `${variant}.mjs`)], dir))
		judge(`node ${process.version} init({ ${variant} })`, out)
		const importClean = Object.values(out.afterImport as Record<string, number>).every((n) => n === 0)

		record(
			`node import allocates no WASM (${variant})`,
			importClean && out.beforeInit === "H3InitializationError" ? "pass" : "fail",
			`WebAssembly calls during import ${JSON.stringify(out.afterImport)}; call before init threw ${out.beforeInit}`
		)
	}
}

// ---------------------------------------------------------------------------------------------
// Worker: esbuild bundle under Worker conditions, then local wrangler dev.

{
	const dir = consumer("worker")
	installProbe(dir)
	copyFileSync(join(dir, "node_modules/@sister.software/h3/wasm/h3.wasm"), join(dir, "h3-bytes.bin"))

	writeFileSync(
		join(dir, "worker.mjs"),
		`import wasmModule from "@sister.software/h3/h3.wasm"
import wasmBytes from "./h3-bytes.bin"
import * as h3 from "@sister.software/h3"
import { runFixtureCases } from "./probe.mjs"
import cases from "./cases.json"

async function restrictions() {
	const out = { processDefined: typeof globalThis.process !== "undefined", importMetaUrl: String(import.meta.url) }
	try { await WebAssembly.compile(wasmBytes); out.compileBytes = "allowed" } catch (e) { out.compileBytes = String(e) }
	try { new Function("return 1")(); out.newFunction = "allowed" } catch (e) { out.newFunction = String(e) }
	try { (0, eval)("1"); out.eval = "allowed" } catch (e) { out.eval = String(e) }
	try { await h3.init({ bytes: wasmBytes }); out.initBytes = "allowed" } catch (e) { out.initBytes = e.name + ": " + String(e.cause ?? e) }
	return out
}

export default {
	async fetch(request) {
		const url = new URL(request.url)
		if (url.pathname === "/restrictions") return Response.json(await restrictions())
		let beforeInit
		try { h3.isValidCell("8001fffffffffff"); beforeInit = "did not throw" } catch (e) { beforeInit = e.name }
		await h3.init({ module: wasmModule })
		return Response.json({ beforeInit, outcomes: runFixtureCases(h3, cases) })
	},
}
`
	)

	writeFileSync(
		join(dir, "wrangler.toml"),
		`name = "h3-runtime-probe"
main = "worker.mjs"
compatibility_date = "2026-10-01"
rules = [{ type = "Data", globs = ["**/*.bin"], fallthrough = false }]
`
	)

	// Bundle check: the shared graph under Worker conditions must not contain Node builtins,
	// string code generation, or reference implementations.
	const bundle = join(dir, "bundle.mjs")

	try {
		sh(
			bin("esbuild"),
			[
				join(dir, "worker.mjs"),
				"--bundle",
				"--format=esm",
				"--platform=neutral",
				"--conditions=workerd,worker,browser",
				"--loader:.wasm=file",
				"--loader:.bin=file",
				`--outfile=${bundle}`,
			],
			dir
		)

		const text = readFileSync(bundle, "utf8")

		const findings = {
			nodeBuiltins: [...text.matchAll(/(?:from|import\()\s*["'](node:[^"']+)["']/g)].map((m) => m[1]),
			require: /\brequire\(/.test(text),
			eval: /\beval\(/.test(text.replace(/\(0, eval\)\("1"\)/, "")),
			newFunction: /new Function\(/.test(text.replace('new Function("return 1")', "")),
			h3js: /h3-js/.test(text),
			h3o: /\bh3o\b/.test(text),
			importMetaUrl: (text.match(/import\.meta\.url/g) ?? []).length,
		}

		const clean =
			findings.nodeBuiltins.length === 0 &&
			!findings.require &&
			!findings.eval &&
			!findings.newFunction &&
			!findings.h3js &&
			!findings.h3o

		record(
			"esbuild bundle (--conditions=workerd,worker,browser)",
			clean ? "pass" : "fail",
			`node builtins ${findings.nodeBuiltins.length}, require ${findings.require}, eval ${findings.eval}, new Function ${findings.newFunction}, h3-js ${findings.h3js}, h3o ${findings.h3o}; import.meta.url occurrences (probe only) ${findings.importMetaUrl}`,
			findings
		)
	} catch (error) {
		record(
			"esbuild bundle (--conditions=workerd,worker,browser)",
			"fail",
			String((error as { stderr?: string }).stderr ?? error)
		)
	}

	const port = 8790 + Math.floor(Math.random() * 100)

	const wrangler = spawn(
		bin("wrangler"),
		["dev", "--port", String(port), "--ip", "127.0.0.1", "--log-level", "warn", "--show-interactive-dev-session=false"],
		{ cwd: dir, env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" }, stdio: ["ignore", "pipe", "pipe"] }
	)

	let log = ""
	wrangler.stdout!.on("data", (d) => (log += d))
	wrangler.stderr!.on("data", (d) => (log += d))

	try {
		const base = `http://127.0.0.1:${port}`
		const deadline = Date.now() + 120_000
		let up = false

		while (Date.now() < deadline) {
			try {
				await fetch(base + "/restrictions").then((r) => r.text())
				up = true

				break
			} catch {
				await new Promise((r) => {
					setTimeout(r, 500)
				})
			}
		}

		if (!up) {
			record("wrangler dev (workerd)", "not run", `wrangler dev did not start within 120 s: ${log.slice(-500)}`)
		} else {
			const versions = sh(bin("wrangler"), ["--version"]).trim().split("\n").pop()
			const workerd = JSON.parse(readFileSync(join(root, "node_modules/workerd/package.json"), "utf8")).version
			// Fresh isolate first: the restrictions route must run before any successful init.
			const restrictions = await (await fetch(base + "/restrictions")).json()

			record(
				`workerd restrictions (wrangler ${versions}, workerd ${workerd})`,
				"pass",
				JSON.stringify(restrictions),
				restrictions
			)

			const res = await (await fetch(base + "/")).json()
			judge(`wrangler dev (workerd ${workerd}) init({ module })`, res)

			record(
				"workerd call before init",
				res.beforeInit === "H3InitializationError" ? "pass" : "fail",
				`threw ${res.beforeInit}`
			)
		}
	} finally {
		wrangler.kill("SIGTERM")

		await new Promise((r) => {
			setTimeout(r, 500)
		})

		if (wrangler.exitCode === null) {
			wrangler.kill("SIGKILL")
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Browsers: Vite and webpack production builds from separate consumers, run in Chromium.

const BROWSER_MAIN = (importLine: string, loadLine: string) => `${importLine}
import * as h3 from "@sister.software/h3"
import { runFixtureCases } from "./probe.mjs"
import cases from "./cases.json"

async function main() {
	let beforeInit
	try { h3.isValidCell("8001fffffffffff"); beforeInit = "did not throw" } catch (e) { beforeInit = e.name }
	${loadLine}
	window.__result = { beforeInit, outcomes: runFixtureCases(h3, cases) }
}
main().catch((e) => { window.__result = { error: String(e && e.stack || e) } })
`

const viteDir = consumer("vite")
installProbe(viteDir)

writeFileSync(
	join(viteDir, "main.mjs"),
	BROWSER_MAIN(
		`import wasmUrl from "@sister.software/h3/h3.wasm?url"`,
		`const response = await fetch(wasmUrl)
	if (!response.ok) throw new Error("Unable to load H3 WASM: " + response.status)
	await h3.init({ bytes: await response.arrayBuffer() })`
	)
)

writeFileSync(
	join(viteDir, "index.html"),
	`<!doctype html><html><body><script type="module" src="./main.mjs"></script></body></html>`
)

const webpackDir = consumer("webpack")
installProbe(webpackDir)

writeFileSync(
	join(webpackDir, "main.mjs"),
	BROWSER_MAIN(
		`import wasmUrl from "@sister.software/h3/h3.wasm"`,
		`const response = await fetch(wasmUrl)
	if (!response.ok) throw new Error("Unable to load H3 WASM: " + response.status)
	await h3.init({ bytes: await response.arrayBuffer() })`
	)
)

async function buildVite(): Promise<string> {
	const { build } = await import(pathToFileURL(join(root, "node_modules/vite/dist/node/index.js")).href)
	await build({ root: viteDir, logLevel: "warn", build: { outDir: join(viteDir, "dist"), emptyOutDir: true } })

	return join(viteDir, "dist")
}

async function buildWebpack(): Promise<string> {
	const webpack = (await import("webpack")).default
	const out = join(webpackDir, "dist")

	await new Promise<void>((resolveBuild, reject) => {
		webpack(
			{
				mode: "production",
				context: webpackDir,
				entry: "./main.mjs",
				output: { path: out, filename: "main.js", publicPath: "auto" },
				module: { rules: [{ test: /\.wasm$/, type: "asset/resource" }] },
				experiments: { topLevelAwait: false },
				resolve: { modules: [join(webpackDir, "node_modules")] },
			},
			(error, stats) => {
				if (error) return reject(error)

				if (stats?.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })))
				resolveBuild()
			}
		)
	})

	writeFileSync(join(out, "index.html"), `<!doctype html><html><body><script src="./main.js"></script></body></html>`)

	return out
}

const MIME: Record<string, string> = {
	".html": "text/html",
	".js": "text/javascript",
	".mjs": "text/javascript",
	".wasm": "application/wasm",
	".json": "application/json",
}

function serve(dir: string): Promise<{ server: Server; url: string }> {
	return new Promise((resolveServe) => {
		const server = createServer((req, res) => {
			const path = join(dir, decodeURIComponent(new URL(req.url!, "http://x").pathname))

			if (!path.startsWith(dir) || !existsSync(path) || statSync(path).isDirectory()) {
				const index = join(path, "index.html")

				if (existsSync(index)) {
					res.writeHead(200, { "content-type": "text/html" }).end(readFileSync(index))

					return
				}

				res.writeHead(404).end()

				return
			}

			res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" }).end(readFileSync(path))
		})

		server.listen(0, "127.0.0.1", () => {
			const address = server.address() as { port: number }
			resolveServe({ server, url: `http://127.0.0.1:${address.port}/` })
		})
	})
}

let chromium: typeof import("playwright-core").chromium | undefined

try {
	chromium = (await import("playwright-core")).chromium
} catch (error) {
	record("browser", "not run", `playwright-core unavailable: ${String(error)}`)
}

for (const [label, buildFn] of [
	["vite", buildVite],
	["webpack", buildWebpack],
] as const) {
	let dist: string

	try {
		dist = await buildFn()
	} catch (error) {
		record(`${label} production build`, "fail", String(error))

		continue
	}

	const assets = readdirSync(dist, { recursive: true }).map(String)
	const wasmAssets = assets.filter((a) => a.endsWith(".wasm"))

	record(
		`${label} production build`,
		wasmAssets.length === 1 ? "pass" : "fail",
		`wasm assets emitted: ${wasmAssets.join(", ")}`
	)

	if (!chromium) continue
	const { server, url } = await serve(dist)
	let browser

	try {
		browser = await chromium.launch({ headless: true })
		const page = await browser.newPage()
		const requests: string[] = []
		page.on("request", (r) => requests.push(new URL(r.url()).pathname))
		const consoleErrors: string[] = []
		page.on("pageerror", (e) => consoleErrors.push(String(e)))
		await page.goto(url)

		await page.waitForFunction(() => (globalThis as unknown as { __result?: unknown }).__result !== undefined, null, {
			timeout: 60_000,
		})

		const result = await page.evaluate(() => (globalThis as unknown as { __result: Record<string, unknown> }).__result)
		const wasmRequests = requests.filter((p) => p.endsWith(".wasm"))

		if (result.error) {
			record(`${label} in Chromium ${browser.version()}`, "fail", JSON.stringify(result.error))
		} else {
			judge(`${label} in Chromium ${browser.version()}`, result as never)
		}

		record(
			`${label} network`,
			wasmRequests.length === 1 && result.beforeInit === "H3InitializationError" && !consoleErrors.length
				? "pass"
				: "fail",
			`wasm requests ${JSON.stringify(wasmRequests)}; call before init threw ${String(result.beforeInit)}; page errors ${consoleErrors.length}`
		)
	} catch (error) {
		record(`${label} in Chromium`, "not run", `browser could not run: ${String(error)}`)
	} finally {
		await browser?.close()
		server.close()
	}
}

writeFileSync(join(work, "report.json"), JSON.stringify(checks, null, "\t"))
const bad = checks.filter((c) => c.status !== "pass")

console.log(
	`\ntest:runtimes: ${checks.length - bad.length}/${checks.length} checks passed; report at target/runtime/report.json`
)

process.exit(!bad.length ? 0 : 1)
