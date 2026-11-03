# Supervisor summary — 2026-11-03

Small single-area task (backend), built by the supervisor; no sections woken.

- ✅ supervisor: fixed the two reported bugs and added `POST /groups/:id/import`, with tests and README docs. Reviewer grade 8/10 (pass). Fixed the one bug the reviewer found: an array `type` such as `["expense"]` was accepted. `npm test`: 60/60 pass.

Fixes:
- `lib/validate.mjs`: `parseAmount` rounded down instead of to the nearest cent (`Math.trunc` changed to `Math.round`), so 4.35 was stored as 434 cents.
- `lib/ledger.mjs`: `splitEvenly` now gives the left-over cents to the first people in `split`, as the README says, so balances add up to 0.
- Records already saved are not migrated.

Feature: `lib/import.mjs` (`importEntries`), routed in `lib/routes.mjs`; tests in `test/import.test.mjs`.

Next steps (optional): `planImport` parses a valid entry twice (once to check it, once to build it); this could be removed.
