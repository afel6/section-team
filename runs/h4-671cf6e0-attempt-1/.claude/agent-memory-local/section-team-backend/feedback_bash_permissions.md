---
name: bash-permissions
description: In this project's harness, compound Bash commands (cd && ..., mktemp, python heredocs) get denied; single plain commands with absolute paths work
metadata:
  type: feedback
---

Run Bash as single plain commands with absolute paths (e.g. `node --check /abs/server.mjs`, `timeout 60 node /tmp/x/smoke.mjs`); do not chain with `cd &&`, pipes into grep/cut, or python heredocs.

**Why:** those forms were denied on 2026-11-03; plain node commands were allowed.

**How to apply:** for smoke tests, write a node script under /tmp with the Write tool and run it with one `node` command; edit files with Edit, not scripts.
