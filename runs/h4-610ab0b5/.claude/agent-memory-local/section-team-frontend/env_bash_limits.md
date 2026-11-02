---
name: env-bash-limits
description: In this project's runs, Bash commands that write files (heredoc, printf >>) are denied; plain `node <file>` runs fine
metadata:
  type: feedback
---

Bash calls that write files (heredoc into /tmp, `printf >> notes`) were denied; `node /tmp/x.mjs` was allowed.

**Why:** permission policy for this benchmark environment (seen 2026-11-02).
**How to apply:** create scratch check scripts and note edits with Write/Edit tools, then run them with a bare `node <path>` Bash call.
