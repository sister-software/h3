/**
 * Initialization (docs/api-decisions.md, "Initialization"): implicit synchronous instantiation on first use, and the
 * optional explicit `init`. Every test imports a fresh module graph so state never leaks between tests.
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
const CELL = "87283472bffffff"

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
 * Plausible arguments so each function reaches its WASM call.
 */
const DUMMY: unknown[] = ["8001fffffffffff", 1, 1, 1]

const OriginalInstance = WebAssembly.Instance
let instances = 0

beforeEach(() => {
	instances = 0

	WebAssembly.Instance = new Proxy(OriginalInstance, {
		construct(target, args, newTarget) {
			instances++

			return Reflect.construct(target, args, newTarget)
		},
	})
})

afterEach(() => {
	WebAssembly.Instance = OriginalInstance
})

function thrown(fn: () => unknown): Error | undefined {
	try {
		fn()
	} catch (error) {
		return error as Error
	}

	return undefined
}

describe("implicit initialization on first use", () => {
	test("the pure exports are exactly the documented six (plus init)", () => {
		const pure = manifest.entries.filter((e) => !e.usesWasm).map((e) => e.name)
		expect(pure.toSorted()).toEqual(PURE.toSorted())
	})

	test("importing compiles and instantiates nothing", async () => {
		await fresh()
		expect(instances).toBe(0)
	})

	test("every export works without calling init, with exactly one instance", async () => {
		const h3 = await fresh()
		expect(h3.latLngToCell(37.3615593, -122.0553238, 7)).toBe(CELL)

		for (const entry of manifest.entries.filter((e) => e.usesWasm)) {
			const fn = (h3 as unknown as Record<string, (...a: unknown[]) => unknown>)[entry.name]!
			expect(typeof fn, entry.name).toBe("function")
			// Dummy arguments may be rejected, but never for lack of initialization.
			expect(thrown(() => fn(...DUMMY))?.name, entry.name).not.toBe("H3InitializationError")
		}

		expect(instances).toBe(1)
	})

	test("pure exports never instantiate", async () => {
		const h3 = await fresh()
		expect(h3.UNITS.km).toBe("km")
		expect(h3.POLYGON_TO_CELLS_FLAGS.containmentFull).toBe("containmentFull")
		expect(h3.h3IndexToSplitLong(CELL)).toEqual([0x2b_ff_ff_ff, 0x8_72_83_47])
		expect(h3.splitLongToH3Index(0x2b_ff_ff_ff, 0x8_72_83_47)).toBe(CELL)
		expect(h3.degsToRads(180)).toBe(Math.PI)
		expect(h3.radsToDegs(Math.PI)).toBe(180)
		expect(instances).toBe(0)
	})

	test("a failed first-use instantiation explains itself and can be retried", async () => {
		const h3 = await fresh()
		const state = await import("../../lib/runtime/state.ts")
		state.setDefaultSource(() => new Uint8Array([0, 1, 2, 3]))
		const error = thrown(() => h3.isValidCell(CELL))
		expect(error?.name).toBe("H3InitializationError")
		expect(error?.message).toMatch(/init\(\{ module \}\)/)
		expect(error?.cause).toBeInstanceOf(WebAssembly.CompileError)
		expect(state.stateKind()).toBe("uninitialized")
		state.setDefaultSource(() => new Uint8Array(wasmBytes))
		expect(h3.isValidCell(CELL)).toBe(true)
	})
})

describe("init arguments", () => {
	test("accepts no source, or exactly one source of the right type", async () => {
		const h3 = await fresh()
		await expect(h3.init(null as never)).rejects.toBeInstanceOf(TypeError)

		await expect(
			h3.init({ bytes: wasmBytes, module: new WebAssembly.Module(wasmBytes) } as never)
		).rejects.toBeInstanceOf(TypeError)

		await expect(h3.init({ module: wasmBytes } as never)).rejects.toBeInstanceOf(TypeError)
		await expect(h3.init({ bytes: "x" } as never)).rejects.toBeInstanceOf(TypeError)
		await h3.init()
		await h3.init({})
		expect(instances).toBe(1)
	})

	test("validates limits", async () => {
		const h3 = await fresh()
		await expect(h3.init({ limits: { maxResultItems: -1 } })).rejects.toBeInstanceOf(RangeError)
		await expect(h3.init({ limits: { maxResultItems: 1.5 } })).rejects.toBeInstanceOf(RangeError)
		await expect(h3.init({ limits: { maxResultItems: "1" as never } })).rejects.toBeInstanceOf(TypeError)
		await expect(h3.init({ limits: { nope: 1 } as never })).rejects.toBeInstanceOf(TypeError)
	})
})

