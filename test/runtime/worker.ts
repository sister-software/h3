/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { copyFileSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { buildConsumer, installConsumer } from "#scripts/support/consumer"
import { bin, root } from "#scripts/support/paths"
import { run, startService } from "#scripts/support/process"
import { freePort } from "#scripts/support/server"
import type { RuntimeChecks, ProbeResult } from "#test/runtime/checks"

export async function checkWorker(work: string, tarball: string, checks: RuntimeChecks): Promise<void> {
	const dir = installConsumer(work, "worker", tarball)
	copyFileSync(join(dir, "node_modules/@sister.software/h3/wasm/h3.wasm"), join(dir, "h3-bytes.bin"))

	buildConsumer(join(root, "test/runtime/consumers/worker.ts"), dir, "worker.mjs", {
		"h3-probe-cases": join(work, "cases.json"),
		"h3-probe-bytes": "./h3-bytes.bin",
	})

	writeFileSync(
		join(dir, "wrangler.toml"),
		`name = "h3-runtime-probe"\nmain = "worker.mjs"\ncompatibility_date = "2026-10-01"\nrules = [{ type = "Data", globs = ["**/*.bin"], fallthrough = false }]\n`
	)

	// Bundle check: the shared graph under Worker conditions must not contain Node builtins,
	// string code generation, or reference implementations.
	const bundle = join(dir, "bundle.mjs")

	try {
		run(
			bin("esbuild"),
			[
				join(dir, "worker.mjs"),
				"--bundle",
				"--format=esm",
				"--platform=neutral",
				"--conditions=workerd,worker,browser",
				"--loader:.wasm=file",
				"--loader:.bin=file",
				`--outfile=${bundle}`,
			],
			dir
		)

		const text = readFileSync(bundle, "utf8")

		const findings = {
			nodeBuiltins: [...text.matchAll(/(?:from|import\()\s*["'](node:[^"']+)["']/g)].map((m) => m[1]),
			require: /\brequire\(/.test(text),
			eval: /\beval\(/.test(text.replace(/\(0, eval\)\("1"\)/, "")),
			newFunction: /new Function\(/.test(text.replace('new Function("return 1")', "")),
			h3js: /h3-js/.test(text),
			h3o: /\bh3o\b/.test(text),
			importMetaUrl: (text.match(/import\.meta\.url/g) ?? []).length,
			// The workerd condition must select the entry that imports the compiled module, not the embedded copy.
			embeddedBinary: text.includes("embeddedWasmBytes"),
		}

		const clean =
			findings.nodeBuiltins.length === 0 &&
			!findings.require &&
			!findings.eval &&
			!findings.newFunction &&
			!findings.h3js &&
			!findings.h3o &&
			!findings.embeddedBinary

		checks.record(
			"esbuild bundle (--conditions=workerd,worker,browser)",
			clean ? "pass" : "fail",
			`node builtins ${findings.nodeBuiltins.length}, require ${findings.require}, eval ${findings.eval}, new Function ${findings.newFunction}, h3-js ${findings.h3js}, h3o ${findings.h3o}, embedded binary ${findings.embeddedBinary}; import.meta.url occurrences (probe only) ${findings.importMetaUrl}`,
			findings
		)
	} catch (error) {
		checks.record(
			"esbuild bundle (--conditions=workerd,worker,browser)",
			"fail",
			String((error as { stderr?: string }).stderr ?? error)
		)
	}

	const port = await freePort()
	const base = `http://127.0.0.1:${port}`

	const service = startService(
		bin("wrangler"),
		["dev", "--port", String(port), "--ip", "127.0.0.1", "--log-level", "warn", "--show-interactive-dev-session=false"],
		dir,
		{
			...process.env,
			WRANGLER_SEND_METRICS: "false",
			CI: "1",
		}
	)

	try {
		await service.ready(base + "/restrictions")
		const versions = run(bin("wrangler"), ["--version"]).trim().split("\n").pop()
		const workerd = JSON.parse(readFileSync(join(root, "node_modules/workerd/package.json"), "utf8")).version
		const restrictions: unknown = await (await fetch(base + "/restrictions")).json()

		checks.record(
			`workerd restrictions (wrangler ${versions}, workerd ${workerd})`,
			"pass",
			JSON.stringify(restrictions),
			restrictions
		)

		const result = (await (await fetch(base + "/")).json()) as ProbeResult & { first: string }
		checks.judge(`wrangler dev (workerd ${workerd}) no init (workerd export condition)`, result)

		checks.record(
			"workerd first call without init",
			result.first === "87283472bffffff" ? "pass" : "fail",
			`first call returned ${result.first}`
		)
	} catch (error) {
		checks.record("wrangler dev (workerd)", "fail", String(error))
	} finally {
		await service.close()
	}
}
