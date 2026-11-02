---
name: project-bench-conventions
description: Booking-app bench project conventions for backend: Node built-ins only, spec-exact values, server tests spawn the real process
metadata:
  type: project
---
Bench runs (e.g. /root/bench-runs/h4-*) give a verbatim, final spec in `.team/notes/spec.md`; no questions possible; Node v22, built-ins only, no npm.
**Why:** graded by hidden tests that check exact status codes/messages/content types and plausible wrong implementations.
**How to apply:** treat every spec value as exact, pick the stricter reading and log it in decisions.md; tests spawn the server with PORT=0 + temp DATA_FILE. Compound Bash commands (cd && heredoc, background processes) may be denied — use Write tool and simple commands.
