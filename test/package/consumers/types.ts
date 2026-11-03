/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import {
	cellToBoundary,
	gridDiskDistances,
	init,
	latLngToCell,
	polygonToCellsExperimental,
	POLYGON_TO_CELLS_FLAGS,
	type CoordPair,
	type H3Index,
	type H3Error,
	type ResourceLimits,
} from "@sister.software/h3"

const limits: ResourceLimits = { maxResultItems: 1000 }
declare const bytes: Uint8Array
await init({ bytes, limits })
const cell: H3Index = latLngToCell(37.3615593, -122.0553238, 7)
const boundary: CoordPair[] = cellToBoundary(cell, true)
const rings: H3Index[][] = gridDiskDistances(cell, 2)

const cells: H3Index[] = polygonToCellsExperimental(
	[
		[0, 0],
		[1, 0],
		[1, 1],
	],
	5,
	POLYGON_TO_CELLS_FLAGS.containmentFull
)

function code(e: H3Error): number {
	return e.code
}

// @ts-expect-error resolution must be a number
latLngToCell(0, 0, "7")
await init()
// @ts-expect-error init takes at most one source
await init({ bytes, module: {} as WebAssembly.Module })
export { boundary, rings, cells, code }
