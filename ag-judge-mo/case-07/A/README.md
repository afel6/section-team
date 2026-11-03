# Room bookings

A small meeting-room booking app. One Node.js server (`server.mjs`) serves a JSON
API and a browser page, and stores all bookings in a single JSON file. There are
three fixed rooms: `Aurora`, `Borealis` and `Cosmos`.

## Requirements

- Node.js 22 or later.
- No dependencies. The app uses only Node.js built-ins, so you don't need `npm install`.

## Usage

```sh
npm start            # same as: node server.mjs
```

Then open <http://127.0.0.1:3000> in a browser. Use the page to book a room,
list bookings (all of them, or one date with **Show date**), and cancel bookings.

When the server is listening, it prints one line to stdout:

```
listening on http://127.0.0.1:3000
```

The server only ever writes that line to stdout. Errors go to stderr.

### Environment variables

| Variable    | Default         | Meaning |
|-------------|-----------------|---------|
| `PORT`      | `3000`          | Port to listen on. The server always binds to `127.0.0.1`. `PORT=0` lets the OS pick a free port, and the startup line shows which one. |
| `DATA_FILE` | `bookings.json` | Path of the data file. A relative path is resolved against the current working directory, not the folder that holds `server.mjs`. |

An unset or empty variable uses its default.

```sh
PORT=8080 DATA_FILE=/var/lib/rooms/bookings.json node server.mjs
```

### Startup errors

At startup the server checks `PORT` first, then reads the data file, then starts
listening. It writes one line to stderr and exits with code 1 when:

- `PORT` is not made only of the digits 0-9, or is above 65535.
- The port cannot be bound, for example because another process is using it.
- The data file cannot be read for any reason other than "does not exist", or its
  content is not valid data, for example an empty file or invalid JSON. In this
  case the message is `cannot read data file <name>`, where `<name>` is
  `DATA_FILE` exactly as you gave it.

If the data file (or a folder on its path) does not exist, the server starts with
no bookings.

### Data file

The data file is a JSON object with exactly two keys:

```json
{
  "nextId": 2,
  "bookings": [
    {"id": 1, "room": "Aurora", "title": "Standup", "date": "2026-11-03", "start": "09:00", "end": "10:00"}
  ]
}
```

- `nextId` is the id the next booking will get, a whole number of at least 1. The
  server keeps it in the file, so ids are never reused, even after deletes and restarts.
- `bookings` is an array of bookings, each with exactly the six booking keys.

The server checks the file strictly at startup. It exits with `cannot read data file <name>`
if any of these fail:

- The file is valid UTF-8 JSON with no byte order mark.
- Every booking id is unique and lower than `nextId`.
- Every field passes the booking rules below, and `title` is already trimmed.
- No two bookings for the same room on the same date overlap.

The server:

- reads the file once, at startup, and doesn't notice changes made to it from outside after that.
- writes the file only when a booking is created or deleted, and saves each change before it
  replies. It first writes a temporary file `<DATA_FILE>.tmp-<pid>` in the same folder, then
  renames it over the data file.
- never creates folders. If a save fails, for example because the folder is
  missing, the request returns 500 and nothing changes.

## API

All JSON replies use `Content-Type: application/json; charset=utf-8`. Every error
reply has the body `{"error": "<message>"}`.

| Method & path               | Success | Reply |
|-----------------------------|---------|-------|
| `GET /api/rooms`            | 200 | `{"rooms": ["Aurora", "Borealis", "Cosmos"]}` |
| `GET /api/bookings`         | 200 | `{"bookings": [...]}`, sorted by date, then start, then room (in the order above) |
| `GET /api/bookings?date=YYYY-MM-DD` | 200 | Only the bookings on that date. An invalid or empty date gets 400 `date must be a valid YYYY-MM-DD date`. |
| `POST /api/bookings`        | 201 | The new booking |
| `DELETE /api/bookings/<id>` | 204 | Empty body. An unknown or malformed id gets 404 `booking not found`. |
| `GET /`, `GET /app.js`      | 200 | The page (`text/html`) and its script (`text/javascript`) |

A booking looks like this:

```json
{"id": 1, "room": "Aurora", "title": "Standup", "date": "2026-11-03", "start": "09:00", "end": "10:00"}
```

Ids start at 1 and go up by one for each new booking.

Other errors:

- Any other path, with any method: 404 `not found`. Paths are matched exactly,
  with no decoding or normalisation. For example, `/api/bookings/` and `/API/rooms`
  are unknown paths.
- A known path with a method it doesn't support, including `HEAD` and `OPTIONS`: 405 `method not allowed`.
- An unexpected server failure, including a failed save: 500 `internal error`.

### Creating a booking

Send `POST /api/bookings` with `Content-Type: application/json` and a JSON object
that has `room`, `title`, `date`, `start` and `end`. Other keys are ignored. The server
checks these rules in order and replies with the first one that fails:

| # | Rule | Status | Message |
|---|------|--------|---------|
| 1 | Media type is `application/json` | 415 | `content type must be application/json` |
| 2 | Body is at most 10000 bytes | 413 | `body too large` |
| 3 | Body is a JSON object | 400 | `body must be a JSON object` |
| 4 | `room` is exactly `Aurora`, `Borealis` or `Cosmos` | 400 | `room must be one of Aurora, Borealis, Cosmos` |
| 5 | `title` is 1 to 80 characters after trimming (the trimmed title is stored) | 400 | `title must be 1 to 80 characters` |
| 6 | `date` is a real day `YYYY-MM-DD` from 2000-01-01 to 2099-12-31 | 400 | `date must be a valid YYYY-MM-DD date` |
| 7 | `start` is `HH:MM`, from `00:00` to `23:59` | 400 | `start must be HH:MM` |
| 8 | `end` is `HH:MM`, from `00:00` to `23:59` | 400 | `end must be HH:MM` |
| 9 | `end` is later than `start` | 400 | `end must be after start` |
| 10 | No overlap with another booking for the same room on the same date | 409 | `room is already booked from <start> to <end>` |

The server trims `title` and nothing else, so ` 2026-11-03`, `2026-11-3` and `9:00` are
all invalid. A booking can start at the exact time another one ends. When a booking
overlaps several others, the 409 message names the overlapping booking that starts
earliest.

Example:

```sh
curl -i -X POST http://127.0.0.1:3000/api/bookings \
  -H 'Content-Type: application/json' \
  -d '{"room":"Aurora","title":"Standup","date":"2026-11-03","start":"09:00","end":"10:00"}'
```

## Running tests

```sh
npm test             # runs: node --test test/*.test.mjs
```

The tests use the built-in `node:test` runner and don't need any extra packages. Only
files named `*.test.mjs` run as tests. The other modules in `test/` are shared helpers.

## File layout

```
server.mjs              HTTP server: API, page serving, data file
package.json            npm start / npm test scripts, no dependencies
public/index.html       The booking page
public/app.js           The page's script (classic script, no build step)
test/server.test.mjs    API and server tests
test/app.test.mjs       Page and script tests
test/helpers.mjs        Server test helpers (spawn the server, send requests, temp dirs)
test/app-fake-dom.mjs   Test helper (small fake DOM and fetch for running app.js)
```

The server reads `public/` from the folder that holds `server.mjs`. It reads the data file
(`bookings.json` by default) from the current working directory and creates it with the
first booking.
