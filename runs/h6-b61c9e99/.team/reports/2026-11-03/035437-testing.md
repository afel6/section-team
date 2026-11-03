## REPORT · testing · 2026-11-03 04:10
Status:       done
Job:          node:test suite for jsonpatch.mjs and jsonpatch-cli.mjs covering the full spec, with npm test passing
Changed:      /root/bench-runs/h6-b61c9e99/test/pointer.test.mjs, test/patch-form.test.mjs, test/patch-ops.test.mjs, test/patch-copy.test.mjs, test/cli.test.mjs, test/cli-read.test.mjs, test/helpers/cli-runner.mjs, test/helpers/patch-assert.mjs; package.json (one line: test script); .team/notes/decisions.md
Tests:        npm test: 249 tests, 248 pass, 0 fail, 1 todo (directory-on-stdin CLI bug); 20 of 20 wrong versions caught
Quality:      8/10 (reviewer, 0 fix rounds; suggested fixes applied after the pass)
Coordination: main: CLI bug in readStdin (jsonpatch-cli.mjs:59-79) reported with a todo test; package.json test script fixed for Node 22
Helpers used: sonnet ×5 (4 test writers, 1 fix pass), opus ×1 (reviewer)
Problems:     `npm test` in package.json was broken on Node 22 (fixed). Directory-on-stdin CLI bug still open. EACCES "cannot read" can't be tested as root. A scratch wrong-version run once hung; I restored jsonpatch-cli.mjs by hand and checked it.
Next:         main: make readStdin report `Error: stdin: cannot read` (exit 1) when stdin is a directory, e.g. by checking whether fd 0 is a directory or reading it with fs; then remove the `todo` in test/cli-read.test.mjs
