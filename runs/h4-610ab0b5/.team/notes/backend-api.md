# Backend API note (owner: backend) — 2026-11-02

Implementation: `server.mjs` (single file, Node built-ins only). `package.json` created by backend
(`name: room-bookings`, `type: module`, `start: node server.mjs`, `test: node --test test/`).

## Data file layout
`{"nextId": <positive safe integer>, "bookings": [ {id, room, title, date, start, end}, ... ]}`
- Written as compact JSON with `fs.promises.writeFile` on each successful POST/DELETE, before the reply.
- Loaded strictly at startup. Rejected (stderr `cannot read data file <name>`, exit 1) unless: an object with
  exactly the keys `nextId` and `bookings`; every booking has exactly the six keys, `id` a positive integer
  `< nextId`, ids unique, fields valid by booking rules 4-9 (title already trimmed, 1-80), and no two
  bookings overlap. A UTF-8 BOM makes it invalid JSON -> rejected. `ENOENT` -> empty `{nextId:1,bookings:[]}`;
  `ENOTDIR` or `EISDIR` etc. -> rejected.
- Tests can seed a data file in this layout to start the server with known bookings.

## Behaviour worth knowing (tests / frontend)
- stdout: only `listening on http://127.0.0.1:<port>\n`. Startup errors: one stderr line, exit 1.
  Bad PORT line: `invalid PORT: ...`; bind failure: `cannot listen on port <p>: <code>`.
- Every reply body is read in full (buffering stops past 10000 bytes) before replying, for all routes/methods.
- Routing compares the raw `req.url` up to the first `?`. Note: `fetch()`/`new URL()` normalise `/./` and
  similar on the client side; use a raw `net` socket or `http.request({path})` to test such paths.
  An absolute-form target (`GET http://x/api/rooms`) is not any path -> 404.
- Precedence: path known? else 404 `not found`; then method -> else 405 `method not allowed` (no Allow header).
  `/api/bookings/<id>` with non-empty, slash-free id is the DELETE route (any other method -> 405).
- DELETE id must match `^[1-9][0-9]*$` and an existing id, else 404 `booking not found`. 204 has no body
  and no Content-Type.
- POST: rules 1-9 checked before the mutation queue; rule 10 + save run inside a promise queue, so
  concurrent overlapping POSTs give exactly one 201. Save failure -> 500 `internal error`, memory and nextId
  unchanged.
- `GET /` and `GET /app.js` read `public/index.html` / `public/app.js` (relative to server.mjs) on each
  request; missing file -> 500 `internal error`. Query string ignored on these.
- JSON replies: `Content-Type: application/json; charset=utf-8` exactly, with Content-Length.
