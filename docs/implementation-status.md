# Compatibility and verification

The implementation follows H3 C at revision `24946ad1c5e9016a6eab96d4f9ee4d0c993720e5`.
Committed reference fixtures retain their generator and source provenance in `test/fixtures/provenance.json`.

## Algorithm comparisons

The native parity suites exercise index validation, coordinates, hierarchy, traversal, directed edges,
vertices, measurements, polygon coverage, and cell-set outlines. Comparisons preserve C error codes,
integer results, and output-buffer order, including unused slots where the raw API exposes them.

Default native math is compared bit for bit on the Linux x86-64 glibc reference platform.
Other native platforms and the portable `libm` feature use the comparison bounds documented in
[API decisions](api-decisions.md#comparison-rules). The portable native build and WebAssembly
are also compared directly by `yarn check:libm-wasm`.

## JavaScript and installed packages

The JavaScript tests exercise argument validation, initialization, resource limits, and migration behavior.
`test/api-manifest.json` records the public export inventory and links to its comparison cases.
Its status labels are metadata; the tests execute the comparisons independently.

`yarn test:runtimes` installs a packed tarball into separate consumers and tests Node, workerd,
and Vite and webpack production builds in Chromium and Firefox. WebKit is included on macOS.
A missing browser is reported as not run and makes the command fail.

`yarn test:package` checks the tarball contents, export map, declarations, supported Node version floors,
and an external consumer of the packaged Rust crate.

## Running verification

[Build instructions](build.md) describe prerequisites and the CI commands.
[Benchmark instructions](../benchmarks/README.md) describe measurement methods and output validation.
The [2026-11-02 verification record](history/2026-11-02-verification.md) preserves earlier command results;
it is a historical record rather than a report for the current checkout.
