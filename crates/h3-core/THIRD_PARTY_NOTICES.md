# Third-party notices

This project is licensed under the MIT License (`LICENSE`). As permitted by section 4 of the Apache
License 2.0, the translated H3 portions are distributed as part of this MIT-licensed work while
remaining subject to that license's conditions: its text is in `LICENSE-APACHE-2.0`, Uber's notices
are retained in `NOTICE`, and the changes made are described below.

This package is a source-informed translation, not a clean-room implementation. The sources it is
derived from, and how, are listed here. Each translated Rust module also names its C source files.

## H3 (C library)

- Repository: https://github.com/uber/h3
- Revision: `24946ad1c5e9016a6eab96d4f9ee4d0c993720e5` (`git describe`: `v4.5.0-67-g24946ad1`;
  `VERSION` file `4.5.0`)
- License: Apache License 2.0 (see `LICENSE-APACHE-2.0`); Copyright 2016-2026 Uber Technologies, Inc.
- Use: algorithms translated into Rust (`crates/h3-core/src`), from `src/h3lib/lib/{h3Index,baseCells,
  faceijk,latLng,vec2d,mathExtensions,iterators,algos,localij,directedEdge,vertex,area,bbox,polygon,
  polyfill,linkedGeo,cellsToMultiPoly}.c` and `src/h3lib/include/{constants,coordijk,vec3d,
  polygonAlgos,adder,cellsToMultiPoly}.h`.
- Tables: `crates/h3-core/src/tables/generated.rs` is generated from `baseCells.c`, `faceijk.c`, and
  `polyfill.c` by `scripts/tables/gen_tables.c`; other constants are copied from the C sources.
- Test data: `crates/h3-core/tests/fixtures/*.jsonl` are outputs of the pinned C library, produced
  by `test/reference/runner.c`; several polygon cases reuse vertex data from the C test programs in
  `src/apps/testapps/`.
- Changes: translated to Rust with typed errors and owned collections; pointer-linked structures
  replaced by index-based ones; recursion in the safe grid-disk algorithm replaced by an explicit
  stack with the same visiting order; string parsing restricted to hexadecimal digits.

## h3-js

- Repository: https://github.com/uber/h3-js, version 4.5.0
- License: Apache License 2.0; Copyright 2017-2021 Uber Technologies, Inc.
- Use: the JavaScript function names, argument order, and result shapes; the `UNITS` and
  `POLYGON_TO_CELLS_FLAGS` constants; portions of the README API reference text. No h3-js code is
  included in the package. h3-js is a development dependency used only by migration tests.

## h3o

- Repository: https://github.com/HydroniumLabs/h3o (version 0.11.0,
  `fa1557fd1edd56f64e4da95b2fd294609ce2353e`)
- License: BSD-3-Clause
- Use: consulted for Rust API design ideas only (typed index wrappers, fallible constructors). No
  h3o code is copied, vendored, or depended on.

## Runtime dependencies of the WASM adapter

- `wasm-bindgen` 0.2.130 (MIT OR Apache-2.0): generates the private JavaScript glue in
  `lib/generated/h3.js` and is linked into `wasm/h3.wasm`.
