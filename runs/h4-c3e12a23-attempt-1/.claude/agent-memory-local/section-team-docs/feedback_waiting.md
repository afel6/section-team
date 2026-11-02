---
name: no-blocking-bash-waits
description: Foreground Bash sleep/wait loops are denied in this environment; poll with Glob/Read instead
metadata:
  type: feedback
---

Foreground Bash loops that sleep or block (until/sleep, tail --pid) get permission-denied here.

**Why:** the harness blocks foreground sleeps; two attempts were denied on 2026-11-02.
**How to apply:** when waiting on parallel sections' files, write from spec first, then re-check with Glob/Read a few times; don't retry blocking Bash.
