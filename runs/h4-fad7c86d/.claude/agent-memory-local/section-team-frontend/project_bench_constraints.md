---
name: project-bench-constraints
description: Meeting-room booking benchmark project; page has a strict browser-API whitelist and testers run app.js in node:vm
metadata:
  type: project
---
The booking app page (public/app.js) may use only a short list of browser APIs and must contain no http(s):// strings, inline scripts, or room names in the HTML.

**Why:** the spec is checked by automated graders, which test app.js in node:vm with a fake DOM.

**How to apply:** use `el.append('text')` for text nodes; no querySelector, innerHTML or console. Smoke-test in node:vm before the reviewer gate.
