# Room bookings

A small meeting-room booking app: one Node.js HTTP server (`server.mjs`) that
serves a JSON API and a browser page, and keeps its data in one JSON file.

## Requirements

- Node.js 22 or later.
- No dependencies: only Node.js built-ins are used, so there is nothing to
  `npm install`.

## Running

```sh
npm start          # same as: node server.mjs
```

Once the server is listening it prints one line to stdout, for example:

```
listening on http://127.0.0.1:3000
```

That is the only thing it ever writes to stdout. The server listens on
`127.0.0.1` only.

Open http://127.0.0.1:3000/ in a browser to use the page.

### Environment variables

| Variable    | Default         | Meaning |
|-------------|-----------------|---------|
| `PORT`      | `3000`          | Port to listen on. Unset or empty means `3000`. `PORT=0` lets the OS pick a free port; the printed line shows the port actually bound. |
| `DATA_FILE` | `bookings.json` | Path of the JSON data file. Unset or empty means `bookings.json`. A relative path (the default included) is resolved against the **current working directory**, not the folder of `server.mjs`. |

```sh
PORT=8080 DATA_FILE=/var/lib/rooms/bookings.json node server.mjs
```

### Startup and exit codes

At startup the server checks `PORT`, then reads the data file, then starts
listening, in that order. It writes one line to stderr and exits with code
`1` when:

- `PORT` is not made only of ASCII digits `0`-`9`, or is above `65535`;
- the port cannot be bound (for example, it is already in use);
- the data file cannot be read for any reason other than "does not exist"
  (for example, the path is a directory), or its content is not in the
  layout the server writes (for example, it is empty or not valid JSON).
  The message is then `cannot read data file <name>`, where `<name>` is
  `DATA_FILE` as given.

A data file that does not exist (or whose folder does not exist) is not an
error: the server starts with no bookings.

## Data file

- Layout: `{"nextId": <integer>, "bookings": [ ...bookings ]}`.
- It is read once, at startup. After that the server's memory is the truth:
  edits made to the file from outside are not noticed.
- It is written only when a `POST` creates a booking or a `DELETE` removes
  one; never at startup or for any other request.
- Every change is saved before its reply is sent, so after a restart with
  the same `DATA_FILE` the bookings and the id the next booking will get
  are as before. Ids are never reused, even after deletes and restarts.
