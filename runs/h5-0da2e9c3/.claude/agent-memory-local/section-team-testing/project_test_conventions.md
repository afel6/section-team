---
name: project-test-conventions
description: How tests are run and structured in the h5 expense-sharing service (node:test, HTTP-only via helpers)
metadata:
  type: project
---

Tests use node:test + node:assert/strict, over HTTP via test/helpers.mjs (withApp, startApp, tempDataFile); `npm test` runs `node --test "test/*.test.mjs"`. Builders own lib/; the testing section must not edit lib/ or README, only report bugs with failing tests.

**Why:** supervisor's instruction for the import-endpoint job (2026-11-03).
**How to apply:** for file-unchanged checks use tempDataFile+startApp and compare readFileSync text + statSync mtimeMs; deepEqual ignores key order, so assert Object.keys where order matters.
