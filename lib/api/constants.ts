/**
 * Public constants. Pure; available before initialization.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

/**
 * Length and area units accepted by the measurement functions.
 */
export const UNITS = Object.freeze({
	m: "m",
	m2: "m2",
	km: "km",
	km2: "km2",
	rads: "rads",
	rads2: "rads2",
} as const)

/**
 * A value of {@link UNITS}.
 */
export type Unit = (typeof UNITS)[keyof typeof UNITS]

/**
 * Containment modes for `polygonToCellsExperimental` (C flags 0–3).
 */
export const POLYGON_TO_CELLS_FLAGS = Object.freeze({
	containmentCenter: "containmentCenter",
	containmentFull: "containmentFull",
	containmentOverlapping: "containmentOverlapping",
	containmentOverlappingBbox: "containmentOverlappingBbox",
} as const)

/**
 * A value of {@link POLYGON_TO_CELLS_FLAGS}.
 */
export type PolygonToCellsFlag = (typeof POLYGON_TO_CELLS_FLAGS)[keyof typeof POLYGON_TO_CELLS_FLAGS]
