/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

declare module "h3-probe-cases" {
	const cases: import("../../shared/fixture-cases.ts").FixtureRecord[]
	export default cases
}

declare module "h3-probe-bytes" {
	const bytes: Uint8Array<ArrayBuffer>
	export default bytes
}

declare module "@sister.software/h3/h3.wasm" {
	const url: string
	export default url
}
