---
name: bash-limits
description: In this project's runs, Bash denies sed/cat/grep pipelines and inline `node -e`; plain `node <file>` works
metadata:
  type: feedback
---
Bash permission denies compound shell commands (sed, grep pipes, `node -e '...'`); `node /tmp/<dir>/script.mjs <args>` is allowed.

**Why:** observed denials on 2026-11-02 during the room-bookings benchmark.
**How to apply:** for smoke tests write a script file with Write, then run it with a single plain `node` command; use Read/Edit instead of sed/cat. Also note `fetch()` normalises `/./` paths, so test raw paths over `node:net`.
