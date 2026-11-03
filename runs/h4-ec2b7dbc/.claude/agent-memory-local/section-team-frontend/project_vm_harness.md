---
name: project-vm-harness
description: Gotchas when testing browser scripts in node:vm with a fake DOM in this benchmark project
metadata:
  type: project
---

Objects made inside a node:vm context (e.g. fetch options.headers) have another Object.prototype, so assert.deepStrictEqual fails against host objects. Compare through a JSON round-trip.

**Why:** the first fake-DOM run on 2026-11-03 failed only because of this, not because of an app bug.
**How to apply:** whenever a page script is checked in node:vm (see [[frontend-page-note]] in .team/notes/frontend-page.md).

Also: a Bash heredoc write into .team/notes was refused once by permissions; Write/Edit tools worked.
