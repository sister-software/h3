/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { createServer } from "node:http"

const server = createServer((_request, response) => response.end("ready"))
server.listen(Number(process.argv[2]), "127.0.0.1")
process.once("SIGTERM", () => server.close())
