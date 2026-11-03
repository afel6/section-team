# Data file layout (owner: backend) — 2026-11-03

File: `DATA_FILE` env (unset/empty → `bookings.json`), resolved against the cwd.
UTF-8 JSON, written by `server.mjs` only on a successful POST create or DELETE.

```json
{
  "nextId": 3,
  "bookings": [
    { "id": 2, "room": "Aurora", "title": "x", "date": "2026-11-03", "start": "10:00", "end": "11:00" }
  ]
}
```

Strict validation at startup (anything else → stderr `cannot read data file <name>`, exit 1):
- Top level: an object with exactly the keys `nextId` and `bookings`.
- `nextId`: a safe integer ≥ 1, the id the next booking gets (never reused).
- `bookings`: an array (any order). Each entry has exactly the keys `id, room, title, date, start, end`:
  - `id` a safe integer, 1 ≤ id < nextId, unique.
  - `room` one of Aurora/Borealis/Cosmos; `title` a string already trimmed, 1–80 UTF-16 units.
  - `date` valid per booking rule 6; `start`/`end` valid `HH:MM`, start < end.
  - No two bookings overlap (same room + date, each starts before the other ends).
- Read errors: `ENOENT` → no bookings, nextId 1 (file not created). Any other read error → exit 1.

Fixtures for tests: write `{"nextId":1,"bookings":[]}` for an empty store, or let the file be missing.
An empty file, invalid JSON, a BOM or a directory path all make startup fail.
