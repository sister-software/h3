/**
 * Deterministic C reference fixture cases. Each case names an operation, the complete named arguments recorded in the
 * fixture, the runner tokens, and a decoder for the runner result.
 *
 * Indexes are built directly from bits with BigInt so that case generation does not depend on any H3 implementation.
 * Coordinates are drawn in degrees and converted to radians with the C `M_PI_180` constant so that degree and radian
 * fields describe exactly the same double.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

export const FIXTURE_SCHEMA_VERSION = 1
export const SEED = 0x51_57_48_33

/**
 * C `M_PI_180` (`0.0174532925199432957692369076848861271111`), written as the shortest literal that parses to the same
 * double.
 */
export const M_PI_180 = 0.017453292519943295

export interface Case {
	operation: string
	/**
	 * Fixture file name without extension; defaults to the operation.
	 */
	file?: string
	args: Record<string, unknown>
	tokens: string[]
	decode: (tokens: string[]) => unknown
}

// ---------------------------------------------------------------------------------------------
// Deterministic PRNG (SplitMix64 over BigInt).

export class Rng {
	#state: bigint
	constructor(seed: number) {
		this.#state = BigInt(seed) & 0xff_ff_ff_ff_ff_ff_ff_ffn
	}
	u64(): bigint {
		this.#state = (this.#state + 0x9e_37_79_b9_7f_4a_7c_15n) & 0xff_ff_ff_ff_ff_ff_ff_ffn
		let z = this.#state
		z = ((z ^ (z >> 30n)) * 0xbf_58_47_6d_1c_e4_e5_b9n) & 0xff_ff_ff_ff_ff_ff_ff_ffn
		z = ((z ^ (z >> 27n)) * 0x94_d0_49_bb_13_31_11_ebn) & 0xff_ff_ff_ff_ff_ff_ff_ffn

		return z ^ (z >> 31n)
	}
	/**
	 * Uniform float in [0, 1).
	 */
	float(): number {
		return Number(this.u64() >> 11n) / 2 ** 53
	}
	int(lo: number, hi: number): number {
		return lo + Math.floor(this.float() * (hi - lo + 1))
	}
	pick<T>(xs: readonly T[]): T {
		return xs[this.int(0, xs.length - 1)]!
	}
}

// ---------------------------------------------------------------------------------------------
// Index construction.

export const PENTAGON_BASE_CELLS = [4, 14, 24, 38, 49, 58, 63, 72, 83, 97, 107, 117] as const
const H3_INIT = 35_184_372_088_831n

export function makeIndex(mode: number, res: number, baseCell: number, digits: readonly number[], extra = 0): bigint {
	let h = H3_INIT
	h |= BigInt(mode) << 59n
	h |= BigInt(extra) << 56n
	h = (h & ~(15n << 52n)) | (BigInt(res) << 52n)
	h = (h & ~(127n << 45n)) | (BigInt(baseCell) << 45n)

	for (let r = 1; r <= digits.length; r++) {
		const shift = BigInt((15 - r) * 3)
		h = (h & ~(7n << shift)) | (BigInt(digits[r - 1]!) << shift)
	}

	return h
}

export function cell(res: number, baseCell: number, digits: readonly number[]): bigint {
	return makeIndex(1, res, baseCell, digits)
}

/**
 * A random valid cell, respecting the pentagon deleted subsequence.
 */
export function randomCell(rng: Rng, res: number, baseCell = rng.int(0, 121)): bigint {
	const digits: number[] = []
	let pent = (PENTAGON_BASE_CELLS as readonly number[]).includes(baseCell)

	for (let r = 0; r < res; r++) {
		let d = rng.int(0, 6)

		if (pent) {
			while (d === 1) {
				d = rng.int(0, 6)
			}

			if (d !== 0) {
				pent = false
			}
		}

		digits.push(d)
	}

	return cell(res, baseCell, digits)
}

export function pentagon(res: number, baseCell: number): bigint {
	return cell(res, baseCell, new Array(res).fill(0))
}

export const hex = (h: bigint): string => h.toString(16)

/**
 * Invalid or non-cell index values exercising each validation rule.
 */
export function invalidIndexes(rng: Rng): bigint[] {
	const c = randomCell(rng, 5, 20)

	return [
		0n,
		H3_INIT,
		0xff_ff_ff_ff_ff_ff_ff_ffn,
		c | (1n << 63n), // high bit
		c | (1n << 56n), // reserved bits
		(c & ~(15n << 59n)) | (2n << 59n), // directed-edge mode
		(c & ~(15n << 59n)) | (4n << 59n), // vertex mode
		(c & ~(15n << 59n)) | (0n << 59n), // mode 0
		(c & ~(127n << 45n)) | (122n << 45n), // base cell out of range
		(c & ~(127n << 45n)) | (127n << 45n),
		c & ~(7n << 30n), // digit 6 cleared to 0 past res? (res 5 => digit 6 becomes 0)
		c | (7n << 42n), // digit 1 set to 7
		cell(3, 4, [0, 1, 0]), // pentagon deleted subsequence
		cell(1, 14, [1]),
		rng.u64(),
		rng.u64(),
	]
}

// ---------------------------------------------------------------------------------------------
// Encoding helpers.

export function fmt(x: number): string {
	if (Number.isNaN(x)) return "nan"

	if (x === Infinity) return "inf"

	if (x === -Infinity) return "-inf"

	return x.toPrecision(17)
}

/**
 * JSON-safe float: non-finite values become tagged strings.
 */
export function jf(x: number): number | string {
	if (Number.isNaN(x)) return "nan"

	if (x === Infinity) return "inf"

	if (x === -Infinity) return "-inf"

	return x
}

const num = (t: string | undefined): number => {
	if (t === undefined) throw new Error("missing result token")

	return Number(t)
}

