# Page contract — frontend — 2026-11-02

Files: `public/index.html` (served at `GET /`), `public/app.js` (served at `GET /app.js`).

## Element ids (all fetched once at startup via document.getElementById)
| id | tag / type | notes |
|----|-----------|-------|
| booking-form | form[novalidate] | listener: `submit` |
| room | select[name=room] | starts empty; filled with `<option>` per room |
| title | input[type=text][name=title] | emptied on 201 |
| date | input[type=date][name=date] | |
| start | input[type=time][name=start] | |
| end | input[type=time][name=end] | |
| book | button[type=submit] `Book` | `disabled` toggled |
| filter-date | input[type=date] (label `Show date`) | listener: `change` only |
| show-all | button[type=button] `Show all` | listener: `click` |
| booking-list | ul | `replaceChildren` on list success |
| error | p[role=alert], empty | written via `textContent` |

## Browser APIs app.js touches (and nothing else; no other globals)
- Globals: `fetch`, `document` only. Classic script wrapped in an IIFE; runs at once.
- `document.getElementById(id)`, `document.createElement('option' | 'li' | 'button')`.
- `fetch(url, options)` always called with an options object:
  - GET: `{ method: 'GET' }`
  - POST: `{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: <JSON string> }`
    body key order: room, title, date, start, end (raw values).
  - DELETE: `{ method: 'DELETE' }`
- Response: reads `status`; calls `json()` (awaited, may reject) unless status is 204.
- Element members used:
  - setters: `value` (option, title, filter-date), `textContent` (option, button, #error), `type` (='button' on Cancel), `disabled`
  - getters: `value` (room, title, date, start, end, filter-date), `disabled` (book, Cancel button)
  - methods: `append(...nodesOrStrings)` (li: `append(text, button)` or `append('No bookings.')`), `replaceChildren(...nodes)` (#room on rooms success, #booking-list on list success), `addEventListener(type, fn)`
- Events: `event.preventDefault()` on submit (first statement). Click handlers ignore the event.
- Listeners registered: form `submit`, #filter-date `change`, #show-all `click`, each Cancel button `click`.

## Startup order
`fetch('/api/rooms')` then `fetch('/api/bookings[?date=v]')`, both synchronously during script run (2 calls before any await resolves).

## Fake-DOM tips for testing
- A fake `textContent` setter should replace children; `append` of a string = text node.
- Async: each outcome needs ~2 microtask hops (fetch, json); `await new Promise(r => setImmediate(r))` is enough.
- A click on a disabled Cancel button (or submit while Book disabled) sends nothing.
- 200 GET with a body lacking an array `rooms` / `bookings` (or non-object bookings) → `#error` = `Request failed.`, list/select untouched (see decisions.md).
