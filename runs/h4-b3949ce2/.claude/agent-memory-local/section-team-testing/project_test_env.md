---
name: project-test-env
description: Quirks of this machine/tooling for the booking-app tests (Node 22 test glob, Bash denials, edit tool turning \u escapes into literal chars)
metadata:
  type: project
---

- Node 22.23: `node --test test/` fails (loads the folder as a module); use `node --test test/*.test.mjs`.
- Bash denies shell redirects to /tmp, `$(...)` substitution and `>` to files; write scratch scripts with Write into `.team/scratch/` and run them with plain `node`.
- The Edit/Write tools turn `\uXXXX` typed in strings into the literal character; use `String.fromCharCode(...)` or `\u{...}` to keep invisible chars visible.
- Near-miss runner `.team/scratch/near-miss-run.mjs` must clean up files a mutant writes next to server.mjs (e.g. bookings.json).

**Why:** each cost a retry on 2026-11-02.
**How to apply:** use these defaults from the start in this project.
