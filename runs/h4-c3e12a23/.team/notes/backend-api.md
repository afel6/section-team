# Backend API notes — owner: backend — 2026-11-02

Source of truth for behaviour is `spec.md`; this note records backend choices only.

## Data file layout
```json
{ "nextId": 3, "bookings": [ { "id": 1, "room": "Aurora", "title": "Standup",
  "date": "2026-11-03", "start": "09:00", "end": "10:00" } ] }
```
- Exactly the keys `nextId` and `bookings`; `nextId` a positive safe integer.
- Each booking has exactly the keys id, room, title, date, start, end; id a positive
  integer < nextId and unique; title already trimmed (1-80 code units); room/date/
  start/end valid by the spec rules; start < end; no two same-room same-date overlaps.
- Anything else (empty file, invalid JSON, extra keys, ...) -> stderr
  `cannot read data file <DATA_FILE as given>` and exit 1. ENOENT -> `{nextId:1,bookings:[]}`.
- Written with `JSON.stringify(state, null, 2) + "\n"` directly to the path (no temp
  file, no mkdir), only on successful POST/DELETE, before the reply.
- Test tip: a fresh empty state on disk is `{"nextId":1,"bookings":[]}`.

## Page files
- `GET /` -> `public/index.html` (`text/html; charset=utf-8`),
  `GET /app.js` -> `public/app.js` (`text/javascript; charset=utf-8`).
- Located via `new URL('./public/...', import.meta.url)` (server.mjs folder, not cwd).
- Read from disk on every request (no cache); a read failure -> 500 `internal error` JSON.

## Concurrency
- Every request's body is read fully first (only the first 10000 bytes are kept; all
  bytes are counted for 413), then routing + handling run through one FIFO queue, so
  state changes and saves are strictly serialised. A failed save leaves memory unchanged.

## stdout / stderr
- stdout: only `listening on http://127.0.0.1:<port>\n`. Bad PORT / bind error: one
  stderr line, exit code 1.
