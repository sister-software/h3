/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import type { CaseOutcome } from "../shared/fixture-cases.ts"

export interface Check {
	name: string
	status: "pass" | "fail" | "not run"
	detail: string
	data?: unknown
}

export interface ProbeResult {
	outcomes: CaseOutcome[]
}

export class RuntimeChecks {
	readonly results: Check[] = []
	readonly expectedCases: number
	constructor(expectedCases: number) {
		this.expectedCases = expectedCases
	}
	record = (name: string, status: Check["status"], detail: string, data?: unknown): void => {
		this.results.push({ name, status, detail, data })

		console.log(`${status.toUpperCase()}  ${name}: ${detail}`)
	}
	judge = (name: string, result: ProbeResult): void => {
		const failed = result.outcomes.filter((outcome) => !outcome.ok)
		const total = result.outcomes.length
		const ok = total === this.expectedCases && failed.length === 0

		this.record(name, ok ? "pass" : "fail", `${total - failed.length}/${this.expectedCases} fixture cases match C`, {
			...result,
			outcomes: undefined,
			summary: { total, failed: failed.length, firstFailures: failed.slice(0, 5) },
		})
	}
}
