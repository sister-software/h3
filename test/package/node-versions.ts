/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { root } from "../../scripts/support/paths.ts"

export function nodeBinary(version: string): string | undefined {
	for (const p of [
		join(root, "target/tools", `node-v${version}-linux-x64/bin/node`),
		join(homedir(), ".nvm/versions/node", `v${version}`, "bin/node"),
	]) {
		if (existsSync(p)) return p
	}

	return undefined
}

const nvmrc = readFileSync(join(root, ".nvmrc"), "utf8").trim().replace(/^v/, "")

// `engines.node` is a disjunction of `^x.y.z` (that LTS line from its latest security release) and `>=x.y.z` (the
// newest LTS line onward). Only those two forms are accepted, so the policy cannot drift into something untested.
const enginesRange = String(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).engines.node)

const ranges = enginesRange.split("||").map((part) => {
	const match = /^\s*(\^|>=)(\d+)\.(\d+)\.(\d+)\s*$/.exec(part)

	if (!match) throw new Error(`engines.node "${enginesRange}": unsupported range "${part.trim()}"`)

	return { op: match[1]!, floor: [Number(match[2]), Number(match[3]), Number(match[4])] as const }
})

const parse = (v: string) => v.split(".").map(Number) as [number, number, number]
const cmp = (a: readonly number[], b: readonly number[]) => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!

const admitted = (v: string) =>
	ranges.some(({ op, floor }) => cmp(parse(v), floor) >= 0 && (op === ">=" || parse(v)[0] === floor[0]))

if (!admitted(nvmrc)) throw new Error(`.nvmrc ${nvmrc} is outside engines.node "${enginesRange}"`)

const floors = ranges.map(({ floor }) => floor.join("."))
const running = process.version.slice(1)

if (!admitted(running)) {
	console.log(`test:package: running Node ${running} is outside engines.node "${enginesRange}"; not tested`)
}

export const nodeVersions = new Set([...floors, nvmrc, ...(admitted(running) ? [running] : [])])
