# Meeting-room booking

A small meeting-room booking app: an HTTP server (`server.mjs`) with a JSON API
and a browser page. All data is kept in one JSON file. There are three fixed rooms:
`Aurora`, `Borealis` and `Cosmos`.

## Requirements

- Node.js 22 or later.
- No dependencies, so there is nothing to `npm install`. The app uses only Node.js built-ins.

## Usage

```sh
npm start            # same as: node server.mjs
```

When the server is up it prints one line to stdout:

```
listening on http://127.0.0.1:3000
```

Open <http://127.0.0.1:3000/> in a browser to book rooms, list bookings (all of them
or one date) and cancel bookings. The server listens on `127.0.0.1` only.

### Environment variables

| Variable    | Default         | Meaning |
|-------------|-----------------|---------|
| `PORT`      | `3000`          | Port to listen on. Must be ASCII digits only, at most `65535`. `PORT=0` lets the OS pick a free port; the listening line shows the port it picked. An empty value means the default. |
| `DATA_FILE` | `bookings.json` | Path of the data file. A relative path is resolved against the current working directory, not the folder of `server.mjs`. An empty value means the default. |

```sh
PORT=8080 DATA_FILE=/var/lib/rooms/bookings.json node server.mjs
```

### Startup and exit codes

At startup the server checks `PORT`, then reads the data file, then starts listening.
If a step fails, it writes one line to stderr and exits with code `1`:

| Problem | stderr line |
|---------|-------------|
| `PORT` is not digits only, or is above 65535 | `invalid PORT "<value>"` |
| The data file cannot be read (for example it is a directory), or it is empty, not valid JSON, or not in the layout below | `cannot read data file <DATA_FILE as given>` |
| The port cannot be bound (for example it is in use) | `cannot listen on port <port>: <error code>` |

A missing data file, or a missing folder on its path, is not an error: the server starts
with no bookings. The file is not created at startup. It is first written when a booking
is created or deleted. The server never creates folders, so if the folder does not exist,
every POST and DELETE gets `500 internal error`.

The server reads the data file once, at startup. Changes made to the file while the
server runs are not noticed, and the server's next save overwrites them.

The server writes nothing else to stdout. On stderr it writes one `request failed: ...`
line for each unexpected 500 error (for example a failed save). Normal 4xx replies are
not logged.

## API

Every JSON reply has `Content-Type: application/json; charset=utf-8`. An error reply is
`{"error": "<message>"}`. Routes match the path (the request target up to the first `?`)
exactly: no percent-decoding, no case folding and no slash normalisation.

| Method   | Path                  | Success |
|----------|-----------------------|---------|
| `GET`    | `/`                   | 200, the page (`text/html; charset=utf-8`) |
| `GET`    | `/app.js`             | 200, the page script (`text/javascript; charset=utf-8`) |
| `GET`    | `/api/rooms`          | 200, the room list |
| `GET`    | `/api/bookings`       | 200, the bookings (optional `?date=YYYY-MM-DD`) |
| `POST`   | `/api/bookings`       | 201, the new booking |
| `DELETE` | `/api/bookings/<id>`  | 204, no body |

Any other path gives `404 not found`. A known path called with another method (`HEAD` and
`OPTIONS` included) gives `405 method not allowed`. For example `GET /api/bookings/1` is 405,
and `/api/bookings/` and `/api/bookings/1/` are 404 `not found`.

### Booking object

```json
{ "id": 1, "room": "Aurora", "title": "Standup", "date": "2026-11-03", "start": "09:00", "end": "10:00" }
```

Ids start at 1 and go up by one. An id is never reused, even after deletes and restarts.

### `GET /api/rooms`

```json
{ "rooms": ["Aurora", "Borealis", "Cosmos"] }
```

### `GET /api/bookings`

Returns every booking sorted by date, then start, then room (in the order above).

```sh
curl http://127.0.0.1:3000/api/bookings?date=2026-11-03
```

```json
{ "bookings": [
  { "id": 1, "room": "Aurora", "title": "Standup", "date": "2026-11-03", "start": "09:00", "end": "10:00" }
] }
```

With a `date` query parameter, only bookings on that date are returned. If there is more
than one, the first one counts. A `date` that is empty (`?date` or `?date=`) or not a valid
date gets `400 date must be a valid YYYY-MM-DD date`. Other query parameters are ignored.

