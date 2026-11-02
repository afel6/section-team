---
name: project-env
description: h6 jsonpatch project test environment quirks (Node 22, root user, Bash limits)
metadata:
  type: project
---

Node v22.23.4, tests run as root (chmod-based permission tests are meaningless). `node --test test/` fails on this Node with "Cannot find module .../test"; `node --test test/*.test.mjs` works.
Bash calls writing to /tmp or running shell loops were denied by the permission system on 2026-11-02; plain test runs were allowed.

**Why:** cost a debugging round in the first job.
**How to apply:** use the glob when running tests here; keep fixtures in mkdtemp dirs created from inside test code; flag the package.json test script to main if still unchanged.
