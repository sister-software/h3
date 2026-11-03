/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { join } from "node:path"

import { expect, test } from "vitest"

import { root } from "../../scripts/support/paths.ts"
import { startService } from "../../scripts/support/process.ts"
import { freePort } from "../../scripts/support/server.ts"

test("closing a ready service releases its listener", async () => {
	const port = await freePort()
	const url = `http://127.0.0.1:${port}`
	const service = startService(process.execPath, [join(root, "test/tools/fixtures/service.ts"), String(port)], root)

	try {
		await service.ready(url, 5000)
		expect(await (await fetch(url)).text()).toBe("ready")
	} finally {
		await service.close()
	}

	await expect(fetch(url)).rejects.toThrow("fetch failed")
})

test("a process that exits before readiness fails without waiting for the deadline", async () => {
	const port = await freePort()
	const service = startService(process.execPath, ["--eval", "process.exit(7)"], root)

	try {
		await expect(service.ready(`http://127.0.0.1:${port}`, 5000)).rejects.toThrow("Service exited before readiness")
	} finally {
		await service.close()
	}
}, 3000)
