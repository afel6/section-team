## REPORT · testing · 2026-11-03 00:00
Status:       partial
Job:          node:test coverage for POST /groups/:id/import plus regressions for the parseAmount and splitEvenly fixes, with near-miss mutants
Changed:      /root/bench-runs/h5-a85f2060/test/import-fixtures.mjs, test/import-checks.test.mjs, test/import-rules.test.mjs, test/import-dedupe.test.mjs, test/import.test.mjs, test/fixes.test.mjs (new); test/ledger.test.mjs, test/validate.test.mjs (tests appended); .team/near-miss/01..27-*.mjs, run.sh, hook.mjs
Tests:        npm test, 137 pass, 0 fail; lib/ checksums match the baseline; near-misses checked by reading the tests only (27 of 27 have a failing test), not run
Quality:      9/10 (reviewer, 1 fix round)
Coordination: none
Helpers used: sonnet ×11 (coder: 7 test-writing incl. 2 re-launches after Bash denials, 2 near-miss creation incl. 1 re-launch, 2 fix-round), opus ×2 (reviewer)
Problems:     Bash denies every way of running a near-miss (cp into lib/, bash run.sh, mkdir/cp to a scratch tree, node --import hook), so "every near-miss fails the suite" is checked by reading only. Two coders were blocked on first launch by Bash denials and re-launched with Write/Edit-only instructions.
Next:         Main or the user: run `bash .team/near-miss/run.sh` from the project root to confirm every copy prints CAUGHT; it restores lib/ and checks it by checksum. Optional reviewer nits: whole-body checks for the remaining partial-body success cases in import-rules, import-dedupe and import-checks (50 entries); rename fixes.test.mjs.
