/**
 * Validates the committed C reference fixtures without C: schema of every record, and file hashes and counts against
 * test/fixtures/provenance.json (which must equal the copy packaged with the native crate).
 *
 *     yarn check:fixtures
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const dir = join(root, "crates/h3-core/tests/fixtures")
const errors: string[] = []

const provenanceText = readFileSync(join(root, "test/fixtures/provenance.json"), "utf8")

if (readFileSync(join(dir, "provenance.json"), "utf8") !== provenanceText) {
	errors.push("crates/h3-core/tests/fixtures/provenance.json differs from test/fixtures/provenance.json")
}

const provenance = JSON.parse(provenanceText) as {
	fixtureSchemaVersion: number
	seed: number
	ctestRun: boolean
	references: { h3c: { revision: string } }
	files: Record<string, { cases: number; sha256: string }>
}

if (provenance.fixtureSchemaVersion !== 1) {
	errors.push(`unsupported fixture schema ${provenance.fixtureSchemaVersion}`)
}

if (!/^[0-9a-f]{40}$/.test(provenance.references.h3c.revision)) {
	errors.push("provenance lacks a full C revision")
}

if (provenance.ctestRun !== true) {
	errors.push("fixtures were generated without running the C test suite")
}

const isFloatTag = (x: unknown) => x === "nan" || x === "inf" || x === "-inf"

function checkJsonValue(x: unknown, where: string): void {
	if (typeof x === "number" && !Number.isFinite(x)) {
		errors.push(`${where}: non-finite number`)
	}

	if (x === null) return

	if (Array.isArray(x)) {
		x.forEach((v, i) => checkJsonValue(v, `${where}[${i}]`))
	} else if (typeof x === "object") {
		for (const [k, v] of Object.entries(x as object)) {
			checkJsonValue(v, `${where}.${k}`)
		}
	} else if (typeof x === "string" && !isFloatTag(x) && !/^[0-9a-f]+$/.test(x) && !/^[a-zA-Z0-9_]+$/.test(x)) {
		errors.push(`${where}: unexpected string ${JSON.stringify(x)}`)
	}
}

const files = readdirSync(dir)
	.filter((f) => f.endsWith(".jsonl"))
	.toSorted()

const listed = Object.keys(provenance.files).toSorted()

if (JSON.stringify(files) !== JSON.stringify(listed)) {
	errors.push(`fixture files ${files.join(",")} != provenance ${listed.join(",")}`)
}

let total = 0

for (const file of files) {
	const body = readFileSync(join(dir, file), "utf8")
	const sha = createHash("sha256").update(body).digest("hex")
	const expected = provenance.files[file]

	if (!expected) continue

	if (sha !== expected.sha256) {
		errors.push(`${file}: sha256 ${sha} != provenance ${expected.sha256}`)
	}

	const lines = body.trimEnd().split("\n")

	if (lines.length !== expected.cases) {
		errors.push(`${file}: ${lines.length} cases != provenance ${expected.cases}`)
	}

	const op = file.replace(/\.jsonl$/, "")

	lines.forEach((line, i) => {
		const where = `${file}:${i + 1}`
		let rec: Record<string, unknown>

		try {
			rec = JSON.parse(line)
		} catch {
			errors.push(`${where}: invalid JSON`)

			return
		}

		const keys = Object.keys(rec).toSorted().join(",")

		if (keys !== "args,error,operation,result,schemaVersion") {
			errors.push(`${where}: keys ${keys}`)
		}

		if (rec.schemaVersion !== 1) {
			errors.push(`${where}: schemaVersion`)
		}

		if (rec.operation !== op) {
			errors.push(`${where}: operation ${String(rec.operation)} in ${file}`)
		}

		if (!Number.isInteger(rec.error) || (rec.error as number) < 0 || (rec.error as number) > 19) {
			errors.push(`${where}: error code`)
		}

		if (rec.error === 0 ? rec.result === null || typeof rec.result !== "object" : rec.result !== null) {
			errors.push(`${where}: result must be an object on success and null on failure`)
		}

		if (typeof rec.args !== "object" || rec.args === null) {
			errors.push(`${where}: args`)
		}

		checkJsonValue(rec.args, `${where} args`)
		checkJsonValue(rec.result, `${where} result`)
	})

	total += lines.length
}

if (errors.length) {
	for (const e of errors.slice(0, 50)) {
		console.error(`check:fixtures: ${e}`)
	}

	console.error(`check:fixtures: ${errors.length} problem(s)`)

	process.exit(1)
}

console.log(`check:fixtures: ${total} cases in ${files.length} files match provenance (seed ${provenance.seed})`)
