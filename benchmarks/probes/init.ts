/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"

const {
	values: { mode },
} = parseArgs({ options: { mode: { type: "string", default: "lazy" } } })

if (mode !== "lazy" && mode !== "explicit") throw new RangeError("mode must be lazy or explicit")
const t0 = performance.now()
const h3 = await import("@sister.software/h3")
const t1 = performance.now()

if (mode === "explicit") {
	await h3.init({ bytes: readFileSync(new URL(import.meta.resolve("@sister.software/h3/h3.wasm"))) })
}

const t2 = performance.now()
h3.latLngToCell(37.3615593, -122.0553238, 7)
const t3 = performance.now()
h3.latLngToCell(37.3615593, -122.0553238, 7)
const t4 = performance.now()

console.log(JSON.stringify({ importMs: t1 - t0, initMs: t2 - t1, firstCallMs: t3 - t2, secondCallMs: t4 - t3 }))
