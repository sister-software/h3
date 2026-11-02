/**
 * H3 hexagonal hierarchical geospatial indexing, implemented in Rust and compiled to WebAssembly.
 *
 * No setup is required: the first H3 call instantiates the embedded WebAssembly binary synchronously (importing does no
 * WebAssembly work). Call {@link init} only to preload, to set resource limits, or to supply your own binary. See
 * README.md and docs/api-decisions.md.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { embeddedWasmBytes } from "./lib/generated/h3-embedded.js"
import { setDefaultSource } from "./lib/runtime/state.ts"

setDefaultSource(embeddedWasmBytes)

export * from "./lib/exports.ts"
