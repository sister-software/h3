/**
 * Explicit WebAssembly initialization and ownership. See docs/api-decisions.md, "Initialization".
 *
 * Importing this module allocates nothing beyond ordinary module objects: no compilation, no instantiation, no fetch,
 * no WASM memory. All of that happens inside {@link init}.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import * as glue from "../generated/h3.js"
import { initializationError, resourceLimitError, runtimeError, h3Error } from "./errors.ts"

/**
 * The private WASM bindings. Only lib/api uses this type. @internal
 */
export type Bindings = typeof glue

/**
 * WASM ABI version this runtime understands. Must match `abi_version()` in crates/h3-wasm.
 */
const ABI_VERSION = 1

/**
 * Per-request budgets. See docs/api-decisions.md, "Resource limits".
 */
export interface ResourceLimits {
	/**
	 * Maximum scalar values in a returned result (an index string or a number counts as one).
	 */
	maxResultItems?: number
	/**
	 * Maximum estimated bytes of flattened WASM output plus JavaScript result expansion.
	 */
	maxResultBytes?: number
	/**
	 * Maximum estimated bytes of live native input plus temporary workspace.
	 */
	maxWorkspaceBytes?: number
}

/**
 * Options for {@link init}: exactly one of `module` or `bytes`.
 */
export type InitOptions =
	| { module: WebAssembly.Module; bytes?: never; limits?: ResourceLimits }
	| { bytes: ArrayBuffer | ArrayBufferView; module?: never; limits?: ResourceLimits }

/**
 * Defaults chosen from measurements (benchmarks/RESULTS.md, docs/api-decisions.md "Resource limits"): a result index
 * string measured 27-40 bytes of JS heap, and an 823,543-cell result about 23 MiB of transient WASM memory. One million
 * results therefore stay near 50 MiB, well inside a Cloudflare Worker's 128 MB for JS heap plus WASM. Node build tools
 * that need larger single results should raise them in `init`.
 */
export const DEFAULT_LIMITS: Readonly<Required<ResourceLimits>> = Object.freeze({
	maxResultItems: 1_000_000,
	maxResultBytes: 128 * 1024 * 1024,
	maxWorkspaceBytes: 64 * 1024 * 1024,
})

type ResolvedLimits = Readonly<Required<ResourceLimits>>

type State =
	| { kind: "uninitialized" }
	| { kind: "initializing"; source: object; limits: ResolvedLimits; promise: Promise<void> }
	| { kind: "ready"; source: object; limits: ResolvedLimits }
	| { kind: "poisoned"; cause: unknown }

let state: State = { kind: "uninitialized" }

/**
 * The live bindings, or `null` before readiness. Read on every call; kept monomorphic.
 */
let live: Bindings | null = null

/**
 * The instance's linear memory, kept for diagnostics only.
 */
let memory: WebAssembly.Memory | null = null

function resolveLimits(limits: unknown): ResolvedLimits {
	if (limits === undefined) return DEFAULT_LIMITS

	if (typeof limits !== "object" || limits === null) throw new TypeError("init: limits must be an object")
	const out = { ...DEFAULT_LIMITS }

	for (const key of Object.keys(limits)) {
		if (!(key in DEFAULT_LIMITS)) throw new TypeError(`init: unknown limit ${JSON.stringify(key)}`)
	}

	for (const key of Object.keys(DEFAULT_LIMITS) as (keyof ResolvedLimits)[]) {
		const value = (limits as Record<string, unknown>)[key]

		if (value === undefined) continue

		if (typeof value !== "number") throw new TypeError(`init: limits.${key} must be a number`)

		if (!Number.isSafeInteger(value) || value < 0) {
			throw new RangeError(`init: limits.${key} must be a non-negative safe integer`)
		}

		out[key] = value
	}

	return Object.freeze(out)
}

function sameLimits(a: ResolvedLimits, b: ResolvedLimits): boolean {
	return (
		a.maxResultItems === b.maxResultItems &&
		a.maxResultBytes === b.maxResultBytes &&
		a.maxWorkspaceBytes === b.maxWorkspaceBytes
	)
}

function isBytes(x: unknown): x is ArrayBuffer | ArrayBufferView {
	return x instanceof ArrayBuffer || ArrayBuffer.isView(x)
}

/**
 * Copies the bytes (including from shared buffers) into a fresh, unshared Uint8Array.
 */
function copyBytes(bytes: ArrayBuffer | ArrayBufferView): Uint8Array<ArrayBuffer> {
	const view =
		bytes instanceof ArrayBuffer
			? new Uint8Array(bytes)
			: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)

	return view.slice()
}

/**
 * Initializes the H3 WebAssembly instance. Call once during application startup; every H3 function except the pure
 * exports is synchronous afterwards.
 *
 * Pass `module` with a compiled `WebAssembly.Module` (required in Cloudflare Workers, where a bundler supplies it) or
 * `bytes` with the contents of `@sister.software/h3/h3.wasm`.
 */
