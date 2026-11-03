# Backend API notes (owner: backend) — 2026-11-03

Implementation: `server.mjs` (single file, Node built-ins only), `package.json`.

## Data file layout
`{"nextId": <int>, "bookings": [{"id","room","title","date","start","end"}, ...]}`
- Written with `JSON.stringify(store)` (compact) via `fs.promises.writeFile(path)` straight to
  the DATA_FILE path; no temp file, no folder creation.
- Accepted at startup only when: top level is an object with exactly the keys `nextId` and
  `bookings`; `nextId` safe integer >= 1 and > every id; every booking has exactly the 6 keys,
  `id` safe integer >= 1 (unique), valid room/date/start/end, `end > start`, title already trimmed
  and 1-80 UTF-16 units; no two bookings overlap. Anything else (incl. empty file, BOM, `[]`,
  ENOTDIR, EISDIR, EACCES) -> stderr `cannot read data file <DATA_FILE as given>` + exit 1.
  Only `ENOENT` means "no bookings yet" (nextId 1).
- Fixture example for tests:
  `{"nextId":3,"bookings":[{"id":2,"room":"Aurora","title":"Standup","date":"2026-11-03","start":"09:00","end":"10:00"}]}`

## Write serialisation
- All mutations (POST create, DELETE) go through one promise queue in `createRepository`.
  Inside the queue: overlap check (rule 10) / id lookup, build the next store, write the file,
  then swap memory. Write failure -> 500 `internal error`, memory unchanged (nextId too).
- Rules 1-9 run before entering the queue; rule 10 runs inside it, so concurrent overlapping
  POSTs give exactly one 201.

## HTTP details worth knowing for tests
- Every request body is read to the end before replying (413/415 included); bytes over 10000
  are counted and discarded, the socket is never destroyed early.
- Routing uses raw `req.url` split at the first `?`; byte-for-byte path compare.
- `http.createServer({ requireHostHeader: false })` so Host-less HTTP/1.1 requests reach routing.
- HEAD -> 405 (Node omits the body on HEAD replies, status/headers still sent).
- CONNECT is answered on the raw socket: 405 for a known path, 404 otherwise.
- Unknown `Expect:` values are routed normally (no automatic 417).
- 204 replies carry no body and no Content-Type.
- `GET /` and `GET /app.js` read `public/index.html` / `public/app.js` per request (relative to
  server.mjs); read failure -> 500 `internal error`.
- Startup failures: invalid PORT -> stderr `invalid PORT "<value>"`; bind failure -> stderr
  `cannot listen on port <p>: <code>`; both exit 1. PORT is checked before the data file.
- Stdout: only `listening on http://127.0.0.1:<port>\n`.
- Smoke script (not a test suite): `.team/backend-smoke/smoke.mjs`.
