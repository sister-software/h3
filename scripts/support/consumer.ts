/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { SUPPORTED_OPERATIONS, type FixtureRecord } from "../../test/shared/fixture-cases.ts"
import { bin, root } from "./paths.ts"
import { run } from "./process.ts"

export function pack(work: string): string {
	mkdirSync(work, { recursive: true })
	run("yarn", ["compile"])
	const tarball = join(work, "package.tgz")
	run("yarn", ["pack", "--out", tarball])

	return tarball
}

export function installConsumer(work: string, name: string, tarball: string): string {
	const dir = join(work, name)
	mkdirSync(dir, { recursive: true })
	writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `h3-${name}`, private: true, type: "module" }))
	run("npm", ["install", "--no-audit", "--no-fund", "--offline", "--loglevel=error", tarball], dir)

	return dir
}

export function fixtureRecords(): FixtureRecord[] {
	return SUPPORTED_OPERATIONS.flatMap((op) =>
		readFileSync(join(root, "crates/h3-core/tests/fixtures", `${op}.jsonl`), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as FixtureRecord)
	)
}

/**
 * Bundles the probe code while keeping the installed package external to the bundle.
 */
export function buildConsumer(source: string, dir: string, name: string, aliases: Record<string, string> = {}): void {
	run(bin("esbuild"), [
		source,
		"--bundle",
		"--format=esm",
		"--platform=neutral",
		"--external:node:*",
		"--external:@sister.software/h3",
		"--external:@sister.software/h3/*",
		"--external:./h3-bytes.bin",
		...Object.entries(aliases).map(([key, value]) => `--alias:${key}=${value}`),
		`--outfile=${join(dir, name)}`,
	])
}
