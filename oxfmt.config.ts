/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 *
 * Oxfmt configuration.
 */

import { sisterSoftwareOxfmtConfig } from "@sister.software/oxfmt-config"
import type { OxfmtConfig } from "oxfmt"

const config: OxfmtConfig = {
	...sisterSoftwareOxfmtConfig,
	ignorePatterns: [".yarn", "lib/generated", "target", "crates", "wasm", "scratchpad", "out", "test/fixtures"],
}

export default config
