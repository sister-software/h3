/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { readFile } from "node:fs/promises"
import { parseArgs } from "node:util"

import { runFixtureCases } from "#test/shared/fixture-cases"

const counts = { compile: 0, instantiate: 0, Module: 0, Instance: 0, Memory: 0 }

for (const key of ["compile", "instantiate"] as const) {
	const original = WebAssembly[key]

	Object.defineProperty(WebAssembly, key, {
		value: (...args: unknown[]) => {
			counts[key]++

			return Reflect.apply(original, WebAssembly, args)
		},
	})
}

for (const key of ["Module", "Instance", "Memory"] as const) {
	const Original = WebAssembly[key]

	Object.defineProperty(WebAssembly, key, {
		value: new Proxy(Original, {
			construct(target, args, newTarget) {
				counts[key]++

				return Reflect.construct(target, args, newTarget)
			},
		}),
	})
}

const h3 = await import("@sister.software/h3")
const afterImport = { ...counts }

const pure = {
	split: h3.h3IndexToSplitLong("87283472bffffff"),
	join: h3.splitLongToH3Index(0x2b_ff_ff_ff, 0x8_72_83_47),
}

const bytes = await readFile(new URL(import.meta.resolve("@sister.software/h3/h3.wasm")))
const cases = JSON.parse(await readFile(new URL("./cases.json", import.meta.url), "utf8"))

const {
	values: { mode },
} = parseArgs({ options: { mode: { type: "string", default: "lazy" } } })

if (mode !== "lazy" && mode !== "bytes" && mode !== "module") throw new RangeError("Unknown initialization mode")

if (mode === "bytes") {
	await h3.init({ bytes })
}

if (mode === "module") {
	await h3.init({ module: new WebAssembly.Module(bytes) })
}

const first = h3.latLngToCell(37.3615593, -122.0553238, 7)

console.log(
	JSON.stringify({ afterImport, first, instances: counts.Instance, pure, outcomes: runFixtureCases(h3, cases) })
)
