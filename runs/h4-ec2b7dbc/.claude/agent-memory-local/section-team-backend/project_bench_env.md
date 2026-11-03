---
name: bench-env-shell-limits
description: In this bench project, compound shell commands and writes to /tmp are denied; use plain single commands and a scratch dir inside the repo
metadata:
  type: project
---

Bash allows only plain single commands here (no `&&`, pipes into multiple commands, `&` backgrounding, or /tmp writes).

**Why:** permission settings of the benchmark harness (observed 2026-11-03).
**How to apply:** put smoke scripts under `.team/backend-smoke/` and run them with one `node <script>` call; edit notes with Edit, not shell appends.
