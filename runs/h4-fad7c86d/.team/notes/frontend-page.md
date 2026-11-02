# Frontend page — owner: frontend — 2026-11-02

Files: `public/index.html`, `public/app.js` (served by server.mjs at `GET /` and `GET /app.js`).

## Element ids (all present in the static HTML)
- `#booking-form` (novalidate) containing `#room` (select, empty), `#title`, `#date`, `#start`, `#end`, `#book` (submit).
- Outside the form: `#error` (p, role=alert, empty), `#filter-date`, `#show-all`, `#booking-list` (ul, empty).
- Labels use `for=` and are siblings of their fields. `<script src="/app.js"></script>` is the last element in body.
- The HTML has no `<option>`, no room names and no `http://`/`https://`. Its only inline code is a `<style>` block.

## Script shape
- Classic script: one IIFE, no import/export, no globals leaked. It sets up at once:
  it looks up elements by id, adds 3 listeners (form `submit`, filter `change`, show-all `click`),
  then calls `loadRooms()` and `loadList()` in that order without awaiting (2 fetches at once).
- Browser APIs used: only `fetch`, `document.getElementById`, `document.createElement`,
  `.textContent .value .type .disabled .append .replaceChildren .addEventListener`, and `event.preventDefault`.
  Text nodes come from `li.append('text', button)`, so a fake DOM's `append` must accept strings.
- Fetch calls:
  - GET requests: `fetch(url)` with no options object.
  - POST: `{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({room,title,date,start,end})}`.
  - DELETE: `{method:'DELETE'}`.
- The reply object needs only `status` and `json()`. `json()` is never called on a 204.
  A rejected `fetch`, or a rejected `json()` on a non-204, counts as "no reply".
- Error message: `body.error` if the body is a non-array object with a string `error`; otherwise `Request failed.`.
- A 200 whose body is not `{rooms: [...]}` / `{bookings: [...]}` is treated as an error reply (message as above).
- Last list fetch wins: a sequence counter; an earlier fetch's outcome is dropped entirely.
- Submit: preventDefault, then return if `#book.disabled`; else disable, POST, set `disabled=false` right after
  the body is read, then: 201 → title '', error '', refetch; otherwise show the message.
- Cancel: the button is disabled, then `DELETE /api/bookings/<id>`, then re-enabled. 204 → error ''; other → message;
  then refetch. No reply → `Could not reach the server.`, no refetch.
- Show all: `#filter-date.value = ''`, then one list fetch. Filter `change` → one list fetch; `input` is not listened to.
- Filter URL: `'/api/bookings?date=' + value`, no encoding.

## Testing hints
- app.js runs in `node:vm` (`vm.runInNewContext(src, { fetch, document })`) against a fake DOM:
  `document.getElementById(id)` returns fake elements; `createElement(tag)` returns objects with the members above.
  The event object passed to submit needs `preventDefault()`. The click and change handlers ignore their argument.
- Wait for promises with `await new Promise(r => setImmediate(r))` (a few times) after each action.
- The Cancel button is `li.children[1]`; its handler is the one registered for 'click'.
