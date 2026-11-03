# Room bookings

A small meeting-room booking app. One Node.js server (`server.mjs`) serves a
JSON API and a browser page, and keeps every booking in a single JSON file.
There are three fixed rooms: `Aurora`, `Borealis` and `Cosmos`.

## Requirements

- Node.js 18 or later (the server and tests use only built-in modules).
- No dependencies. Nothing to install: there is no `npm install` step.

## Usage

```sh
npm start            # same as: node server.mjs
```

Once it is listening, the server prints exactly one line to stdout:

```
listening on http://127.0.0.1:3000
```

Open that address in a browser to use the page. The server only listens on
`127.0.0.1`.

### Environment variables

| Variable    | Default         | Meaning |
|-------------|-----------------|---------|
| `PORT`      | `3000`          | Port to listen on. Must be ASCII digits only, at most `65535`. `0` lets the OS pick a free port (the printed line shows the real one). Unset or empty means the default. |
| `DATA_FILE` | `bookings.json` | Path of the data file. A relative path, the default included, is resolved against the current working directory, not the folder of `server.mjs`. Unset or empty means the default. |

```sh
PORT=8080 npm start
PORT=0 DATA_FILE=/tmp/rooms.json node server.mjs
DATA_FILE=data/bookings.json node server.mjs   # the data/ folder must already exist
```

### Startup order and exit codes

At startup the server checks `PORT`, then reads the data file, then starts
listening. Any startup failure writes one line to stderr, prints nothing on
stdout, and exits with code `1`:

| Cause | stderr line |
|-------|-------------|
| `PORT` is not all digits, or is above 65535 | `invalid PORT "<value>"` |
| The data file exists but cannot be read, or its content is not the layout below (empty, bad JSON, a folder, and so on) | `cannot read data file <DATA_FILE as given>` |
| The port cannot be bound (for example it is in use) | `cannot listen on 127.0.0.1:<port>: <code>` (for example `EADDRINUSE`) |

A missing data file (or a missing folder on its path, `ENOENT`) is not an
error: the server starts with no bookings. After startup the server keeps
running until it is stopped; errors while handling requests are logged to
stderr as `server error: <code>` and answered with 500.

## API

All JSON replies have `Content-Type: application/json; charset=utf-8`. Every
error reply has the body `{"error": "<message>"}`.

Paths are matched byte for byte against the request target up to the first
`?`: no percent-decoding and no slash, dot-segment or case normalisation
(`/API/rooms` and `/api/bookings/` are not valid routes). The query string is
ignored except for `date` on `GET /api/bookings`.

| Method and path | Success | Errors |
|-----------------|---------|--------|
| `GET /api/rooms` | 200 `{"rooms": ["Aurora", "Borealis", "Cosmos"]}` | |
| `GET /api/bookings` | 200 `{"bookings": [...]}` | 400 `date must be a valid YYYY-MM-DD date` |
| `POST /api/bookings` | 201, the new booking | 415, 413, 400, 409, 500 (see below) |
| `DELETE /api/bookings/<id>` | 204, empty body | 404 `booking not found`, 500 `internal error` |
| `GET /` | 200, the page (`text/html; charset=utf-8`) | |
| `GET /app.js` | 200, the page script (`text/javascript; charset=utf-8`) | |

Errors that apply to every route:

- Unknown path, any method: 404 `not found`. This includes `/api/bookings/`
  and any `/api/bookings/...` path whose rest contains a `/`.
- Known path with a method not listed for it (HEAD and OPTIONS included):
  405 `method not allowed`. For example `GET /api/bookings/1` is 405.
- Any unexpected failure, including a failed save: 500 `internal error`.

### Bookings

A booking has exactly these keys:

```json
{"id": 1, "room": "Aurora", "title": "Standup", "date": "2026-11-03", "start": "09:00", "end": "10:00"}
```

Ids start at 1 and go up by one. An id is never reused, even after deletes
and restarts.

### `GET /api/bookings`

Returns every booking, sorted by date, then start time, then room (in the
order Aurora, Borealis, Cosmos).

```sh
curl http://127.0.0.1:3000/api/bookings
curl 'http://127.0.0.1:3000/api/bookings?date=2026-11-03'
```

With a `date` query parameter, only bookings on that date are returned. The
first `date` value counts if it is repeated, and `?date` with no value counts
as the empty value. A value that is not a valid date (rule 6 below, the empty
value included) gets 400 `date must be a valid YYYY-MM-DD date`.

