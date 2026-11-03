# Backend API note (owner: backend, 2026-11-03)

## Pages
- `GET /` -> `public/index.html`, `Content-Type: text/html; charset=utf-8`.
- `GET /app.js` -> `public/app.js`, `Content-Type: text/javascript; charset=utf-8`.
- Both resolved from the folder of `server.mjs` (import.meta.url), read fresh on each
  request (so frontend edits show without restart). A missing file -> 500 `internal error`.
- Any other method on `/` or `/app.js` (HEAD included) -> 405.

## API (exactly as in spec.md)
- `GET /api/rooms` -> `{"rooms":["Aurora","Borealis","Cosmos"]}`
- `GET /api/bookings[?date=YYYY-MM-DD]` -> `{"bookings":[...]}` sorted date, start, room order.
- `POST /api/bookings` (Content-Type application/json) -> 201 booking
  `{"id":1,"room":"Aurora","title":"Standup","date":"2026-11-03","start":"09:00","end":"10:00"}`
- `DELETE /api/bookings/<id>` -> 204 empty body; 404 `booking not found`.
- Errors: `{"error":"<message>"}`, every JSON reply `application/json; charset=utf-8`.

## Data file layout (`DATA_FILE`, default `bookings.json`, relative to cwd)
```json
{
  "nextId": 3,
  "bookings": [
    {"id": 1, "room": "Aurora", "title": "Standup", "date": "2026-11-03", "start": "09:00", "end": "10:00"}
  ]
}
```
Validated strictly at startup (anything else -> `cannot read data file <name>`, exit 1):
- valid UTF-8 (no BOM), JSON object with exactly the keys `nextId` and `bookings`;
- `nextId` a safe integer >= 1; `bookings` an array;
- each booking has exactly the six keys, `id` a positive safe integer < `nextId`, unique;
  `room`/`title`/`date`/`start`/`end` valid per the Booking rules, `title` already trimmed,
  `end` > `start`, and no two bookings of the same room and date overlap.
- Written (temp file `<DATA_FILE>.tmp-<pid>` in the same folder, then rename) only on a
  successful POST/DELETE, before the reply. Folders are never created.
