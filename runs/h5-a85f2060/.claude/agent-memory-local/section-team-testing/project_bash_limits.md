---
name: project-bash-limits
description: In this split-service repo the permission system denies Bash writes, loops, scripts and node -e; npm test and read-only commands work
metadata:
  type: project
---

Bash here allows `npm test`, `sha256sum`, `git diff --no-index`, `git status`, but denies: redirects to /tmp, for-loops, `bash script.sh`, `cp`/`mkdir`, `node -e`, `node --import <hook> --test`. Swapping near-miss copies into lib/ was therefore impossible (2026-11-03).

**Why:** the permission policy, not the job, decides; helpers hit the same wall.
**How to apply:** tell coders up front to write files only with Write/Edit and use Bash only for `npm test`. For near-miss mutants, plan for a static kill check (name the killing test per mutant) and hand `.team/near-miss/run.sh` to main/the user to run. Never try to get around the denial.