export function init(options: InitOptions): Promise<void> {
	// Validate and capture synchronously, before any asynchronous gap.
	if (typeof options !== "object" || options === null) {
		return Promise.reject(new TypeError("init: options must be an object with `module` or `bytes`"))
	}

	const { module, bytes } = options as { module?: unknown; bytes?: unknown }
	const hasModule = module !== undefined
	const hasBytes = bytes !== undefined

	if (hasModule === hasBytes) {
		return Promise.reject(new TypeError("init: pass exactly one of `module` or `bytes`"))
	}

	if (hasModule && !(module instanceof WebAssembly.Module)) {
		return Promise.reject(new TypeError("init: `module` must be a WebAssembly.Module"))
	}

	if (hasBytes && !isBytes(bytes)) {
		return Promise.reject(new TypeError("init: `bytes` must be an ArrayBuffer or ArrayBufferView"))
	}

	let limits: ResolvedLimits

	try {
		limits = resolveLimits(options.limits)
	} catch (error) {
		return Promise.reject(error)
	}

	const source = (hasModule ? module : bytes) as object

	switch (state.kind) {
		case "poisoned":
			return Promise.reject(runtimeError("H3 WebAssembly instance trapped; create a new runtime", state.cause))
		case "ready":
			if (state.source === source && sameLimits(state.limits, limits)) return Promise.resolve()
			return Promise.reject(initializationError("init: already initialized with a different source or limits"))
		case "initializing":
			if (state.source === source && sameLimits(state.limits, limits)) return state.promise
			return Promise.reject(initializationError("init: initialization with a different source or limits is pending"))
		case "uninitialized":
			break
	}

	const copied = hasBytes ? copyBytes(bytes as ArrayBuffer | ArrayBufferView) : null

	const promise = (async () => {
		const compiled = copied ? await WebAssembly.compile(copied) : (module as WebAssembly.Module)
		const exports = (await glue.default({ module_or_path: compiled })) as { memory?: WebAssembly.Memory }
		memory = exports.memory ?? null
		const version = glue.abi_version()

		if (version !== ABI_VERSION) {
			throw new Error(`WASM ABI version ${version} does not match runtime ABI version ${ABI_VERSION}`)
		}

		glue.set_limits(limits.maxResultItems, limits.maxResultBytes, limits.maxWorkspaceBytes)
	})().then(
		() => {
			state = { kind: "ready", source, limits }
			live = glue

			return undefined
		},
		(error: unknown) => {
			state = { kind: "uninitialized" }
			live = null
			throw initializationError(`init: failed to initialize H3 WebAssembly: ${String(error)}`, error)
		}
	)

	state = { kind: "initializing", source, limits, promise }

	return promise
}

/**
 * Returns the live bindings or throws the appropriate state error. Called at the start of every non-pure public
 * function. @internal
 */
export function ready(): Bindings {
	if (live !== null) return live

	if (state.kind === "poisoned")
		throw runtimeError("H3 WebAssembly instance trapped; create a new runtime", state.cause)

	throw initializationError(
		state.kind === "initializing"
			? "H3 is still initializing; await init() before calling H3 functions"
			: "H3 is not initialized; call and await init() before calling H3 functions"
	)
}

/**
 * Converts an exception thrown out of WASM into the public error. A WebAssembly trap poisons the instance. @internal
 */
export function trapped(error: unknown): unknown {
	if (error instanceof WebAssembly.RuntimeError) {
		state = { kind: "poisoned", cause: error }
		live = null

		return runtimeError("H3 WebAssembly instance trapped; create a new runtime", error)
	}

	return error
}

/**
 * Throws the public error for a nonzero status from `last_error()`. @internal
 */
export function statusError(w: Bindings, status: number): Error {
	switch (status) {
		case 1001:
			return resourceLimitError("maxResultItems", w.limit_requested(), w.limit_maximum())
		case 1002:
			return resourceLimitError("maxResultBytes", w.limit_requested(), w.limit_maximum())
		case 1003:
			return resourceLimitError("maxWorkspaceBytes", w.limit_requested(), w.limit_maximum())
		case 1004:
			return new RangeError("Result is not representable as a JavaScript safe integer")
		default:
			return h3Error(status)
	}
}

/**
 * Test hook: the current state kind. @internal
 */
export function stateKind(): State["kind"] {
	return state.kind
}

/**
 * Diagnostics for measurement scripts: the current WASM linear memory size in bytes, or 0 before initialization. Not
 * part of the public API.
 *
 * @internal
 */
export function wasmMemoryBytes(): number {
	return memory?.buffer.byteLength ?? 0
}

/**
 * The current linear memory buffer. Read it after each call (memory may have grown) and copy out before the next WASM
 * call.
 *
 * @internal
 */
export function memoryBuffer(): ArrayBuffer {
	return memory!.buffer as ArrayBuffer
}
