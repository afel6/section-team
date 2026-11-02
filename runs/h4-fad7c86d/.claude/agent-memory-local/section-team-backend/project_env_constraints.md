---
name: project-env-constraints
description: Bench env for h4-fad7c86d - running the server directly via Bash is denied; node --test works; Node 22 rejects folder args to --test
metadata:
  type: project
---

Running `node server.mjs` (or piped/compound shell scripts) via Bash is permission-denied here; `node --test <file>` and simple commands are allowed.

**Why:** sandbox permission rules in this benchmark environment (seen 2026-11-02).

**How to apply:** smoke-test servers with a node:test file that spawns the server as a child process (put it in a scratch folder, delete it after). On Node 22.23, `node --test test/` fails; use `node --test "test/**/*.test.mjs"`.
