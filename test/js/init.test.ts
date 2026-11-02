/**
 * Initialization state machine (docs/api-decisions.md, "Initialization"). Every test imports a fresh module graph so
 * state never leaks between tests.
 *
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import manifest from "../api-manifest.json" with { type: "json" }

const root = join(import.meta.dirname, "../..")
const wasmBytes = readFileSync(join(root, "wasm/h3.wasm"))

type H3 = typeof import("../../index.ts")

async function fresh(): Promise<H3> {
	vi.resetModules()

	return import("../../index.ts")
}

const PURE = [
	"UNITS",
	"POLYGON_TO_CELLS_FLAGS",
	"h3IndexToSplitLong",
	"splitLongToH3Index",
	"degsToRads",
	"radsToDegs",
	"init",
]

/**
 * Plausible arguments so each function reaches its readiness check.
 */
const DUMMY: unknown[] = ["8001fffffffffff", 1, 1, 1]

let instantiate: ReturnType<typeof vi.spyOn>

beforeEach(() => {
	instantiate = vi.spyOn(WebAssembly, "instantiate")
})

afterEach(() => {
	instantiate.mockRestore()
})

describe("before readiness", () => {
	test("the pure exports are exactly the documented six (plus init)", () => {
		const pure = manifest.entries.filter((e) => !e.requiresInit).map((e) => e.name)
		expect(pure.toSorted()).toEqual(PURE.toSorted())
	})

	test("every other export throws H3InitializationError synchronously", async () => {
		const h3 = await fresh()

		for (const entry of manifest.entries.filter((e) => e.requiresInit)) {
			const fn = (h3 as unknown as Record<string, (...a: unknown[]) => unknown>)[entry.name]!
			expect(typeof fn, entry.name).toBe("function")
			let thrown: unknown

			try {
				fn(...DUMMY)
			} catch (error) {
				thrown = error
			}

			expect((thrown as Error | undefined)?.name, entry.name).toBe("H3InitializationError")
		}
	})

	test("pure exports work before init", async () => {
		const h3 = await fresh()
		expect(h3.UNITS.km).toBe("km")
		expect(h3.POLYGON_TO_CELLS_FLAGS.containmentFull).toBe("containmentFull")
		expect(h3.h3IndexToSplitLong("87283472bffffff")).toEqual([0x2b_ff_ff_ff, 0x8_72_83_47])
		expect(h3.splitLongToH3Index(0x2b_ff_ff_ff, 0x8_72_83_47)).toBe("87283472bffffff")
		expect(h3.degsToRads(180)).toBe(Math.PI)
		expect(h3.radsToDegs(Math.PI)).toBe(180)
	})

	test("importing compiles and instantiates nothing", async () => {
		await fresh()
		expect(instantiate).not.toHaveBeenCalled()
	})
})

describe("init arguments", () => {
	test("requires exactly one source of the right type", async () => {
		const h3 = await fresh()
		await expect(h3.init(undefined as never)).rejects.toBeInstanceOf(TypeError)
		await expect(h3.init({} as never)).rejects.toBeInstanceOf(TypeError)

		await expect(
			h3.init({ bytes: wasmBytes, module: new WebAssembly.Module(wasmBytes) } as never)
		).rejects.toBeInstanceOf(TypeError)

		await expect(h3.init({ module: wasmBytes } as never)).rejects.toBeInstanceOf(TypeError)
		await expect(h3.init({ bytes: "x" } as never)).rejects.toBeInstanceOf(TypeError)
	})

	test("validates limits", async () => {
		const h3 = await fresh()
		await expect(h3.init({ bytes: wasmBytes, limits: { maxResultItems: -1 } })).rejects.toBeInstanceOf(RangeError)
		await expect(h3.init({ bytes: wasmBytes, limits: { maxResultItems: 1.5 } })).rejects.toBeInstanceOf(RangeError)

		await expect(h3.init({ bytes: wasmBytes, limits: { maxResultItems: "1" as never } })).rejects.toBeInstanceOf(
			TypeError
		)

		await expect(h3.init({ bytes: wasmBytes, limits: { nope: 1 } as never })).rejects.toBeInstanceOf(TypeError)
	})
})

