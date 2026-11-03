/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { readdirSync } from "node:fs"

import type { Browser } from "playwright-core"

import { closeServer, serve } from "../../scripts/support/server.ts"
import { browserBuilds } from "./builds.ts"
import type { RuntimeChecks } from "./checks.ts"
import type {} from "./consumers/browser.ts"

export async function checkBrowsers(work: string, tarball: string, checks: RuntimeChecks): Promise<void> {
	type BrowserType = typeof import("playwright-core").chromium
	let engines: [string, BrowserType][] = []

	try {
		const pw = await import("playwright-core")

		engines = [
			["Chromium", pw.chromium],
			["Firefox", pw.firefox],
		]

		if (process.platform === "darwin") {
			engines.push(["WebKit", pw.webkit])
		}
	} catch (error) {
		checks.record("browser", "not run", `playwright-core unavailable: ${String(error)}`)
	}

	for (const { name: label, assets: expectedAssets, build: buildFn } of browserBuilds(work, tarball)) {
		let dist: string

		try {
			dist = await buildFn()
		} catch (error) {
			checks.record(`${label} production build`, "fail", String(error))

			continue
		}

		const assets = readdirSync(dist, { recursive: true }).map(String)
		const wasmAssets = assets.filter((a) => a.endsWith(".wasm"))

		// The Vite consumer never references h3.wasm (embedded binary); the webpack consumer emits it.

		checks.record(
			`${label} production build`,
			wasmAssets.length === expectedAssets ? "pass" : "fail",
			`wasm assets emitted: ${wasmAssets.length ? wasmAssets.join(", ") : "none"}`
		)

		for (const [engineName, engine] of engines) {
			const { server, url } = await serve(dist)
			let browser: Browser | undefined

			try {
				browser = await engine.launch({ headless: true })
				const page = await browser.newPage()
				const requests: string[] = []
				page.on("request", (r) => requests.push(new URL(r.url()).pathname))
				const consoleErrors: string[] = []
				page.on("pageerror", (e) => consoleErrors.push(String(e)))
				await page.goto(url)

				await page.waitForFunction(() => globalThis.__result !== undefined, null, {
					timeout: 120_000,
				})

				const result = await page.evaluate(() => globalThis.__result)

				if (!result) throw new Error("Browser returned no result")

				const wasmRequests = requests.filter((p) => p.endsWith(".wasm"))
				const where = `${label} in ${engineName} ${browser.version()}`

				if ("error" in result) {
					checks.record(where, "fail", JSON.stringify(result.error))
				} else {
					checks.judge(where, result)
				}

				// Vite uses first-use instantiation of the embedded binary (no request); webpack preloads the
				// separate asset with init({ bytes }) (exactly one request).
				const expectedRequests = label === "vite" ? 0 : 1

				checks.record(
					`${label} network in ${engineName} (${label === "vite" ? "no init" : "init({ bytes }) from the asset"})`,
					wasmRequests.length === expectedRequests &&
						("first" in result ? result.first : undefined) === "87283472bffffff" &&
						!consoleErrors.length
						? "pass"
						: "fail",
					`wasm requests ${JSON.stringify(wasmRequests)}; first call ${String("first" in result ? result.first : undefined)}; page errors ${consoleErrors.length}`
				)
			} catch (error) {
				checks.record(
					`${label} in ${engineName}`,
					browser ? "fail" : "not run",
					`browser could not run: ${String(error)}`
				)
			} finally {
				try {
					await browser?.close()
				} finally {
					await closeServer(server)
				}
			}
		}
	}
}