describe("explicit initialization", () => {
	test("limits passed before first use apply", async () => {
		const h3 = await fresh()
		await h3.init({ limits: { maxResultItems: 6 } })
		expect(thrown(() => h3.gridDisk(CELL, 1))?.name).toBe("H3ResourceLimitError")
	})

	test("after first use, init with the same limits resolves and different limits reject", async () => {
		const h3 = await fresh()
		expect(h3.isValidCell(CELL)).toBe(true)
		await h3.init()
		await h3.init({ bytes: wasmBytes })
		await h3.init({ module: new WebAssembly.Module(wasmBytes) })
		expect(instances).toBe(1)

		await expect(h3.init({ limits: { maxResultItems: 5 } })).rejects.toMatchObject({
			name: "H3InitializationError",
			message: expect.stringMatching(/before the first H3 call/),
		})
	})

	test("concurrent calls with the same source share one promise and one instance", async () => {
		const h3 = await fresh()
		const module = new WebAssembly.Module(wasmBytes)
		const a = h3.init({ module })
		const b = h3.init({ module, limits: {} })
		expect(b).toBe(a)
		await a
		expect(instances).toBe(1)
		expect(h3.isValidCell(CELL)).toBe(true)
	})

	test("after an explicit source, a different explicit source or different limits reject", async () => {
		const h3 = await fresh()
		const module = new WebAssembly.Module(wasmBytes)
		await h3.init({ module })
		await h3.init({ module })
		expect(instances).toBe(1)

		await expect(h3.init({ module: new WebAssembly.Module(wasmBytes) })).rejects.toMatchObject({
			name: "H3InitializationError",
		})

		await expect(h3.init({ module, limits: { maxResultItems: 5 } })).rejects.toMatchObject({
			name: "H3InitializationError",
		})

		expect(h3.isValidCell(CELL)).toBe(true)
	})

	test("calls while an explicit init is pending throw; a different source rejects without cancelling it", async () => {
		const h3 = await fresh()
		const pending = h3.init({ bytes: wasmBytes })

		await expect(h3.init({ module: new WebAssembly.Module(wasmBytes) })).rejects.toMatchObject({
			name: "H3InitializationError",
		})

		expect(thrown(() => h3.isValidCell(CELL))?.name).toBe("H3InitializationError")
		await pending
		expect(h3.isValidCell(CELL)).toBe(true)
		expect(instances).toBe(1)
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
		// Back to uninitialized: the next call falls back to the package's own binary.
		expect(h3.isValidCell(CELL)).toBe(true)
	})

	test("bytes are copied before the first asynchronous gap", async () => {
		const h3 = await fresh()
		const bytes = new Uint8Array(wasmBytes)
		const p = h3.init({ bytes })
		bytes.fill(0)
		await p
		expect(h3.latLngToCell(37.3615593, -122.0553238, 7)).toBe(CELL)
	})

	test("a WebAssembly trap poisons the instance (simulated through the runtime hook)", async () => {
		const h3 = await fresh()
		expect(h3.isValidCell(CELL)).toBe(true)
		const state = await import("../../lib/runtime/state.ts")
		const trap = new WebAssembly.RuntimeError("unreachable")
		const converted = state.trapped(trap) as Error
		expect(converted.name).toBe("H3RuntimeError")
		expect(converted.cause).toBe(trap)
		expect(state.stateKind()).toBe("poisoned")
		expect(thrown(() => h3.isValidCell(CELL))?.name).toBe("H3RuntimeError")
		await expect(h3.init()).rejects.toMatchObject({ name: "H3RuntimeError" })
	})
})
