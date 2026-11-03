## REPORT · testing · 2026-11-03 12:00
Status:       done
Job:          node:test suites for the jsonpatch library + CLI, 28 near-miss copies all failing them, reviewer gate
Changed:      /root/bench-runs/h6-8780f14c/test/helpers.mjs, test/pointer.test.mjs, test/form.test.mjs, test/ops.test.mjs, test/apply-failures.test.mjs, test/cli-input.test.mjs, test/cli-output.test.mjs; .team/near-miss/1..28-*.mjs; .team/scratch/make-near-miss.mjs, .team/scratch/run-near-miss.mjs; .team/notes/decisions.md
Tests:        node --test test/*.test.mjs: 519 tests, 517 pass, 0 fail, 2 skipped (chmod 000 as root); all 28 near-miss copies fail it; originals unchanged (sha256 3620b641… / 80e8f81c…); `npm test` fails on Node 22 because of the package.json script
Quality:      9/10 (reviewer, 0 fix rounds; quick fixes applied after the pass)
Coordination: none (no awake builders); real problem reported to supervisor here: package.json test script fails on Node 22
Helpers used: sonnet ×3 (coder: pointer/form, ops/failures, CLI tests), opus ×1 (reviewer)
Problems:     package.json:12 `"test": "node --test test/"` fails on Node v22.23.4 (`Cannot find module '/root/bench-runs/h6-8780f14c/test'`), which breaks the spec's "test" script requirement; not fixed (supervisor's file). The shell would not let me overwrite the originals, so near-miss copies ran in a mirror folder instead (logged in decisions.md).
Next:         Supervisor: change the test script to `node --test test/*.test.mjs` (or `node --test`)
