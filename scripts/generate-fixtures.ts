/**
 * Generates C reference fixtures and C-derived Rust tables from the pinned H3 C source.
 *
 * This is the only script that builds or invokes C. It requires an explicit `H3_C_SOURCE` checkout at the pinned
 * revision (`H3_C_SOURCE=/path/to/h3 yarn generate:fixtures`); normal builds and tests consume the committed output.
 *
 * Environment: `H3_C_SOURCE` (required) names the checkout at {@link PINNED_C_REVISION}; `H3_SKIP_CTEST=1` skips the C
 * test suite (iteration only: accepted fixtures must have it run); `H3_BUILD_JOBS` sets parallel build jobs (default 4;
 * the lab machine is shared).
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { cases, FIXTURE_SCHEMA_VERSION, SEED } from "./fixtures/cases.ts"

export const PINNED_C_REVISION = "24946ad1c5e9016a6eab96d4f9ee4d0c993720e5"
export const PINNED_C_VERSION = "4.5.0"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const target = join(root, "target", "reference")
const cBuild = join(target, "h3-c")
const fixtureDir = join(root, "crates", "h3-core", "tests", "fixtures")
const jobs = process.env.H3_BUILD_JOBS ?? "4"

function fail(message: string): never {
	console.error(`generate:fixtures: ${message}`)

	process.exit(1)
}

function run(cmd: string, args: string[], opts: { cwd?: string; input?: string } = {}): string {
	return execFileSync(cmd, args, {
		cwd: opts.cwd ?? root,
		input: opts.input,
		encoding: "utf8",
		maxBuffer: 1 << 30,
		stdio: opts.input === undefined ? ["ignore", "pipe", "inherit"] : ["pipe", "pipe", "inherit"],
	})
}

const source = process.env.H3_C_SOURCE

if (!source) {
	fail("H3_C_SOURCE must name an H3 C checkout at revision " + PINNED_C_REVISION)
}

const revision = run("git", ["-C", source, "rev-parse", "HEAD"]).trim()

if (revision !== PINNED_C_REVISION) {
	fail(`H3_C_SOURCE is at ${revision}; expected ${PINNED_C_REVISION}`)
}

const version = readFileSync(join(source, "VERSION"), "utf8").trim()
const describe = run("git", ["-C", source, "describe", "--tags"]).trim()

if (version !== PINNED_C_VERSION) {
	fail(`H3_C_SOURCE VERSION is ${version}; expected ${PINNED_C_VERSION}`)
}

// Build the C library and its tests out of tree. BUILD_FILTERS is required at this revision:
// the CLI tests registered by CMakeTests.cmake reference the h3 filter binary.
run("cmake", [
	"-S",
	source,
	"-B",
	cBuild,
	"-DCMAKE_BUILD_TYPE=Release",
	"-DBUILD_TESTING=ON",
	"-DBUILD_BENCHMARKS=OFF",
	"-DBUILD_FUZZERS=OFF",
	"-DBUILD_FILTERS=ON",
	"-DBUILD_GENERATORS=OFF",
	"-DENABLE_DOCS=OFF",
	"-DENABLE_FORMAT=OFF",
	"-DENABLE_LINTING=OFF",
])

run("cmake", ["--build", cBuild, "--parallel", jobs])

if (process.env.H3_SKIP_CTEST !== "1") {
	const ctest = spawnSync("ctest", ["--test-dir", cBuild, "--output-on-failure", "-j", jobs], { stdio: "inherit" })

	if (ctest.status !== 0) {
		fail("the C test suite failed; fixtures were not generated")
	}
}

const include = join(cBuild, "src", "h3lib", "include")
const lib = join(cBuild, "lib")
const runner = join(target, "runner")

run("cc", [
	"-O2",
	"-std=c11",
	"-I" + include,
	"-o",
	runner,
	join(root, "test/reference/runner.c"),
	"-L" + lib,
	"-lh3",
	"-lm",
])

// Tables: the generator includes C implementation files directly so file-static tables are readable.
const tablesDir = join(root, "target", "tables")
mkdirSync(tablesDir, { recursive: true })

const genSrc = readFileSync(join(root, "scripts/tables/gen_tables.c"), "utf8").replaceAll(
	'"../lib/',
	`"${join(source, "src/h3lib/lib")}/`
)

const genTmp = join(tablesDir, "gen_tables.c")
writeFileSync(genTmp, genSrc)
const genBin = join(tablesDir, "gen_tables")

run("cc", [
	"-O0",
	"-std=c11",
	"-I" + join(source, "src/h3lib/include"),
	"-I" + include,
	"-o",
	genBin,
	genTmp,
	"-L" + lib,
	"-lh3",
	"-lm",
])

const tablesRs = join(root, "crates/h3-core/src/tables/generated.rs")

writeFileSync(tablesRs, run(genBin, []))
// Committed Rust follows rustfmt.toml, so `cargo fmt --check` stays clean after regeneration.
run("rustfmt", ["--edition", "2024", tablesRs])

// Fixtures.
mkdirSync(fixtureDir, { recursive: true })

/**
 * Runs helper queries against the C runner during case generation (e.g. to find nearby cells).
 */
