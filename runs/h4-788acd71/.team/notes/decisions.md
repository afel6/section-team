# Decisions (supervisor)

- Full user spec: see `.team/notes/spec.md` (exact, final; every value in it is exact).
- Only Node.js built-ins, no npm install. Node 22. Tests use `node:test`.
- File layout:
  - `server.mjs` — backend (HTTP server, JSON API, data file). Owner: backend.
  - `public/index.html` and `public/app.js` — the page and its classic script. Owner: frontend.
    `server.mjs` reads both from `new URL('./public/…', import.meta.url)` (relative to server.mjs, NOT cwd)
    per request or at startup (backend's choice) and serves them on `GET /` and `GET /app.js`.
  - `test/server.test.mjs` — backend tests (owner backend). `test/app.test.mjs` — frontend tests
    (owner frontend; run app.js in `node:vm` with a fake DOM + fake fetch, and check index.html markup).
  - `package.json`: `{"type":"module","scripts":{"start":"node server.mjs","test":"node --test \"test/*.test.mjs\""}}`. Owner: backend.
  - `README.md` — owner docs.
- Data file layout: `{"nextId": <int>, "bookings": [ ...booking objects ]}` (backend owns; validate on load strictly).
- 2026-11-02 · frontend · A 200 reply whose body lacks a `rooms`/`bookings` array shows `Request failed.` and leaves `#room`/the list unchanged · the spec does not cover this case, so we took the stricter reading and handle both requests the same way.
- 2026-11-02 · backend · package.json test script is `node --test "test/*.test.mjs"`, not `node --test test/` · on Node 22.23 `node --test test/` treats the folder as a module and fails (MODULE_NOT_FOUND); the glob form (expanded by Node itself) runs every `test/*.test.mjs`, the frontend's `test/app.test.mjs` included. Docs: README should say `npm test`.
- 2026-11-02 · backend · Data file load is strict: exactly keys `nextId` (safe integer >= 1) and `bookings` (array of objects with exactly id/room/title/date/start/end, all valid by the booking rules, title already trimmed, ids unique and < nextId, no overlaps); anything else → `cannot read data file <name>` · stricter reading of "not data in the layout this server writes".
- 2026-11-02 · backend · Concurrency: after the body is fully read, routing, validation, save (`fs.writeFileSync`, no temp file, no mkdir) and state swap run synchronously, so requests are serialized without a lock; state is swapped only after a successful save (rollback incl. nextId) · simplest correct serialization.
- 2026-11-02 · backend · Test helpers live in `test/helpers.mjs` (backend-owned) · keeps test/server.test.mjs under 800 lines.
- 2026-11-02 · testing · "One line" on stderr for a bad PORT means no CR or LF before the final "\n" (a CR counts as a line break) · stricter reading; a PORT holding CR/LF must not be echoed raw. Covered by test/final.test.mjs.
