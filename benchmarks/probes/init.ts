/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { readFileSync } from "node:fs"

const indexUrl = process.argv[3]!
const mode = process.argv[2]
const t0 = performance.now()
const h3 = (await import(indexUrl)) as typeof import("../../index.ts")
const t1 = performance.now()

if (mode === "explicit") {
	await h3.init({ bytes: readFileSync(process.argv[4]!) })
}

const t2 = performance.now()
h3.latLngToCell(37.3615593, -122.0553238, 7)
const t3 = performance.now()
h3.latLngToCell(37.3615593, -122.0553238, 7)
const t4 = performance.now()

console.log(JSON.stringify({ importMs: t1 - t0, initMs: t2 - t1, firstCallMs: t3 - t2, secondCallMs: t4 - t3 }))
