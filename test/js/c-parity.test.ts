/**
 * Public JavaScript API (compiled WASM) versus the pinned C fixtures.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { beforeAll, describe, expect, test } from "vitest"

import * as h3 from "../../index.ts"
import { type FixtureRecord, runFixtureCases, stats, SUPPORTED_OPERATIONS } from "../shared/fixture-cases.ts"

const root = join(import.meta.dirname, "../..")

beforeAll(async () => {
	await h3.init({ bytes: readFileSync(join(root, "wasm/h3.wasm")) })
})

describe("C fixture parity through the public API", () => {
	for (const op of SUPPORTED_OPERATIONS) {
		test(`${op}`, () => {
			const records: FixtureRecord[] = readFileSync(join(root, "crates/h3-core/tests/fixtures", `${op}.jsonl`), "utf8")
				.trim()
				.split("\n")
				.map((l) => JSON.parse(l))

			const outcomes = runFixtureCases(h3, records)
			const failed = outcomes.filter((o) => !o.ok)
			expect(failed.slice(0, 5)).toEqual([])
			expect(outcomes.filter((o) => !o.skipped).length).toBeGreaterThan(0)
		})
	}

	test("coordinate differences are reported", () => {
		console.log("WASM vs C coordinate differences (degrees):", JSON.stringify(stats))

		expect(Object.keys(stats).length).toBeGreaterThan(0)
	})
})
