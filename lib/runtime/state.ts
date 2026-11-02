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
 * Options for {@link init}: at most one of `module` or `bytes`, and optional resource limits.
 */
export type InitOptions =
	| { module?: never; bytes?: never; limits?: ResourceLimits }
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
 * The binary the entry module registered for first-use initialization: embedded bytes (default entry) or a
 * bundler-compiled module (workerd entry). @internal
 */
let defaultSource: (() => WebAssembly.Module | Uint8Array<ArrayBuffer>) | null = null

/**
 * Identity of the registered default source, for init source comparisons.
 */
const DEFAULT_SOURCE = Object.freeze({ defaultSource: true })

/**
 * Registers the binary used when no source is passed to {@link init} and on first use. Called once by each entry module.
 *
 * @internal
 */
export function setDefaultSource(source: () => WebAssembly.Module | Uint8Array<ArrayBuffer>): void {
	defaultSource = source
}

/**
 * Instantiates synchronously and makes the instance live. Throws on failure, leaving the state unchanged.
 */
function activate(module: WebAssembly.Module, limits: ResolvedLimits, source: object): Bindings {
	const exports = glue.initSync({ module }) as { memory?: WebAssembly.Memory }
	const version = glue.abi_version()

	if (version !== ABI_VERSION) {
		throw new Error(`WASM ABI version ${version} does not match runtime ABI version ${ABI_VERSION}`)
	}

	glue.set_limits(limits.maxResultItems, limits.maxResultBytes, limits.maxWorkspaceBytes)
	memory = exports.memory ?? null
	state = { kind: "ready", source, limits }
	live = glue

	return glue
}

function activateDefault(limits: ResolvedLimits): Bindings {
	if (!defaultSource) throw new Error("no default WebAssembly binary is registered; pass `module` or `bytes`")

	const src = defaultSource()
	const module = src instanceof WebAssembly.Module ? src : new WebAssembly.Module(src)

	return activate(module, limits, DEFAULT_SOURCE)
}

/**
 * Optionally initializes the H3 WebAssembly instance ahead of first use. Calling it is never required: the first H3
 * call instantiates the package's binary synchronously.
 *
 * Use it to preload during startup, to set resource limits (which must happen before the first H3 call), or to supply
 * your own `module` (a compiled `WebAssembly.Module`) or `bytes` (the contents of `@sister.software/h3/h3.wasm`). With
 * no source it initializes from the package's binary. If H3 is already initialized with the same limits it resolves
 * immediately, whatever the source.
 */
export function init(options: InitOptions = {}): Promise<void> {
	// Validate and capture synchronously, before any asynchronous gap.
	if (typeof options !== "object" || options === null) {
		return Promise.reject(new TypeError("init: options must be an object"))
	}

	const { module, bytes } = options as { module?: unknown; bytes?: unknown }
	const hasModule = module !== undefined
	const hasBytes = bytes !== undefined

	if (hasModule && hasBytes) return Promise.reject(new TypeError("init: pass at most one of `module` or `bytes`"))

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

	const source = hasModule ? (module as object) : hasBytes ? (bytes as object) : DEFAULT_SOURCE

	switch (state.kind) {
		case "poisoned":
			return Promise.reject(runtimeError("H3 WebAssembly instance trapped; create a new runtime", state.cause))
		case "ready":
			// The package's binary is already live (possibly from first use): any source is equivalent unless the
			// limits differ, which can no longer change.
			if (sameLimits(state.limits, limits) && (state.source === source || state.source === DEFAULT_SOURCE)) {
				return Promise.resolve()
			}

			return Promise.reject(
				initializationError(
					"init: H3 is already initialized with a different source or limits (limits must be set before the first H3 call)"
				)
			)
		case "initializing":
			if (state.source === source && sameLimits(state.limits, limits)) return state.promise

			return Promise.reject(initializationError("init: initialization with a different source or limits is pending"))
		case "uninitialized":
			break
	}

	if (!hasModule && !hasBytes) {
		try {
			activateDefault(limits)

			return Promise.resolve()
		} catch (error) {
			return Promise.reject(initializationError(`init: failed to initialize H3 WebAssembly: ${String(error)}`, error))
		}
	}

	const copied = hasBytes ? copyBytes(bytes as ArrayBuffer | ArrayBufferView) : null

	const promise = (async () => {
		const compiled = copied ? await WebAssembly.compile(copied) : (module as WebAssembly.Module)

		activate(compiled, limits, source)
	})().catch((error: unknown) => {
		state = { kind: "uninitialized" }
		live = null
		throw initializationError(`init: failed to initialize H3 WebAssembly: ${String(error)}`, error)
	})

	state = { kind: "initializing", source, limits, promise }

	return promise
}

/**
 * Returns the live bindings, instantiating the default binary synchronously on first use. Called at the start of every
 * non-pure public function. @internal
 */
export function ready(): Bindings {
	if (live !== null) return live

	if (state.kind === "poisoned")
		throw runtimeError("H3 WebAssembly instance trapped; create a new runtime", state.cause)

	if (state.kind === "initializing") {
		throw initializationError("H3 is still initializing from the source passed to init(); await it before calling H3")
	}

	try {
		return activateDefault(DEFAULT_LIMITS)
	} catch (error) {
		throw initializationError(
			`H3 could not instantiate its WebAssembly binary synchronously (${String(error)}). ` +
				"Where synchronous compilation is not allowed, call and await init({ module }) or init({ bytes }) first.",
			error
		)
	}
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
