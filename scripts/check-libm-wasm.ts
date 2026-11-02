/**
 * Checks that native Rust with the `libm` feature and the WebAssembly build produce bit-identical floating-point
 * results (README, "Reproducibility across machines").
 *
 * Both use the same `libm` crate version from Cargo.lock, so they must agree exactly. The native side is
 * `crates/h3-core/examples/float_bits.rs`; this script reads the same values from the WASM exports (radians, before the
 * JavaScript layer converts anything) over the committed fixture inputs and compares line for line.
 *
 * Yarn check:libm-wasm
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { init } from "../index.ts"
import { memoryBuffer, ready } from "../lib/runtime/state.ts"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const fixtures = join(root, "crates/h3-core/tests/fixtures")

await init({ bytes: readFileSync(join(root, "wasm/h3.wasm")) })
const w = ready()

const hex = (x: number) => {
	const view = new DataView(new ArrayBuffer(8))
	view.setFloat64(0, x)

	return view.getBigUint64(0).toString(16).padStart(16, "0")
}

const OPS = [
	"cellToLatLng",
	"cellToBoundary",
	"vertexToLatLng",
	"directedEdgeToBoundary",
	"cellAreaRads2",
	"edgeLengthRads",
]

/**
 * The radian results of one fixture input as read from the WASM exports, or the C error code.
 */
function wasmValues(op: string, h: bigint): number[] | number {
	if (op === "cellToLatLng" || op === "vertexToLatLng") {
		const error = op === "cellToLatLng" ? w.cell_to_lat_lng(h) : w.vertex_to_lat_lng(h)

		return error || [w.out_f64(0), w.out_f64(1)]
	}

	if (op === "cellToBoundary" || op === "directedEdgeToBoundary") {
		const n = op === "cellToBoundary" ? w.cell_to_boundary(h) : w.directed_edge_to_boundary(h)

		return n < 0 ? -n : [...new Float64Array(memoryBuffer(), w.out_f64_ptr(), n)]
	}

	const x = op === "cellAreaRads2" ? w.cell_area(h, 0) : w.edge_length(h, 0)

	return w.last_error() || [x]
}

const lines: string[] = []

for (const op of OPS) {
	const records = readFileSync(join(fixtures, `${op}.jsonl`), "utf8")
		.trim()
		.split("\n")

	for (const text of records) {
		const index = JSON.parse(text).args.index as string
		const r = wasmValues(op, BigInt("0x" + index))

		lines.push(`${op} ${index}${typeof r === "number" ? ` error ${r}` : r.map((x) => " " + hex(x)).join("")}`)
	}
}

const native = execFileSync(
	"cargo",
	["run", "-q", "-p", "sister-h3", "--example", "float_bits", "--features", "libm", "--locked", "--", fixtures],
	{ cwd: root, encoding: "utf8", maxBuffer: 1 << 28 }
)
	.trimEnd()
	.split("\n")

let mismatches = 0

for (let i = 0; i < Math.max(native.length, lines.length); i++) {
	if (native[i] !== lines[i] && mismatches++ < 5) {
		console.error(`line ${i + 1}\n  native ${native[i]}\n  wasm   ${lines[i]}`)
	}
}

const values = lines.reduce((n, l) => n + l.split(" ").length - 2, 0)

if (mismatches || native.length !== lines.length) {
	console.error(`check:libm-wasm: ${mismatches} of ${lines.length} cases differ between native (libm feature) and WASM`)

	process.exit(1)
}

console.log(
	`check:libm-wasm: ${lines.length} cases (${values} values) bit-identical between native (libm feature) and WASM`
)
