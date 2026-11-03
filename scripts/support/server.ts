/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { existsSync, readFileSync, statSync } from "node:fs"
import { createServer, type Server } from "node:http"
import { extname, join, sep } from "node:path"

export function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer()
		server.once("error", reject)

		server.listen(0, "127.0.0.1", () => {
			const address = server.address()

			if (!address || typeof address === "string") {
				server.close()
				reject(new Error("Missing server address"))

				return
			}

			server.close((error) => (error ? reject(error) : resolve(address.port)))
		})
	})
}

export function closeServer(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()))
	})
}

const MIME: Record<string, string> = {
	".html": "text/html",
	".js": "text/javascript",
	".mjs": "text/javascript",
	".wasm": "application/wasm",
	".json": "application/json",
}

export function serve(dir: string): Promise<{ server: Server; url: string }> {
	return new Promise((resolveServe, reject) => {
		const server = createServer((req, res) => {
			const path = join(dir, decodeURIComponent(new URL(req.url!, "http://x").pathname))

			if (path !== dir && !path.startsWith(dir + sep)) {
				res.writeHead(404).end()

				return
			}

			if (!existsSync(path) || statSync(path).isDirectory()) {
				const index = join(path, "index.html")

				if (existsSync(index)) {
					res.writeHead(200, { "content-type": "text/html" }).end(readFileSync(index))

					return
				}

				res.writeHead(404).end()

				return
			}

			res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" }).end(readFileSync(path))
		})

		server.once("error", reject)

		server.listen(0, "127.0.0.1", () => {
			const address = server.address() as { port: number }
			resolveServe({ server, url: `http://127.0.0.1:${address.port}/` })
		})
	})
}
