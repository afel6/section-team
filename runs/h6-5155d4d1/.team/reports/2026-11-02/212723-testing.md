## REPORT · testing · 2026-11-02 21:45
Status:       done
Job:          Write the node:test suite for jsonpatch.mjs and jsonpatch-cli.mjs, check it against at least 8 near-miss copies, and pass the Max reviewer gate.
Changed:      Tests in /root/bench-runs/h6-5155d4d1/test/: `pointer.test.mjs`, `patch-form.test.mjs`, `patch-ops.test.mjs`, `patch-test-op.test.mjs`, `patch-purity.test.mjs`, `cli-basic.test.mjs`, `cli-input.test.mjs`, `cli-order.test.mjs`, plus `helpers/assert-patch-error.mjs` and `helpers/cli-runner.mjs`. Near-miss copies `1-…` to `31-…` in /root/bench-runs/h6-5155d4d1/.team/near-miss/. I added `.team/notes/decisions.md`. jsonpatch.mjs and jsonpatch-cli.mjs are unchanged: their sha256 matches the start (4a7c3cec…, 0549805d…).
Tests:        `npm test` runs 388 tests: 386 pass, 0 fail, 2 skipped. The skipped two are the chmod 000 file cases, which cannot fail when running as root. All 31 near-miss copies fail the suite, each with at least 1 failing test. They include every bug you listed, plus BOM not counted, lenient UTF-8, /dev/zero accepted via stat size, document opened before the patch is checked, ENOTDIR reported as `cannot read`, and others.
Quality:      9/10 (reviewer, 1 fix round). Max gate passed: overall 9, lowest item 7 (duplication), and no near-miss passes the tests.
Coordination: main: I reported that `"test": "node --test test/"` fails on Node 22 with MODULE_NOT_FOUND. You changed package.json to `node --test "test/**/*.test.mjs"`.
Helpers used: sonnet coder ×4 (3 wrote the test files, 1 applied the fix list); opus reviewer ×2 (grading)
Problems:     
- **Near-misses not swapped in place:** the permission system blocked copying a near-miss over the original files. Instead, each one ran in a temporary copy of the project with the near-miss in place, so the originals were never touched. The checksums match before and after. The tools are in /tmp/nm-tools/ (`gen.mjs`, `run.mjs`), and the choice is logged in decisions.md.
- **Coders could not run tests:** Bash was denied for them, so I ran every test myself.
- **One test fixed:** a pointer test I specified was wrong ("/~0~1" is the single token "~/", not two tokens). I fixed it.
- **Spec conflict:** a CLI argument containing a line break cannot be printed as given while keeping stderr to exactly one line. I left it untested and logged it in decisions.md.
Next:         Optional cleanup from the passing review: share the `fail`/`failOp` helpers between patch-ops and patch-test-op, remove about six duplicated tests in patch-form, and rename short local names in cli-basic. You also need to decide what the CLI does with an argument that contains a line break.