class Reader {
	#t: string[]
	#i = 0
	constructor(t: string[]) {
		this.#t = t
	}
	n(): number {
		return num(this.#t[this.#i++])
	}
	/**
	 * A floating-point result: non-finite values become tagged strings ("nan", "inf", "-inf").
	 */
	f(): number | string {
		const t = this.#t[this.#i++]

		if (t === undefined) throw new Error("missing result token")

		if (t === "nan" || t === "-nan") return "nan"

		if (t === "inf") return "inf"

		if (t === "-inf") return "-inf"

		return Number(t)
	}
	s(): string {
		const t = this.#t[this.#i++]

		if (t === undefined) throw new Error("missing result token")

		return t
	}
	idxArray(): string[] {
		const n = this.n()

		return Array.from({ length: n }, () => this.s())
	}
	boundary(): (number | string)[][] {
		const n = this.n()

		return Array.from({ length: n }, () => [this.f(), this.f()])
	}
}

const r = (t: string[]) => new Reader(t)

// ---------------------------------------------------------------------------------------------
// Case sets.

function latLngCase(latDeg: number, lngDeg: number, res: number): Case {
	const lat = latDeg * M_PI_180
	const lng = lngDeg * M_PI_180

	return {
		operation: "latLngToCell",
		args: { latDegrees: jf(latDeg), lngDegrees: jf(lngDeg), latRadians: jf(lat), lngRadians: jf(lng), res },
		tokens: [fmt(lat), fmt(lng), String(res)],
		decode: (t) => ({ index: r(t).s() }),
	}
}

function radiansLatLngCase(lat: number, lng: number, res: number): Case {
	return {
		operation: "latLngToCell",
		args: { latRadians: jf(lat), lngRadians: jf(lng), res },
		tokens: [fmt(lat), fmt(lng), String(res)],
		decode: (t) => ({ index: r(t).s() }),
	}
}

function indexCase(operation: string, h: bigint, decode: Case["decode"], file?: string): Case {
	return { operation, file, args: { index: hex(h) }, tokens: [hex(h)], decode }
}

function indexResCase(operation: string, h: bigint, res: number, decode: Case["decode"]): Case {
	return { operation, args: { index: hex(h), res }, tokens: [hex(h), String(res)], decode }
}

/**
 * Sample cells used as inputs for single-cell operations.
 */
function sampleCells(rng: Rng): bigint[] {
	const out: bigint[] = []

	for (let bc = 0; bc < 122; bc++) {
		out.push(cell(0, bc, []))
	}

	for (let res = 0; res <= 15; res++) {
		for (const bc of PENTAGON_BASE_CELLS) {
			out.push(pentagon(res, bc))
		}

		for (let i = 0; i < 24; i++) {
			out.push(randomCell(rng, res))
		}

		// pentagon descendants (hexagons adjacent to the pentagon hierarchy)
		for (let i = 0; i < 4; i++) {
			out.push(randomCell(rng, res, rng.pick(PENTAGON_BASE_CELLS)))
		}
	}

	return out
}

const boolResult = (t: string[]) => ({ value: r(t).n() !== 0 })
const intResult = (t: string[]) => ({ value: r(t).n() })
const indexResult = (t: string[]) => ({ index: r(t).s() })

export type RefQuery = (lines: string[]) => string[][]

export function cases(ref: RefQuery): Case[] {
	const rng = new Rng(SEED)
	const out: Case[] = []
	const cells = sampleCells(rng)
	const invalid = invalidIndexes(rng)

	// Validation and inspection.
	for (const h of [...cells, ...invalid]) {
		out.push(indexCase("isValidCell", h, boolResult))
		out.push(indexCase("isPentagon", h, boolResult))
		out.push(indexCase("isResClassIII", h, boolResult))
		out.push(indexCase("getResolution", h, intResult))
		out.push(indexCase("getBaseCellNumber", h, intResult))
	}

	for (const h of [...cells.filter((_, i) => i % 7 === 0), ...invalid]) {
		for (const d of [0, 1, 2, 7, 15, 16, -1]) {
			out.push({
				operation: "getIndexDigit",
				args: { index: hex(h), digit: d },
				tokens: [hex(h), String(d)],
				decode: intResult,
			})
		}
	}

	const constructInputs: [number, number, number[]][] = [
		[0, 0, []],
		[0, 121, []],
		[0, 122, []],
		[0, -1, []],
		[-1, 0, []],
		[16, 0, []],
		[1, 4, [1]],
		[2, 4, [0, 1]],
		[2, 4, [0, 2]],
		[3, 4, [2, 1, 1]],
		[1, 0, [7]],
		[1, 0, [-1]],
		[15, 20, [1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6, 0, 1]],
		[15, 117, new Array(15).fill(0)],
	]

	for (let i = 0; i < 40; i++) {
		const res = rng.int(0, 15)
		const bc = rng.int(0, 121)
		constructInputs.push([res, bc, Array.from({ length: res }, () => rng.int(0, 6))])
	}

	for (const [res, bc, digits] of constructInputs) {
		out.push({
			operation: "constructCell",
			args: { res, baseCellNumber: bc, digits },
			tokens: [String(res), String(bc), String(digits.length), ...digits.map(String)],
			decode: indexResult,
		})
	}

	out.push({ operation: "getRes0Cells", args: {}, tokens: [], decode: (t) => ({ indexes: r(t).idxArray() }) })

	for (const res of [-1, ...Array.from({ length: 16 }, (_, i) => i), 16]) {
		out.push({
			operation: "getPentagons",
			args: { res },
			tokens: [String(res)],
			decode: (t) => ({ indexes: r(t).idxArray() }),
		})

		out.push({ operation: "getNumCells", args: { res }, tokens: [String(res)], decode: intResult })
	}

	// Coordinates and boundaries.
	for (let res = 0; res <= 15; res++) {
		for (let i = 0; i < 120; i++) {
			const lat = Math.asin(2 * rng.float() - 1) / M_PI_180
			const lng = rng.float() * 360 - 180
			out.push(latLngCase(lat, lng, res))
		}

		for (const [lat, lng] of [
			[90, 0],
			[-90, 0],
			[90, 123],
			[-90, -45],
			[0, 180],
			[0, -180],
			[0, 179.99999999],
			[0, -179.99999999],
			[45, 180],
			[-45, -180],
			[37.3615593, -122.0553238],
			[0, 0],
		] as const) {
			out.push(latLngCase(lat, lng, res))
		}
	}

	// README example
	out.push(latLngCase(37.3615593, -122.0553238, 7))

	// Invalid / unusual inputs
	for (const [lat, lng, res] of [
		[Number.NaN, 0, 5],
		[0, Number.NaN, 5],
		[Infinity, 0, 5],
		[0, -Infinity, 5],
		[0, 0, -1],
		[0, 0, 16],
		[100, 0, 5],
		[-100, 0, 5],
		[0, 360, 5],
		[0, 540, 5],
		[0, -720, 5],
		[1e10, 1e10, 5],
	] as const) {
		out.push(latLngCase(lat, lng, res))
	}

	for (const [lat, lng] of [
		[1e300, 0],
		[0, 1e300],
		[-1e-300, 5e-324],
	] as const) {
		out.push(radiansLatLngCase(lat, lng, 9))
	}

	const decodeLatLng = (t: string[]) => {
		const x = r(t)

		return { latRadians: x.f(), lngRadians: x.f() }
	}

	const decodeBoundary = (t: string[]) => ({ verticesRadians: r(t).boundary() })

	for (const h of [...cells, ...invalid]) {
		out.push(indexCase("cellToLatLng", h, decodeLatLng))
		out.push(indexCase("cellToBoundary", h, decodeBoundary))

		out.push(
			indexCase("getIcosahedronFaces", h, (t) => {
				const x = r(t)
				const n = x.n()

				return { faces: Array.from({ length: n }, () => x.n()) }
			})
		)
	}

	// Hierarchy.
	for (const h of [...cells.filter((_, i) => i % 3 === 0), ...invalid]) {
		const res = Number((h >> 52n) & 15n)

		for (const p of [-1, 0, res - 1, res, res + 1, 15, 16]) {
			out.push(indexResCase("cellToParent", h, p, indexResult))
			out.push(indexResCase("cellToCenterChild", h, p, indexResult))
			out.push(indexResCase("cellToChildrenSize", h, p, intResult))
			out.push(indexResCase("cellToChildPos", h, p, intResult))
		}
	}

	for (const h of cells.filter((_, i) => i % 5 === 0)) {
		const res = Number((h >> 52n) & 15n)

		for (const c of [res, res + 1, res + 2]) {
			if (c > 15) continue
			out.push(indexResCase("cellToChildren", h, c, (t) => ({ indexes: r(t).idxArray() })))
		}

		const childRes = Math.min(15, res + 2)

		for (const pos of [-1, 0, 1, 6, 7, 48, 49, 1000]) {
			out.push({
				operation: "childPosToCell",
				args: { childPos: pos, index: hex(h), childRes },
				tokens: [String(pos), hex(h), String(childRes)],
				decode: indexResult,
			})
		}
	}

	for (const h of invalid) {
		out.push({
			operation: "childPosToCell",
			args: { childPos: 0, index: hex(h), childRes: 15 },
			tokens: ["0", hex(h), "15"],
			decode: indexResult,
		})
	}

	// compactCells: complete child sets (compactable), partial sets, mixed, duplicates, invalid.
	const compactSets: bigint[][] = []

	const childrenOf = (h: bigint, depth: number): bigint[] => {
		// Children enumerated in the C iterator order, built from bits.
		const res = Number((h >> 52n) & 15n)
		let level = [h]

		for (let d = 1; d <= depth; d++) {
			const next: bigint[] = []

			for (const p of level) {
				const isPent =
					(PENTAGON_BASE_CELLS as readonly number[]).includes(Number((p >> 45n) & 127n)) &&
					Array.from({ length: res + d - 1 }, (_, i) => (p >> BigInt((14 - i) * 3)) & 7n).every((x) => x === 0n)

				for (let digit = 0; digit < 7; digit++) {
					if (isPent && digit === 1) continue
					const shift = BigInt((15 - (res + d)) * 3)
					let c = (p & ~(15n << 52n)) | (BigInt(res + d) << 52n)
					c = (c & ~(7n << shift)) | (BigInt(digit) << shift)
					next.push(c)
				}
			}

			level = next
		}

		return level
	}

	compactSets.push([])
	compactSets.push(childrenOf(randomCell(rng, 3), 1))
	compactSets.push(childrenOf(randomCell(rng, 2), 2))
	compactSets.push(childrenOf(pentagon(2, 14), 2))
	compactSets.push(childrenOf(cell(0, 4, []), 1))
	compactSets.push(childrenOf(randomCell(rng, 4), 1).slice(0, 5))
	compactSets.push([...childrenOf(randomCell(rng, 5), 1), ...childrenOf(randomCell(rng, 5), 1).slice(2)])
	compactSets.push(Array.from({ length: 122 }, (_, bc) => cell(0, bc, [])))
	compactSets.push([...childrenOf(randomCell(rng, 3), 1), childrenOf(randomCell(rng, 3), 1)[0]!])
	const dup = childrenOf(randomCell(rng, 6), 1)
	compactSets.push([...dup, dup[0]!])
	compactSets.push([...dup, ...dup])
	compactSets.push([randomCell(rng, 5), randomCell(rng, 7)])
	compactSets.push([randomCell(rng, 7), randomCell(rng, 5)])
	compactSets.push([randomCell(rng, 5) | (1n << 56n)])
	compactSets.push([0n, ...childrenOf(randomCell(rng, 4), 1)])
	compactSets.push(childrenOf(cell(0, 0, []), 3))

	for (let i = 0; i < 10; i++) {
		const base = randomCell(rng, rng.int(0, 10))
		const kids = childrenOf(base, 2)
		compactSets.push(kids.filter(() => rng.float() < 0.9))
	}

	for (const set of compactSets) {
		out.push({
			operation: "compactCells",
			args: { indexes: set.map(hex) },
			tokens: [String(set.length), ...set.map(hex)],
			decode: (t) => ({ indexes: r(t).idxArray() }),
		})
	}

	const uncompactSets: [bigint[], number][] = [
		[[], 5],
		[[randomCell(rng, 3)], 5],
		[[randomCell(rng, 3), pentagon(2, 24)], 4],
		[[randomCell(rng, 3), 0n, randomCell(rng, 4)], 5],
		[[randomCell(rng, 5)], 4],
		[[randomCell(rng, 5)], 5],
		[[randomCell(rng, 5)], 16],
		[[randomCell(rng, 5)], -1],
		[[pentagon(0, 4)], 3],
	]

	for (const [set, res] of uncompactSets) {
		for (const op of ["uncompactCellsSize", "uncompactCells"]) {
			out.push({
				operation: op,
				args: { indexes: set.map(hex), res },
				tokens: [String(set.length), ...set.map(hex), String(res)],
				decode: op === "uncompactCells" ? (t) => ({ indexes: r(t).idxArray() }) : intResult,
			})
		}
	}

	// Traversal and local IJ.
	const diskIndexes = (t: string[]) => {
		const x = r(t)
		const n = x.n()

		return { indexes: Array.from({ length: n }, () => x.s()) }
	}

	const diskDistances = (t: string[]) => {
		const x = r(t)
		const n = x.n()
		const indexes: string[] = []
		const distances: number[] = []

		for (let i = 0; i < n; i++) {
			indexes.push(x.s())
			distances.push(x.n())
		}

		return { indexes, distances }
	}

	for (const k of [-1, 0, 1, 2, 5, 100, 13_780_509, 13_780_510, 2_147_483_647]) {
		out.push({ operation: "maxGridDiskSize", args: { k }, tokens: [String(k)], decode: intResult })
		out.push({ operation: "maxGridRingSize", args: { k }, tokens: [String(k)], decode: intResult })
	}

	// Origins: sampled cells, pentagons, and pentagon neighbors (distortion areas).
	const pentNeighborhood: bigint[] = []

	for (const res of [0, 1, 2, 5, 9, 15]) {
		for (const bc of [4, 14, 117]) {
			const p = pentagon(res, bc)
			const disk = ref([`gridDisk ${hex(p)} 2`])[0]!

			for (const h of disk.slice(2))
				if (h !== "0") {
					pentNeighborhood.push(BigInt("0x" + h))
				}
		}
	}

	const traversalOrigins = [...cells.filter((_, i) => i % 9 === 0), ...pentNeighborhood.filter((_, i) => i % 3 === 0)]

	for (const h of [...traversalOrigins, ...invalid.slice(0, 6)]) {
		for (const k of [0, 1, 2, 4]) {
			for (const op of ["gridDisk", "gridDiskUnsafe"]) {
				out.push({ operation: op, args: { index: hex(h), k }, tokens: [hex(h), String(k)], decode: diskIndexes })
			}

			for (const op of ["gridDiskDistances", "gridDiskDistancesUnsafe", "gridDiskDistancesSafe"]) {
				out.push({ operation: op, args: { index: hex(h), k }, tokens: [hex(h), String(k)], decode: diskDistances })
			}

			for (const op of ["gridRing", "gridRingUnsafe"]) {
				out.push({
					operation: op,
					args: { index: hex(h), k },
					tokens: [hex(h), String(k)],
					decode: (t) => ({ indexes: r(t).idxArray() }),
				})
			}
		}
	}

	for (const h of traversalOrigins.slice(0, 4)) {
		out.push({ operation: "gridDisk", args: { index: hex(h), k: -1 }, tokens: [hex(h), "-1"], decode: diskIndexes })

		out.push({
			operation: "gridRing",
			args: { index: hex(h), k: -1 },
			tokens: [hex(h), "-1"],
			decode: (t) => ({ indexes: r(t).idxArray() }),
		})

		out.push({ operation: "gridDisk", args: { index: hex(h), k: 12 }, tokens: [hex(h), "12"], decode: diskIndexes })
	}

	// Pairs for distance, path and local IJ: nearby points (crossing base cells and faces), cells in
	// a pentagon neighborhood, same-parent cells, mismatched resolutions, far-apart cells.
	const pairs: [bigint, bigint][] = []
	const pointQueries: string[] = []

	for (let i = 0; i < 160; i++) {
		const res = rng.int(0, 15)
		const lat = Math.asin(2 * rng.float() - 1)
		const lng = rng.float() * 2 * Math.PI - Math.PI
		const span = 6 * Math.pow(7, -res / 2) * 0.12
		const lat2 = lat + (rng.float() - 0.5) * span
		const lng2 = lng + (rng.float() - 0.5) * span
		pointQueries.push(`latLngToCell ${fmt(lat)} ${fmt(lng)} ${res}`, `latLngToCell ${fmt(lat2)} ${fmt(lng2)} ${res}`)
	}

	const pts = ref(pointQueries)

	for (let i = 0; i + 1 < pts.length; i += 2) {
		if (pts[i]![0] === "0" && pts[i + 1]![0] === "0") {
			pairs.push([BigInt("0x" + pts[i]![1]), BigInt("0x" + pts[i + 1]![1])])
		}
	}

	for (let i = 0; i + 1 < pentNeighborhood.length; i += 2) {
		pairs.push([pentNeighborhood[i]!, pentNeighborhood[i + 1]!])
	}

	for (const res of [1, 3, 8]) {
		for (const bc of PENTAGON_BASE_CELLS.slice(0, 4)) {
			pairs.push([pentagon(res, bc), pentNeighborhood[res]!])
		}
	}

	pairs.push([randomCell(rng, 5), randomCell(rng, 6)])
	pairs.push([randomCell(rng, 5, 0), randomCell(rng, 5, 121)])
	pairs.push([invalid[0]!, randomCell(rng, 0)])
	pairs.push([invalid[3]!, invalid[3]!])

	for (const [a, b] of pairs) {
		out.push({
			operation: "gridDistance",
			args: { origin: hex(a), destination: hex(b) },
			tokens: [hex(a), hex(b)],
			decode: intResult,
		})

		out.push({
			operation: "gridPathCellsSize",
			args: { origin: hex(a), destination: hex(b) },
			tokens: [hex(a), hex(b)],
			decode: intResult,
		})

		out.push({
			operation: "gridPathCells",
			args: { origin: hex(a), destination: hex(b) },
			tokens: [hex(a), hex(b)],
			decode: (t) => ({ indexes: r(t).idxArray() }),
		})

		for (const mode of [0, 1]) {
			out.push({
				operation: "cellToLocalIj",
				args: { origin: hex(a), destination: hex(b), mode },
				tokens: [hex(a), hex(b), String(mode)],
				decode: (t) => {
					const x = r(t)

					return { i: x.n(), j: x.n() }
				},
			})
		}
	}

	// localIjToCell: round trips of computed coordinates, offsets, and overflow-range inputs.
	const ijs = ref(pairs.map(([a, b]) => `cellToLocalIj ${hex(a)} ${hex(b)} 0`))
	const ijCases: [bigint, number, number, number][] = []

	pairs.forEach(([a], idx) => {
		const t = ijs[idx]!

		if (t[0] === "0") {
			const i = Number(t[1])
			const j = Number(t[2])
			ijCases.push([a, i, j, 0], [a, i + 1, j, 0], [a, i, j - 2, 0])
		}
	})

	const o = traversalOrigins[3]!

	const ijOffsets: [number, number][] = [
		[0, 0],
		[1, 0],
		[-1, -1],
		[2_147_483_647, 0],
		[-2_147_483_648, 0],
		[0, -2_147_483_648],
		[715_827_882, 715_827_882],
		[-715_827_883, 1],
		[1_000_000, -1_000_000],
	]

	for (const [i, j] of ijOffsets) {
		ijCases.push([o, i, j, 0])
	}

	ijCases.push([o, 0, 0, 1], [pentagon(0, 4), 1, 0, 0], [pentagon(0, 4), 0, 1, 0], [cell(0, 0, []), 2, 0, 0])

	for (const [origin, i, j, mode] of ijCases) {
		out.push({
			operation: "localIjToCell",
			args: { origin: hex(origin), i, j, mode },
			tokens: [hex(origin), String(i), String(j), String(mode)],
			decode: indexResult,
		})
	}

	// Directed edges and vertices.
	const edgeOrigins = [...cells.filter((_, i) => i % 6 === 0), ...pentNeighborhood.filter((_, i) => i % 4 === 0)]
	const edgeRows = ref(edgeOrigins.map((h) => `originToDirectedEdges ${hex(h)}`))
	const edges: bigint[] = []

	edgeRows.forEach((t) => {
		for (const e of t.slice(2))
			if (e !== "0") {
				edges.push(BigInt("0x" + e))
			}
	})

	const sampledEdges = edges.filter((_, i) => i % 2 === 0)

	const badEdges = [
		...invalid,
		(edges[0]! & ~(7n << 56n)) | (0n << 56n), // direction 0
		(edges[0]! & ~(7n << 56n)) | (7n << 56n), // direction 7
		(pentagon(3, 14) & ~(15n << 59n)) | (2n << 59n) | (1n << 56n), // pentagon k edge
		(edges[0]! & ~(15n << 59n)) | (1n << 59n), // cell mode
	]

	for (const h of edgeOrigins) {
		out.push(indexCase("originToDirectedEdges", h, (t) => ({ indexes: r(t).idxArray() })))
	}

	for (const e of [...sampledEdges, ...badEdges]) {
		out.push(indexCase("isValidDirectedEdge", e, boolResult))
		out.push(indexCase("getDirectedEdgeOrigin", e, indexResult))
		out.push(indexCase("getDirectedEdgeDestination", e, indexResult))

		out.push(
			indexCase("directedEdgeToCells", e, (t) => {
				const x = r(t)

				return { indexes: [x.s(), x.s()] }
			})
		)

		out.push(indexCase("directedEdgeToBoundary", e, decodeBoundary))
		out.push(indexCase("reverseDirectedEdge", e, indexResult))

		for (const op of ["edgeLengthRads", "edgeLengthKm", "edgeLengthM"]) {
			out.push(indexCase(op, e, (t) => ({ value: r(t).f() })))
		}
	}

	// Neighbor pairs: edge endpoints (neighbors), the traversal pairs, identical, mismatched modes.
	const dests = ref(sampledEdges.slice(0, 200).map((e) => `getDirectedEdgeDestination ${hex(e)}`))
	const neighborPairs: [bigint, bigint][] = []

	sampledEdges.slice(0, 200).forEach((e, i) => {
		const t = dests[i]!

		if (t[0] === "0") {
			neighborPairs.push([(e & ~(15n << 59n) & ~(7n << 56n)) | (1n << 59n), BigInt("0x" + t[1])])
		}
	})

	const neighborCases: [bigint, bigint][] = [
		...neighborPairs,
		...pairs,
		[cells[200]!, cells[200]!],
		[edges[0]!, cells[0]!],
		[cell(5, 4, [0, 0, 0, 0, 1]), cell(5, 4, [0, 0, 0, 0, 2])],
		[cell(5, 4, [0, 0, 0, 0, 0]), cell(5, 4, [0, 0, 0, 0, 1])],
		[cell(3, 20, [1, 2, 7]), cell(3, 20, [1, 2, 3])],
	]

	for (const [a, b] of neighborCases) {
		out.push({
			operation: "areNeighborCells",
			args: { origin: hex(a), destination: hex(b) },
			tokens: [hex(a), hex(b)],
			decode: boolResult,
		})

		out.push({
			operation: "cellsToDirectedEdge",
			args: { origin: hex(a), destination: hex(b) },
			tokens: [hex(a), hex(b)],
			decode: indexResult,
		})
	}

	// Vertexes.
	const vertexOrigins = [...cells.filter((_, i) => i % 5 === 0), ...pentNeighborhood.filter((_, i) => i % 3 === 0)]

	for (const h of [...vertexOrigins, ...invalid]) {
		out.push(indexCase("cellToVertexes", h, (t) => ({ indexes: r(t).idxArray() })))
	}

	for (const h of vertexOrigins.filter((_, i) => i % 2 === 0)) {
		for (const v of [-1, 0, 1, 4, 5, 6]) {
			out.push({
				operation: "cellToVertex",
				args: { index: hex(h), vertexNum: v },
				tokens: [hex(h), String(v)],
				decode: indexResult,
			})
		}
	}

	const vertexRows = ref(vertexOrigins.map((h) => `cellToVertexes ${hex(h)}`))
	const vertexes: bigint[] = []

	vertexRows.forEach((t) => {
		if (t[0] === "0") {
			for (const v of t.slice(2))
				if (v !== "0") {
					vertexes.push(BigInt("0x" + v))
				}
		}
	})

	const sampledVertexes = vertexes.filter((_, i) => i % 3 === 0)

	const badVertexes = [
		...invalid,
		(vertexes[0]! & ~(7n << 56n)) | (6n << 56n),
		(vertexes[0]! & ~(7n << 56n)) | (7n << 56n),
		((vertexes[0]! & ~(15n << 59n)) | (1n << 59n)) & ~(7n << 56n),
		(pentagon(4, 24) & ~(15n << 59n)) | (4n << 59n) | (5n << 56n),
		(randomCell(rng, 6) & ~(15n << 59n)) | (4n << 59n) | (3n << 56n), // non-canonical owner likely
	]

	for (const v of [...sampledVertexes, ...badVertexes]) {
		out.push(indexCase("isValidVertex", v, boolResult))

		out.push(
			indexCase("vertexToLatLng", v, (t) => {
				const x = r(t)

				return { latRadians: x.f(), lngRadians: x.f() }
			})
		)
	}

	for (const h of [
		...cells.filter((_, i) => i % 4 === 0),
		...sampledEdges.slice(0, 100),
		...sampledVertexes.slice(0, 100),
		...badEdges,
		...badVertexes,
	]) {
		out.push(indexCase("isValidIndex", h, boolResult))
	}

	// Measurements.
	for (const h of [...cells.filter((_, i) => i % 2 === 0), ...invalid]) {
		for (const op of ["cellAreaRads2", "cellAreaKm2", "cellAreaM2"]) {
			out.push(indexCase(op, h, (t) => ({ value: r(t).f() })))
		}
	}

	for (let i = 0; i < 200; i++) {
		// Degree-defined so the JavaScript API (degrees) and C (deg * M_PI_180) see the same doubles.
		const aDeg = [Math.asin(2 * rng.float() - 1) / M_PI_180, rng.float() * 360 - 180]

		const bDeg =
			i % 4 === 0 ? [aDeg[0]! + 1e-5, aDeg[1]!] : [Math.asin(2 * rng.float() - 1) / M_PI_180, rng.float() * 360 - 180]

		const a = aDeg.map((x) => x * M_PI_180)
		const b = bDeg.map((x) => x * M_PI_180)

		for (const op of ["greatCircleDistanceRads", "greatCircleDistanceKm", "greatCircleDistanceM"]) {
			out.push({
				operation: op,
				args: {
					aLatRadians: a[0],
					aLngRadians: a[1],
					bLatRadians: b[0],
					bLngRadians: b[1],
					aLatDegrees: aDeg[0],
					aLngDegrees: aDeg[1],
					bLatDegrees: bDeg[0],
					bLngDegrees: bDeg[1],
				},
				tokens: [fmt(a[0]!), fmt(a[1]!), fmt(b[0]!), fmt(b[1]!)],
				decode: (t) => ({ value: r(t).f() }),
			})
		}
	}

	for (const [la, lo, lb, lob] of [
		[0, 0, 0, 0],
		[90, 0, -90, 0],
		[0, 0, 0, 180],
		[0, -179.9, 0, 179.9],
		[Number.NaN, 0, 0, 0],
	] as const) {
		for (const op of ["greatCircleDistanceRads", "greatCircleDistanceKm", "greatCircleDistanceM"]) {
			const v = [la * M_PI_180, lo * M_PI_180, lb * M_PI_180, lob * M_PI_180]

			out.push({
				operation: op,
				args: {
					aLatRadians: jf(v[0]!),
					aLngRadians: jf(v[1]!),
					bLatRadians: jf(v[2]!),
					bLngRadians: jf(v[3]!),
					aLatDegrees: jf(la),
					aLngDegrees: lo,
					bLatDegrees: lb,
					bLngDegrees: lob,
				},
				tokens: v.map(fmt),
				decode: (t) => ({ value: r(t).f() }),
			})
		}
	}

	for (const res of [-1, ...Array.from({ length: 16 }, (_, i) => i), 16]) {
		for (const op of [
			"getHexagonAreaAvgKm2",
			"getHexagonAreaAvgM2",
			"getHexagonEdgeLengthAvgKm",
			"getHexagonEdgeLengthAvgM",
		]) {
			out.push({ operation: op, args: { res }, tokens: [String(res)], decode: (t) => ({ value: r(t).f() }) })
		}
	}

	for (const x of [0, 1, -1, 90, 180, -180, 360, 1e-300, 1e300, 57.29577951308232, Number.NaN, Infinity]) {
		out.push({
			operation: "degsToRads",
			args: { value: jf(x) },
			tokens: [fmt(x)],
			decode: (t) => ({ value: r(t).f() }),
		})

		out.push({
			operation: "radsToDegs",
			args: { value: jf(x) },
			tokens: [fmt(x)],
			decode: (t) => ({ value: r(t).f() }),
		})
	}

	// Polygons.
	// Polygons are defined in degrees; C receives deg * M_PI_180, exactly what the JavaScript
	// adapter computes, so JS and C fixtures describe the same doubles.
	type Loop = [number, number][]
	const fromRad = (loop: [number, number][]): Loop => loop.map(([a, b]) => [a / M_PI_180, b / M_PI_180])

	const square = (lat: number, lng: number, half: number): Loop => [
		[lat + half, lng + half],
		[lat + half, lng - half],
		[lat - half, lng - half],
		[lat - half, lng + half],
	]

	const sf = fromRad([
		[0.659966917655, -2.1364398519396],
		[0.6595011102219, -2.1359434279405],
		[0.6583348114025, -2.1354884206045],
		[0.6581220034068, -2.1382437718946],
		[0.6594479998527, -2.1384597563896],
		[0.6599990002976, -2.1376771158464],
	])

	const sfHole = fromRad([
		[0.6595072188743, -2.1371053983433],
		[0.6591482046471, -2.1373141048153],
		[0.6592295020837, -2.1365222838402],
	])

	const pent4 = ref(["cellToLatLng 8009fffffffffff"])[0]!
	const pentLat = Number(pent4[1]) / M_PI_180
	const pentLng = Number(pent4[2]) / M_PI_180

	const tmOuter = fromRad([
		[0.01, -Math.PI + 0.01],
		[0.01, Math.PI - 0.01],
		[-0.01, Math.PI - 0.01],
		[-0.01, -Math.PI + 0.01],
	])

	const tmHole = fromRad([
		[0.005, -Math.PI + 0.005],
		[0.005, Math.PI - 0.005],
		[-0.005, Math.PI - 0.005],
		[-0.005, -Math.PI + 0.005],
	])

	const polygons: { name: string; loops: Loop[]; resolutions: number[] }[] = [
		{ name: "sf", loops: [sf], resolutions: [7, 9] },
		{ name: "sfHole", loops: [sf, sfHole], resolutions: [9] },
		{ name: "sfEmptyHole", loops: [sf, []], resolutions: [8] },
		{
			name: "nearlyEmpty",
			loops: [
				fromRad([
					[0.659966917655, -2.1364398519394],
					[0.659966917656, -2.1364398519395],
					[0.659966917657, -2.1364398519396],
				]),
			],
			resolutions: [9],
		},
		{ name: "point", loops: [[[0, 0]]], resolutions: [9] },
		{
			name: "line",
			loops: [
				[
					[0, 0],
					[1 / M_PI_180, 0],
				],
			],
			resolutions: [6],
		},
		{ name: "empty", loops: [[]], resolutions: [9] },
		{
			name: "infinite",
			loops: [
				[
					[Infinity, Infinity],
					[-Infinity, -Infinity],
				],
			],
			resolutions: [9],
		},
		{
			name: "nan",
			loops: [
				[
					[Number.NaN, Number.NaN],
					[Number.NaN, Number.NaN],
				],
			],
			resolutions: [9],
		},
		{ name: "sfNanVertex", loops: [sf.map((v, i) => (i === 1 ? [Number.NaN, v[1]] : v)) as Loop], resolutions: [9] },
		{
			name: "sfNanHole",
			loops: [sf, sfHole.map((v, i) => (i === 1 ? [v[0], Number.NaN] : v)) as Loop],
			resolutions: [9],
		},
		{
			name: "polarBand",
			loops: [
				[
					[85, 0],
					[85, 179],
					[89.9, 179],
					[89.9, 0],
				],
			],
			resolutions: [2],
		},
		{
			name: "primeMeridian",
			loops: [
				fromRad([
					[0.01, 0.01],
					[0.01, -0.01],
					[-0.01, -0.01],
					[-0.01, 0.01],
				]),
			],
			resolutions: [7],
		},
		{ name: "transMeridian", loops: [tmOuter], resolutions: [7] },
		{ name: "transMeridianHole", loops: [tmOuter, tmHole], resolutions: [7] },
		{ name: "transMeridianFilled", loops: [tmHole], resolutions: [7] },
		{
			name: "h3js67",
			loops: [
				[
					[-33.13755119234615, -56.25],
					[-34.30714385628804, -56.25],
					[-34.30714385628804, -57.65625],
					[-33.13755119234615, -57.65625],
				],
			],
			resolutions: [7],
		},
		{
			name: "h3_136",
			loops: [
				fromRad([
					[0.10068990369902957, 0.8920772174196191],
					[0.10032914690616246, 0.8915914753447348],
					[0.10033349237998787, 0.8915860128746426],
					[0.10069496685903621, 0.8920742194546231],
				]),
			],
			resolutions: [13],
		},
		{ name: "aroundPentagon", loops: [square(pentLat, pentLng, 1.5)], resolutions: [3, 4] },
		{ name: "pentagonTiny", loops: [square(pentLat, pentLng, 0.0001)], resolutions: [5] },
		{ name: "tinyInsideCell", loops: [square(37.3615593, -122.0553238, 0.00001)], resolutions: [5, 8] },
		{
			name: "large",
			loops: [
				[
					[60, -30],
					[60, 30],
					[0, 30],
					[0, -30],
				],
			],
			resolutions: [1],
		},
		{
			name: "outOfRangeLat",
			loops: [
				[
					[100, 10],
					[100, 20],
					[80, 20],
					[80, 10],
				],
			],
			resolutions: [2],
		},
		{
			name: "concave",
			loops: [
				[
					[0, 0],
					[10, 5],
					[0, 10],
					[5, 5],
				],
			],
			resolutions: [3],
		},
	]

	const polygonTokens = (loops: Loop[]): string[] => [
		String(loops.length),
		...loops.flatMap((l) => [String(l.length), ...l.flatMap(([a, b]) => [fmt(a * M_PI_180), fmt(b * M_PI_180)])]),
	]

	const polygonArgs = (name: string, loops: Loop[], res: number, flags: number) => ({
		name,
		res,
		flags,
		loopsDegrees: loops.map((l) => l.map(([a, b]) => [jf(a), jf(b)])),
		loopsRadians: loops.map((l) => l.map(([a, b]) => [jf(a * M_PI_180), jf(b * M_PI_180)])),
	})

	const cellsResult = (t: string[]) => ({ indexes: r(t).idxArray() })

	for (const { name, loops, resolutions } of polygons) {
		for (const res of resolutions) {
			const toks = polygonTokens(loops)

			out.push({
				operation: "maxPolygonToCellsSize",
				args: polygonArgs(name, loops, res, 0),
				tokens: [String(res), "0", ...toks],
				decode: intResult,
			})

			out.push({
				operation: "polygonToCells",
				args: polygonArgs(name, loops, res, 0),
				tokens: [String(res), "0", ...toks],
				decode: cellsResult,
			})

			for (const flags of [0, 1, 2, 3]) {
				out.push({
					operation: "maxPolygonToCellsSizeExperimental",
					args: polygonArgs(name, loops, res, flags),
					tokens: [String(res), String(flags), ...toks],
					decode: intResult,
				})

				out.push({
					operation: "polygonToCellsExperimental",
					args: polygonArgs(name, loops, res, flags),
					tokens: [String(res), String(flags), ...toks],
					decode: cellsResult,
				})
			}
		}
	}

	for (const [res, flags] of [
		[9, 4],
		[9, 16],
		[-1, 0],
		[16, 0],
	] as const) {
		const toks = polygonTokens([sf])

		for (const op of [
			"maxPolygonToCellsSize",
			"polygonToCells",
			"maxPolygonToCellsSizeExperimental",
			"polygonToCellsExperimental",
		]) {
			out.push({
				operation: op,
				args: polygonArgs("sf", [sf], res, flags),
				tokens: [String(res), String(flags), ...toks],
				decode: op.startsWith("max") ? intResult : cellsResult,
			})
		}
	}

	// cellsToLinkedMultiPolygon.
	const q = (line: string) => {
		const t = ref([line])[0]!

		return t[0] === "0" ? t.slice(2).filter((x) => x !== "0") : []
	}

	const hexOrigin = hex(randomCell(rng, 6, 20))
	const disk2 = q(`gridDisk ${hexOrigin} 2`)
	const ring2 = q(`gridRing ${hexOrigin} 2`)
	const farDisk = q(`gridDisk ${hex(randomCell(rng, 6, 90))} 1`)
	const pentDisk = q(`gridDisk ${hex(pentagon(4, 14))} 2`)

	const tmCells = q(
		`polygonToCellsExperimental 5 0 ${polygonTokens([tmOuter.map(([a, b]) => [a * 5, b]) as Loop]).join(" ")}`
	)

	const sfCells = q(`polygonToCellsExperimental 9 0 ${polygonTokens([sf]).join(" ")}`)
	const res1Children = q(`cellToChildren 8001fffffffffff 1`)
	const res0All = Array.from({ length: 122 }, (_, bc) => hex(cell(0, bc, [])))

	const multiSets: string[][] = [
		[],
		[hexOrigin],
		[hex(pentagon(5, 4))],
		[hex(pentagon(0, 117))],
		disk2,
		ring2,
		[...disk2, ...farDisk],
		pentDisk,
		tmCells,
		sfCells,
		res1Children,
		res0All,
		res0All.slice(1),
		[...disk2, disk2[0]!],
		[hexOrigin, hex(randomCell(rng, 7))],
		[hexOrigin, hex(invalid[4]!)],
	]

	const decodeMulti = (t: string[]) => {
		const x = r(t)
		const np = x.n()

		return {
			polygonsRadians: Array.from({ length: np }, () => {
				const nl = x.n()

				return Array.from({ length: nl }, () => {
					const nv = x.n()

					return Array.from({ length: nv }, () => [x.f(), x.f()])
				})
			}),
		}
	}

	for (const set of multiSets) {
		out.push({
			operation: "cellsToLinkedMultiPolygon",
			args: { indexes: set },
			tokens: [String(set.length), ...set],
			decode: decodeMulti,
		})
	}

	return out
}
