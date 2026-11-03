/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

const privatePath = "@sister.software/h3/out/lib/runtime/state.js"

const out: Record<string, unknown> = {
	packageJson: (await import("@sister.software/h3/package.json", { with: { type: "json" } })).default.name,
}

try {
	await import(privatePath)
	out.deepImport = "allowed"
} catch (error) {
	out.deepImport = (error as NodeJS.ErrnoException).code
}

out.wasm = import.meta.resolve("@sister.software/h3/h3.wasm").endsWith("/wasm/h3.wasm")

console.log(JSON.stringify(out))
