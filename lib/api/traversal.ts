/**
 * Grid traversal: disks, rings, distances, paths, local IJ.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { ready, statusError } from "../runtime/state.ts"
import { call, checkCount, checkIndex, checkVec, readIndexes } from "./call.ts"
import { type H3Cell, type H3IndexInput, intArg, parseIndex } from "./indexes.ts"

/**
 * Local IJ coordinates relative to an origin cell.
 */
export interface CoordIJ {
	i: number
	j: number
}

const MAX_K = 0x7f_ff_ff_ff

function ringSizeArg(x: unknown): number {
	return intArg(x, "ringSize", 0, MAX_K)
}

/**
 * Returns all cells within grid distance `ringSize` of a cell (unspecified order, no gaps).
 */
export function gridDisk<T extends string = H3Cell>(h3Index: H3IndexInput, ringSize: number): T[] {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")
	const k = ringSizeArg(ringSize)

	return call(() => readIndexes<T>(w, w.grid_disk(h, k)))
}

/**
 * Returns cells within `ringSize`, grouped by distance: element `d` holds the cells at distance `d`.
 */
export function gridDiskDistances<T extends string = H3Cell>(h3Index: H3IndexInput, ringSize: number): T[][] {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")
	const k = ringSizeArg(ringSize)
	const flat = call(() => checkVec(w, w.grid_disk_distances(h, k)))

	const out: T[][] = Array.from({ length: k + 1 }, () => [])

	for (let i = 0; i < flat.length; i += 2) {
		out[Number(flat[i + 1])]!.push(flat[i]!.toString(16) as T)
	}

	return out
}

/**
 * Returns the hollow ring of cells at exactly grid distance `ringSize`.
 */
export function gridRing<T extends string = H3Cell>(h3Index: H3IndexInput, ringSize: number): T[] {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")
	const k = ringSizeArg(ringSize)

	return call(() => readIndexes<T>(w, w.grid_ring(h, k)))
}

/**
 * Returns the hollow ring at `ringSize`; throws `H3Error` (`E_PENTAGON`) near pentagon distortion.
 */
export function gridRingUnsafe<T extends string = H3Cell>(h3Index: H3IndexInput, ringSize: number): T[] {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")
	const k = ringSizeArg(ringSize)

	return call(() => readIndexes<T>(w, w.grid_ring_unsafe(h, k)))
}

/**
 * Returns the grid distance between two cells.
 */
export function gridDistance(origin: H3IndexInput, destination: H3IndexInput): number {
	const w = ready()
	const a = parseIndex(origin, "origin")
	const b = parseIndex(destination, "destination")

	return call(() => checkCount(w, w.grid_distance(a, b)))
}

/**
 * Returns a line of adjacent cells from `origin` to `destination`, inclusive.
 */
export function gridPathCells<T extends string = H3Cell>(origin: H3IndexInput, destination: H3IndexInput): T[] {
	const w = ready()
	const a = parseIndex(origin, "origin")
	const b = parseIndex(destination, "destination")

	return call(() => readIndexes<T>(w, w.grid_path_cells(a, b)))
}

/**
 * Local IJ coordinates of `destination` anchored at `origin` (C mode 0).
 */
export function cellToLocalIj(origin: H3IndexInput, destination: H3IndexInput): CoordIJ {
	const w = ready()
	const a = parseIndex(origin, "origin")
	const b = parseIndex(destination, "destination")
	const status = call(() => w.cell_to_local_ij(a, b))

	if (status !== 0) throw statusError(w, status)

	return { i: w.out_f64(0), j: w.out_f64(1) }
}

/**
 * The cell at local IJ coordinates anchored at `origin` (C mode 0).
 */
export function localIjToCell<T extends string = H3Cell>(origin: H3IndexInput, coords: CoordIJ): T {
	const w = ready()
	const a = parseIndex(origin, "origin")

	if (typeof coords !== "object" || coords === null) throw new TypeError("coords must be an { i, j } object")
	const i = intArg(coords.i, "coords.i", -0x80_00_00_00, 0x7f_ff_ff_ff)
	const j = intArg(coords.j, "coords.j", -0x80_00_00_00, 0x7f_ff_ff_ff)

	return call(() => checkIndex<T>(w, w.local_ij_to_cell(a, i, j)))
}
