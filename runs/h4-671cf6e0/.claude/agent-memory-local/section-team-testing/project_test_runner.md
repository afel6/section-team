---
name: project-test-runner
description: Booking-app repo — how to run the node:test suite on Node 22 and which Bash commands get denied here
metadata:
  type: project
---

Run tests with `node --test 'test/*.test.mjs'`. `node --test test/` fails on Node 22.23 (directory loaded as a module); flagged to backend 2026-11-03 for package.json.
test/ holds non-test helpers (helpers.mjs, api-util.mjs, fake-dom.mjs), so plain `node --test` would run them as test files.

**Why:** the user's benchmark requires `npm test` to pass; the package.json script is backend-owned.
**How to apply:** check package.json "test" first; if it is still `node --test test/`, report it rather than editing.

Bash in this environment denies heredocs, /tmp scripts and some loops; plain single commands (node --test, grep, sed) are allowed. Use Write/Edit for file changes.
