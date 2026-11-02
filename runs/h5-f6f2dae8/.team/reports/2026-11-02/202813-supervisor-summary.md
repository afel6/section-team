# Supervisor summary — 2026-11-02

- ✅ supervisor (own code): fixed parseAmount (Math.round instead of Math.trunc: 4.35 stayed 434 cents) and splitEvenly (leftover cents go to the first people in split, so shares add up); added POST /groups/:id/import in lib/import.mjs plus its route; documented it in README. Reviewer: 7/10 fail (no tests yet; long handler) → after fix round 1: 9/10 pass.
- ✅ testing: tests for both bug fixes and the import endpoint (test/import.test.mjs plus additions to api/ledger/validate tests); npm test 69/69 pass. Quality 8/10.

Decisions: 413 and the "not a JSON object" 400 come before the 404 for an unknown group, because the spec says "after that". Records already in the data file are not migrated.

Next steps (optional): rename sortEntries/check in lib/import.mjs; share the "must be a member" messages with lib/expenses.mjs; split test/import.test.mjs (about 445 lines).
