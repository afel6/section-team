# Room bookings

A small meeting-room booking app: one Node.js HTTP server (`server.mjs`) that serves a JSON API
and a browser page, and keeps its bookings in one JSON file. There are three fixed rooms:
`Aurora`, `Borealis` and `Cosmos`.

## Requirements

- Node.js 22 or later.
- No dependencies: only Node built-ins are used, so there is nothing to `npm install`.

## Usage

```sh
npm start            # same as: node server.mjs
PORT=8080 DATA_FILE=data/bookings.json node server.mjs
```

The server listens on `127.0.0.1` only. Once it is listening it prints one line to stdout:

```
listening on http://127.0.0.1:3000
```

### Environment variables

| Variable    | Default         | Meaning |
|-------------|-----------------|---------|
| `PORT`      | `3000`          | Port to listen on. Must be ASCII digits only, at most `65535`. `PORT=0` lets the OS pick a free port (the printed line shows the real one). Unset or empty means the default. |
| `DATA_FILE` | `bookings.json` | Path of the data file. A relative path, the default included, is resolved against the **current working directory**, not the folder of `server.mjs`. Unset or empty means the default. |

### Startup errors

At startup the server checks `PORT`, then reads the data file, then starts listening. If a step
fails, it writes one line to stderr and exits with code 1:

| stderr line                  | Cause |
|------------------------------|-------|
| `invalid PORT`               | `PORT` is not digits only, or is above 65535. |
| `cannot read data file <name>` | The data file cannot be read for any reason other than "does not exist" (for example it is a directory), or its content is not in the layout the server writes (empty, invalid JSON, wrong keys, bad bookings). `<name>` is `DATA_FILE` as given. |
| `port <n> is already in use` | Another process holds the port. |
| `port <n> cannot be used`    | The port cannot be bound for another reason. |

A missing data file (or a missing folder on its path) is not an error: the server starts with no
bookings and does not create the file until the first change.

## The page

Open `http://127.0.0.1:<port>/` in a browser. The page (`public/index.html` with its script
`public/app.js`) lets you:

- book a room by choosing room, title, date, start and end, then pressing **Book**;
- see the bookings, optionally only those on one date (**Show date**), or all of them (**Show all**);
- cancel a booking with its **Cancel** button.

Errors from the server (for example `room is already booked from 09:00 to 10:00`) are shown
under the list; if the server is down the page shows `Could not reach the server.`

## API

All JSON replies use `Content-Type: application/json; charset=utf-8`. Errors are
`{"error": "<message>"}`. A booking looks like:

```json
{"id": 1, "room": "Aurora", "title": "Standup", "date": "2026-11-03", "start": "09:00", "end": "10:00"}
```

Ids start at 1, increase by one per new booking, and are never reused (not even after deletes
or restarts).

| Route | Success | Errors |
|-------|---------|--------|
| `GET /api/rooms` | 200 `{"rooms": ["Aurora", "Borealis", "Cosmos"]}` | |
| `GET /api/bookings` | 200 `{"bookings": [...]}`, sorted by date, then start, then room order | 400 `date must be a valid YYYY-MM-DD date` |
| `GET /api/bookings?date=YYYY-MM-DD` | 200, only bookings on that date | same 400 for an invalid or empty `date` |
| `POST /api/bookings` | 201 and the new booking | see booking rules below |
| `DELETE /api/bookings/<id>` | 204, empty body | 404 `booking not found` (no such id, or `<id>` is not a positive integer without leading zeros) |
| `GET /`, `GET /app.js` | 200, the page and its script | |

For every route:

- Any other path: 404 `not found`. Paths are matched exactly (no decoding or normalising), so
  `/API/rooms` and `/api/bookings/` are not found.
- A known path with a method it does not support (`HEAD` and `OPTIONS` included): 405 `method not allowed`.
- An unexpected failure, including a failed save of the data file: 500 `internal error`; nothing
  changes and the server keeps running.

### Booking rules (`POST /api/bookings`)

The first rule that fails decides the reply:

1. `Content-Type` media type is not `application/json`: 415 `content type must be application/json`.
2. Body is over 10000 bytes: 413 `body too large`.
3. Body is not a JSON object: 400 `body must be a JSON object`.
4. `room` is not exactly one of the room names: 400 `room must be one of Aurora, Borealis, Cosmos`.
5. `title`, after trimming, is not 1 to 80 characters: 400 `title must be 1 to 80 characters`.
   The stored title is trimmed.
6. `date` is not a real day `YYYY-MM-DD` from 2000-01-01 to 2099-12-31: 400 `date must be a valid YYYY-MM-DD date`.
7. `start` is not `HH:MM` from `00:00` to `23:59`: 400 `start must be HH:MM`.
8. `end` is not such a time: 400 `end must be HH:MM`.
9. `end` is not later than `start`: 400 `end must be after start`.
10. It overlaps a booking of the same room on the same date: 409
    `room is already booked from <start> to <end>` (the earliest overlapping booking). A booking
    may start exactly when another ends.

Only `title` is trimmed; other fields must match exactly (`9:00` or `2026-11-3` are invalid).
Extra keys in the body are ignored.

Example:

```sh
curl -i -X POST http://127.0.0.1:3000/api/bookings \
  -H 'Content-Type: application/json' \
  -d '{"room":"Aurora","title":"Standup","date":"2026-11-03","start":"09:00","end":"10:00"}'
```

## Data file

The server reads the data file once at startup and afterwards treats its memory as the truth:
edits made to the file while it runs are not noticed. It writes the file only when a booking is
created or deleted, before replying, and never creates folders. The layout is:

```json
{"nextId": 4, "bookings": [{"id": 2, "room": "Cosmos", "title": "Standup", "date": "2026-11-03", "start": "08:00", "end": "10:00"}]}
```

`nextId` is the id the next booking will get. At startup every booking must follow the booking
rules, have a unique id below `nextId`, and not overlap another booking; otherwise the server
exits with `cannot read data file <name>`.

## Tests

```sh
npm test             # runs: node --test test/
```

The tests use the built-in `node:test` runner, so no install is needed.
