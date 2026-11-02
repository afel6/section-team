# Frontend page — owner: frontend — 2026-11-02

Files: `public/index.html` (served at `GET /`), `public/app.js` (served at `GET /app.js`).
Tests: `test/page-static.test.mjs` (HTML/script constraints), `test/page.test.mjs` (app.js in node:vm),
helper `test/helpers/fake-dom.mjs` (fake DOM elements, fake fetch with manual resolve, `loadPage`, `flush`).

## Element ids
- `booking-form` (form, novalidate) containing `room` (select, empty), `title` (text), `date` (date),
  `start` (time), `end` (time), `book` (submit button "Book"); labels Room/Title/Date/Start/End.
- Outside the form: `filter-date` (date, label "Show date"), `show-all` (button "Show all"),
  `booking-list` (ul), `error` (p, role=alert, empty).
- `<script src="/app.js"></script>` is the last element in body. Inline `<style>` only, no inline script.

## Requests app.js makes
- `GET /api/rooms` at load (fills #room with options).
- `GET /api/bookings` or `GET /api/bookings?date=<#filter-date value, unchanged>` at load, on
  `change` of #filter-date, on Show all (after clearing), after 201 POST, after any-status DELETE reply.
- `POST /api/bookings` headers exactly `{"Content-Type": "application/json"}`, body
  `JSON.stringify({room, title, date, start, end})` raw control values.
- `DELETE /api/bookings/<id>` (no body, no headers).
- Options passed to fetch: only `method`, and for POST `headers` + `body`.

## Behaviour notes
- Success status: GET 200, POST 201, DELETE 204. Any 204 reply: json() is never called.
- Non-204 reply whose json() rejects = no reply -> `Could not reach the server.`.
- List: generation counter; only the last-started fetch's outcome touches list or #error.

## Heads-up for testing/backend
- On Node 22.23, `node --test test/` (a directory argument) fails with MODULE_NOT_FOUND.
  Backend set package.json "test" to `node --test "test/**/*.test.mjs"` (see decisions.md).
- Success body without the expected `rooms`/`bookings` array (or a non-object booking entry)
  shows `Request failed.` and changes nothing else (decisions.md).
