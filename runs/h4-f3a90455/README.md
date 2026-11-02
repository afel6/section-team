# Room bookings

A small meeting-room booking app: a Node.js HTTP server (`server.mjs`, no dependencies)
serving a JSON API and a browser page. Bookings are stored in a single JSON file.

## Usage

```sh
npm start                          # same as: node server.mjs
PORT=8080 DATA_FILE=data/bookings.json node server.mjs
```

Then open http://127.0.0.1:3000/ (or your port).

- `PORT` — port to listen on (127.0.0.1 only). Default `3000`; `0` picks a free port.
- `DATA_FILE` — data file path, relative to the current directory. Default `bookings.json`.
  A missing file means no bookings yet; its folder is never created.

## API

| Method | Path | Result |
| ------ | ---- | ------ |
| GET | `/api/rooms` | `{"rooms": ["Aurora", "Borealis", "Cosmos"]}` |
| GET | `/api/bookings[?date=YYYY-MM-DD]` | `{"bookings": [...]}` sorted by date, start, room |
| POST | `/api/bookings` | JSON body `room`, `title`, `date`, `start`, `end` → 201 and the booking |
| DELETE | `/api/bookings/<id>` | 204, or 404 `booking not found` |

Errors are `{"error": "<message>"}` (400, 404, 405, 409, 413, 415, 500).

Example:

```sh
curl -X POST localhost:3000/api/bookings -H 'Content-Type: application/json' \
  -d '{"room":"Aurora","title":"Standup","date":"2026-11-03","start":"09:00","end":"10:00"}'
```

## Tests

```sh
npm test
```
