/**
 * Benchmarks and memory measurements (Phase H), for `yarn benchmark`.
 *
 * - Public JavaScript API versus h3-js 4.5.0 under Node: the six priority functions with fixed seeded inputs, warmup,
 *   interleaved samples, and output checksums.
 * - Boundary costs: index string conversion alone, the raw WASM call alone, first initialization (fresh processes).
 * - Native Rust versus C (`crates/h3-core/examples/bench.rs`, `benchmarks/c/bench.c`) when the C reference is built.
 * - Memory: JS heap, array buffers, and WASM memory in fresh Node processes before import, after import, after init, and
 *   after each workload, plus repeated-call plateau; and the same stages in local workerd through the inspector.
 *
 * Results are written to `benchmarks/results/latest.json` and `benchmarks/RESULTS.md`, with the runtime, hardware, and
 * machine load recorded. On a loaded machine the numbers are indicative only.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { cpus, loadavg, totalmem } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const out = join(root, "target", "benchmark")
mkdirSync(out, { recursive: true })
mkdirSync(join(root, "benchmarks/results"), { recursive: true })
const SAMPLES = Number(process.env.H3_BENCH_SAMPLES ?? 15)
const jobs = process.env.H3_BUILD_JOBS ?? "4"

function sh(cmd: string, args: string[], cwd = root): string {
	return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 })
}

const quantile = (xs: number[], q: number) => {
	const s = xs.toSorted((a, b) => a - b)
	const pos = (s.length - 1) * q
	const lo = Math.floor(pos)
	const hi = Math.ceil(pos)

	return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo)
}

interface Stat {
	median: number
	p25: number
	p75: number
	samples: number
}

const stat = (xs: number[]): Stat => ({
	median: quantile(xs, 0.5),
	p25: quantile(xs, 0.25),
	p75: quantile(xs, 0.75),
	samples: xs.length,
})

const environment = {
	date: new Date().toISOString(),
	node: process.version,
	cpu: cpus()[0]?.model ?? "unknown",
	cores: cpus().length,
	memoryGiB: Math.round(totalmem() / 2 ** 30),
	loadAverageBefore: loadavg().map((x) => Number(x.toFixed(2))),
	rustc: sh("rustc", ["--version"]).trim(),
	wasmBytes: readFileSync(join(root, "wasm/h3.wasm")).length,
	h3js: JSON.parse(readFileSync(join(root, "node_modules/h3-js/package.json"), "utf8")).version as string,
}

sh("yarn", ["compile"])

// ---------------------------------------------------------------------------------------------
// JavaScript: this package versus h3-js, interleaved.

const ours = await import(pathToFileURL(join(root, "out/index.js")).href)
const h3js = await import("h3-js")
await ours.init({ bytes: readFileSync(join(root, "wasm/h3.wasm")) })

function points(n: number): [number, number][] {
	let s = 0x51_57_48_33n

	const next = () => {
		s = (s + 0x9e_37_79_b9_7f_4a_7c_15n) & 0xff_ff_ff_ff_ff_ff_ff_ffn
		let z = s
		z = ((z ^ (z >> 30n)) * 0xbf_58_47_6d_1c_e4_e5_b9n) & 0xff_ff_ff_ff_ff_ff_ff_ffn
		z = ((z ^ (z >> 27n)) * 0x94_d0_49_bb_13_31_11_ebn) & 0xff_ff_ff_ff_ff_ff_ff_ffn

		return Number((z ^ (z >> 31n)) >> 11n) / 2 ** 53
	}

	return Array.from({ length: n }, () => [next() * 160 - 80, next() * 360 - 180])
}

const pts = points(10_000)
const cells: string[] = pts.map(([a, b]) => ours.latLngToCell(a, b, 9))
const diskOrigins = cells.slice(0, 1000)
const compactInput: string[] = ours.cellToChildren(ours.cellToParent(cells[0], 5), 9)

const sfPolygon = (
	[
		[0.659966917655, -2.1364398519396],
		[0.6595011102219, -2.1359434279405],
		[0.6583348114025, -2.1354884206045],
		[0.6581220034068, -2.1382437718946],
		[0.6594479998527, -2.1384597563896],
		[0.6599990002976, -2.1376771158464],
	] as const
).map(([a, b]) => [ours.radsToDegs(a), ours.radsToDegs(b)])

type Api = typeof ours

const workloads: { name: string; ops: number; run: (api: Api) => string }[] = [
	{
		name: "latLngToCell",
		ops: pts.length,
		run: (api) =>
			pts
				.map(([a, b]) => api.latLngToCell(a, b, 9))
				.join("")
				.slice(-16),
	},
	{
		name: "cellToParent",
		ops: cells.length,
		run: (api) =>
			cells
				.map((c) => api.cellToParent(c, 5))
				.join("")
				.slice(-16),
	},
	{
		name: "cellToLatLng",
		ops: cells.length,
		// Rounded: last-bit differences (libm, uber/h3#1255) are expected between implementations.
		run: (api) => cells.reduce((acc, c) => acc + api.cellToLatLng(c)[0], 0).toFixed(6),
	},
	{
		name: "gridDisk",
		ops: diskOrigins.length,
		run: (api) => String(diskOrigins.reduce((acc, c) => acc + api.gridDisk(c, 2).length, 0)),
	},
	{ name: "compactCells", ops: 1, run: (api) => api.compactCells(compactInput).join(",") },
	{ name: "polygonToCells", ops: 1, run: (api) => String(api.polygonToCells(sfPolygon, 9).length) },
]

const js: Record<
	string,
	{ ours: Stat; h3js: Stat; checksumMatch: boolean; oursOpsPerSec: number; h3jsOpsPerSec: number }
> = {}

for (const w of workloads) {
	const a: number[] = []
	const b: number[] = []
	let ca = ""
	let cb = ""

	for (let i = 0; i < 3; i++) {
		ca = w.run(ours)
		cb = w.run(h3js as unknown as Api)
	}

	for (let i = 0; i < SAMPLES; i++) {
		// Alternate which implementation runs first in each round.
		const order = i % 2 ? [ours, h3js] : [h3js, ours]

		for (const api of order) {
			const t = performance.now()
			const c = w.run(api as Api)
			const ns = ((performance.now() - t) * 1e6) / w.ops

			if (api === ours) {
				a.push(ns)
				ca = c
			} else {
				b.push(ns)
				cb = c
			}
		}
	}

	const sa = stat(a)
	const sb = stat(b)

	js[w.name] = {
		ours: sa,
		h3js: sb,
		checksumMatch: ca === cb,
		oursOpsPerSec: 1e9 / sa.median,
		h3jsOpsPerSec: 1e9 / sb.median,
	}

	console.log(
		`js ${w.name}: ours ${sa.median.toFixed(1)} ns/op, h3-js ${sb.median.toFixed(1)} ns/op, checksum ${ca === cb}`
	)
}

// ---------------------------------------------------------------------------------------------
// Boundary costs.

function timeLoop(n: number, fn: (i: number) => unknown): Stat {
	const xs: number[] = []

	for (let r = 0; r < SAMPLES; r++) {
		const t = performance.now()

		for (let i = 0; i < n; i++) {
			fn(i)
		}

		xs.push(((performance.now() - t) * 1e6) / n)
	}

	return stat(xs)
}

const glue = await import(pathToFileURL(join(root, "out/lib/generated/h3.js")).href)
const big = cells.map((c) => BigInt("0x" + c))

const boundary = {
	stringToBigInt: timeLoop(cells.length, (i) => BigInt("0x" + cells[i]!)),
	bigIntToString: timeLoop(cells.length, (i) => big[i]!.toString(16)),
	rawWasmCellToParent: timeLoop(cells.length, (i) => glue.cell_to_parent(big[i], 5)),
	publicCellToParent: timeLoop(cells.length, (i) => ours.cellToParent(cells[i], 5)),
	rawWasmLatLngToCell: timeLoop(pts.length, (i) => glue.lat_lng_to_cell(pts[i]![0], pts[i]![1], 9)),
	publicLatLngToCell: timeLoop(pts.length, (i) => ours.latLngToCell(pts[i]![0], pts[i]![1], 9)),
}

console.log(
	`boundary: ${JSON.stringify(Object.fromEntries(Object.entries(boundary).map(([k, v]) => [k, v.median.toFixed(1)])))}`
)

// First initialization, in fresh processes.
const initScript = join(out, "init.mjs")

writeFileSync(
	initScript,
	`import { readFileSync } from "node:fs"
const indexUrl = ${JSON.stringify(pathToFileURL(join(root, "out/index.js")).href)}
const mode = process.argv[2]
const t0 = performance.now()
const h3 = await import(indexUrl)
const t1 = performance.now()
if (mode === "explicit") await h3.init({ bytes: readFileSync(${JSON.stringify(join(root, "wasm/h3.wasm"))}) })
const t2 = performance.now()
h3.latLngToCell(37.3615593, -122.0553238, 7)
const t3 = performance.now()
h3.latLngToCell(37.3615593, -122.0553238, 7)
const t4 = performance.now()
console.log(JSON.stringify({ importMs: t1 - t0, initMs: t2 - t1, firstCallMs: t3 - t2, secondCallMs: t4 - t3 }))
`
)

const runs = (mode: string) =>
	Array.from({ length: Math.min(SAMPLES, 9) }, () => JSON.parse(sh(process.execPath, [initScript, mode])))

const lazyRuns = runs("lazy")
const explicitRuns = runs("explicit")
const inits = lazyRuns

const initStats = {
	importMs: stat(lazyRuns.map((x) => x.importMs)),
	// Default path: the first call compiles and instantiates the embedded binary.
	firstCallMs: stat(lazyRuns.map((x) => x.firstCallMs)),
	secondCallMs: stat(lazyRuns.map((x) => x.secondCallMs)),
	// Optional preload with init({ bytes }) from the separate asset, then the first call.
	explicitInitMs: stat(explicitRuns.map((x) => x.initMs)),
	explicitFirstCallMs: stat(explicitRuns.map((x) => x.firstCallMs)),
}

console.log(
	`cold start: import ${initStats.importMs.median.toFixed(2)} ms, first call ${initStats.firstCallMs.median.toFixed(2)} ms (no init); init({ bytes }) ${initStats.explicitInitMs.median.toFixed(2)} ms`
)

// ---------------------------------------------------------------------------------------------
// Native Rust versus C.

let native: Record<string, { rust: Stat; c?: Stat; checksumMatch?: boolean }>

{
	sh("cargo", ["build", "--release", "-p", "sister-h3", "--example", "bench", "--locked", "-j", jobs])

	const parse = (text: string) =>
		Object.fromEntries(
			text
				.trim()
				.split("\n")
				.map((l) => JSON.parse(l))
				.map((r: { op: string; nsPerOp: number[]; checksum: string }) => [r.op, r])
		)

	const rust = parse(sh(join(root, "target/release/examples/bench"), [String(SAMPLES)]))
	const cLib = join(root, "target/reference/h3-c")
	let c: Record<string, { nsPerOp: number[]; checksum: string }> | undefined

	if (existsSync(join(cLib, "lib/libh3.a"))) {
		const exe = join(root, "target/reference/bench-c")

		sh("cc", [
			"-O3",
			"-std=c11",
			"-I" + join(cLib, "src/h3lib/include"),
			"-o",
			exe,
			join(root, "benchmarks/c/bench.c"),
			"-L" + join(cLib, "lib"),
			"-lh3",
			"-lm",
		])

		c = parse(sh(exe, [String(SAMPLES)]))
	}

	native = Object.fromEntries(
		Object.entries(rust).map(([op, r]) => [
			op,
			{
				rust: stat(r.nsPerOp),
				c: c?.[op] ? stat(c[op].nsPerOp) : undefined,
				checksumMatch: c?.[op] ? c[op].checksum === r.checksum : undefined,
			},
		])
	)

	if (!c) {
		console.log("native: C reference not built (run generate:fixtures); Rust only")
	}
}

// ---------------------------------------------------------------------------------------------
// Memory in fresh Node processes.

const memScript = join(out, "memory.mjs")

writeFileSync(
	memScript,
	`import { readFileSync } from "node:fs"
const gc = globalThis.gc
const snap = (wasm) => { gc(); gc(); const m = process.memoryUsage(); return { heapUsedBytes: m.heapUsed, arrayBuffersBytes: m.arrayBuffers, externalBytes: m.external, wasmMemoryBytes: wasm() } }
const out = {}
out.beforeImport = snap(() => 0)
const h3 = await import(${JSON.stringify(pathToFileURL(join(root, "out/index.js")).href)})
const state = await import(${JSON.stringify(pathToFileURL(join(root, "out/lib/runtime/state.js")).href)})
out.afterImport = snap(state.wasmMemoryBytes)
await h3.init({ bytes: readFileSync(${JSON.stringify(join(root, "wasm/h3.wasm"))}) })
out.afterInit = snap(state.wasmMemoryBytes)
const cell = h3.latLngToCell(37.3615593, -122.0553238, 9)
for (let i = 0; i < 100000; i++) h3.latLngToCell(37 + i * 1e-6, -122, 9)
out.afterScalar = snap(state.wasmMemoryBytes)
for (let i = 0; i < 20; i++) h3.gridDisk(cell, 100)
out.afterDisk100 = snap(state.wasmMemoryBytes)
const kids = h3.cellToChildren(h3.cellToParent(cell, 4), 9)
h3.compactCells(kids)
out.afterCompact = snap(state.wasmMemoryBytes)
const poly = [[37.7, -122.5], [37.8, -122.5], [37.8, -122.35], [37.7, -122.35]]
h3.polygonToCells(poly, 10)
out.afterPolygon = snap(state.wasmMemoryBytes)
const plateau = []
for (let r = 0; r < 5; r++) { for (let i = 0; i < 20; i++) { h3.gridDisk(cell, 100); h3.compactCells(kids); h3.polygonToCells(poly, 10) } plateau.push(state.wasmMemoryBytes()) }
out.repeatedWorkloadWasmBytes = plateau
out.compactCellsInput = kids.length
console.log(JSON.stringify(out))
`
)

const nodeMemory = JSON.parse(sh(process.execPath, ["--expose-gc", memScript]))

console.log(
	`node memory: ${JSON.stringify(nodeMemory.afterInit)}; plateau ${JSON.stringify(nodeMemory.repeatedWorkloadWasmBytes)}`
)

// ---------------------------------------------------------------------------------------------
// Memory in workerd through the inspector.

async function workerMemory(): Promise<unknown> {
	const dir = join(out, "worker")

	mkdirSync(dir, { recursive: true })
	// Bundled from workspace source (the real workerd entry) so the probe can read the internal memory
	// hook. --ignore-annotations keeps the entry's registration even if sideEffects metadata omitted it.
	const entry = join(dir, "entry.ts")

	writeFileSync(
		entry,
		`export * from ${JSON.stringify(join(root, "workerd.ts"))}\nexport { wasmMemoryBytes } from ${JSON.stringify(join(root, "lib/runtime/state.ts"))}\n`
	)

	sh(join(root, "node_modules/.bin/esbuild"), [
		entry,
		"--bundle",
		"--format=esm",
		"--platform=neutral",
		"--ignore-annotations",
		"--alias:@sister.software/h3/h3.wasm=./h3.wasm",
		"--external:./h3.wasm",
		`--outfile=${join(dir, "h3.mjs")}`,
	])

	writeFileSync(join(dir, "h3.wasm"), readFileSync(join(root, "wasm/h3.wasm")))

	writeFileSync(
		join(dir, "worker.mjs"),
		`let h3
export default {
	async fetch(request) {
		const step = new URL(request.url).pathname.slice(1)
		if (step === "import") h3 = await import("./h3.mjs")
		if (step === "init") h3.isValidCell("8001fffffffffff") // first use instantiates (no init call)
		if (step === "scalar") for (let i = 0; i < 100000; i++) h3.latLngToCell(37 + i * 1e-6, -122, 9)
		if (step === "disk") for (let i = 0; i < 20; i++) h3.gridDisk(h3.latLngToCell(37.36, -122.05, 9), 100)
		if (step === "compact") h3.compactCells(h3.cellToChildren(h3.cellToParent(h3.latLngToCell(37.36, -122.05, 9), 4), 9))
		if (step === "polygon") h3.polygonToCells([[37.7, -122.5], [37.8, -122.5], [37.8, -122.35], [37.7, -122.35]], 10)
		return Response.json({ step, wasmMemoryBytes: h3 ? h3.wasmMemoryBytes() : 0 })
	},
}
`
	)

	writeFileSync(
		join(dir, "wrangler.toml"),
		`name = "h3-memory"\nmain = "worker.mjs"\ncompatibility_date = "2026-10-01"\nfind_additional_modules = true\nrules = [{ type = "ESModule", globs = ["**/*.mjs"], fallthrough = true }]\n`
	)

	const port = 8890 + Math.floor(Math.random() * 50)
	const inspector = port + 100

	const wrangler = spawn(
		join(root, "node_modules/.bin/wrangler"),
		["dev", "--port", String(port), "--inspector-port", String(inspector), "--ip", "127.0.0.1", "--log-level", "warn"],
		{ cwd: dir, env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" }, stdio: ["ignore", "pipe", "pipe"] }
	)

	let log = ""

	wrangler.stdout!.on("data", (d) => (log += d))
	wrangler.stderr!.on("data", (d) => (log += d))

	try {
		const base = `http://127.0.0.1:${port}`
		const deadline = Date.now() + 120_000

		while (Date.now() < deadline) {
			try {
				await fetch(base + "/baseline")

				break
			} catch {
				await new Promise((r) => {
					setTimeout(r, 500)
				})
			}
		}

		const targets = (await (await fetch(`http://127.0.0.1:${inspector}/json`)).json()) as {
			webSocketDebuggerUrl: string
		}[]

		// Wrangler's inspector proxy admits DevTools origins only (undici's WebSocket accepts headers).
		const ws = new WebSocket(targets[0]!.webSocketDebuggerUrl, {
			headers: { Origin: "https://devtools.devprod.cloudflare.dev" },
		} as unknown as string[])

		await new Promise((resolveOpen, rejectOpen) => {
			ws.addEventListener("open", resolveOpen, { once: true })
			ws.addEventListener("close", () => rejectOpen(new Error("inspector WebSocket closed")), { once: true })
			setTimeout(() => rejectOpen(new Error("inspector WebSocket did not open")), 10_000)
		})

		let id = 0

		const call = (method: string) =>
			new Promise<Record<string, unknown>>((resolveCall, rejectCall) => {
				setTimeout(() => rejectCall(new Error(`inspector ${method} timed out`)), 15_000)
				const mine = ++id

				const onMessage = (e: MessageEvent) => {
					const msg = JSON.parse(String(e.data))

					if (msg.id === mine) {
						ws.removeEventListener("message", onMessage)
						resolveCall(msg.result ?? {})
					}
				}

				ws.addEventListener("message", onMessage)
				ws.send(JSON.stringify({ id: mine, method }))
			})

		const stages: Record<string, unknown> = {}

		for (const step of ["baseline", "import", "init", "scalar", "disk", "compact", "polygon"]) {
			const r = (await (await fetch(`${base}/${step}`)).json()) as { wasmMemoryBytes: number }

			// HeapProfiler.collectGarbage gets no reply through wrangler's proxy; space by time instead.
			ws.send(JSON.stringify({ id: ++id, method: "HeapProfiler.collectGarbage" }))

			await new Promise((res) => {
				setTimeout(res, 1500)
			})

			const heap = await call("Runtime.getHeapUsage")

			stages[step] = {
				wasmMemoryBytes: r.wasmMemoryBytes,
				jsHeapUsedBytes: heap.usedSize,
				jsHeapTotalBytes: heap.totalSize,
				backingStorageBytes: heap.backingStorageSize,
			}
		}

		ws.close()

		return stages
	} catch (error) {
		return { notRun: `${String(error)} ${log.slice(-400)}` }
	} finally {
		wrangler.kill("SIGTERM")
	}
}

