# Room bookings

A small meeting-room booking app. `server.mjs` is one HTTP server that serves a JSON API and a browser page. You can book three fixed rooms (`Aurora`, `Borealis`, `Cosmos`) by date and time, list and filter bookings, and cancel them. All data is kept in one JSON file.

## Requirements

- Node.js (a version with `node:test`, 18 or later).
- No dependencies. You do not need to run `npm install`.

## Usage

```sh
npm start            # same as: node server.mjs
```

The server listens on `127.0.0.1` only. Once it is ready it prints one line to stdout:

```
listening on http://127.0.0.1:3000
```

Open http://127.0.0.1:3000/ in a browser (use the port from that line).

### Environment variables

| Variable    | Default         | Meaning |
|-------------|-----------------|---------|
| `PORT`      | `3000`          | Port to listen on. Unset or empty means 3000. `PORT=0` lets the OS pick any free port, and the startup line shows which one. It must be ASCII digits only and no more than 65535. |
| `DATA_FILE` | `bookings.json` | Path of the data file. Unset or empty means `bookings.json`. A relative path is resolved against the current working directory, not the folder of `server.mjs`. |

Example:

```sh
PORT=8080 DATA_FILE=data/b.json node server.mjs
```

The server never creates folders, so `data/` must already exist. If it does not, the server still starts, but every booking or cancel that would otherwise succeed fails with `500 internal error` and changes nothing.

On startup the server checks `PORT`, then reads the data file, then starts listening. If `PORT` is invalid or the port cannot be bound (for example because it is already in use), the server writes one line to stderr and exits with code 1.

## Data file

- The file holds `{"nextId": <int>, "bookings": [...]}`.
- It is read once, at startup:
  - If it does not exist, the server starts with no bookings.
  - If it cannot be read for any other reason (for example the path is a directory), or its content is not valid data, the server prints `cannot read data file <name>` to stderr (`<name>` is `DATA_FILE` exactly as given, or `bookings.json`) and exits with code 1.
- After startup the server's memory is the source of truth. Edits made to the file while the server runs are not noticed.
- The file is written only when a booking is created or deleted, and always before the reply is sent. After a restart you get the same bookings and the same next id.
- Ids start at 1 and are never reused, even after deletes and restarts.

## API

Every JSON reply has `Content-Type: application/json; charset=utf-8`. An error reply is `{"error": "<message>"}`.

A booking looks like this:

```json
{"id": 1, "room": "Aurora", "title": "Standup", "date": "2026-11-03", "start": "09:00", "end": "10:00"}
```

| Method & path | Success | Errors |
|---------------|---------|--------|
| `GET /api/rooms` | 200 `{"rooms": ["Aurora", "Borealis", "Cosmos"]}` | |
| `GET /api/bookings` | 200 `{"bookings": [...]}`, sorted by date, then start, then room (in the order above) | |
| `GET /api/bookings?date=YYYY-MM-DD` | 200, with only the bookings on that date | 400 `date must be a valid YYYY-MM-DD date` (an empty value counts as invalid) |
| `POST /api/bookings` | 201 with the new booking | see the validation rules below |
| `DELETE /api/bookings/<id>` | 204, empty body | 404 `booking not found` (the id is unknown, or is not a positive integer without a leading zero) |
| `GET /` | 200, the page (`text/html; charset=utf-8`) | |
| `GET /app.js` | 200, the page script (`text/javascript; charset=utf-8`) | |

Errors that apply to every route:

- Any other path: 404 `not found`. This includes `/api/bookings/` and `/api/bookings/1/`.
- A known path with a method it does not support (HEAD and OPTIONS included): 405 `method not allowed`. For example, `GET /api/bookings/abc` returns 405.
- A failed save or any other unexpected error: 500 `internal error`. Nothing changes, and the server keeps running.

Paths are matched exactly, with no case folding, percent-decoding or slash normalisation. The query string is ignored except for `date` on `GET /api/bookings`.

### `POST /api/bookings` validation

The body needs `room`, `title`, `date`, `start` and `end`. Any other keys are ignored. The rules are checked in this order, and the first rule that fails decides the reply:

| # | Rule | Reply |
|---|------|-------|
| 1 | The `Content-Type` media type must be `application/json` (letter case is ignored, and parameters such as `; charset=utf-8` are allowed) | 415 `content type must be application/json` |
| 2 | The body must be at most 10000 bytes | 413 `body too large` |
| 3 | The body must be a JSON object | 400 `body must be a JSON object` |
| 4 | `room` must be exactly one of the room names | 400 `room must be one of Aurora, Borealis, Cosmos` |
| 5 | `title` must be a string of 1 to 80 characters after trimming (the trimmed title is stored) | 400 `title must be 1 to 80 characters` |
| 6 | `date` must be `YYYY-MM-DD` and a real day from 2000-01-01 to 2099-12-31 | 400 `date must be a valid YYYY-MM-DD date` |
| 7 | `start` must be `HH:MM`, from `00:00` to `23:59` | 400 `start must be HH:MM` |
| 8 | `end` must be `HH:MM`, from `00:00` to `23:59` | 400 `end must be HH:MM` |
| 9 | `end` must be later than `start` | 400 `end must be after start` |
| 10 | The booking must not overlap another booking of the same room on the same date. Back-to-back bookings are allowed. | 409 `room is already booked from <start> to <end>` (the times of the earliest overlapping booking) |

Only `title` is trimmed. Values such as ` 2026-11-03`, `2026-11-3` and `9:00` are rejected.

Example:

```sh
curl -i -X POST http://127.0.0.1:3000/api/bookings \
  -H 'Content-Type: application/json' \
  -d '{"room":"Aurora","title":"Standup","date":"2026-11-03","start":"09:00","end":"10:00"}'
```

## Tests

```sh
npm test             # runs: node --test
```

The tests use `node:test` and live in `test/`. The server tests start `node server.mjs` with `PORT=0` and a temporary data file.
