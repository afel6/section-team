---
name: probe-scratch-location
description: Where to put ad-hoc probe scripts in this project; shell commands touching /tmp or background jobs were denied
metadata:
  type: feedback
---
Write probe scripts as .mjs files under the project (e.g. `.team/probe/`), run them with `node <file>`, and delete them afterwards.

**Why:** A multi-line bash probe that used /tmp and a background `&` job was denied by the permission system on 2026-11-03; a plain `node script.mjs` run inside the project was allowed.

**How to apply:** For server probes (raw http, startup env cases) write one Node script with child_process/net instead of shell loops.
