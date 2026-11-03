/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import * as h3 from "@sister.software/h3"
import wasmBytes from "h3-probe-bytes"
import cases from "h3-probe-cases"

import { runFixtureCases } from "#test/shared/fixture-cases"

async function restrictions() {
	const out: Record<string, string | boolean> = {
		processDefined: "process" in globalThis,
		importMetaUrl: String(import.meta.url),
	}

	try {
		await WebAssembly.compile(wasmBytes)
		out.compileBytes = "allowed"
	} catch (error) {
		out.compileBytes = String(error)
	}

	try {
		// These operations deliberately probe workerd restrictions.
		// oxlint-disable-next-line typescript/no-implied-eval
		new Function("return 1")()
		out.newFunction = "allowed"
	} catch (error) {
		out.newFunction = String(error)
	}

	try {
		// oxlint-disable-next-line eslint/no-eval
		;(0, eval)("1")
		out.eval = "allowed"
	} catch (error) {
		out.eval = String(error)
	}

	try {
		await h3.init({ bytes: wasmBytes })
		out.initBytes = "allowed"
	} catch (error) {
		out.initBytes =
			error instanceof Error
				? `${error.name}: ${String(error.cause instanceof Error ? error.cause : error)}`
				: String(error)
	}

	return out
}

export default {
	async fetch(request: Request): Promise<Response> {
		if (new URL(request.url).pathname === "/restrictions") return Response.json(await restrictions())
		const first = h3.latLngToCell(37.3615593, -122.0553238, 7)

		return Response.json({ first, outcomes: runFixtureCases(h3, cases) })
	},
}
