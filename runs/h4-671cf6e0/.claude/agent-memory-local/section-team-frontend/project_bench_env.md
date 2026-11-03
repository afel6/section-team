---
name: project-bench-env
description: This project is an automated benchmark run; Bash may be denied to the frontend section, so verify with Grep/Read instead
metadata:
  type: project
---

This repo (h4-671cf6e0) is an automated benchmark: no human answers, the Fable model is not used, and npm install is not allowed.

**Why:** the supervisor said so in the 2026-11-03 job; Bash calls (node --check, grep) were denied during that job.

**How to apply:** don't plan on running node for syntax checks. Use the Grep tool for scans of forbidden strings and let the testing section run the code.
