# Supervisor summary — 2026-11-02

Task: fix the two reported money bugs, add `POST /groups/:id/import`, document it.

- ✅ main (supervisor): fixed `parseAmount` (truncate → round, 4.35 was 434 cents) and `splitEvenly` (remainder cents to the first people in split, so balances sum to 0); new `lib/import.mjs` + route; README Importing section, API row, narrowed "Unknown fields are ignored". Reviewer gate: 8/10 fail → 9/10 pass (round 2).
- ✅ testing: test/import.test.mjs, test/import-apply.test.mjs, test/import-helpers.mjs, regression cases in validate/ledger/api tests; 70/70 pass; quality 9/10. It reported partial only because its shell could not swap near-miss copies; main ran all 31 via a Node loader hook (lib/ untouched, control copy survives): 31/31 caught.
- ❌ security: failed twice on start-up (its setup runs `git log origin/HEAD...`; repo has no origin remote). Main probed hostile inputs instead (`__proto__` keys, coerced types, null fields, array-like entries): no crashes, no state mutation.

Next steps (optional):
- Export the payer / from-to messages from one module and use them in both lib/expenses.mjs and lib/import.mjs.
- Give the security section a setup that works without an `origin` remote.
