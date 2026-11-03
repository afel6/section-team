# Supervisor summary — 2026-11-03

Task: fix the two reported bugs and add `POST /groups/:id/import` (single-area work: built by main, tests by the testing section).

- ✅ main (supervisor): fixed `parseAmount` to round instead of truncate (4.35 had been stored as 434 cents). Fixed `splitEvenly` so the leftover cents go to the first people in `split`. Added `lib/import.mjs`, its route and the README section. Reviewer gate passed at 9/10; its three readability tweaks were applied after the testing section finished.
- ⚠ testing: added 6 test files and extended 2 existing ones; `npm test` passes 137 of 137. Reviewer grade 9/10. It wrote 27 near-miss copies, but running them against the suite was blocked by Bash permissions, for it and for main. By reading the tests, each copy has a test that should fail for it; this was never confirmed by running.
- ❌ security: failed twice at startup. Its definition runs `git diff origin/HEAD...`, and this repo has no remote. Main checked the security points by hand instead: `__proto__` and inherited keys, type confusion, entry and body size limits, and no writes on failed, dry-run or all-skipped imports. No issues found.

Next steps:
- Run `bash .team/near-miss/run.sh` to confirm every near-miss copy prints CAUGHT. It restores lib/ and checks it by checksum.
- Fix the security section's startup command so it works in repos without an `origin` remote.
- Optional nits from the testing reviewer: compare whole reply bodies in the remaining partial-body success tests, and rename `test/fixes.test.mjs`.
