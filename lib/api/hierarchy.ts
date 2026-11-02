/**
 * Hierarchy (Phase C): parents, children, child positions, compaction.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { ready, trapped } from "../runtime/state.ts"
import { checkCount, checkIndex, readIndexes } from "./call.ts"
import { type H3Index, type H3IndexInput, parseIndex, parseIndexArray, resArg } from "./indexes.ts"

/**
 * The parent of a cell at `res`.
 */
export function cellToParent(h3Index: H3IndexInput, res: number): H3Index {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")
	const r = resArg(res)
	let p: bigint

	try {
		p = w.cell_to_parent(h, r)
	} catch (error) {
		throw trapped(error)
	}

	return checkIndex(w, p)
}

/**
 * All children of a cell at `res`, in C iteration order.
 */
export function cellToChildren(h3Index: H3IndexInput, res: number): H3Index[] {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")
	const r = resArg(res)

	try {
		return readIndexes(w, w.cell_to_children(h, r))
	} catch (error) {
		throw trapped(error)
	}
}

/**
 * The number of children of a cell at `res`.
 */
export function cellToChildrenSize(h3Index: H3IndexInput, res: number): number {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")
	const r = resArg(res)

	try {
		return checkCount(w, w.cell_to_children_size(h, r))
	} catch (error) {
		throw trapped(error)
	}
}

/**
 * The center child of a cell at `res`.
 */
export function cellToCenterChild(h3Index: H3IndexInput, res: number): H3Index {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")
	const r = resArg(res)

	try {
		return checkIndex(w, w.cell_to_center_child(h, r))
	} catch (error) {
		throw trapped(error)
	}
}

/**
 * The position of a cell within its parent's ordered children at `parentRes`.
 */
export function cellToChildPos(h3Index: H3IndexInput, parentRes: number): number {
	const w = ready()
	const h = parseIndex(h3Index, "h3Index")
	const r = resArg(parentRes, "parentRes")

	try {
		return checkCount(w, w.cell_to_child_pos(h, r))
	} catch (error) {
		throw trapped(error)
	}
}

/**
 * The child of `h3Index` at `childRes` with ordered position `childPos`.
 */
export function childPosToCell(childPos: number, h3Index: H3IndexInput, childRes: number): H3Index {
	const w = ready()

	if (typeof childPos !== "number") throw new TypeError("childPos must be a number")

	if (!Number.isSafeInteger(childPos)) throw new RangeError(`childPos must be a safe integer; got ${childPos}`)
	const h = parseIndex(h3Index, "h3Index")
	const r = resArg(childRes, "childRes")

	try {
		return checkIndex(w, w.child_pos_to_cell(childPos, h, r))
	} catch (error) {
		throw trapped(error)
	}
}

/**
 * Compacts a set of same-resolution cells into the minimal covering set (C order).
 */
export function compactCells(h3Set: readonly H3IndexInput[]): H3Index[] {
	const w = ready()
	const cells = parseIndexArray(h3Set, "h3Set")

	try {
		return readIndexes(w, w.compact_cells(cells))
	} catch (error) {
		throw trapped(error)
	}
}

/**
 * Expands a compacted set to cells at `res`.
 */
export function uncompactCells(compactedSet: readonly H3IndexInput[], res: number): H3Index[] {
	const w = ready()
	const cells = parseIndexArray(compactedSet, "compactedSet")
	const r = resArg(res)

	try {
		return readIndexes(w, w.uncompact_cells(cells, r))
	} catch (error) {
		throw trapped(error)
	}
}
