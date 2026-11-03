/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 */

import { resolve, join } from "node:path"

export const root = resolve(import.meta.dirname, "../..")
export const bin = (name: string) => join(root, "node_modules/.bin", name)