### `POST /api/bookings`

```sh
curl -i -X POST http://127.0.0.1:3000/api/bookings \
  -H 'Content-Type: application/json' \
  -d '{"room":"Aurora","title":"Standup","date":"2026-11-03","start":"09:00","end":"10:00"}'
```

```
HTTP/1.1 201 Created
{"id":1,"room":"Aurora","title":"Standup","date":"2026-11-03","start":"09:00","end":"10:00"}
```

Other keys in the body are ignored. The rules are checked in this order, and
the first one that fails decides the reply:

| # | Rule | Reply |
|---|------|-------|
| 1 | The `Content-Type` media type (before the first `;`, spaces and tabs trimmed, case ignored) is `application/json` | 415 `content type must be application/json` |
| 2 | The body is at most 10000 bytes | 413 `body too large` |
| 3 | The body (decoded as UTF-8) parses as a JSON object, not an array, `null`, a string, number or boolean, and is not empty | 400 `body must be a JSON object` |
| 4 | `room` is exactly `Aurora`, `Borealis` or `Cosmos` (case matters) | 400 `room must be one of Aurora, Borealis, Cosmos` |
| 5 | `title` is a string of 1 to 80 characters (UTF-16 code units) after trimming whitespace at both ends | 400 `title must be 1 to 80 characters` |
| 6 | `date` is `YYYY-MM-DD`, a real day from 2000-01-01 to 2099-12-31 (February has 29 days in years divisible by 4) | 400 `date must be a valid YYYY-MM-DD date` |
| 7 | `start` is `HH:MM`, from `00:00` to `23:59` | 400 `start must be HH:MM` |
| 8 | `end` is `HH:MM`, from `00:00` to `23:59` | 400 `end must be HH:MM` |
| 9 | `end` is later than `start` | 400 `end must be after start` |
| 10 | No overlap with a booking of the same room on the same date | 409 `room is already booked from <start> to <end>` |

- Only `title` is trimmed, and the booking stores the trimmed title. No other
  field is changed: ` 2026-11-03`, `2026-11-3` and `9:00` are invalid.
- Two bookings overlap when each starts before the other ends. A booking may
  start exactly when another ends. The 409 message names the start and end of
  the overlapping booking that starts earliest, for example
  `room is already booked from 09:00 to 10:00`.
- Requests that arrive at the same time are handled one at a time: of several
  overlapping bookings sent at once, exactly one is created and the others get
  409.

### `DELETE /api/bookings/<id>`

```sh
curl -i -X DELETE http://127.0.0.1:3000/api/bookings/1
```

Replies 204 with an empty body. When `<id>` is not a positive integer in plain
digits without a leading zero (for example `abc`, `01`, `-1`), or no booking
has that id, the reply is 404 `booking not found`.

## Data file

The data file holds one JSON object, written compactly with no trailing
newline:

```json
{"nextId":3,"bookings":[{"id":1,"room":"Aurora","title":"Standup","date":"2026-11-03","start":"09:00","end":"10:00"}]}
```

- `nextId` is the id the next booking will get. `bookings` is kept in creation
  order; the API sorts on read.
- The file is read once, at startup. It must be exactly this layout: only the
  keys `nextId` and `bookings`; each booking with exactly its six keys and
  valid values (title already trimmed, end after start); ids unique, at least
  1 and below `nextId`; and no two bookings overlapping. Anything else stops
  startup with `cannot read data file <name>`.
- After startup, memory is the source of truth. Changes made to the file from
  outside are not noticed.
- The file is written only when a POST creates a booking or a DELETE removes
  one, and the save finishes before the reply is sent, so a restart with the
  same `DATA_FILE` keeps the bookings and the next id.
- The server never creates folders. If a save fails (for example because the
  file's folder does not exist), the reply is 500 `internal error` and nothing
  changes, the next id included. The server keeps running.
- The file is overwritten in place (no temp file). A write that fails partway,
  for example on a full disk, can leave it damaged, and the next startup will
  then refuse it.

## Tests

```sh
npm test             # runs: node --test test/
```

The tests use the built-in `node:test` runner and live in `test/`. To run the
server the same way by hand without touching your `bookings.json`, use
`PORT=0` and a temporary `DATA_FILE`.

## Files

```
server.mjs        HTTP server, API and data file handling
public/index.html the page (served at /)
public/app.js     the page script (served at /app.js)
test/             node:test tests
package.json      start and test scripts ("type": "module")
```
