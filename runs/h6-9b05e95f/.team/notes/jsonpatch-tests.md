# jsonpatch test suite layout (owner: testing)

Run: `node --test 'test/*.test.mjs'` (the package.json `node --test test/` form fails on Node 22).

- test/helpers.mjs: assertExact (key order, prototype, -0), assertPatchError (exact message and index), j, assertNoSharing
- test/pointer.test.mjs: parsePointer
- test/patch-form.test.mjs: non-array patch, form rules and their order, holes, own vs inherited, non-enumerable members
- test/patch-ops.test.mjs: each op, array index rules, failures while applying, test equality
- test/patch-integrity.test.mjs: deep copy, no shared refs, -0, inputs never mutated, 1000-deep values
- test/cli-helpers.mjs: run (spawnSync), runAsync (stdin held open), tempDir, assertFailure/assertSuccess
- test/cli-io.test.mjs, test/cli-errors.test.mjs: CLI success, BOM, output format, usage, read/decode/parse/depth/apply errors, step order

Near-miss check: `node .team/near-miss/run-near-miss.mjs [prefixes]` swaps each NN-*.mjs mutant into the root,
runs the suite, always restores, and verifies sha256 of the originals. 44 mutants, all killed (2026-11-03).
Known todo test: directory as stdin (CLI bug, see decisions.md).
