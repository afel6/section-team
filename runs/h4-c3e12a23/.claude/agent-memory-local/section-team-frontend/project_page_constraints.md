---
name: project-page-constraints
description: Room-booking bench page must use a tiny allowed browser-API set and run in node:vm fake DOM; scratch scripts go in .team/scratch (Bash in /tmp denied)
metadata:
  type: project
---
The room-booking page (public/app.js) may use only fetch(method/headers/body, status, json), getElementById, createElement, and element textContent/value/type/disabled/append/replaceChildren/addEventListener + preventDefault.

**Why:** spec rule; tests run app.js in node:vm with a minimal fake DOM.
**How to apply:** text nodes via `el.append(string)`; avoid substrings like `content=` in HTML (naive on*= regex); put smoke scripts under `.team/scratch/` since /tmp shell access was denied.
