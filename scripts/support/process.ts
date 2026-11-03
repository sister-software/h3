/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { execFileSync, spawn } from "node:child_process"
import { once } from "node:events"
import { setTimeout as delay } from "node:timers/promises"

import { root } from "./paths.ts"

export function run(command: string, args: string[], cwd = root, env = process.env): string {
	return execFileSync(command, args, {
		cwd,
		env,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		maxBuffer: 1 << 28,
	})
}

/**
 * Starts a service whose owner must close it after use, including when readiness fails.
 */
export function startService(command: string, args: string[], cwd: string, env = process.env) {
	const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] })
	let log = ""
	let failure: Error | undefined

	child.on("error", (error) => {
		failure = error
	})

	child.stdout.on("data", (data) => {
		log = (log + data).slice(-16_384)
	})

	child.stderr.on("data", (data) => {
		log = (log + data).slice(-16_384)
	})

	return {
		async ready(url: string, timeoutMs = 120_000): Promise<void> {
			const deadline = Date.now() + timeoutMs

			while (Date.now() < deadline) {
				if (failure) throw failure

				if (child.exitCode !== null || child.signalCode !== null)
					throw new Error(`Service exited before readiness: ${log}`)

				try {
					const remaining = Math.min(2000, Math.max(1, deadline - Date.now()))
					const response = await fetch(url, { signal: AbortSignal.timeout(remaining) })
					await response.arrayBuffer()

					if (response.ok) return
				} catch {
					/* The service may still be starting. */
				}

				await delay(250)
			}

			throw new Error(`Service did not become ready at ${url}: ${log}`)
		},
		async close(): Promise<void> {
			if (child.exitCode !== null || child.signalCode !== null || failure) return
			const exited = once(child, "exit")
			child.kill("SIGTERM")
			const timer = setTimeout(() => child.kill("SIGKILL"), 2000)

			try {
				await exited
			} finally {
				clearTimeout(timer)
			}
		},
	}
}
