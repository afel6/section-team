# Room bookings

A small meeting-room booking app: a Node.js HTTP server (`server.mjs`, no dependencies)
with a JSON API and a browser page. Data is kept in one JSON file.

## Usage

```sh
npm start                              # same as: node server.mjs
PORT=8080 DATA_FILE=data/rooms.json node server.mjs
```

Then open the printed address (default `http://127.0.0.1:3000`).

- `PORT`: port to listen on (127.0.0.1 only). Default `3000`; `0` picks a free port.
- `DATA_FILE`: JSON data file, relative to the current directory. Default `bookings.json`.
  A missing file means no bookings yet. Its folder is never created.

## API

| Method & path               | Result                                                   |
|-----------------------------|----------------------------------------------------------|
| `GET /api/rooms`            | `{"rooms": ["Aurora", "Borealis", "Cosmos"]}`            |
| `GET /api/bookings[?date=]` | `{"bookings": [...]}`, sorted by date, start and room     |
| `POST /api/bookings`        | JSON body `room`, `title`, `date`, `start`, `end` → 201  |
| `DELETE /api/bookings/<id>` | 204, or 404 `booking not found`                          |

Errors are `{"error": "<message>"}` (400, 404, 405, 409, 413, 415 or 500).

## Tests

```sh
npm test
```
