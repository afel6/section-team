# Server data file and behaviour notes (backend)

Data file layout (exactly what `server.mjs` writes and accepts at startup):

```json
{"nextId": 4, "bookings": [{"id": 2, "room": "Cosmos", "title": "Standup", "date": "2026-11-03", "start": "08:00", "end": "10:00"}]}
```

- Top level: exactly the keys `nextId` and `bookings`. `nextId` is a safe integer >= 1.
- Each booking: exactly `id`, `room`, `title`, `date`, `start`, `end`; it must pass the booking rules
  (title already trimmed, 1-80 chars), have a unique id < nextId, and not overlap another stored booking.
- Anything else (empty file, invalid JSON, `[]`, extra keys) -> stderr `cannot read data file <name>`, exit 1.
- Only `ENOENT` means "no bookings yet"; every other read error (EISDIR, ENOTDIR, EACCES) -> exit 1.
- The file is written with `writeFile` (in place, no temp file) only on a successful POST create or DELETE.
- Tests can seed a server by writing this layout before starting it.

stderr lines (one line each, exit 1): `invalid PORT`, `port <n> is already in use`, `port <n> cannot be used`,
`cannot read data file <name>`.

Static files: `public/index.html` and `public/app.js` are read on every request, relative to the folder of
server.mjs; a read failure -> 500 `internal error`.
