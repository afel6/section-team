---
name: project-env
description: Test-environment quirks for this bench project (Node 22, root sandbox, Bash limits, node --test dir arg)
metadata:
  type: project
---
- Node 22: `node --test test/` fails (the directory is treated as a module). Use a glob such as `node --test "test/**/*.test.mjs"`.
- Runs as root, so chmod-000 "cannot read" tests have to skip.
- Bash calls that write files, such as `node -e` with fs writes or `sed -i`, get denied. Use Write/Edit instead. Edit cannot swap a raw invisible character for its `\uXXXX` escape, so build such characters with `String.fromCodePoint`.

**Why:** these cost extra rounds on 2026-11-03.
**How to apply:** check the package.json test script first, and plan file changes around Write/Edit.
