/**
 * Generates the public JavaScript reference from compiled declarations and their source documentation.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"

import { format } from "oxfmt"

import { root } from "#scripts/support/paths"

import config from "../oxfmt.config.ts"

const {
	values: { check },
} = parseArgs({ options: { check: { type: "boolean", default: false } } })

const api = await import("@sister.software/h3")
const publicNames = new Set(Object.keys(api))

const sections = [
	["Initialization", "runtime/state"],
	["Constants", "api/constants"],
	["Index representation", "api/indexes"],
	["Inspection", "api/inspection"],
	["Coordinates", "api/coordinates"],
	["Hierarchy", "api/hierarchy"],
	["Traversal", "api/traversal"],
	["Edges and vertices", "api/edges"],
	["Measurements", "api/measurements"],
	["Polygons", "api/polygons"],
] as const

const lines = [
	"# JavaScript API reference",
	"",
	"This reference is generated from this package's declarations and source documentation.",
	"Run `yarn docs:api` to update it after changing a public signature or description.",
	"",
	"Indexes use `H3IndexInput` (a hexadecimal string or a pair of 32-bit words) and return canonical lowercase `H3Index` strings.",
	"Coordinates use degree pairs. GeoJSON switches reverse the coordinate order and close output loops.",
	"",
	"Cell, directed-edge, and vertex outputs default to the string brands `H3Cell`, `H3DirectedEdge`, and `H3Vertex`. Index-producing functions accept `T extends string` to select an application brand or plain `string`. The type argument changes only the output annotation. Existing string and split-long inputs remain accepted; `H3Index` remains the general string alias.",
	"",
	"Argument type errors throw `TypeError`; invalid binding ranges throw `RangeError`; algorithm failures throw an error named `H3Error` with its numeric C `code`.",
	"Predicates and inspection functions document their sentinel results below. [API decisions](api-decisions.md) describe the shared behavior and migration differences.",
	"",
]

for (const [title, module] of sections) {
	const declaration = readFileSync(join(root, `out/lib/${module}.d.ts`), "utf8")

	const entries = [
		...declaration.matchAll(/\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*export declare (function|const) (\w+)([^;]*);/g),
	].filter((entry) => publicNames.has(entry[3]!))

	if (!entries.length) continue
	lines.push(`## ${title}`, "")

	for (const [, comment, kind, name, signature] of entries) {
		publicNames.delete(name!)

		const description = comment!
			.split("\n")
			.map((line) => line.replace(/^\s*\* ?/, ""))
			.join("\n")
			.trim()

		const text = description.replaceAll(/\{@link(?:code)? ([^}]+)\}/g, "`$1`")

		const code =
			kind === "const"
				? `const ${name} = ${JSON.stringify(api[name as keyof typeof api], null, "\t")} as const`
				: `function ${name}${signature}`

		lines.push(`### ${name}`, "", "```ts", code, "```", "", text, "")
	}
}

if (publicNames.size) throw new Error(`Undocumented runtime exports: ${[...publicNames].join(", ")}`)
const file = join(root, "docs/api-reference.md")
const formatted = await format(file, lines.join("\n"), config)

if (formatted.errors.length) throw new Error(JSON.stringify(formatted.errors))
const contents = formatted.code

if (check) {
	if (readFileSync(file, "utf8") !== contents) throw new Error("API reference is stale; run yarn docs:api")
} else {
	writeFileSync(file, contents)
}
