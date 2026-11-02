---
name: bash-and-node-test-quirks
description: In this project Bash is often denied for compound/piped/redirected commands; plain single commands work. Node 22 `node --test test/` fails.
metadata:
  type: feedback
---

Run single plain commands (e.g. `cd <repo> && npm test`, `node --test --test-reporter=dot test/*.test.mjs`); pipes, redirects to /tmp files, `pgrep`, `cat` combos got denied. Read large outputs via the persisted tool-results file with Grep.

**Why:** permission system denied piped/redirected Bash calls for me and for coder helpers on 2026-11-02; several coders came back unable to run tests.
**How to apply:** tell coders to use plain commands; use `test/*.test.mjs` glob in package.json, since Node 22 treats `node --test test/` as a module path.
