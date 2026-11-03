# Supervisor summary — 2026-11-03

- ✅ supervisor (main): fixed parseAmount rounding (4.35 stored as 434 cents) and splitEvenly leftover cents (first people in split pay 1 cent more); added POST /groups/:id/import in lib/import.mjs, route, README section and table row. Reviewer: 8/10 pass.
- ✅ testing: tests for both fixes and every import spec line (test/amounts.test.mjs, test/import-checks.test.mjs, test/import-success.test.mjs, ledger/validate updates). npm test 87/87. Quality 8/10.

Notes: stored records are left untouched (no migration); old expenses stored in truncated cents keep their stored value.
Next steps (optional): share test fixtures across import test files; the import handler could share expense/payment field parsing with lib/expenses.mjs.
