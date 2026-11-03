# Build and verification

## Toolchain (pinned)

| Tool               | Version                                      | Pinned by                                      |
| ------------------ | -------------------------------------------- | ---------------------------------------------- |
| Rust               | 1.99.1, target `wasm32-unknown-unknown`      | `rust-toolchain.toml`                          |
| wasm-bindgen       | 0.2.130 (crate `=0.2.130`, CLI `0.2.130`)    | `Cargo.toml`, `scripts/build-wasm.ts`          |
| wasm-opt           | not used                                     | the correctness build is unoptimized by design |
| libm (crate)       | 0.2.16; the WASM build's math library        | `Cargo.lock`, recorded in the build manifest   |
| Node               | 24.22.1; supported `^24.22.1 \|\| >=26.12.1` | `.nvmrc`, `package.json` `engines`             |
| Yarn               | 4.18.1                                       | `packageManager`                               |
| esbuild            | 0.28.2                                       | `package.json` (exact)                         |
| webpack            | 5.111.1                                      | `package.json` (exact)                         |
| wrangler / workerd | 4.156.0 / 1.20261023.1                       | `package.json` (exact) / `yarn.lock`           |
| playwright-core    | 1.64.1 (Chromium revision 1248)              | `package.json` (exact)                         |

Install the wasm-bindgen CLI once:

```sh
cargo install wasm-bindgen-cli --version 0.2.130 --locked
```

`yarn build:wasm` checks both the Rust and wasm-bindgen versions and fails with these instructions
instead of installing anything.

## Building

```sh
yarn build:wasm            # wasm/h3.wasm, lib/generated/h3.{js,d.ts}, wasm/build-manifest.json
yarn check:wasm-artifact   # fresh build in a temporary directory, compared byte-for-byte
yarn compile               # TypeScript to out/
```

The WASM build is `cargo build --locked --release -p sister-h3-wasm --target wasm32-unknown-unknown`
with `--remap-path-prefix` for the checkout and Cargo home (so embedded panic locations do not
depend on the host path) and `-Cdebuginfo=0`, followed by `wasm-bindgen --target web
--omit-default-module-path`. `wasm/build-manifest.json` records the source-tree hash, rustc,
target, flags, wasm-bindgen version, lockfile hash, and each output's SHA-256 and size.

The committed artifacts are `wasm/h3.wasm`, `lib/generated/h3.js`, `lib/generated/h3.d.ts`, and
`wasm/build-manifest.json`. The generated glue is private; only `lib/runtime/state.ts` imports it.
TypeScript carries it to `out/lib/generated/` with `allowJs`, so source and packed import paths
are identical.

Release build environment: Linux x86-64 (Ubuntu 24.04, kernel 6.8). Reproducibility has been
confirmed across target directories on this host; cross-host byte identity is not yet established
(see `docs/implementation-status.md`).

## C reference fixtures

Normal builds and tests consume committed fixtures (`crates/h3-core/tests/fixtures/*.jsonl`) and
never need C. Regenerating them requires an explicit H3 C checkout at the pinned revision:

```sh
H3_C_SOURCE=/path/to/h3 yarn generate:fixtures
```

Every C compile uses `-ffp-contract=off`, so the reference does not depend on whether the host
compiler fuses multiply-adds. clang on arm64 does so by default, which changed last bits on Apple
Silicon. The fixtures are bit-exact for linux x86-64 glibc. On other hosts, regenerated fixtures
differ in floating-point last bits only (see `docs/api-decisions.md`, "Comparison rules"), so
commit fixtures regenerated on that platform only.

The script verifies `git rev-parse HEAD` equals `24946ad1c5e9016a6eab96d4f9ee4d0c993720e5` and
`VERSION` is `4.5.0`, then builds C out of tree in `target/reference/h3-c`, runs CTest, compiles the
test-only runner (`test/reference/runner.c`) and the table generator (`scripts/tables/gen_tables.c`),
regenerates `crates/h3-core/src/tables/generated.rs`, and writes fixtures plus
`test/fixtures/provenance.json`.

