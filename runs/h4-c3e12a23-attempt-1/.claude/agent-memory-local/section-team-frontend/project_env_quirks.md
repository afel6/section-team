---
name: project-env-quirks
description: Bench project env quirks - Bash permission is intermittent, node --test with a dir arg fails on Node 22.23
metadata:
  type: project
---

In /root/bench-runs/h4-c3e12a23 (meeting-room booking app, Node built-ins only):
- `node --test test/` fails (MODULE_NOT_FOUND); use explicit files or the glob `"test/**/*.test.mjs"`.
- Bash calls are sometimes denied (compound/sed-y ones especially); coder helpers often cannot run Bash, so run tests yourself after they write them.

**Why:** cost two helper rounds that could not verify their tests.
**How to apply:** brief coders that they may lack Bash; plan to run the suite in the head's own turn.
