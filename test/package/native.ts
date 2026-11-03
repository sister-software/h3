/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { root } from "../../scripts/support/paths.ts"
import { run as sh } from "../../scripts/support/process.ts"

const cargo = process.env.CARGO ?? "cargo"

export function checkNativePackage(work: string): string {
	sh(cargo, ["package", "-p", "sister-h3", "--locked", "--allow-dirty", "--no-verify"])

	const version = JSON.parse(sh(cargo, ["metadata", "--format-version", "1", "--no-deps"])).packages.find(
		(p: { name: string }) => p.name === "sister-h3"
	).version

	// Outside the repository, so Cargo cannot attach the crate to this workspace.
	const nativeWork = mkdtempSync(join(tmpdir(), "sister-h3-native-"))

	try {
		const unpacked = join(nativeWork, `sister-h3-${version}`)
		sh("tar", ["-xzf", join(root, "target/package", `sister-h3-${version}.crate`), "-C", nativeWork])

		if (existsSync(join(unpacked, "..", "h3-wasm"))) throw new Error("adapter leaked into the package")
		const app = join(nativeWork, "native-consumer")
		mkdirSync(join(app, "src"), { recursive: true })

		writeFileSync(
			join(app, "Cargo.toml"),
			`[package]
name = "native-consumer"
version = "0.0.0"
edition = "2024"
publish = false

[dependencies]
sister-h3 = { path = ${JSON.stringify(unpacked)} }

[workspace]
`
		)

		copyFileSync(join(root, "test/package/consumers/native.rs"), join(app, "src/main.rs"))

		const env = { ...process.env, CARGO_TARGET_DIR: join(work, "native-target") }
		const out = sh(cargo, ["run", "--offline", "--quiet", "-j", process.env.H3_BUILD_JOBS ?? "4"], app, env).trim()

		if (out !== "87283472bffffff") throw new Error(`printed ${out}`)
		// The packaged crate's own tests (C fixtures included in the package).
		const tests = sh(cargo, ["test", "--offline", "--quiet", "-j", process.env.H3_BUILD_JOBS ?? "4"], unpacked, env)
		const passed = [...tests.matchAll(/test result: ok\. (\d+) passed/g)].reduce((n, m) => n + Number(m[1]), 0)

		if (/FAILED/.test(tests)) throw new Error(tests.slice(-1500))

		return `consumer printed ${out}; packaged crate tests passed (${passed} tests) without the workspace`
	} finally {
		rmSync(nativeWork, { recursive: true, force: true })
	}
}
