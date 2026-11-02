---
name: bash-permissions
description: In this project, Bash with cd/pipes/sed/awk is denied; plain single commands like `node /abs/script.mjs` are allowed; coder helpers got Bash denied entirely
metadata:
  type: feedback
---

Run Bash as a single plain command with absolute paths (e.g. `node /tmp/x/smoke.mjs`); no `cd`, pipes, or sed/awk.

**Why:** 2026-11-02 run: `cd ...; ... | sed` and `cd ... && node ... | grep` were denied, while `node --check /abs/file` and `node /abs/script` worked. A section-team:coder helper had Bash denied entirely, so it could not smoke-test.

**How to apply:** Do smoke checks myself with a script written via Write under /tmp and run by a single `node` command; use Read/Grep instead of shell text tools. Don't delegate run-only work to a coder.