- The server never creates folders. If saving fails (for example, the
  file's folder does not exist), the reply is `500 internal error`, nothing
  changes (the next id included), and the server keeps running.

## Browser page

`GET /` serves the page and `GET /app.js` its script. The page lets you:

- book a room with the form (Room, Title, Date, Start, End, then **Book**);
- see the list of bookings, optionally filtered with **Show date**;
  **Show all** clears the filter;
- cancel a booking with its **Cancel** button.

Error messages from the server are shown on the page as they are; if the
server cannot be reached the page shows `Could not reach the server.`

## API

All JSON replies have `Content-Type: application/json; charset=utf-8`.
Errors are `{"error": "<message>"}`.

Rooms are fixed: `Aurora`, `Borealis`, `Cosmos` (in that order).

A booking looks like this:

```json
{"id": 1, "room": "Aurora", "title": "Standup", "date": "2026-11-03", "start": "09:00", "end": "10:00"}
```

### `GET /api/rooms`

```sh
curl http://127.0.0.1:3000/api/rooms
```

`200`:

```json
{"rooms": ["Aurora", "Borealis", "Cosmos"]}
```

### `GET /api/bookings`

Returns every booking, sorted by date, then start, then room (in the room
order above). Add `?date=YYYY-MM-DD` to get only the bookings on that date;
other query parameters are ignored.

```sh
curl http://127.0.0.1:3000/api/bookings
curl "http://127.0.0.1:3000/api/bookings?date=2026-11-03"
```

`200`:

```json
{"bookings": [
  {"id": 1, "room": "Aurora", "title": "Standup", "date": "2026-11-03", "start": "09:00", "end": "10:00"}
]}
```

An invalid `date` (including an empty one, as in `?date` or `?date=`) gets
`400 date must be a valid YYYY-MM-DD date`.

### `POST /api/bookings`

Send a JSON object with `room`, `title`, `date`, `start` and `end` (other
keys are ignored) and the header `Content-Type: application/json`.

```sh
curl -X POST http://127.0.0.1:3000/api/bookings \
  -H 'Content-Type: application/json' \
  -d '{"room":"Aurora","title":"Standup","date":"2026-11-03","start":"09:00","end":"10:00"}'
```

`201` with the new booking:

```json
{"id": 1, "room": "Aurora", "title": "Standup", "date": "2026-11-03", "start": "09:00", "end": "10:00"}
```

See [Booking rules](#booking-rules) for the error replies.

### `DELETE /api/bookings/<id>`

```sh
curl -X DELETE http://127.0.0.1:3000/api/bookings/1
```

`204` with an empty body. If `<id>` is not a positive integer written in
digits without a leading zero, or no booking has that id:
`404 booking not found`.

### Other replies

| Status | Message              | When |
|--------|----------------------|------|
| `404`  | `not found`          | Any other path, whatever the method (for example `/api/bookings/` or `/api/bookings/1/`). |
| `405`  | `method not allowed` | A known path with a method not listed for it, `HEAD` and `OPTIONS` included (for example `GET /api/bookings/abc`). |
| `500`  | `internal error`     | Saving the data file failed, or any other unexpected failure. The server keeps running. |

Paths are matched exactly: no percent-decoding, no dot-segment, slash or
letter-case normalisation (`/API/rooms` and `/api/./rooms` are `404`). The
query string after the first `?` is ignored unless stated above.

## Booking rules

`POST /api/bookings` checks these in order; the first one that fails
decides the reply.

| # | Rule | Status | Message |
|---|------|--------|---------|
| 1 | `Content-Type` media type is `application/json` (case-insensitive, parameters such as `; charset=utf-8` allowed) | `415` | `content type must be application/json` |
| 2 | Body is at most 10000 bytes | `413` | `body too large` |
| 3 | Body is a JSON object (not empty, invalid, `null`, an array or a scalar) | `400` | `body must be a JSON object` |
| 4 | `room` is exactly one of `Aurora`, `Borealis`, `Cosmos` (case matters) | `400` | `room must be one of Aurora, Borealis, Cosmos` |
| 5 | `title` is a string of 1 to 80 characters after trimming whitespace at both ends | `400` | `title must be 1 to 80 characters` |
| 6 | `date` is `YYYY-MM-DD`, a real day from `2000-01-01` to `2099-12-31` | `400` | `date must be a valid YYYY-MM-DD date` |
| 7 | `start` is `HH:MM` from `00:00` to `23:59` | `400` | `start must be HH:MM` |
| 8 | `end` is `HH:MM` from `00:00` to `23:59` | `400` | `end must be HH:MM` |
| 9 | `end` is later than `start` | `400` | `end must be after start` |
| 10 | No overlap with another booking of the same room on the same date | `409` | `room is already booked from <start> to <end>` |

Notes:

- The stored title is the trimmed title. No other field is trimmed or
  changed: ` 2026-11-03`, `2026-11-3` and `9:00` are invalid.
- Two bookings overlap when each starts before the other ends; a booking
  may start exactly when another ends. The `409` message names the
  overlapping booking that starts earliest.
- Requests sent at the same time are handled as if one at a time: of
  several overlapping bookings sent at once, exactly one is created and the
  others get `409`.

## Tests

```sh
npm test           # runs: node --test test/*.test.mjs
```

The tests use the built-in `node:test` runner and live in `test/`. They
start the server with `PORT=0` and a temporary `DATA_FILE`, so they do not
touch your `bookings.json`.

## Project layout

```
server.mjs         the server (API, page files, data file)
public/index.html  the page
public/app.js      the page's script
test/              node:test tests
package.json       start and test scripts
```
