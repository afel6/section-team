---
name: feedback-probing
description: How black-box probing works in this sandbox — Bash outside the repo (cd /tmp etc.) is denied; probe via node:test files in test/
metadata:
  type: feedback
---

Run ad-hoc probes as node:test files inside the repo (e.g. test/final.test.mjs using test/helpers.mjs), not as shell one-liners in /tmp.

**Why:** a Bash call that cd'd into /tmp and spawned the server was denied by the permission system (2026-11-02).

**How to apply:** keep Bash commands rooted at /root/bench-runs/h4-788acd71; use tmpDir() from test/helpers.mjs for temp files. Node's HTTP parser rejects raw non-ASCII bytes in a request target with 400 before the app sees it, so send them percent-encoded.