### `POST /api/bookings`

```sh
curl -i -X POST http://127.0.0.1:3000/api/bookings \
  -H 'Content-Type: application/json' \
  -d '{"room":"Aurora","title":"Standup","date":"2026-11-03","start":"09:00","end":"10:00"}'
```

Reply `201` with the new booking. Extra keys in the body are ignored.

#### Booking rules

The rules are checked in this order, and the first one that fails decides the reply:

| # | Rule | Status | Message |
|---|------|--------|---------|
| 1 | `Content-Type` media type is `application/json` (case-insensitive, parameters such as `; charset=utf-8` allowed) | 415 | `content type must be application/json` |
| 2 | Body is at most 10000 bytes | 413 | `body too large` |
| 3 | Body is a JSON object (UTF-8; a leading byte order mark makes it invalid) | 400 | `body must be a JSON object` |
| 4 | `room` is exactly `Aurora`, `Borealis` or `Cosmos` (case matters) | 400 | `room must be one of Aurora, Borealis, Cosmos` |
| 5 | `title` is a string of 1 to 80 characters after trimming whitespace at both ends; the trimmed title is stored | 400 | `title must be 1 to 80 characters` |
| 6 | `date` is `YYYY-MM-DD` and names a real day from 2000-01-01 to 2099-12-31 | 400 | `date must be a valid YYYY-MM-DD date` |
| 7 | `start` is `HH:MM` from `00:00` to `23:59` | 400 | `start must be HH:MM` |
| 8 | `end` is `HH:MM` from `00:00` to `23:59` | 400 | `end must be HH:MM` |
| 9 | `end` is later than `start` | 400 | `end must be after start` |
| 10 | No overlap with another booking of the same room on the same date | 409 | `room is already booked from <start> to <end>` |

- Only `title` is trimmed. Values such as ` 2026-11-03`, `2026-11-3` or `9:00` are invalid.
- Two bookings overlap when each one starts before the other ends. A booking may start
  exactly when another one ends. The 409 message gives the times of the clashing booking
  that starts earliest.

### `DELETE /api/bookings/<id>`

```sh
curl -i -X DELETE http://127.0.0.1:3000/api/bookings/1
```

Reply `204` with an empty body. If `<id>` is not a positive integer written without a
leading zero (for example `abc`, `01` or `-1`), or no booking has that id, the reply is
`404 booking not found`.

### Status codes

| Status | When |
|--------|------|
| 200 | Successful `GET` |
| 201 | Booking created |
| 204 | Booking deleted |
| 400 | Invalid body, field or `date` filter (rules 3-9) |
| 404 | Unknown path (`not found`) or unknown booking id (`booking not found`) |
| 405 | Known path, wrong method (`method not allowed`) |
| 409 | Booking overlaps an existing one |
| 413 | Body over 10000 bytes |
| 415 | Missing or wrong `Content-Type` on `POST` |
| 500 | Failed save or other unexpected error (`internal error`); nothing is changed and the server keeps running |

Requests are handled one at a time, in order, after each body has been fully read. So if
several overlapping bookings are sent at once, exactly one is created and the others get 409.

## Data file format

```json
{
  "nextId": 3,
  "bookings": [
    { "id": 1, "room": "Aurora", "title": "Standup", "date": "2026-11-03", "start": "09:00", "end": "10:00" }
  ]
}
```

- `nextId`: the id the next booking will get. A positive integer, greater than every
  booking id.
- `bookings`: booking objects with exactly the six keys shown, unique ids, already-trimmed
  titles, valid fields as in the booking rules, and no two bookings that overlap.

The file is checked strictly at startup. Anything else, extra keys included, gives
`cannot read data file ...` and exit code 1. Each change is saved before the reply is
sent: the server writes `<DATA_FILE>.<pid>.tmp` beside the data file and then renames it
over the data file, so a failed save leaves the old file as it was.

## Running tests

```sh
npm test             # node --test "test/**/*.test.mjs"
```

Tests use the built-in `node:test` runner. Test files are named `test/*.test.mjs`.

## Project layout

```
server.mjs          HTTP server, JSON API, data file handling
public/index.html   the booking page
public/app.js       the page script (classic script, plain fetch + DOM)
test/*.test.mjs     node:test tests
package.json        "type": "module", start and test scripts
README.md           this file
```