CMake configuration differs from the original guide in one flag: **`-DBUILD_FILTERS=ON`** is required
at the pinned revision because `CMakeTests.cmake` registers CLI tests that reference the `h3_bin`
filter target; with `BUILD_FILTERS=OFF` CMake's generate step fails (`No target "h3_bin"`).

Reference environment used for the committed fixtures:

| Item     | Version                                                     |
| -------- | ----------------------------------------------------------- |
| CMake    | 3.28.3                                                      |
| C        | gcc 13.3.0 (Ubuntu 13.3.0-6ubuntu2~24.04.1), `-O3 -DNDEBUG` |
| Platform | Linux 6.8.0 x86-64                                          |
| CTest    | 325/325 passed                                              |

Prerequisites for fixture generation only: git, CMake ≥ 3.20, a C11 compiler, and libm.

## Runtime verification

`yarn test:runtimes` packs the tarball, installs it into fresh consumers under `target/runtime/`,
and runs the C-fixture probe in Node (bytes and module initialization, with WebAssembly call
instrumentation around import), an esbuild bundle under `--conditions=workerd,worker,browser`,
local `wrangler dev`, and Vite and webpack production builds in headless Chromium. Prerequisites:
the Playwright Chromium revision 1248 (`npx playwright-core install chromium` with
playwright-core 1.64.1) and the workerd binary installed by `wrangler` from npm.

### Observed workerd restrictions (wrangler 4.156.0, workerd 1.20261023.1)

Reproduced by the `/restrictions` route of the runtime Worker probe on 2026-11-02:

| Probe                                       | Result                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| `WebAssembly.compile(bytes)`                | `CompileError: WebAssembly.compile(): Wasm code generation disallowed by embedder` |
| `new Function("return 1")`                  | `EvalError: Code generation from strings disallowed for this context`              |
| indirect `eval("1")`                        | `EvalError: Code generation from strings disallowed for this context`              |
| `typeof globalThis.process`                 | defined (`"object"`)                                                               |
| `import.meta.url` in the bundled Worker     | `undefined`                                                                        |
| `init({ bytes })`                           | rejects with `H3InitializationError` (cause: the `CompileError` above)             |
| `init({ module })` with an imported `.wasm` | works                                                                              |

## Package verification

### Node support policy

Only Node LTS lines are supported, each from its latest security release: `engines.node` is
`^24.22.1 || >=26.12.1` (24 "Krypton" and 26 "Lithium", security releases of 2026-10-20 and
2026-10-21). When a line gets a security release, its floor moves to it. When a line reaches end of
life, its range is removed. Raising a floor or dropping a line is a breaking change for consumers,
so it ships in a minor version while the package is below 1.0. `test:package` reads the floors from
`package.json`, so the policy and the tested versions cannot drift apart.

`yarn test:package` packs the npm tarball, checks its file list (only `out/`, `wasm/h3.wasm`, the
README, license and notices), installs it into a fresh consumer, and runs the README example, the
export-map checks, and the C fixture probe under the floor of every `engines` range (24.22.1 and
26.12.1), the `.nvmrc` version, and the running Node when `engines` admits it. It also typechecks a TypeScript consumer against the shipped
declarations with `skipLibCheck: false`, and builds and tests the unpacked `cargo package` output
of `sister-h3` from a directory outside the repository.

Node binaries for the version matrix are looked up in `target/tools/node-v<version>-linux-x64/`
and then `~/.nvm/versions/node/`. Locally they were downloaded from nodejs.org into `target/tools`
with SHA-256 verification against `SHASUMS256.txt`; CI does the same for each floor that `.nvmrc`
does not already provide.

`cargo package` requires a committed tree; on an uncommitted working tree run it with
`--allow-dirty` (as `yarn test:package` does). CI runs it without that flag.

## Fixture checks

`yarn check:fixtures` validates every committed record against the schema and compares file
hashes and case counts with `test/fixtures/provenance.json` (which must equal the copy packaged
with the native crate), and requires the provenance to record a CTest run. It needs no C.

