---
name: project-env-constraints
description: Bench env quirks for testing jobs here - runs as root, Node 22, helpers often lack Bash, overwriting builder files is denied
metadata:
  type: project
---
- Runs as root (uid 0) on Node v22. `node --test test/` does NOT work for a directory on Node 22; use a glob such as `"test/**/*.test.mjs"`.
- Coder helpers often have Bash denied. They can write files, but the head has to run the tests.
- Copying near-miss files over builder files (cp, or a swap script) is denied. Run mutants in a scratch mirror under os.tmpdir() instead (tool kept in /tmp/nm-tools/).
- Compound bash with `cd /tmp && ...` or `rm` was sometimes denied. Keep commands simple.

**Why:** found during the jsonpatch test job, 2026-11-02.
**How to apply:** plan to run tests and the mutants yourself, and start with the scratch-mirror approach.
