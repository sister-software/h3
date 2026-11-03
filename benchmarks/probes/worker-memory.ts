/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

const workerModule = "./h3.mjs"
let h3: (typeof import("../../index.ts") & { wasmMemoryBytes(): number }) | undefined

export default {
	async fetch(request: Request) {
		const step = new URL(request.url).pathname.slice(1)

		if (step === "import") {
			h3 = (await import(workerModule)) as typeof h3
		}

		if (step === "baseline") return Response.json({ step, wasmMemoryBytes: 0 })

		if (!h3) throw new Error("Run the import stage first")

		if (step === "init") {
			// This first call instantiates the binary.
			h3.isValidCell("8001fffffffffff")
		}

		if (step === "scalar") {
			for (let i = 0; i < 100_000; i++) {
				h3.latLngToCell(37 + i * 1e-6, -122, 9)
			}
		}

		if (step === "disk") {
			for (let i = 0; i < 20; i++) {
				h3.gridDisk(h3.latLngToCell(37.36, -122.05, 9), 100)
			}
		}

		if (step === "compact") {
			h3.compactCells(h3.cellToChildren(h3.cellToParent(h3.latLngToCell(37.36, -122.05, 9), 4), 9))
		}

		if (step === "polygon") {
			h3.polygonToCells(
				[
					[37.7, -122.5],
					[37.8, -122.5],
					[37.8, -122.35],
					[37.7, -122.35],
				],
				10
			)
		}

		return Response.json({ step, wasmMemoryBytes: h3 ? h3.wasmMemoryBytes() : 0 })
	},
}
