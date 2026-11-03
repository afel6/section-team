---
name: project-test-env
description: Booking-app test environment quirks - Bash allowlist, Node 22 --test dir, near-miss tooling location
metadata:
  type: project
---
Bash here only allows simple `node`/`npm`/`git`/`ls`/`cat`/`rm`/`cp`/`mv`/`mkdir` commands. Pipes into grep/tail usually work, but sha256sum, ps and `node -e` are denied. Use `git hash-object` for checksums, and write small node scripts under `.team/tools/` for anything else.
**Why:** several probes were denied in the 2026-11-03 run.
**How to apply:** plan verification steps with node scripts from the start.

On Node 22, `node --test test/` fails because it treats `test/` as a module. Use `node --test "test/**/*.test.mjs"`.

Near-miss tooling is in `.team/tools/near-miss-make.mjs` (string mutants) and `.team/tools/near-miss-run.mjs`. The runner works in a scratch copy, so the real files are never swapped while other sections edit them.

The raw-socket test helper must not half-close the socket (no `socket.end`), because Node drops async replies to half-closed requests.
