# Supervisor summary — 2026-11-02

Single-area backend task, built by the supervisor (no sections woken).

- ✅ supervisor: fixed `parseAmount` (Math.round instead of Math.trunc: 4.35 stayed 434 cents) and `splitEvenly` (leftover cents go to the first people in `split`, so shares and balances add up); added `POST /groups/:id/import` in `lib/import.mjs` with route, 20 HTTP tests, regression tests for both bugs, README docs. Reviewer grade 9/10 (pass).
- Saved records are not migrated: an old 434-cent expense still shows 4.34 (tested).
- `npm test`: 65 pass, 0 fail.

Optional next step (reviewer): move the try/catch around `parseEntry` in `sortEntries` into a helper.