describe("state transitions", () => {
	test("concurrent calls with the same source share one promise and one instance", async () => {
		const h3 = await fresh()
		const module = new WebAssembly.Module(wasmBytes)
		const a = h3.init({ module })
		const b = h3.init({ module, limits: {} })
		expect(b).toBe(a)
		await a
		expect(instantiate).toHaveBeenCalledTimes(1)
		expect(h3.isValidCell("8001fffffffffff")).toBe(true)
	})

	test("repeat init after success resolves without reinstantiating; different source or limits reject", async () => {
		const h3 = await fresh()
		const module = new WebAssembly.Module(wasmBytes)
		await h3.init({ module })
		await h3.init({ module })
		expect(instantiate).toHaveBeenCalledTimes(1)

		await expect(h3.init({ module: new WebAssembly.Module(wasmBytes) })).rejects.toMatchObject({
			name: "H3InitializationError",
		})

		await expect(h3.init({ module, limits: { maxResultItems: 5 } })).rejects.toMatchObject({
			name: "H3InitializationError",
		})

		expect(h3.isValidCell("8001fffffffffff")).toBe(true)
	})

	test("a different source while pending rejects without cancelling the pending attempt", async () => {
		const h3 = await fresh()
		const pending = h3.init({ bytes: wasmBytes })

		await expect(h3.init({ module: new WebAssembly.Module(wasmBytes) })).rejects.toMatchObject({
			name: "H3InitializationError",
		})

		expect(() => h3.isValidCell("8001fffffffffff")).toThrow(expect.objectContaining({ name: "H3InitializationError" }))
		await pending
		expect(h3.isValidCell("8001fffffffffff")).toBe(true)
	})

	test("failure rejects every waiter with the cause, resets, and allows retry", async () => {
		const h3 = await fresh()
		const bad = new Uint8Array([0, 1, 2, 3])
		const a = h3.init({ bytes: bad })
		const b = h3.init({ bytes: bad })
		expect(b).toBe(a)
		const error = await a.catch((error_: unknown) => error_)
		expect(error).toMatchObject({ name: "H3InitializationError" })
		expect((error as Error).cause).toBeInstanceOf(WebAssembly.CompileError)
		await expect(b).rejects.toBe(error)
		expect(() => h3.isValidCell("8001fffffffffff")).toThrow(expect.objectContaining({ name: "H3InitializationError" }))
		await h3.init({ bytes: wasmBytes })
		expect(h3.isValidCell("8001fffffffffff")).toBe(true)
	})

	test("bytes are copied before the first asynchronous gap", async () => {
		const h3 = await fresh()
		const bytes = new Uint8Array(wasmBytes)
		const p = h3.init({ bytes })
		bytes.fill(0)
		await p
		expect(h3.latLngToCell(37.3615593, -122.0553238, 7)).toBe("87283472bffffff")
	})

	test("after init all computation is synchronous", async () => {
		const h3 = await fresh()
		await h3.init({ bytes: wasmBytes })
		const r = h3.latLngToCell(37.3615593, -122.0553238, 7)
		expect(typeof r).toBe("string")
		expect(r).toBe("87283472bffffff")
	})

	test("a WebAssembly trap poisons the instance (simulated through the runtime hook)", async () => {
		const h3 = await fresh()
		await h3.init({ bytes: wasmBytes })
		const state = await import("../../lib/runtime/state.ts")
		const trap = new WebAssembly.RuntimeError("unreachable")
		const converted = state.trapped(trap) as Error
		expect(converted.name).toBe("H3RuntimeError")
		expect(converted.cause).toBe(trap)
		expect(state.stateKind()).toBe("poisoned")
		expect(() => h3.isValidCell("8001fffffffffff")).toThrow(expect.objectContaining({ name: "H3RuntimeError" }))
		await expect(h3.init({ bytes: wasmBytes })).rejects.toMatchObject({ name: "H3RuntimeError" })
	})
})
