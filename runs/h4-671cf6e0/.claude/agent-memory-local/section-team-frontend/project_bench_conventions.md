---
name: bench-conventions
description: How this benchmark project runs frontend jobs and which tool patterns are permitted
metadata:
  type: project
---
This repo is an automated benchmark: the spec in `.team/notes/spec.md` is final and nobody answers questions. Frontend means plain HTML plus a classic JS script, with no build step and a restricted list of allowed browser APIs.

**Why:** the graders check exact ids, text and API usage.

**How to apply:** To check behaviour, use a throwaway mock-DOM harness written with the Write tool to /tmp and run it with `node`. A Bash heredoc that writes the file was denied permission.
