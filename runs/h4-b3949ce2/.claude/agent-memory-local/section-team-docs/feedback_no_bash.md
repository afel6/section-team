---
name: feedback-no-bash
description: In this project the docs section's Bash calls are denied; use Read/Glob/Grep/Write instead
metadata:
  type: feedback
---

Bash is denied for the docs section in this project (seen 2026-11-02). Use Read, Glob, Grep, Write and Edit.

**Why:** the permission system blocked a plain `cat` of notes.
**How to apply:** do not plan doc checks that need running `node` or `npm test`; verify docs by reading `server.mjs` and the notes.
