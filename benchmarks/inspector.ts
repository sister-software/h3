/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

export interface HeapUsage {
	usedSize: number
	totalSize: number
	backingStorageSize: number
}

/**
 * Owns a workerd inspector connection and the listeners and timers for its requests.
 */
export async function connectInspector(url: string) {
	// Node's WebSocket accepts undici headers, which the DOM constructor type does not describe.
	const InspectorSocket = WebSocket as typeof WebSocket & {
		new (url: string, options: { headers: Record<string, string> }): WebSocket
	}

	const socket = new InspectorSocket(url, { headers: { Origin: "https://devtools.devprod.cloudflare.dev" } })

	try {
		await new Promise<void>((resolve, reject) => {
			const cleanup = () => {
				clearTimeout(timer)
				socket.removeEventListener("open", opened)
				socket.removeEventListener("close", closed)
				socket.removeEventListener("error", closed)
			}

			const opened = () => {
				cleanup()
				resolve()
			}

			const closed = () => {
				cleanup()
				reject(new Error("Inspector connection failed"))
			}

			const timer = setTimeout(() => {
				cleanup()
				reject(new Error("Inspector connection timed out"))
			}, 10_000)

			socket.addEventListener("open", opened)
			socket.addEventListener("close", closed)
			socket.addEventListener("error", closed)
		})
	} catch (error) {
		socket.close()
		throw error
	}

	let nextId = 0

	return {
		collectGarbage(): void {
			socket.send(JSON.stringify({ id: ++nextId, method: "HeapProfiler.collectGarbage" }))
		},
		heapUsage(): Promise<HeapUsage> {
			const id = ++nextId

			return new Promise((resolve, reject) => {
				const cleanup = () => {
					clearTimeout(timer)
					socket.removeEventListener("message", message)
					socket.removeEventListener("close", closed)
					socket.removeEventListener("error", closed)
				}

				const closed = () => {
					cleanup()
					reject(new Error("Inspector closed during request"))
				}

				const message = (event: MessageEvent) => {
					const response = JSON.parse(String(event.data)) as {
						id?: number
						result?: HeapUsage
						error?: { message: string }
					}

					if (response.id !== id) return
					cleanup()

					if (response.error) {
						reject(new Error(response.error.message))
					} else if (response.result) {
						resolve(response.result)
					} else {
						reject(new Error("Inspector returned no heap usage"))
					}
				}

				const timer = setTimeout(() => {
					cleanup()
					reject(new Error("Inspector heap request timed out"))
				}, 15_000)

				socket.addEventListener("message", message)
				socket.addEventListener("close", closed)
				socket.addEventListener("error", closed)

				try {
					socket.send(JSON.stringify({ id, method: "Runtime.getHeapUsage" }))
				} catch (error) {
					cleanup()
					reject(error)
				}
			})
		},
		close(): void {
			socket.close()
		},
	}
}
