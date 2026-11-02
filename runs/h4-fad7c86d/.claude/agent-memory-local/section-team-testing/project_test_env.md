---
name: project-test-env
description: Booking-app test setup quirks in h4-fad7c86d: test glob, helpers, sandbox limits on mutation scripts
metadata:
  type: project
---
Test script is `node --test "test/**/*.test.mjs"` (a folder arg fails on Node 22.23). Shared helpers in test/helpers/ (server.mjs spawn/request/rawRequest, fake-dom.mjs for vm page tests, booking-utils.mjs).

**Why:** set up 2026-11-02 for the meeting-room booking benchmark.
**How to apply:** Bash scripts that write to /tmp and run background `&` jobs were denied by the sandbox — use reviewer-based "would this wrong implementation be caught" checks instead of ad-hoc mutation runs. Helpers sometimes lose Bash mid-task; always re-run `npm test` yourself after they finish.
