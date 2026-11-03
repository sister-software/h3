/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import * as h3 from "@sister.software/h3"
import wasmUrl from "@sister.software/h3/h3.wasm"

import { failBrowser, runBrowser } from "#test/runtime/consumers/browser"

async function main(): Promise<void> {
	const response = await fetch(wasmUrl)

	if (!response.ok) throw new Error(`Unable to load H3 WASM: ${response.status}`)
	await h3.init({ bytes: await response.arrayBuffer() })
	runBrowser()
}

main().catch(failBrowser)
