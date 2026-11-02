---
name: node22-test-script
description: On this machine's Node 22, `node --test test/` fails (directory treated as file); use a glob like "test/**/*.test.mjs"
metadata:
  type: project
---
`node --test test/` gives MODULE_NOT_FOUND on Node v22.23 here; package.json uses `node --test "test/**/*.test.mjs"`.

**Why:** a directory argument to `--test` is treated as a module path in Node 22; default discovery would also pick up helper files.
**How to apply:** when a job prescribes `node --test test/`, use the glob instead and log it in `.team/notes/decisions.md`.

Also: in this environment, Bash calls that start background servers or multi-step shell scripts get denied; verify servers via node:test files that spawn the server instead.
