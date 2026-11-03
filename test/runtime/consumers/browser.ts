/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import * as h3 from "@sister.software/h3"
import cases from "h3-probe-cases"

import { runFixtureCases, type CaseOutcome } from "../../shared/fixture-cases.ts"

export type BrowserResult = { first: string; outcomes: CaseOutcome[] } | { error: string }

declare global {
	var __result: BrowserResult | undefined
}

export function runBrowser(): void {
	try {
		const first = h3.latLngToCell(37.3615593, -122.0553238, 7)
		globalThis.__result = { first, outcomes: runFixtureCases(h3, cases) }
	} catch (error) {
		failBrowser(error)
	}
}

export function failBrowser(error: unknown): void {
	globalThis.__result = { error: error instanceof Error ? (error.stack ?? error.message) : String(error) }
}
