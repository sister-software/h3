/**
 * Helpers that turn the private WASM ABI results into public values or errors. See docs/api-decisions.md, "Private WASM
 * ABI".
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { type Bindings, memoryBuffer, statusError, trapped } from "../runtime/state.ts"

/**
 * An index result. `0n` is either a failure or C returning `H3_NULL` successfully (possible for some operations on
 * invalid input), distinguished by `last_error()`. @internal
 */
export function checkIndex(w: Bindings, h: bigint): string {
	if (h === 0n) {
		const status = w.last_error()

		if (status !== 0) throw statusError(w, status)
	}

	return h.toString(16)
}

/**
 * A non-negative integer result: negative values are negated status codes. @internal
 */
export function checkCount(w: Bindings, n: number): number {
	if (n < 0) throw statusError(w, -n)

	return n
}

/**
 * A variable-length result: empty with a nonzero status means failure. @internal
 */
export function checkVec<T extends { length: number }>(w: Bindings, v: T): T {
	if (!v.length) {
		const status = w.last_error()

		if (status !== 0) throw statusError(w, status)
	}

	return v
}

/**
 * Pairs a flat `[lat, lng, ...]` radian array into degree coordinate pairs. @internal
 */
export function radPairsToDegrees(flat: Float64Array, geoJson: boolean, close: boolean): [number, number][] {
	const n = flat.length / 2
	const out: [number, number][] = new Array(close && n > 0 ? n + 1 : n)

	for (let i = 0; i < n; i++) {
		const lat = flat[2 * i]! * M_180_PI
		const lng = flat[2 * i + 1]! * M_180_PI
		out[i] = geoJson ? [lng, lat] : [lat, lng]
	}

	if (close && n > 0) {
		out[n] = [out[0]![0], out[0]![1]]
	}

	return out
}

/**
 * C `M_180_PI` (`57.29577951308232087679815481410517033240547`) as the shortest literal for the same double. @internal
 */
export const M_180_PI = 57.29577951308232
/**
 * C `M_PI_180` (`0.0174532925199432957692369076848861271111`) as the shortest literal for the same double. @internal
 */
export const M_PI_180 = 0.017453292519943295

/**
 * Reads `n` indexes from the WASM index output buffer as canonical strings. `n < 0` is a negated status. The view is
 * created after the call (memory may have grown) and copied out immediately.
 *
 * @internal
 */
export function readIndexes(w: Bindings, n: number): string[] {
	if (n < 0) throw statusError(w, -n)

	const view = new BigUint64Array(memoryBuffer(), w.out_u64_ptr(), n)
	const out: string[] = new Array(n)

	for (let i = 0; i < n; i++) {
		out[i] = view[i]!.toString(16)
	}

	return out
}

/**
 * Copies `n` numbers out of the WASM float output buffer. `n < 0` is a negated status.
 *
 * @internal
 */
export function readF64(w: Bindings, n: number): Float64Array {
	if (n < 0) throw statusError(w, -n)

	return new Float64Array(memoryBuffer(), w.out_f64_ptr(), n).slice()
}

/**
 * Runs a WASM operation and preserves the runtime's trap-poisoning behavior. Argument validation stays in the caller so
 * it retains the public error order.
 *
 * @internal
 */
export function call<T>(operation: () => T): T {
	try {
		return operation()
	} catch (error) {
		throw trapped(error)
	}
}
