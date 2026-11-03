/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { readFile } from "node:fs/promises"

import * as h3 from "@sister.software/h3"

import { runFixtureCases } from "#test/shared/fixture-cases"

await h3.init({ bytes: await readFile(new URL(import.meta.resolve("@sister.software/h3/h3.wasm"))) })
const cases = JSON.parse(await readFile(new URL("./cases.json", import.meta.url), "utf8"))
const out = runFixtureCases(h3, cases)
const failed = out.filter((o) => !o.ok)

console.log(JSON.stringify({ total: out.length, failed: failed.length, first: failed.slice(0, 3) }))
