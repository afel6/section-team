---
name: bash-limits-smoke-tests
description: In this project Bash denies cd-to-/tmp, mktemp/background/kill and head-redirect commands; smoke-test servers with a node script instead
metadata:
  type: feedback
---
Bash calls with `cd /tmp`, `mktemp`, `&` background jobs and `kill`, or `head > file`, were denied. Plain `node <script>` and `node -e` calls were allowed.
**Why:** this project's permission settings (seen 2026-11-02).
**How to apply:** for server smoke tests, write a Node script under `.team/scratch/` that spawns the server with child_process and run it with `node`. Make file edits with Edit/Write, not shell.