function ref(lines: string[]): string[][] {
	if (!lines.length) return []

	return run(runner, [], { input: lines.join("\n") + "\n" })
		.trimEnd()
		.split("\n")
		.map((l) => l.trim().split(/\s+/))
}

const all = cases(ref)
const input = all.map((c) => [c.operation, ...c.tokens].join(" ")).join("\n") + "\n"
const output = run(runner, [], { input }).split("\n")
const byOp = new Map<string, string[]>()
const counts: Record<string, number> = {}

all.forEach((c, i) => {
	const line = output[i]

	if (line === undefined) {
		fail(`runner produced no output for case ${i} (${c.operation})`)
	}

	const tokens = line.trim().split(/\s+/)
	const error = Number(tokens[0])

	const record = {
		schemaVersion: FIXTURE_SCHEMA_VERSION,
		operation: c.operation,
		args: c.args,
		error,
		result: error === 0 ? c.decode(tokens.slice(1)) : null,
	}

	const file = c.file ?? c.operation

	if (!byOp.has(file)) {
		byOp.set(file, [])
	}

	byOp.get(file)!.push(JSON.stringify(record))
	counts[file] = (counts[file] ?? 0) + 1
})

const files: Record<string, { cases: number; sha256: string }> = {}

for (const [file, lines] of [...byOp].toSorted(([a], [b]) => a.localeCompare(b))) {
	const body = lines.join("\n") + "\n"
	writeFileSync(join(fixtureDir, `${file}.jsonl`), body)
	files[`${file}.jsonl`] = { cases: lines.length, sha256: createHash("sha256").update(body).digest("hex") }
}

const generatorHash = createHash("sha256")

for (const f of [
	"scripts/generate-fixtures.ts",
	"scripts/fixtures/cases.ts",
	"test/reference/runner.c",
	"scripts/tables/gen_tables.c",
]) {
	generatorHash.update(readFileSync(join(root, f)))
}

const cc = run("cc", ["--version"]).split("\n")[0]
const cmake = run("cmake", ["--version"]).split("\n")[0]

const provenance = {
	fixtureSchemaVersion: FIXTURE_SCHEMA_VERSION,
	seed: SEED,
	generationCommand: "H3_C_SOURCE=<checkout> yarn generate:fixtures",
	generatorSha256: generatorHash.digest("hex"),
	references: {
		h3c: {
			repository: "https://github.com/uber/h3",
			version: PINNED_C_VERSION,
			revision: PINNED_C_REVISION,
			describe,
			license: "Apache-2.0",
			note: "The pinned revision is after the v4.5.0 tag; its VERSION file still reads 4.5.0.",
		},
		"h3-js": {
			version: "4.5.0",
			role: "migration comparison only (devDependency); bundles C v4.5.0",
			license: "Apache-2.0",
		},
	},
	platform: { os: `${process.platform} ${process.arch}`, cc, cmake, node: process.version },
	ctestRun: process.env.H3_SKIP_CTEST !== "1",
	files,
}

const provenanceJson = JSON.stringify(provenance, null, "\t") + "\n"
writeFileSync(join(fixtureDir, "provenance.json"), provenanceJson)
mkdirSync(join(root, "test/fixtures"), { recursive: true })
writeFileSync(join(root, "test/fixtures/provenance.json"), provenanceJson)

if (!existsSync(join(fixtureDir, "provenance.json"))) {
	fail("provenance was not written")
}

console.log(`generate:fixtures: wrote ${all.length} cases in ${byOp.size} files`)

for (const [f, n] of Object.entries(counts)) {
	console.log(`  ${f}: ${n}`)
}
