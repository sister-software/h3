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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Api = any

type Args = Record<string, unknown>

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

function compareMeasure(
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

const areaTolerance = (areaRads2: number) => AREA_TOLERANCE_PER_SQRT_RADS2 * Math.sqrt(areaRads2)

/**
 * Divisor converting a result in `unit` back to radians (or square radians).
 */
const UNIT_SCALE: Record<string, number> = {
	rads: 1,
	km: EARTH_RADIUS_KM,
	m: EARTH_RADIUS_KM * 1000,
	rads2: 1,
	km2: EARTH_RADIUS_KM * EARTH_RADIUS_KM,
	m2: EARTH_RADIUS_KM * EARTH_RADIUS_KM * 1e6,
}

function same(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b)
}

const outOfRes = (x: unknown) => typeof x !== "number" || !Number.isInteger(x) || x < 0 || x > 15

const tagged = (x: unknown): number =>
	x === "nan" ? Number.NaN : x === "inf" ? Infinity : x === "-inf" ? -Infinity : (x as number)

function compareCoords(
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

interface Dispatch {
	/**
	 * Whether the JavaScript binding rejects these arguments with a RangeError before C runs.
	 */
	rangeError?: (args: Args) => boolean
	/**
	 * Whether this C case has no JavaScript equivalent (e.g. radian-only inputs).
	 */
	skip?: (args: Args) => boolean
	/**
	 * Calls the API.
	 */
	run: (h3: Api, args: Args) => unknown
	/**
	 * Compares a successful result; returns a mismatch detail or undefined.
	 */
	check: (got: unknown, rec: FixtureRecord, h3: Api) => string | undefined
}

const eqValue: Dispatch["check"] = (got, rec) => (got === rec.result!.value ? undefined : `got ${String(got)}`)
const eqIndex: Dispatch["check"] = (got, rec) => (got === rec.result!.index ? undefined : `got ${String(got)}`)

const eqIndexes: Dispatch["check"] = (got, rec) =>
	same(got, rec.result!.indexes) ? undefined : `got ${JSON.stringify(got).slice(0, 300)}`

const nonzero = (xs: unknown) => (xs as string[]).filter((x) => x !== "0")

const eqNonzeroIndexes: Dispatch["check"] = (got, rec) => {
	const want = nonzero(rec.result!.indexes)

	return same(got, want)
		? undefined
		: `got ${JSON.stringify(got).slice(0, 300)}, want ${JSON.stringify(want).slice(0, 300)}`
}

const sameSet = (got: string[], want: string[]): string | undefined => {
	if (new Set(got).size !== got.length) return "duplicate cells in output"

	if (got.length !== want.length) return `cardinality ${got.length} != ${want.length}`
	const ws = new Set(want)
	const missing = got.find((x) => !ws.has(x))

	return missing === undefined ? undefined : `unexpected cell ${missing}`
}

const FLAG_NAMES = ["containmentCenter", "containmentFull", "containmentOverlapping", "containmentOverlappingBbox"]

const loopsHaveNonFinite = (a: Args) =>
	(a.loopsDegrees as unknown[][][]).some((l) =>
		l.some((v) => !Number.isFinite(tagged(v[0])) || !Number.isFinite(tagged(v[1])))
	)

const loopsArg = (a: Args) => (a.loopsDegrees as unknown[][][]).map((l) => l.map((v) => [tagged(v[0]), tagged(v[1])]))

const unit = (op: string): string => {
	const m = /(Rads2|Km2|M2|Rads|Km|M)$/.exec(op)!

	return m[1]!.toLowerCase()
}

const DISPATCH: Record<string, Dispatch> = {
	isValidCell: { run: (h3, a) => h3.isValidCell(a.index), check: eqValue },
	isPentagon: {
		run: (h3, a) => h3.isPentagon(a.index),
		check: (got, rec, h3) => {
			const want = h3.isValidCell(rec.args.index) && rec.result!.value === true

			return got === want ? undefined : `got ${String(got)}`
		},
	},
	isResClassIII: {
		run: (h3, a) => h3.isResClassIII(a.index),
		check: (got, rec, h3) => {
			const want = h3.isValidCell(rec.args.index) && rec.result!.value === true

			return got === want ? undefined : `got ${String(got)}`
		},
	},
	getResolution: {
		run: (h3, a) => h3.getResolution(a.index),
		check: (got, rec, h3) => {
			const want = h3.isValidCell(rec.args.index) ? rec.result!.value : -1

			return got === want ? undefined : `got ${String(got)}, want ${String(want)}`
		},
	},
	getBaseCellNumber: { run: (h3, a) => h3.getBaseCellNumber(a.index), check: eqValue },
	getIndexDigit: {
		rangeError: (a) => typeof a.digit !== "number" || a.digit < 1 || a.digit > 15,
		run: (h3, a) => h3.getIndexDigit(a.index, a.digit),
		check: eqValue,
	},
	constructCell: {
		rangeError: (a) => outOfRes(a.res),
		run: (h3, a) => h3.constructCell(a.baseCellNumber, a.digits, a.res),
		check: eqIndex,
	},
	getRes0Cells: { run: (h3) => h3.getRes0Cells(), check: eqIndexes },
	getPentagons: { rangeError: (a) => outOfRes(a.res), run: (h3, a) => h3.getPentagons(a.res), check: eqIndexes },
	getNumCells: { rangeError: (a) => outOfRes(a.res), run: (h3, a) => h3.getNumCells(a.res), check: eqValue },
	latLngToCell: {
		skip: (a) => a.latDegrees === undefined,
		rangeError: (a) =>
			outOfRes(a.res) || !Number.isFinite(tagged(a.latDegrees)) || !Number.isFinite(tagged(a.lngDegrees)),
		run: (h3, a) => h3.latLngToCell(tagged(a.latDegrees), tagged(a.lngDegrees), a.res),
		check: eqIndex,
	},
	cellToLatLng: {
		run: (h3, a) => h3.cellToLatLng(a.index),
		check: (got, rec) =>
			compareCoords(
				"cellToLatLng",
				[got as [number, number]],
				[[rec.result!.latRadians as number, rec.result!.lngRadians as number]]
			),
	},
	cellToBoundary: {
		run: (h3, a) => h3.cellToBoundary(a.index),
		check: (got, rec) =>
			compareCoords("cellToBoundary", got as [number, number][], rec.result!.verticesRadians as number[][]),
	},
	getIcosahedronFaces: {
		run: (h3, a) => h3.getIcosahedronFaces(a.index),
		check: (got, rec) => {
			const want = (rec.result!.faces as number[]).filter((f) => f >= 0)

			return same(got, want) ? undefined : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`
		},
	},
	cellToParent: { rangeError: (a) => outOfRes(a.res), run: (h3, a) => h3.cellToParent(a.index, a.res), check: eqIndex },
	cellToCenterChild: {
		rangeError: (a) => outOfRes(a.res),
		run: (h3, a) => h3.cellToCenterChild(a.index, a.res),
		check: eqIndex,
	},
	cellToChildrenSize: {
		rangeError: (a) => outOfRes(a.res),
		run: (h3, a) => h3.cellToChildrenSize(a.index, a.res),
		check: eqValue,
	},
	cellToChildPos: {
		rangeError: (a) => outOfRes(a.res),
		run: (h3, a) => h3.cellToChildPos(a.index, a.res),
		check: eqValue,
	},
	cellToChildren: {
		rangeError: (a) => outOfRes(a.res),
		run: (h3, a) => h3.cellToChildren(a.index, a.res),
		check: eqIndexes,
	},
	childPosToCell: {
		rangeError: (a) => outOfRes(a.childRes),
		run: (h3, a) => h3.childPosToCell(a.childPos, a.index, a.childRes),
		check: eqIndex,
	},
	compactCells: {
		run: (h3, a) => h3.compactCells(a.indexes),
		// The fixture is C's whole output buffer; unused slots are "0".
		check: (got, rec) => {
			const want = (rec.result!.indexes as string[]).slice(0, (got as string[]).length)
			const rest = (rec.result!.indexes as string[]).slice((got as string[]).length)

			return same(got, want) && rest.every((x) => x === "0") ? undefined : `got ${JSON.stringify(got).slice(0, 300)}`
		},
	},
	uncompactCells: {
		rangeError: (a) => outOfRes(a.res),
		run: (h3, a) => h3.uncompactCells(a.indexes, a.res),
		check: eqIndexes,
	},

	// --- Phase D
	gridDisk: {
		rangeError: (a) => (a.k as number) < 0,
		run: (h3, a) => h3.gridDisk(a.index, a.k),
		check: eqNonzeroIndexes,
	},
	gridDiskDistances: {
		rangeError: (a) => (a.k as number) < 0,
		run: (h3, a) => h3.gridDiskDistances(a.index, a.k),
		check: (got, rec) => {
			const want: string[][] = Array.from({ length: (rec.args.k as number) + 1 }, () => [])
			const cells = rec.result!.indexes as string[]
			const ds = rec.result!.distances as number[]

			cells.forEach((c, i) => {
				if (c !== "0") {
					want[ds[i]!]!.push(c)
				}
			})

			return same(got, want) ? undefined : `got ${JSON.stringify(got).slice(0, 300)}`
		},
	},
	gridRing: {
		rangeError: (a) => (a.k as number) < 0,
		run: (h3, a) => h3.gridRing(a.index, a.k),
		check: eqNonzeroIndexes,
	},
	gridRingUnsafe: {
		rangeError: (a) => (a.k as number) < 0,
		run: (h3, a) => h3.gridRingUnsafe(a.index, a.k),
		check: eqNonzeroIndexes,
	},
	gridDistance: { run: (h3, a) => h3.gridDistance(a.origin, a.destination), check: eqValue },
	gridPathCells: { run: (h3, a) => h3.gridPathCells(a.origin, a.destination), check: eqIndexes },
	cellToLocalIj: {
		skip: (a) => a.mode !== 0,
		run: (h3, a) => h3.cellToLocalIj(a.origin, a.destination),
		check: (got, rec) => (same(got, { i: rec.result!.i, j: rec.result!.j }) ? undefined : `got ${JSON.stringify(got)}`),
	},
	localIjToCell: {
		skip: (a) => a.mode !== 0,
		run: (h3, a) => h3.localIjToCell(a.origin, { i: a.i, j: a.j }),
		check: eqIndex,
	},

	// --- Phase E
	areNeighborCells: { run: (h3, a) => h3.areNeighborCells(a.origin, a.destination), check: eqValue },
	cellsToDirectedEdge: { run: (h3, a) => h3.cellsToDirectedEdge(a.origin, a.destination), check: eqIndex },
	isValidDirectedEdge: { run: (h3, a) => h3.isValidDirectedEdge(a.index), check: eqValue },
	isValidIndex: { run: (h3, a) => h3.isValidIndex(a.index), check: eqValue },
	isValidVertex: { run: (h3, a) => h3.isValidVertex(a.index), check: eqValue },
	getDirectedEdgeOrigin: { run: (h3, a) => h3.getDirectedEdgeOrigin(a.index), check: eqIndex },
	getDirectedEdgeDestination: { run: (h3, a) => h3.getDirectedEdgeDestination(a.index), check: eqIndex },
	reverseDirectedEdge: { run: (h3, a) => h3.reverseDirectedEdge(a.index), check: eqIndex },
	directedEdgeToCells: { run: (h3, a) => h3.directedEdgeToCells(a.index), check: eqIndexes },
	originToDirectedEdges: { run: (h3, a) => h3.originToDirectedEdges(a.index), check: eqNonzeroIndexes },
	directedEdgeToBoundary: {
		run: (h3, a) => h3.directedEdgeToBoundary(a.index),
		check: (got, rec) =>
			compareCoords("directedEdgeToBoundary", got as [number, number][], rec.result!.verticesRadians as number[][]),
	},
	cellToVertex: { run: (h3, a) => h3.cellToVertex(a.index, a.vertexNum), check: eqIndex },
	cellToVertexes: { run: (h3, a) => h3.cellToVertexes(a.index), check: eqNonzeroIndexes },
	vertexToLatLng: {
		run: (h3, a) => h3.vertexToLatLng(a.index),
		check: (got, rec) =>
			compareCoords(
				"vertexToLatLng",
				[got as [number, number]],
				[[rec.result!.latRadians as number, rec.result!.lngRadians as number]]
			),
	},

	// --- Phase F
	edgeLengthRads: {
		run: (h3, a) => h3.edgeLength(a.index, "rads"),
		check: (g, rec) => compareMeasure("edgeLength", g, rec.result!.value, UNIT_SCALE.rads!, LENGTH_TOLERANCE_RADS),
	},
	edgeLengthKm: {
		run: (h3, a) => h3.edgeLength(a.index, "km"),
		check: (g, rec) => compareMeasure("edgeLength", g, rec.result!.value, UNIT_SCALE.km!, LENGTH_TOLERANCE_RADS),
	},
	edgeLengthM: {
		run: (h3, a) => h3.edgeLength(a.index, "m"),
		check: (g, rec) => compareMeasure("edgeLength", g, rec.result!.value, UNIT_SCALE.m!, LENGTH_TOLERANCE_RADS),
	},
	cellAreaRads2: {
		run: (h3, a) => h3.cellArea(a.index, "rads2"),
		check: (g, rec) => compareMeasure("cellArea", g, rec.result!.value, UNIT_SCALE.rads2!, areaTolerance),
	},
	cellAreaKm2: {
		run: (h3, a) => h3.cellArea(a.index, "km2"),
		check: (g, rec) => compareMeasure("cellArea", g, rec.result!.value, UNIT_SCALE.km2!, areaTolerance),
	},
	cellAreaM2: {
		run: (h3, a) => h3.cellArea(a.index, "m2"),
		check: (g, rec) => compareMeasure("cellArea", g, rec.result!.value, UNIT_SCALE.m2!, areaTolerance),
	},
	...Object.fromEntries(
		["greatCircleDistanceRads", "greatCircleDistanceKm", "greatCircleDistanceM"].map((op) => [
			op,
			{
				rangeError: (a: Args) =>
					[a.aLatDegrees, a.aLngDegrees, a.bLatDegrees, a.bLngDegrees].some((x) => !Number.isFinite(tagged(x))),
				run: (h3: Api, a: Args) =>
					h3.greatCircleDistance(
						[tagged(a.aLatDegrees), tagged(a.aLngDegrees)],
						[tagged(a.bLatDegrees), tagged(a.bLngDegrees)],
						unit(op)
					),
				check: (g: unknown, rec: FixtureRecord) =>
					compareMeasure("greatCircleDistance", g, rec.result!.value, UNIT_SCALE[unit(op)]!, LENGTH_TOLERANCE_RADS),
			} satisfies Dispatch,
		])
	),
	...Object.fromEntries(
		["getHexagonAreaAvgKm2", "getHexagonAreaAvgM2", "getHexagonEdgeLengthAvgKm", "getHexagonEdgeLengthAvgM"].map(
			(op) => [
				op,
				{
					rangeError: (a: Args) => outOfRes(a.res),
					run: (h3: Api, a: Args) =>
						op.startsWith("getHexagonArea")
							? h3.getHexagonAreaAvg(a.res, unit(op))
							: h3.getHexagonEdgeLengthAvg(a.res, unit(op)),
					check: (g: unknown, rec: FixtureRecord) => (g === rec.result!.value ? undefined : `got ${String(g)}`),
				} satisfies Dispatch,
			]
		)
	),
	degsToRads: {
		run: (h3, a) => h3.degsToRads(tagged(a.value)),
		check: (g, rec) => (Object.is(g, tagged(rec.result!.value)) ? undefined : `got ${String(g)}`),
	},
	radsToDegs: {
		run: (h3, a) => h3.radsToDegs(tagged(a.value)),
		check: (g, rec) => (Object.is(g, tagged(rec.result!.value)) ? undefined : `got ${String(g)}`),
	},

	// --- Phase G
	polygonToCells: {
		skip: (a) => a.flags !== 0,
		rangeError: (a) => outOfRes(a.res) || loopsHaveNonFinite(a),
		run: (h3, a) => h3.polygonToCells(loopsArg(a), a.res),
		check: (got, rec) => sameSet(got as string[], rec.result!.indexes as string[]),
	},
	polygonToCellsExperimental: {
		skip: (a) => (a.flags as number) > 3,
		rangeError: (a) => outOfRes(a.res) || loopsHaveNonFinite(a),
		run: (h3, a) => h3.polygonToCellsExperimental(loopsArg(a), a.res, FLAG_NAMES[a.flags as number]),
		check: eqIndexes,
	},
	cellsToLinkedMultiPolygon: {
		run: (h3, a) => h3.cellsToMultiPolygon(a.indexes),
		check: (got, rec) => {
			const g = got as [number, number][][][]
			const want = rec.result!.polygonsRadians as number[][][][]

			if (g.length !== want.length) return `polygon count ${g.length} != ${want.length}`

			// Polygon order is unspecified (docs/api-decisions.md): C orders polygons by hashing vertex
			// coordinates, so last-bit libm differences can permute them. Each expected polygon must match
			// a distinct produced polygon with the same loops and vertex order, coordinates within bounds.
			const samePolygon = (gp: [number, number][][], wp: number[][][]) =>
				gp.length === wp.length &&
				gp.every(
					(gl, l) =>
						gl.length === wp[l]!.length &&
						gl.every(
							([lat, lng], i) =>
								Math.abs(lat - wp[l]![i]![0]! * M_180_PI) <= COORD_TOLERANCE_DEGREES &&
								Math.abs(lng - wp[l]![i]![1]! * M_180_PI) <= COORD_TOLERANCE_DEGREES
						)
				)

			const used = new Set<number>()

			for (let p = 0; p < want.length; p++) {
				const match = g.findIndex((gp, i) => !used.has(i) && samePolygon(gp, want[p]!))

				if (match === -1) return `expected polygon ${p}: no produced polygon matches`

				used.add(match)

				// Record the observed differences for the matched pair.
				for (let l = 0; l < want[p]!.length; l++) {
					compareCoords("cellsToMultiPolygon", g[match]![l]!, want[p]![l]!)
				}
			}

			return undefined
		},
	},
}

/**
 * Operations this dispatcher can check; grows with each implemented phase.
 */
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
