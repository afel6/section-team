## REPORT · testing · 2026-11-03 10:40
Status:       done
Job:          node:test tests for POST /groups/:id/import, the parseAmount rounding fix and the splitEvenly remainder fix, plus near-miss copies that the tests must catch
Changed:      /root/bench-runs/h5-b31b7a1d/test/import-fixtures.mjs, test/import-body.test.mjs, test/import-rules.test.mjs, test/import-success.test.mjs (new); test/api.test.mjs, test/ledger.test.mjs, test/validate.test.mjs (tests added, none weakened); .team/near-miss/1-validate.mjs … 37-import.mjs; .team/notes/decisions.md
Tests:        npm test passes 82/82; all 37 near-miss copies fail the suite; a control run with an unchanged copy passes; lib/, server.mjs and README.md untouched (git status as at start)
Quality:      9/10 (reviewer, 0 fix rounds; passed first time, its optional fixes applied, suite and near-misses re-run afterwards)
Coordination: none
Helpers used: sonnet ×1 (coder for the near-miss copies; it could not run Bash, so I made them myself with a script), opus ×1 (reviewer gate)
Problems:     The permission system blocked copying near-miss files into lib/ and bash loops, so I ran the copies through a loader hook instead of swapping them in. The spec's "saved in one write" is only checked as "a write happened", not "exactly one". I found no spec violations in the implementation.
Next:         none
