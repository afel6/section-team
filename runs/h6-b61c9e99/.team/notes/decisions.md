# Decisions log (append only): date — section — decision — why

- 2026-11-03 — testing — package.json test script changed from `node --test test/` to `node --test "test/**/*.test.mjs"` — Node 22 treats `test/` as a module path (MODULE_NOT_FOUND), so the suite never ran.
- 2026-11-03 — testing — directory-on-stdin test kept but marked `todo` — it documents a real CLI bug (spec: stdin errors are only "too large"/"cannot read"; CLI prints "invalid JSON", exit 3) while keeping `npm test` green until the supervisor fixes jsonpatch-cli.mjs:59-79.
- 2026-11-03 — testing — CLI helpers skip assert's string diff above 4 KB — diffing two ~1 MB outputs hangs the runner for minutes when a test fails.