const worker = await workerMemory()

console.log(`worker memory: ${JSON.stringify(worker)}`)

// ---------------------------------------------------------------------------------------------
// Report.

const report = {
	environment: { ...environment, loadAverageAfter: loadavg().map((x) => Number(x.toFixed(2))) },
	samples: SAMPLES,
	js,
	boundary,
	init: initStats,
	native,
	memory: { node: nodeMemory, worker },
}

writeFileSync(join(root, "benchmarks/results/latest.json"), JSON.stringify(report, null, "\t") + "\n")

const f = (x: number) => (x >= 100 ? x.toFixed(0) : x.toFixed(1))
const iqr = (s: Stat) => `${f(s.p25)}–${f(s.p75)}`
const mib = (b: unknown) => (typeof b === "number" ? (b / 2 ** 20).toFixed(2) : "n/a")

const lines = [
	"# Benchmark results",
	"",
	`Generated by \`yarn benchmark\` on ${environment.date}. ${environment.cpu}, ${environment.cores} cores, ${environment.memoryGiB} GiB; Node ${environment.node}; ${environment.rustc}; h3-js ${environment.h3js}; \`wasm/h3.wasm\` ${environment.wasmBytes} bytes. ${SAMPLES} interleaved samples per row after 3 warmup runs.`,
	"",
	`Load average before ${environment.loadAverageBefore.join(" / ")}, after ${report.environment.loadAverageAfter.join(" / ")} (1/5/15 min). **The machine is shared; with load above zero these numbers are indicative, not authoritative.**`,
	"",
	"## Public JavaScript API versus h3-js (Node)",
	"",
	"| Function | This package ns/op (median, IQR) | h3-js ns/op (median, IQR) | Ratio | Same output |",
	"| --- | --- | --- | --- | --- |",
	...Object.entries(js).map(
		([k, v]) =>
			`| ${k} | ${f(v.ours.median)} (${iqr(v.ours)}) | ${f(v.h3js.median)} (${iqr(v.h3js)}) | ${(v.ours.median / v.h3js.median).toFixed(2)} | ${v.checksumMatch ? "yes" : "no"} |`
	),
	"",
	"Workloads: `latLngToCell` 10,000 seeded points at res 9; `cellToParent` those cells to res 5; `cellToLatLng` those cells; `gridDisk` k=2 on 1,000 of them (per call); `compactCells` all 2,401 res-9 children of one res-5 cell (per call); `polygonToCells` the C test San Francisco polygon at res 9 (per call).",
	"",
	"## Boundary costs (Node, ns/op median)",
	"",
	"| Step | ns/op |",
	"| --- | --- |",
	...Object.entries(boundary).map(([k, v]) => `| ${k} | ${f(v.median)} (${iqr(v)}) |`),
	"",
	`Cold start in fresh processes (median of ${inits.length}): import ${initStats.importMs.median.toFixed(2)} ms; with no \`init\`, the first call (which compiles and instantiates the embedded binary) ${initStats.firstCallMs.median.toFixed(2)} ms and the second ${(initStats.secondCallMs.median * 1000).toFixed(1)} µs. With the optional \`init({ bytes })\` preload: \`init\` ${initStats.explicitInitMs.median.toFixed(2)} ms, then the first call ${initStats.explicitFirstCallMs.median.toFixed(3)} ms.`,
	"",
	"## Native Rust versus C",
	"",
	"| Function | Rust ns/op (median, IQR) | C ns/op (median, IQR) | Ratio | Same output |",
	"| --- | --- | --- | --- | --- |",
	...Object.entries(native).map(
		([k, v]) =>
			`| ${k} | ${f(v.rust.median)} (${iqr(v.rust)}) | ${v.c ? `${f(v.c.median)} (${iqr(v.c)})` : "not run"} | ${v.c ? (v.rust.median / v.c.median).toFixed(2) : ""} | ${v.checksumMatch === undefined ? "" : v.checksumMatch ? "yes" : "no"} |`
	),
	"",
	"## Memory",
	"",
	"Node (fresh process, after two forced GCs; MiB):",
	"",
	"| Stage | JS heap used | ArrayBuffers | WASM memory |",
	"| --- | --- | --- | --- |",
	...Object.entries(nodeMemory)
		.filter(([, v]) => typeof v === "object" && v !== null && !Array.isArray(v))
		.map(
			([k, v]) =>
				`| ${k} | ${mib((v as Record<string, number>).heapUsedBytes)} | ${mib((v as Record<string, number>).arrayBuffersBytes)} | ${mib((v as Record<string, number>).wasmMemoryBytes)} |`
		),
	"",
	`Repeated workload (5 rounds of 20 × gridDisk k=100, compactCells of ${nodeMemory.compactCellsInput} cells, polygonToCells res 10): WASM memory per round ${(nodeMemory.repeatedWorkloadWasmBytes as number[]).map(mib).join(", ")} MiB.`,
	"",
	"Cloudflare workerd via `wrangler dev` (inspector `Runtime.getHeapUsage`; MiB):",
	"",
	...("notRun" in (worker as object)
		? [`Not run: ${(worker as { notRun: string }).notRun}`]
		: [
				"| Stage | JS heap used | Backing storage | WASM memory |",
				"| --- | --- | --- | --- |",
				...Object.entries(worker as Record<string, Record<string, number>>).map(
					([k, v]) => `| ${k} | ${mib(v.jsHeapUsedBytes)} | ${mib(v.backingStorageBytes)} | ${mib(v.wasmMemoryBytes)} |`
				),
				"",
				"`backingStorageSize` excludes WebAssembly memory, so WASM memory is reported separately.",
			]),
	"",
]

writeFileSync(join(root, "benchmarks/RESULTS.md"), lines.join("\n"))

// Committed outputs follow the repository formatting, so `yarn lint` stays clean after a run.
sh(join(root, "node_modules/.bin/oxfmt"), ["benchmarks/RESULTS.md", "benchmarks/results/latest.json"])

console.log("\nbenchmark: wrote benchmarks/RESULTS.md and benchmarks/results/latest.json")
