/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { copyFileSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { bin, root } from "../../scripts/support/paths.ts"
import { run as sh } from "../../scripts/support/process.ts"

export function checkTarball(tarball: string): string {
	const listing = sh("tar", ["-tzf", tarball])
		.split("\n")
		.filter(Boolean)
		.map((f) => f.replace(/^package\//, ""))

	const required = [
		"package.json",
		"README.md",
		"LICENSE",
		"LICENSE-APACHE-2.0",
		"NOTICE",
		"THIRD_PARTY_NOTICES.md",
		"wasm/h3.wasm",
		"out/index.js",
		"out/index.d.ts",
		"out/lib/generated/h3.js",
		"out/lib/generated/h3.d.ts",
		"out/lib/generated/h3-embedded.js",
		"out/workerd.js",
		"out/lib/runtime/state.js",
	]

	const missing = required.filter((f) => !listing.includes(f))

	const forbidden = listing.filter(
		(f) => /^(crates|scripts|test|target|lib|benchmarks|docs)\//.test(f) || f.endsWith(".rs")
	)

	if (missing.length || forbidden.length) {
		throw new Error(`missing ${JSON.stringify(missing)}; unexpected ${JSON.stringify(forbidden)}`)
	}

	const wasm = readFileSync(join(root, "wasm/h3.wasm"))

	return `${listing.length} files; wasm ${wasm.length} bytes; no sources, tests, or Rust files`
}

export function checkDeclarations(consumer: string): string {
	copyFileSync(join(root, "test/package/consumers/types.ts"), join(consumer, "consumer.ts"))
	copyFileSync(join(root, "test/package/consumers/brands.ts"), join(consumer, "brands.ts"))

	writeFileSync(
		join(consumer, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				target: "esnext",
				module: "nodenext",
				moduleResolution: "nodenext",
				strict: true,
				noEmit: true,
				skipLibCheck: false,
				lib: ["ESNext", "DOM"],
				types: [],
			},
			files: ["consumer.ts", "brands.ts"],
		})
	)

	sh(bin("tsc"), ["-p", join(consumer, "tsconfig.json")], consumer)

	return "consumer.ts and brands.ts typecheck (including default brands, overrides, and @ts-expect-error cases) with skipLibCheck false"
}
