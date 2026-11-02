/**
 * The Cloudflare Workers (`workerd` export condition) entry. Workers refuse to compile WebAssembly from bytes, so
 * instead of the embedded copy this entry imports the package's own `h3.wasm`, which wrangler compiles at deploy time;
 * the first H3 call instantiates it synchronously.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import wasmModule from "@sister.software/h3/h3.wasm"

import { setDefaultSource } from "./lib/runtime/state.ts"

setDefaultSource(() => wasmModule)

export * from "./lib/exports.ts"
