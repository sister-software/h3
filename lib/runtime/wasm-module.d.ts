/**
 * The package's own binary, as a bundler-compiled module (wrangler compiles `.wasm` imports).
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

declare module "@sister.software/h3/h3.wasm" {
	const module: WebAssembly.Module
	export default module
}
