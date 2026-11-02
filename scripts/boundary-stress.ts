/**
 * Measures how often the platform math library and the `libm` crate (the one the WASM build uses) put a point near a
 * cell edge in different cells. See `crates/h3-core/examples/boundary_stress.rs` for the method.
 *
 * Yarn stress:boundary [samples]
 *
 * Writes its points and cells under `target/boundary-stress/` and prints a Markdown table. On linux x86-64 glibc the
 * platform build matches the C reference, so the table is the npm package's disagreement with C there; on macOS it is
 * Apple's libm against the `libm` crate.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { execFileSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const dir = join(root, "target/boundary-stress")
const samples = process.argv[2] ?? "2000"

const example = (features: string[], ...args: string[]) =>
	execFileSync(
		"cargo",
		[
			"run",
			"-q",
			"-p",
			"sister-h3",
			"--example",
			"boundary_stress",
			"--release",
			"--locked",
			...features,
			"--",
			...args,
		],
		{ cwd: root, stdio: "inherit" }
	)

example([], "gen", dir, samples)
example([], "eval", dir, "platform")
example(["--features", "libm"], "eval", dir, "libm")
example([], "report", dir, "platform", "libm")
