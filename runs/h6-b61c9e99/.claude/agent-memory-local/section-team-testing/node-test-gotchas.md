---
name: node-test-gotchas
description: Node 22 test-runner pitfalls hit in this project (directory arg, huge string diffs, stdin directory fd)
metadata:
  type: project
---

- `node --test test/` fails on Node 22 (directory treated as module). Use `node --test "test/**/*.test.mjs"`.
- assert.strictEqual on two ~1 MB differing strings computes a diff for minutes; guard big outputs with a length check / assert.ok.
- process.stdin on a directory fd ends silently (no 'error'); only fs.readFileSync(0) surfaces EISDIR.
- Mutation-check via a scratch script that swaps source text, runs the suite, restores in finally; give it a `timeout` so a hang can't leave a mutant on disk (kill needs approval here).

**Why:** cost real time on 2026-11-03 jsonpatch job.
**How to apply:** any node:test suite in this repo, especially CLI tests with large outputs.
