## REPORT · testing · 2026-11-02 21:10
Status:       partial
Job:          node:test tests for the parseAmount and splitEvenly fixes and for POST /groups/:id/import, plus near-miss copies
Changed:      /root/bench-runs/h5-332e9761/test/import.test.mjs (new: 413/400/404 checks, 400 messages and their order, every 422 rule and its order, duplicate and already-recorded), /root/bench-runs/h5-332e9761/test/import-apply.test.mjs (new: ids, replies and data file match the POST routes, balances in member order, skip_recorded, all-skipped saves nothing, dry_run), /root/bench-runs/h5-332e9761/test/import-helpers.mjs (new shared fixtures, not a test file), /root/bench-runs/h5-332e9761/test/validate.test.mjs, test/ledger.test.mjs, test/api.test.mjs (regression tests: 4.35→435, 0.29→29, 1.15, every cent from 0.01 to 1000.00, 1000/3 → 334/333/333, Ann +6.66, sums are 0, 4.35 back exactly over HTTP), /root/bench-runs/h5-332e9761/.team/near-miss/01..26-import.mjs, 27..28-validate.mjs, 29..31-ledger.mjs, run.sh
Tests:        npm test: 70/70 pass. The 31 near-miss copies were not run (swap denied by permissions). The reviewer named a failing test for each one by reading it.
Quality:      9/10 (reviewer, 0 fix rounds; passed on the first grade, its optional fixes applied after)
Coordination: main: followed the refactor note and covered the extra unit cases it asked for (1000/3 split, parseAmount 4.35 and 0.29); no lib bug to report. Security: none needed.
Helpers used: sonnet ×2 (coder: first stopped with no Bash; second wrote the regression tests, near-miss copies and run.sh), opus ×1 (reviewer gate)
Problems:     Bash that copies near-miss files over lib/ or into a scratch copy was denied, so no copy was actually run and the job's "every near-miss fails" rule is only met by reasoning. The coder helpers had no Bash.
Next:         Run `bash .team/near-miss/run.sh` from the project root (or allow it for me); every copy should print CAUGHT, then LIB RESTORED.
