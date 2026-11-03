# Supervisor summary — 2026-11-03

- ✅ supervisor: fixed amount rounding (`lib/validate.mjs`, Math.round instead of Math.trunc), leftover cents in splits (`lib/ledger.mjs`), added `POST /groups/:id/import` (`lib/import.mjs`, `lib/routes.mjs`), README docs, regression tests. Reviewer: 7/10 fail → 9/10 pass after 1 fix round.
- ✅ testing: `test/import.test.mjs` (33 tests over HTTP); no bugs found. Quality 8/10.

npm test: 76/76 pass.

Next steps (optional): assert full bodies in a few status-only import tests; shared test helpers; make `brokenRule` read-only.
Note: invalid JSON / >10 KB bodies get 400/413 before the 404 for an unknown group, as on every route (the spec lists those first).
