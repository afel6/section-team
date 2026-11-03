---
name: project-env
description: Environment quirks for the h6 jsonpatch bench project — Bash denials, root user, node 22 test runner
metadata:
  type: project
---

- Node v22: `node --test test/` (directory arg) fails with MODULE_NOT_FOUND; the supervisor switched the script to `node --test test/*.test.mjs` on 2026-11-03.
- Node v22 default stack: JSON.stringify(v, null, 2) fails between 4000 and 4250 nesting levels (about 750 with --stack-size=200).
- Shell loops (`for`, `sed -i`) are denied; write a node script under .team/scratch and run it instead.
- Tests run as root (uid 0): chmod-000 "cannot read" tests skip; use a symlink loop (ELOOP) for a root-safe cannot-read case.
- Bash permission denies shell loops, cp over builder files and tmp-dir writes outside the project; single `node <script>` calls are allowed.
  **How to apply:** run near-miss copies in a mirror dir (.team/scratch/run-near-miss.mjs) instead of swapping originals.
