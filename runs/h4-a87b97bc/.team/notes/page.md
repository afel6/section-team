# Page (frontend, 2026-11-03)

Files
- `public/index.html` — static page, no inline script, no options/room names. Served by backend at `GET /`.
- `public/app.js` — classic script (IIFE), served at `GET /app.js`. Loaded by `<script src="/app.js"></script>` as last body element.
- `test/app.test.mjs` + `test/app-fake-dom.mjs` — static HTML checks and vm-run behaviour tests against a Proxy-guarded fake DOM/fetch (only the spec's allowed browser APIs are reachable).

Element ids
- Form `#booking-form` (novalidate): `#room` (select), `#title`, `#date`, `#start`, `#end`, `#book` (submit).
- Outside form: `#filter-date`, `#show-all`, `#booking-list` (ul), `#error` (p, role=alert, empty).

Requests made by app.js (path-only URLs)
- `GET /api/rooms` → expects `{rooms: [...]}`.
- `GET /api/bookings` or `/api/bookings?date=<value unchanged>` → expects `{bookings: [...]}`.
- `POST /api/bookings`, header exactly `Content-Type: application/json`, body `{room,title,date,start,end}` → 201.
- `DELETE /api/bookings/<id>` → 204 (body never read).
- Errors: shows body `error` string if present, else `Request failed.`; no reply / unparsable non-204 body → `Could not reach the server.`.
