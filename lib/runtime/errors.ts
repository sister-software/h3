/**
 * Error constructors for the public API. See docs/api-decisions.md, "Errors".
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

/**
 * The shape of an H3 algorithm error: an `Error` named `"H3Error"` carrying the C error code.
 */
export interface H3Error extends Error {
	name: "H3Error"
	/**
	 * The numeric C `H3Error` code.
	 */
	code: number
}

/**
 * C `describeH3Error` text, indexed by code.
 */
const DESCRIPTIONS = [
	"Success",
	"The operation failed but a more specific error is not available",
	"Argument was outside of acceptable range",
	"Latitude or longitude arguments were outside of acceptable range",
	"Resolution argument was outside of acceptable range",
	"Cell argument was not valid",
	"Directed edge argument was not valid",
	"Undirected edge argument was not valid",
	"Vertex argument was not valid",
	"Pentagon distortion was encountered",
	"Duplicate input",
	"Cell arguments were not neighbors",
	"Cell arguments had incompatible resolutions",
	"Memory allocation failed",
	"Bounds of provided memory were insufficient",
	"Mode or flags argument was not valid",
	"Index argument was not valid",
	"Base cell number was outside of acceptable range",
	"Child digits invalid",
	"Deleted subsequence indicates invalid index",
] as const

/**
 * @internal
 */
export function h3Error(code: number): H3Error {
	const error = new Error(DESCRIPTIONS[code] ?? `Unknown H3 error code ${code}`) as H3Error
	error.name = "H3Error"
	error.code = code

	return error
}

/**
 * @internal
 */
export function initializationError(message: string, cause?: unknown): Error {
	const error = new Error(message, cause === undefined ? undefined : { cause })
	error.name = "H3InitializationError"

	return error
}

/**
 * @internal
 */
export function runtimeError(message: string, cause?: unknown): Error {
	const error = new Error(message, cause === undefined ? undefined : { cause })
	error.name = "H3RuntimeError"

	return error
}

/**
 * The limit names reported by {@link H3ResourceLimitError}.
 */
export type ResourceLimitName = "maxResultItems" | "maxResultBytes" | "maxWorkspaceBytes"

/**
 * The shape of a resource-limit rejection: a `RangeError` named `"H3ResourceLimitError"`.
 */
export interface H3ResourceLimitError extends RangeError {
	name: "H3ResourceLimitError"
	limit: ResourceLimitName
	requested: number
	maximum: number
}

/**
 * @internal
 */
export function resourceLimitError(limit: ResourceLimitName, requested: number, maximum: number): H3ResourceLimitError {
	const error = new RangeError(
		`Request exceeds ${limit}: requested ${requested}, maximum ${maximum}`
	) as H3ResourceLimitError

	error.name = "H3ResourceLimitError"
	error.limit = limit
	error.requested = requested
	error.maximum = maximum

	return error
}
