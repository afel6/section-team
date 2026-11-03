---
name: node-test-script-glob
description: On this machine (Node v22) `node --test test/` fails; use `node --test test/*.test.mjs` in package.json
metadata:
  type: project
---
`node --test test/` fails on Node v22 with "Cannot find module .../test" (a directory is not expanded). Use `node --test test/*.test.mjs`.

**Why:** the supervisor prescribed `node --test test/` on 2026-11-03 and it broke; changed and logged in `.team/notes/decisions.md`.
**How to apply:** when the job dictates a test script, check that it runs before you accept it, and name helper modules without `.test.` so the glob skips them.
