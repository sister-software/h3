/**
 * Runs C reference fixture records through the public JavaScript API and reports mismatches.
 *
 * Shared by the Node test suite and the runtime probes (bundled into browser and Worker consumers), so it must not
 * import Node builtins. The mapping from C operations to JavaScript calls follows docs/api-decisions.md:
 *
 * - Degrees at the boundary (fixture radians are converted with C `M_180_PI`);
 * - A C error becomes an `H3Error` with the same code, except where the JavaScript binding rejects the argument first (an
 *   out-of-range resolution, digit or non-finite coordinate), which is a `RangeError`;
 * - `isPentagon` and `isResClassIII` are `false` for values that are not valid cells, and `getResolution` is `-1` for
 *   them;
 * - `getIcosahedronFaces` omits C's unused `-1` slots.
 *
 * Coordinates are compared within {@link COORD_TOLERANCE_DEGREES}; the observed maximum is reported in {@link stats}.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

export interface FixtureRecord {
	operation: string
	args: Record<string, unknown>
	error: number
	result: Record<string, unknown> | null
}

export interface CaseOutcome {
	operation: string
	index: number
	ok: boolean
	skipped?: boolean
	detail?: string
}

type PublicApi = Omit<typeof import("../../lib/exports.ts"), "init">

// Fixtures intentionally pass malformed arguments. Preserve export names and return types while
// allowing the dispatch table to exercise validation at runtime.
type FixtureResult<T> = T extends readonly (infer Item)[] ? FixtureResult<Item>[] : T

type FixtureMember<T> = T extends (...args: never[]) => infer Result
	? { invoke(...args: unknown[]): FixtureResult<Result> }["invoke"]
	: T extends Record<string, string>
		? { [Key in keyof T]: string }
		: T

export type Api = { [Key in keyof PublicApi]: FixtureMember<PublicApi[Key]> }

export type Args = Record<string, unknown>

/**
 * C `M_180_PI` (`57.29577951308232087679815481410517033240547`) as the shortest literal for the same double.
 */
export const M_180_PI = 57.29577951308232

/**
 * Absolute tolerance, in degrees, for coordinates computed in WASM versus the native C reference. WASM uses Rust's
 * portable libm (a musl port) rather than glibc, so transcendental functions may differ in the last bits. 1e-12 degrees
 * is about 0.1 micrometres on the Earth's surface.
 */
export const COORD_TOLERANCE_DEGREES = 1e-12

/**
 * Absolute tolerances for scalar measurements computed in WASM versus the native C reference, expressed in radian units
 * (results in km/m are converted back with the C Earth radius). The differences come from the same libm last-bit
 * differences that move vertices by about 1e-15 rad; a length accumulates at most a few such errors, an area at most
 * perimeter times that error. A relative bound would be wrong here: it grows without limit as cells shrink.
 */
export const LENGTH_TOLERANCE_RADS = 1e-13
/**
 * Area error scales with the magnitude of the summed Cagnoli terms, i.e. with the perimeter, which is proportional to
 * sqrt(area). The bound is `AREA_TOLERANCE_PER_SQRT_RADS2 * sqrt(area)`.
 */
export const AREA_TOLERANCE_PER_SQRT_RADS2 = 1e-14
const EARTH_RADIUS_KM = 6371.007180918475

/**
 * Observed maximum differences per operation (coordinates in degrees; measurements relative).
 */
export const stats: Record<string, { compared: number; maxDiff: number }> = {}

function note(op: string, diff: number) {
	const s = (stats[op] ??= { compared: 0, maxDiff: 0 })

	s.compared++

	if (diff > s.maxDiff) {
		s.maxDiff = diff
	}
}

export function compareMeasure(
	op: string,
	got: unknown,
	want: unknown,
	scale: number,
	tolerance: number | ((wantRadianUnits: number) => number)
): string | undefined {
	const w = tagged(want)

	if (typeof got !== "number") return `got ${String(got)}`

	if (Number.isNaN(w)) return Number.isNaN(got) ? undefined : `got ${got}, want NaN`
	const d = Math.abs(got - w) / scale

	if (typeof tolerance === "function") {
		tolerance = tolerance(Math.abs(w) / scale)
	}

	note(op, d)

	return d <= tolerance ? undefined : `got ${got}, want ${w}, diff ${d} (radian units) > ${tolerance}`
}

export const areaTolerance = (areaRads2: number) => AREA_TOLERANCE_PER_SQRT_RADS2 * Math.sqrt(areaRads2)

/**
 * Divisor converting a result in `unit` back to radians (or square radians).
 */
export const UNIT_SCALE: Record<string, number> = {
	rads: 1,
	km: EARTH_RADIUS_KM,
	m: EARTH_RADIUS_KM * 1000,
	rads2: 1,
	km2: EARTH_RADIUS_KM * EARTH_RADIUS_KM,
	m2: EARTH_RADIUS_KM * EARTH_RADIUS_KM * 1e6,
}

export function same(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b)
}

export const outOfRes = (x: unknown) => typeof x !== "number" || !Number.isInteger(x) || x < 0 || x > 15

export const tagged = (x: unknown): number =>
	x === "nan" ? Number.NaN : x === "inf" ? Infinity : x === "-inf" ? -Infinity : (x as number)

export function compareCoords(
	op: string,
	got: [number, number][],
	wantRadians: number[][],
	geoJson = false
): string | undefined {
	if (got.length !== wantRadians.length) return `vertex count ${got.length} != ${wantRadians.length}`

	for (let i = 0; i < got.length; i++) {
		const [lat, lng] = geoJson ? [got[i]![1], got[i]![0]] : got[i]!
		const wl = wantRadians[i]![0]! * M_180_PI
		const wg = wantRadians[i]![1]! * M_180_PI
		const d = Math.max(Math.abs(lat - wl), Math.abs(lng - wg))
		note(op, d)

		if (!(d <= COORD_TOLERANCE_DEGREES)) return `vertex ${i}: got [${lat}, ${lng}], want [${wl}, ${wg}], diff ${d}`
	}

	return undefined
}
