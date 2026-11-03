/**
 * Checks default result brands and caller-supplied brands against the installed declarations.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import {
	latLngToCell,
	constructCell,
	cellToParent,
	cellToCenterChild,
	childPosToCell,
	localIjToCell,
	getDirectedEdgeOrigin,
	getDirectedEdgeDestination,
	directedEdgeToCells,
	cellToChildren,
	compactCells,
	uncompactCells,
	gridDisk,
	gridDiskDistances,
	gridRing,
	gridRingUnsafe,
	gridPathCells,
	getRes0Cells,
	getPentagons,
	polygonToCells,
	polygonToCellsExperimental,
	POLYGON_TO_CELLS_FLAGS,
	cellsToDirectedEdge,
	originToDirectedEdges,
	reverseDirectedEdge,
	cellToVertex,
	cellToVertexes,
	splitLongToH3Index,
	type H3Cell,
	type H3DirectedEdge,
	type H3Vertex,
	type H3Index,
} from "@sister.software/h3"

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

type Expect<T extends true> = T

type Values<T> = T[keyof T]

declare const applicationCellBrand: unique symbol

type ApplicationCell = string & { readonly [applicationCellBrand]: true }
declare const applicationEdgeBrand: unique symbol

type ApplicationEdge = string & { readonly [applicationEdgeBrand]: true }
declare const applicationVertexBrand: unique symbol

type ApplicationVertex = string & { readonly [applicationVertexBrand]: true }

const cell = latLngToCell(37.36, -122.05, 9)
const edge = cellsToDirectedEdge(cell, cell)
const vertex = cellToVertex(cell, 0)

const polygon = [
	[0, 0],
	[1, 0],
	[1, 1],
]

const cellResults = {
	cell,
	constructed: constructCell(20, []),
	parent: cellToParent(cell, 5),
	child: cellToCenterChild(cell, 10),
	positionedChild: childPosToCell(0, cell, 10),
	localCell: localIjToCell(cell, { i: 0, j: 0 }),
	origin: getDirectedEdgeOrigin(edge),
	destination: getDirectedEdgeDestination(edge),
}

const cellLists = {
	children: cellToChildren(cell, 10),
	compacted: compactCells([cell]),
	uncompacted: uncompactCells([cell], 10),
	disk: gridDisk(cell, 1),
	ring: gridRing(cell, 1),
	unsafeRing: gridRingUnsafe(cell, 1),
	path: gridPathCells(cell, cell),
	baseCells: getRes0Cells(),
	pentagons: getPentagons(9),
	polygon: polygonToCells(polygon, 5),
	experimentalPolygon: polygonToCellsExperimental(polygon, 5, POLYGON_TO_CELLS_FLAGS.containmentFull),
}

const edgeResults = { edge, reversed: reverseDirectedEdge(edge) }
const edges = originToDirectedEdges(cell)
const vertices = cellToVertexes(cell)
const pair = directedEdgeToCells(edge)
const distances = gridDiskDistances(cell, 2)
const converted = splitLongToH3Index(0, 0)

const applicationCell = latLngToCell<ApplicationCell>(37.36, -122.05, 9)
const applicationDisk = gridDisk<ApplicationCell>(applicationCell, 1)
const applicationDistances = gridDiskDistances<ApplicationCell>(applicationCell, 2)
const applicationPair = directedEdgeToCells<ApplicationCell>(edge)
const applicationEdge = cellsToDirectedEdge<ApplicationEdge>(cell, cell)
const applicationVertex = cellToVertex<ApplicationVertex>(cell, 0)
const applicationConverted = splitLongToH3Index<ApplicationCell>(0, 0)
const plainDisk = gridDisk<string>(cell, 1)

// Input compatibility includes ordinary strings, foreign brands, and split-long tuples.
gridDisk("87283472bffffff", 1)
gridDisk(applicationCell, 1)
gridDisk([0x2b_ff_ff_ff, 0x8_72_83_47], 1)

// @ts-expect-error the output override must be a string type
gridDisk<number>(cell, 1)

export type BrandAssertions = [
	Expect<Equal<Values<typeof cellResults>, H3Cell>>,
	Expect<Equal<Values<typeof cellLists>, H3Cell[]>>,
	Expect<Equal<Values<typeof edgeResults>, H3DirectedEdge>>,
	Expect<Equal<typeof edges, H3DirectedEdge[]>>,
	Expect<Equal<typeof vertex, H3Vertex>>,
	Expect<Equal<typeof vertices, H3Vertex[]>>,
	Expect<Equal<typeof pair, [H3Cell, H3Cell]>>,
	Expect<Equal<typeof distances, H3Cell[][]>>,
	Expect<Equal<typeof converted, H3Index>>,
	Expect<Equal<typeof applicationCell, ApplicationCell>>,
	Expect<Equal<typeof applicationDisk, ApplicationCell[]>>,
	Expect<Equal<typeof applicationDistances, ApplicationCell[][]>>,
	Expect<Equal<typeof applicationPair, [ApplicationCell, ApplicationCell]>>,
	Expect<Equal<typeof applicationEdge, ApplicationEdge>>,
	Expect<Equal<typeof applicationVertex, ApplicationVertex>>,
	Expect<Equal<typeof applicationConverted, ApplicationCell>>,
	Expect<Equal<typeof plainDisk, string[]>>,
	Expect<Equal<string extends H3Cell ? true : false, false>>,
	Expect<Equal<H3DirectedEdge extends H3Cell ? true : false, false>>,
	Expect<Equal<H3Vertex extends H3Cell ? true : false, false>>,
	Expect<Equal<H3Cell extends H3DirectedEdge ? true : false, false>>,
	Expect<Equal<H3Cell extends H3Vertex ? true : false, false>>,
]
