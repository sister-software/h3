/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import type { Api, FixtureRecord, CaseOutcome } from "./fixture-comparison.ts"
/**
 * Runs committed C reference cases against public JavaScript APIs in every tested runtime.
 */
import { DISPATCH } from "./fixture-dispatch.ts"

export type { FixtureRecord, CaseOutcome } from "./fixture-comparison.ts"

export {
	stats,
	M_180_PI,
	COORD_TOLERANCE_DEGREES,
	LENGTH_TOLERANCE_RADS,
	AREA_TOLERANCE_PER_SQRT_RADS2,
} from "./fixture-comparison.ts"

export const SUPPORTED_OPERATIONS = Object.keys(DISPATCH)

function runOne(h3: Api, rec: FixtureRecord): string | undefined {
	const d = DISPATCH[rec.operation]!
	const expectRange = d.rangeError?.(rec.args) ?? false
	let got: unknown

	try {
		got = d.run(h3, rec.args)
	} catch (error) {
		const e = error as { name?: string; code?: number }

		if (expectRange)
			return e instanceof RangeError && e.name === "RangeError"
				? undefined
				: `expected RangeError, got ${e.name}: ${String(error)}`

		if (rec.error !== 0 && e.name === "H3Error" && e.code === rec.error) return undefined

		return `expected ${rec.error ? `H3Error ${rec.error}` : "success"}, got ${e.name} ${String(e.code)}: ${String(error)}`
	}

	if (expectRange) return `expected RangeError, got ${JSON.stringify(got)}`

	if (rec.error !== 0) return `expected H3Error ${rec.error}, got ${JSON.stringify(got)}`

	return d.check(got, rec, h3)
}

/**
 * The outcome of running a fixture record's call against an API, without judging it.
 */
export type Invocation =
	| { ok: true; value: unknown }
	| { ok: false; error: { name?: string; code?: number; message?: string; isRangeError: boolean } }

/**
 * Runs a fixture record's JavaScript call against any API with the same shape (e.g. h3-js).
 */
export function invoke(h3: Api, rec: FixtureRecord): Invocation | undefined {
	const d = DISPATCH[rec.operation]

	if (!d || d.skip?.(rec.args)) return undefined

	try {
		return { ok: true, value: d.run(h3, rec.args) }
	} catch (error) {
		const e = error as { name?: string; code?: number; message?: string }

		return {
			ok: false,
			error: { name: e.name, code: e.code, message: e.message, isRangeError: error instanceof RangeError },
		}
	}
}

/**
 * Whether this record is one where the JavaScript binding rejects arguments with RangeError.
 */
export function expectsRangeError(rec: FixtureRecord): boolean {
	return DISPATCH[rec.operation]?.rangeError?.(rec.args) ?? false
}

export function runFixtureCases(h3: Api, records: readonly FixtureRecord[]): CaseOutcome[] {
	return records.map((rec, index) => {
		const d = DISPATCH[rec.operation]

		if (!d) return { operation: rec.operation, index, ok: false, detail: "no dispatcher" }

		if (d.skip?.(rec.args)) return { operation: rec.operation, index, ok: true, skipped: true }
		const detail = runOne(h3, rec)

		return detail === undefined
			? { operation: rec.operation, index, ok: true }
			: { operation: rec.operation, index, ok: false, detail }
	})
}
