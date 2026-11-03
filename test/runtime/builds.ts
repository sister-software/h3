/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { buildConsumer, installConsumer } from "../../scripts/support/consumer.ts"
import { root } from "../../scripts/support/paths.ts"

export interface BrowserBuild {
	name: string
	assets: number
	build: () => Promise<string>
}

export function browserBuilds(work: string, tarball: string): BrowserBuild[] {
	return ["vite", "webpack"].map((name) => {
		const dir = installConsumer(work, name, tarball)

		buildConsumer(join(root, `test/runtime/consumers/${name}.ts`), dir, "main.mjs", {
			"h3-probe-cases": join(work, "cases.json"),
		})

		writeFileSync(
			join(dir, "index.html"),
			'<!doctype html><html><body><script type="module" src="./main.mjs"></script></body></html>'
		)

		return {
			name,
			assets: name === "vite" ? 0 : 1,
			build: () => (name === "vite" ? buildVite(dir) : buildWebpack(dir)),
		}
	})
}

async function buildVite(viteDir: string): Promise<string> {
	const { build } = await import(pathToFileURL(join(root, "node_modules/vite/dist/node/index.js")).href)
	await build({ root: viteDir, logLevel: "warn", build: { outDir: join(viteDir, "dist"), emptyOutDir: true } })

	return join(viteDir, "dist")
}

async function buildWebpack(webpackDir: string): Promise<string> {
	const webpack = (await import("webpack")).default
	const out = join(webpackDir, "dist")

	await new Promise<void>((resolveBuild, reject) => {
		webpack(
			{
				mode: "production",
				context: webpackDir,
				entry: "./main.mjs",
				output: { path: out, filename: "main.js", publicPath: "auto" },
				module: { rules: [{ test: /\.wasm$/, type: "asset/resource" }] },
				experiments: { topLevelAwait: false },
				resolve: { modules: [join(webpackDir, "node_modules")] },
			},
			(error, stats) => {
				if (error) return reject(error)

				if (stats?.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })))
				resolveBuild()
			}
		)
	})

	writeFileSync(join(out, "index.html"), `<!doctype html><html><body><script src="./main.js"></script></body></html>`)

	return out
}
