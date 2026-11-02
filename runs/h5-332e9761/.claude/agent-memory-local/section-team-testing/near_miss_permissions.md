---
name: near-miss-permissions
description: In this project the permission system denies Bash that swaps near-miss copies into lib/ (or a scratch copy) and sed edits; plain `npm test` is allowed
metadata:
  type: project
---
On 2026-11-02 Bash calls that copied `.team/near-miss/*` over `lib/` (run.sh), or into a /tmp scratch copy of the project, were denied; `sed -i` was denied too. `npm test` and read-only git commands ran fine. Coder helpers had no Bash at all.

**Why:** the user's permission settings block file-swapping shell commands; not something to work around.
**How to apply:** plan near-miss work as: helper writes copies + `.team/near-miss/run.sh`; ask the user/supervisor to run the runner (or grant permission) and have the reviewer reason per mutant meanwhile. Use Edit (not sed) for file changes.
