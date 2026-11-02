---
name: sandbox-scratch
description: In this bench repo, Bash heredocs/echo-appends are denied; write scratch scripts with the Write tool to a unique /tmp dir and edit notes with Edit
metadata:
  type: feedback
---

Bash commands that write files (heredoc `cat >`, `echo >>`) were denied by the permission system on 2026-11-02; read-only Bash and `node <script>` were allowed.

**Why:** the permission policy blocks shell-side file writes.
**How to apply:** create scratch files with Write in a unique path (e.g. /tmp/frontend-<run>-smoke/, since /tmp/fe-smoke was taken by another agent), then run them with node; append to notes via Edit.
