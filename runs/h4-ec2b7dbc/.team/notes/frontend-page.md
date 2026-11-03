# Frontend page (owner: frontend) — 2026-11-03

Files: `public/index.html`, `public/app.js` (classic script, IIFE, runs setup at once).

## Element ids
- `#booking-form` (form, novalidate) holds: `#room` (select, empty in HTML),
  `#title` (input text), `#date` (input date), `#start`, `#end` (input time),
  `#book` (button type=submit, text `Book`). Each field has its own `<label for>` beside it.
- Outside the form: `#filter-date` (input date, label `Show date`),
  `#show-all` (button type=button, text `Show all`), `#error` (p, role=alert, empty),
  `#booking-list` (ul).
- `<script src="/app.js"></script>` is the last element in body.

## Requests made by app.js
- `fetch(url, { method: 'GET' })` for `/api/rooms`, `/api/bookings`, `/api/bookings?date=<raw value>`.
- `fetch('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })`.
- `fetch('/api/bookings/<id>', { method: 'DELETE' })`; json() is never called on a 204.
- Book / Cancel are re-enabled in the request helper's `finally`, right when
  fetch + json() settle, before the outcome is handled.

## Fake-DOM harness: `test/helpers/fake-dom.mjs` (reusable by testing)
- `loadPage({ fetchImpl? })` -> `{ document, el(id), calls, flush }`. Runs app.js in
  `node:vm` with only `document` and `fetch` in the global scope.
- Default fetch is controllable: each `calls[i]` has `url`, `options`, `jsonCalls`,
  `resolve(status, body)`, `resolveBadJson(status)`, `reject()`, `resolveWith(response)`.
- `FakeElement`: value/type/disabled/textContent/childNodes/append/replaceChildren/
  addEventListener, plus test helper `dispatch(type)` returning the event
  (`defaultPrevented`). A `<select>` with no set value reads its first option.
  `dispatch` fires even on disabled elements (like `dispatchEvent`).
- `listTexts(ul)` -> per li `{ text, button: {type,text,disabled}, childCount, nodes }`.
- `flush()` waits a few setImmediate turns.
- Gotcha: objects made inside the vm (e.g. `options.headers`) have another
  `Object.prototype`; compare via a JSON round-trip, not `deepStrictEqual`.
- Frontend's own 28-case check lived outside the repo (/tmp/frontend-check/check.mjs).
