---
name: node-test-glob
description: On this machine (Node 22.23) `node --test test/` fails; use `node --test "test/*.test.mjs"` in package.json
metadata:
  type: project
---

`node --test test/` fails with MODULE_NOT_FOUND on Node v22.23.4 here (the folder is treated as a module). Use the glob form `node --test "test/*.test.mjs"`.

**Why:** supervisor's decisions.md asked for `node --test test/` on 2026-11-02; it broke `npm test`.
**How to apply:** when writing package.json test scripts here, use the quoted glob and log the change in .team/notes/decisions.md.
