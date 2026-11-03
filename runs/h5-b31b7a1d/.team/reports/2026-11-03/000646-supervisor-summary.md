# Supervisor summary — 2026-11-03

Task: fix the two reported bugs and add `POST /groups/:id/import` (all-or-nothing, dry_run, skip_recorded).

- ✅ supervisor (main): fixed `parseAmount` rounding (4.35 was stored as 434 cents, now Math.round) and `splitEvenly` remainder (the first people in split pay one cent more, so shares add up and balances sum to 0); wrote `lib/import.mjs` and its route; documented it in the README (API row, Importing section, unknown-fields wording limited to other routes). Reviewer gate: 9/10, pass (structure 9, naming 9, duplication 8, size 8, errors 10, tests 10, security 10, leftovers 9).
- ✅ testing: 4 new test files plus additions to the api, ledger and validate tests; 82/82 pass; all 37 near-miss copies fail the suite (run through a loader hook because copying into lib/ was blocked; lib/ never touched). Quality 9/10.
- ⚠ security: the section stopped with an error (the security-review skill needs a git remote) and could not be resumed. The supervisor did the security pass instead: untrusted keys read with Object.hasOwn and Object.keys, strict type compare, no crash paths, linear work within 10 KB, and nothing is saved on 400/422, dry runs or all-skipped imports.

Stricter readings chosen: an earlier entry that breaks a field rule never makes a later one `duplicate`; existing records are compared by their stored cents (no migration).

Next steps (optional, from the reviewer): move the entry-checking loop out of `importEntries` (51 lines); stop writing the rule names twice (as unused `parseMember` messages); add a test that the import makes exactly one write.
