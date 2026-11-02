/**
 * @license MIT
 * @author Teffen Ellis, et al.
 * @copyright Sister Software
 *
 * Oxlint configuration.
 */

import { createOxlintConfig, DefaultIgnorePatterns } from "@sister.software/oxlint-config"

export default createOxlintConfig({
	copyrightHolder: "Sister Software",
	spdxLicenseIdentifier: "MIT",
	ignorePatterns: [
		...DefaultIgnorePatterns,
		".claude/**/*",
		// Generated, committed artifacts are checked byte-for-byte by `yarn check:wasm-artifact`.
		"lib/generated/**/*",
		"target/**/*",
		"crates/**/*",
		"wasm/**/*",
		"scratchpad/**/*",
	],
})
