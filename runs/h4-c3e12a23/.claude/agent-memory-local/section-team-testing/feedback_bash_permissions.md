---
name: bash-permissions-near-miss
description: In this project's sandbox, Bash denies shell loops, running .sh scripts, python, and output redirection; single explicit cp/npm test commands work
metadata:
  type: feedback
---
Run near-miss swaps as one explicit command per call: `cp copy target; npm test | grep '^# fail '; cp backup target; diff -q`. Never use a `for` loop or a runner script, and never run two swaps in parallel, because they share the same file.

**Why:** On 2026-11-02 the permission system denied `bash script.sh`, inline `for` loops, `python3` edits, and `> file` redirects, but allowed the single explicit commands. Coder helpers also had Bash denied from time to time, so some of them handed back test files they had never run.

**How to apply:** Write any generator as a .mjs file and run it with `node`; that was allowed. Make edits with the Edit or Write tools. Plan on running the helpers' tests yourself after they hand back.
