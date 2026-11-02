# Backend API notes — owner: backend — 2026-11-02

Implements spec.md (Server, API, Booking rules) in `server.mjs` (one ES module, built-ins only).

## Scripts (package.json)
- `start`: `node server.mjs`
- `test`: `node --test "test/**/*.test.mjs"` — NOT `node --test test/`: on Node 22.23 a folder
  argument fails ("Cannot find module"), the quoted glob works. Name test files `test/*.test.mjs`.

## Data file layout (strictly validated at startup)
```
{"nextId": <safe integer >= 1, greater than every id>,
 "bookings": [{"id", "room", "title", "date", "start", "end"}, ...]}
```
- Top level: exactly the two keys `nextId`, `bookings`. Each booking: exactly the six keys;
  `id` a positive safe integer, unique; room one of the three; title already trimmed, 1-80;
  date/start/end valid by rules 6-8; end > start; no two bookings overlap.
- Any failure, or empty/invalid JSON, or a non-ENOENT read error (e.g. a directory) gives
  stderr `cannot read data file <DATA_FILE as given>\n` and exit 1. ENOENT (including a
  missing parent folder) means `{nextId: 1, bookings: []}`. The file is not created at startup.
- Fixture for tests (valid): `{"nextId":5,"bookings":[{"id":2,"room":"Aurora","title":"T","date":"2026-11-03","start":"09:00","end":"10:00"}]}`
- Save: writes `<file>.<pid>.tmp` beside the data file, then renames it over the data file.
  Done only on a successful POST (201) or DELETE (204). Memory is updated only after the save
  succeeds; on failure the reply is 500 `internal error` and the state (next id too) is unchanged.
  Folders are never created (DATA_FILE=`missing/x.json` starts fine, then POST gives 500).

## Pages
- `GET /` serves `public/index.html` (`text/html; charset=utf-8`), `GET /app.js` serves `public/app.js`
  (`text/javascript; charset=utf-8`). Read per request from `<folder of server.mjs>/public/`
  (via import.meta.url), not cwd. A missing file gives 500 `internal error`. A query is ignored (`/app.js?x` works).
  Other methods on these paths give 405.

## Behaviour details testing may rely on
- stdout: only `listening on http://127.0.0.1:<port>\n`. stderr: one line on startup failure
  (invalid PORT, bind error, data file), plus one `request failed: ...` line per unexpected
  500 (for example a save failure). Expected 4xx replies log nothing.
- All requests are queued after their body is fully read, so they are handled one at a time.
- The body is always drained; 413 counts every byte received (more than 10000 gives 413), and
  only applies after the 415 check (rule order).
- Non-page replies: `Content-Type: application/json; charset=utf-8`; 204 has no body and no
  Content-Type. 405 replies have no Allow header.
- Malformed HTTP gets a raw `400 Bad Request` from the clientError handler; aborted
  uploads are dropped; the server stays up.
- DELETE id: `^[1-9][0-9]*$` and a safe integer, otherwise 404 `booking not found`.
