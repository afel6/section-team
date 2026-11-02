# Frontend page — owner: frontend — 2026-11-02

Files: `public/index.html` (served at `/`), `public/app.js` (served at `/app.js`).

## Element ids (all exist in index.html)
- `booking-form` (form, novalidate) containing: `room` (select, empty in HTML),
  `title` (text), `date` (date), `start` (time), `end` (time), `book` (submit button "Book").
- Outside the form: `filter-date` (date input), `show-all` (button "Show all"),
  `error` (p, role=alert, empty), `booking-list` (ul, empty).
- `<script src="/app.js"></script>` is the last element in body.

## app.js runtime contract (for the node:vm fake DOM)
- Classic script wrapped in an IIFE; needs only globals `document` and `fetch`.
- Browser APIs used, and nothing else:
  - `fetch(url, { method, headers?, body? })` — every call passes an options object
    (`{ method: 'GET' }` for GETs). Reply: `status`, `json()` only. `json()` is never
    called on a 204.
  - `document.getElementById`, `document.createElement` (`option`, `li`, `button`).
  - Element members: `textContent`, `value`, `type`, `disabled`, `append`,
    `replaceChildren`, `addEventListener`. Event: `preventDefault`.
- Text nodes are made with `li.append(string)` (no createTextNode): a fake `append`
  must accept strings as text-node children.
- `#room` filled via `replaceChildren(...options)`; list via `replaceChildren(...lis)`.
- Each booking `li` gets `append(text)` then `append(button)`.
- Listeners: form `submit`, `#filter-date` `change`, `#show-all` `click`,
  each Cancel button `click`. Handlers ignore the event object except submit
  (`preventDefault`).
- Startup order: `GET /api/rooms` then `GET /api/bookings` (both before any reply).
- Cancel and Book both ignore a trigger while their button is disabled.
- Malformed 200 body (rooms/bookings not an array) shows `Request failed.`.
