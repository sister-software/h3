/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { existsSync } from "node:fs"
import { join } from "node:path"

import { root } from "../scripts/support/paths.ts"
import { run } from "../scripts/support/process.ts"
import { jobs, samples } from "./context.ts"
import { stat } from "./stats.ts"

export function measureNative() {
	run("cargo", ["build", "--release", "-p", "sister-h3", "--example", "bench", "--locked", "-j", jobs])

	const parse = (text: string) =>
		Object.fromEntries(
			text
				.trim()
				.split("\n")
				.map((l) => JSON.parse(l))
				.map((r: { op: string; nsPerOp: number[]; checksum: string }) => [r.op, r])
		)

	const rust = parse(run(join(root, "target/release/examples/bench"), [String(samples)]))

	// The same binary with the `libm` feature. Same output path, so build and run it before the next build.
	run("cargo", [
		"build",
		"--release",
		"-p",
		"sister-h3",
		"--example",
		"bench",
		"--features",
		"libm",
		"--locked",
		"-j",
		jobs,
	])

	const rustLibm = parse(run(join(root, "target/release/examples/bench"), [String(samples)]))
	const cLib = join(root, "target/reference/h3-c")
	let c: Record<string, { nsPerOp: number[]; checksum: string }> | undefined

	if (existsSync(join(cLib, "lib/libh3.a"))) {
		const exe = join(root, "target/reference/bench-c")

		run("cc", [
			"-O3",
			"-ffp-contract=off", // as in scripts/generate-fixtures.ts: no host-dependent FMA contraction
			"-std=c11",
			"-I" + join(cLib, "src/h3lib/include"),
			"-o",
			exe,
			join(root, "benchmarks/c/bench.c"),
			"-L" + join(cLib, "lib"),
			"-lh3",
			"-lm",
		])

		c = parse(run(exe, [String(samples)]))
	}

	const native = Object.fromEntries(
		Object.entries(rust).map(([op, r]) => [
			op,
			{
				rust: stat(r.nsPerOp),
				rustLibm: stat(rustLibm[op]!.nsPerOp),
				c: c?.[op] ? stat(c[op].nsPerOp) : undefined,
				checksumMatch: c?.[op] ? c[op].checksum === r.checksum : undefined,
			},
		])
	)

	if (!c) {
		console.log("native: C reference not built (run generate:fixtures); Rust only")
	}

	return native
}
