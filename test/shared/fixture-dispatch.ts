/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */
import {
	type Api,
	type Args,
	type FixtureRecord,
	compareMeasure,
	areaTolerance,
	UNIT_SCALE,
	LENGTH_TOLERANCE_RADS,
	M_180_PI,
	COORD_TOLERANCE_DEGREES,
	same,
	outOfRes,
	tagged,
	compareCoords,
} from "./fixture-comparison.ts"

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

export const DISPATCH: Record<string, Dispatch> = {
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

	// Traversal and local IJ.
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

	// Directed edges and vertices.
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

	// Measurements.
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

	// Polygons.
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