## Benchmarks

`yarn benchmark` writes `benchmarks/RESULTS.md` and `benchmarks/results/latest.json`. The native
comparison builds `crates/h3-core/examples/bench.rs` (not packaged) and, when
`target/reference/h3-c` exists (after `yarn generate:fixtures`), `benchmarks/c/bench.c` against the
pinned C library. `H3_BENCH_SAMPLES` sets the sample count (default 15).

## CI

`.github/workflows/test.yml` (job `test`) runs, in order: fixture checks, a check that
`package.json` and the `sister-h3` crate share a version, `cargo fmt --check`, `cargo clippy -D
warnings` (workspace, and `sister-h3` alone for the default math path), `cargo test -p sister-h3`
bit-exact (`H3_EXPECT_EXACT=1`) and again with `--features libm`, the WASM adapter's tests,
`cargo package`, `yarn check:wasm-artifact` (installs `wasm-bindgen-cli` 0.2.130 with
`--locked`), `yarn check:libm-wasm`, `yarn lint`, `yarn compile`, `yarn check-types`,
`yarn test --run`, `yarn test:package`, and `yarn test:runtimes` (after installing Playwright's
Chromium and Firefox). It never builds C. It never runs `cargo test --workspace`: feature
unification would enable `libm` for the core crate's tests through the WASM adapter.

The `native` job runs the core crate's parity suites with the platform libm and with `--features
libm` on macOS arm64 (macos-26), Linux arm64 glibc, Linux x86-64 musl, and Windows x86-64 MSVC, within the
documented bounds. Only `test` is a required check.

## Releases

One version ships to both registries, following the same two-phase flow as spliterator:

1. Dispatch `publish.yml` with `mode=prepare` and a version (`patch`, `minor`, an exact semver such
   as `0.2.0-rc.1`). It bumps `package.json`, the Cargo workspace version, and the `sister-h3`
   workspace dependency, then runs `cargo update --workspace`. It rebuilds the WASM artifacts
   (`wasm/h3.wasm`, `wasm/build-manifest.json`, `lib/generated/h3-embedded.js`), commits them on
   `release/v<version>`, and opens an auto-merging PR. The rebuild is required, not cosmetic: the
   crate version feeds rustc's symbol hashes, so the binary changes with every version. The PR's
   `test` run proves the rebuilt artifacts reproduce on a clean runner.
2. After the merge, dispatch `publish.yml` with `mode=publish`. It tags `v<version>`, creates the
   GitHub release, and publishes to npm with provenance through trusted publishing (OIDC).
   Prereleases go under the `next` dist-tag, everything else under `latest`. It then dispatches
   `publish-cargo.yml` against the tag.
3. `publish-cargo.yml` tests and packages `sister-h3` at the tag, then publishes it to crates.io in
   the `cargo` environment (`v*` tags only). It uses crates.io trusted publishing, or a
   `CARGO_REGISTRY_TOKEN` environment secret for the very first publish, because crates.io lets
   only an existing crate trust a workflow. `sister-h3-wasm` is never published.

Every step is idempotent: a tag, release, or version that already exists is skipped, so
re-dispatching is the recovery path.

## Private module imports and command arguments

The package `imports` map gives tooling stable names: `#benchmarks/*`, `#scripts/*`, and `#test/*`
resolve source roles, while `#*` resolves compiled library modules. `#diagnostics` describes the
internal state module using its source types and loads the same compiled module as the public API.
`#worker` selects the compiled workerd entry. These private maps do not add public package subpaths.

Node probes import the package by name and remain in their source location, so module resolution and
TypeScript inference agree. The workerd probe is prebuilt with an external runtime module and runs
without Wrangler rebundling; its dynamic import still occurs only in the measured import stage.

Command entry points use `node:util` `parseArgs`. Use named options such as `yarn benchmark --samples 15`,
`yarn stress:boundary --samples 2000`, and `yarn check:wasm-artifact` (which passes `--check`).
