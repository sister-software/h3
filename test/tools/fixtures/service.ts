/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { createServer } from "node:http"
import { parseArgs } from "node:util"

const server = createServer((_request, response) => response.end("ready"))

const {
	values: { port },
} = parseArgs({ options: { port: { type: "string" } } })

if (!port) throw new TypeError("port is required")
server.listen(Number(port), "127.0.0.1")
process.once("SIGTERM", () => server.close())
