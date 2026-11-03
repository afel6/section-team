# Decisions

- 2026-11-03 — testing — package.json test script changed from `node --test test/` to `node --test "test/**/*.test.mjs"`. Why: on Node 22 a bare directory argument is taken as a module path and the run fails with MODULE_NOT_FOUND. The glob also keeps test/helpers.mjs from running as a test file.
- 2026-11-03 — testing — The CLI test for "cannot read" (a file with mode 000) is skipped when uid is 0, because root can read the file anyway.
