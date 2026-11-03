---
name: project-bash-limits
description: In h5-a984a158, coder helpers may get Bash denied; scratch-copy mutation runs and python/sed edits were denied, plain npm test allowed
metadata:
  type: project
---

Bash permissions in this project are narrow: `npm test` and simple read commands run, but python heredocs, sed -i, and copying the project to /tmp for mutation testing were denied (2026-11-03). Coder helpers sometimes could not run Bash at all.

**Why:** the permission system blocks these, and the denial must not be worked around.
**How to apply:** after coders finish, run `npm test` yourself and fix test-side bugs with Edit. Check that plausible wrong implementations fail by reading the tests instead of running mutants.
