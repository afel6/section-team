# Test suite — owner: testing — 2026-11-02

Run: `npm test` (= `node --test`), 485 tests, about 6 s, Node built-ins only.

## Layout
- `test/helpers/server-harness.mjs`: spawns `node server.mjs` (cwd = a temp dir, clean env, PORT 0) and provides `request()`, which sends paths byte-exact and always frames bodies with Content-Length, plus `postBooking()` and `validBooking()`.
- `test/helpers/api-assert.mjs`: MSG (every spec message), `assertJsonError`, `assertCreated`, `listBookings`, `useServer`, `withTempDir`, `withServer`, `freshBooking`.
- `test/helpers/fake-dom.mjs`: runs `public/app.js` in `node:vm` with Proxy-guarded fake elements and a controllable fetch. Any API outside the spec's list shows up in `page.forbidden`.
- `test/helpers/html-tree.mjs`: a tiny HTML parser for `page-html.test.mjs`.
- Server/API tests: `server-startup`, `server-persistence`, `api-routing`, `api-bookings-list`, `api-booking-rules` (rules 1-5, rule order, ids), `api-booking-fields` (rules 6-10), `server-edge-requests` (CONNECT → 405/404, unknown `Expect` → route reply; raw sockets).
- Page tests: `page-html`, `app-startup-list`, `app-actions`.

## Contract for builders
- The tests rely on element ids from `frontend-page.md` and on app.js using only the spec's allowed APIs.
- The tests rely on the data layout `{"nextId","bookings"}` (backend-api.md), but only for hand-written fixture files and file-content checks.
- Near-miss copies: `.team/near-miss/1..22-*`, each with one bug, and every one fails `npm test`. To check one, swap it in, run, then restore the original. Backups of the originals are kept in `.team/scratch/testing-orig/`.
