/**
 * Hierarchy: parents, children, child positions, compaction.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { ready } from "../runtime/state.ts"
import { call, checkCount, checkIndex, readIndexes } from "./call.ts"
import { type H3Cell, type H3IndexInput, parseIndex, parseIndexArray, resArg } from "./indexes.ts"

/**
 * Returns the parent of a cell at `res`.
 */
export function cellToParent<T extends string = H3Cell>(h3Index: H3IndexInput, res: number): T {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")
	const r = resArg(res)
	const p = call(() => w.cell_to_parent(h, r))

	return checkIndex<T>(w, p)
}

/**
 * All children of a cell at `res`, in C iteration order.
 */
export function cellToChildren<T extends string = H3Cell>(h3Index: H3IndexInput, res: number): T[] {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")
	const r = resArg(res)

	return call(() => readIndexes<T>(w, w.cell_to_children(h, r)))
}

/**
 * Returns the number of children of a cell at `res`.
 */
export function cellToChildrenSize(h3Index: H3IndexInput, res: number): number {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")
	const r = resArg(res)

	return call(() => checkCount(w, w.cell_to_children_size(h, r)))
}

/**
 * Returns the center child of a cell at `res`.
 */
export function cellToCenterChild<T extends string = H3Cell>(h3Index: H3IndexInput, res: number): T {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")
	const r = resArg(res)

	return call(() => checkIndex<T>(w, w.cell_to_center_child(h, r)))
}

/**
 * Returns the position of a cell within its parent's ordered children at `parentRes`.
 */
export function cellToChildPos(h3Index: H3IndexInput, parentRes: number): number {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")
	const r = resArg(parentRes, "parentRes")

	return call(() => checkCount(w, w.cell_to_child_pos(h, r)))
}

/**
 * The child of `h3Index` at `childRes` with ordered position `childPos`.
 */
export function childPosToCell<T extends string = H3Cell>(
	childPos: number,
	h3Index: H3IndexInput,
	childRes: number
): T {
	const w = ready()

	if (typeof childPos !== "number") throw new TypeError("childPos must be a number")

	if (!Number.isSafeInteger(childPos)) throw new RangeError(`childPos must be a safe integer; got ${childPos}`)
	const h = parseIndex(h3Index, "h3Index")
	const r = resArg(childRes, "childRes")

	return call(() => checkIndex<T>(w, w.child_pos_to_cell(childPos, h, r)))
}

/**
 * Compacts a set of same-resolution cells into the minimal covering set (C order).
 */
export function compactCells<T extends string = H3Cell>(h3Set: readonly H3IndexInput[]): T[] {
	const w = ready()
	const cells = parseIndexArray(h3Set, "h3Set")

	return call(() => readIndexes<T>(w, w.compact_cells(cells)))
}

/**
 * Expands a compacted set to cells at `res`.
 */
export function uncompactCells<T extends string = H3Cell>(compactedSet: readonly H3IndexInput[], res: number): T[] {
	const w = ready()
	const cells = parseIndexArray(compactedSet, "compactedSet")
	const r = resArg(res)

	return call(() => readIndexes<T>(w, w.uncompact_cells(cells, r)))
}
