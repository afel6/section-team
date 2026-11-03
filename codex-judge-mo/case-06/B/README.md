# Room bookings

A small meeting-room booking app. It is one HTTP server, `server.mjs`, that:

- serves a JSON API for listing, creating and cancelling bookings of three fixed rooms
  (`Aurora`, `Borealis`, `Cosmos`),
- serves a browser page (`public/index.html` and `public/app.js`) that uses that API,
- keeps every booking in one JSON data file.

## Requirements

- Node.js 22 or later.
- No dependencies: the server and the tests use Node.js built-ins only, so there is
  nothing to `npm install`.

## Usage

Start the server with either command from the project folder:

```sh
npm start
# or
node server.mjs
```

When it is ready it prints one line to stdout:

```
listening on http://127.0.0.1:3000
```

The server only listens on `127.0.0.1` (this machine). That line is the only thing it
ever writes to stdout.

### Configuration

Both settings are environment variables.

| Variable    | Default         | Meaning |
|-------------|-----------------|---------|
| `PORT`      | `3000`          | Port to listen on. Unset or empty means `3000`. Must be ASCII digits only and at most `65535`. `PORT=0` lets the OS pick a free port; the printed line shows the port actually bound. |
| `DATA_FILE` | `bookings.json` | Path of the JSON data file. Unset or empty means `bookings.json`. A relative path (the default included) is resolved against the **current working directory**, not the folder of `server.mjs`. |

Examples:

```sh
PORT=8080 npm start
DATA_FILE=/var/lib/rooms/bookings.json node server.mjs
PORT=0 DATA_FILE=tmp/test.json node server.mjs
```

### Startup order and errors

At startup the server checks `PORT`, then reads the data file, then starts listening.
If any step fails it writes one line to stderr and exits with code 1 without serving:

| Problem | stderr line |
|---------|-------------|
| `PORT` is not only digits, or is above 65535 | `invalid PORT "<value>"` |
| The data file cannot be read (other than "does not exist"), or its content is not in the layout this server writes (empty, not valid JSON, wrong shape) | `cannot read data file <name>` |
| The port cannot be bound (for example it is already in use) | `cannot listen on port <port>: <error code>` |

`<name>` is the value of `DATA_FILE` as given (`bookings.json` when unset or empty).
A data file that does not exist, or whose folder does not exist, is not an error: the
server simply starts with no bookings.

## Using the page

With the server running, open <http://127.0.0.1:3000> in a browser (use your `PORT` if
you changed it). The page lets you:

- book a room: pick the room, enter a title, date, start and end, then press **Book**;
- see the bookings, one per line as `<date> <start>-<end> <room>: <title>`;
- show only one day's bookings with **Show date**, or every booking with **Show all**;
- cancel a booking with its **Cancel** button.

The page does not check the fields itself; any error the server returns (for example
`room is already booked from 09:00 to 10:00`) is shown above the list. If the server
cannot be reached the page shows `Could not reach the server.`

## API

All API replies with a body are JSON with `Content-Type: application/json; charset=utf-8`.
Errors are `{"error": "<message>"}`.

A booking looks like this:

```json
{ "id": 1, "room": "Aurora", "title": "Standup", "date": "2026-11-03", "start": "09:00", "end": "10:00" }
```

Ids start at 1 and increase by one per new booking. An id is never reused, even after
deletes and restarts.

### Routes

| Method and path | Success | Errors |
|-----------------|---------|--------|
| `GET /api/rooms` | 200 `{"rooms": ["Aurora", "Borealis", "Cosmos"]}` | |
| `GET /api/bookings` | 200 `{"bookings": [...]}`, sorted by date, then start, then room (in the order above) | |
| `GET /api/bookings?date=YYYY-MM-DD` | 200, only that day's bookings | 400 `date must be a valid YYYY-MM-DD date` |
| `POST /api/bookings` | 201 and the new booking | see booking rules below |
| `DELETE /api/bookings/<id>` | 204, empty body | 404 `booking not found` |
| `GET /` | 200, the page (`text/html; charset=utf-8`) | |
| `GET /app.js` | 200, the page script (`text/javascript; charset=utf-8`) | |

Other replies, for every route:

- Any other path, whatever the method: 404 `not found`. Paths are compared exactly as
  sent (no decoding or case folding), so `/API/rooms`, `/api/bookings/` and
  `/api/bookings/1/` are all 404.
- A known path with a method it does not support (including `HEAD` and `OPTIONS`):
  405 `method not allowed`. For example `GET /api/bookings/1` is 405.
- An unexpected failure, including a failed save of the data file: 500 `internal error`.
  Nothing changes and the server keeps running.

Notes:

- The query string is ignored except for `date` on `GET /api/bookings`. `?date` with no
  value counts as an empty (invalid) date; when `date` is repeated, the first one is used.
- `DELETE` returns 404 `booking not found` both when no booking has that id and when
  `<id>` is not a positive whole number without a leading zero (for example `abc` or `01`).

### Example

```sh
curl -s http://127.0.0.1:3000/api/bookings \
  -H 'Content-Type: application/json' \
  -d '{"room":"Aurora","title":"Standup","date":"2026-11-03","start":"09:00","end":"10:00"}'

curl -s 'http://127.0.0.1:3000/api/bookings?date=2026-11-03'

curl -s -X DELETE http://127.0.0.1:3000/api/bookings/1 -o /dev/null -w '%{http_code}\n'
```

### Booking rules (`POST /api/bookings`)

The body must be a JSON object with `room`, `title`, `date`, `start` and `end`; other keys
are ignored. Rules are checked in this order and the first failure decides the reply:

| # | Rule | Reply on failure |
|---|------|------------------|
| 1 | `Content-Type` media type is `application/json` (case-insensitive, parameters such as `charset` allowed) | 415 `content type must be application/json` |
| 2 | Body is at most 10000 bytes | 413 `body too large` |
| 3 | Body is a JSON object (not empty, `null`, an array or another value) | 400 `body must be a JSON object` |
| 4 | `room` is exactly `Aurora`, `Borealis` or `Cosmos` (case matters) | 400 `room must be one of Aurora, Borealis, Cosmos` |
| 5 | `title` is a string of 1 to 80 characters after trimming whitespace at both ends; the trimmed title is stored | 400 `title must be 1 to 80 characters` |
| 6 | `date` is `YYYY-MM-DD`, a real day from 2000-01-01 to 2099-12-31 | 400 `date must be a valid YYYY-MM-DD date` |
| 7 | `start` is `HH:MM` from `00:00` to `23:59` | 400 `start must be HH:MM` |
| 8 | `end` is `HH:MM` from `00:00` to `23:59` | 400 `end must be HH:MM` |
| 9 | `end` is later than `start` | 400 `end must be after start` |
| 10 | No overlap with another booking of the same room on the same date (back-to-back is fine) | 409 `room is already booked from <start> to <end>` (the earliest-starting overlapping booking) |

Only `title` is trimmed; other fields must be exact, so ` 2026-11-03`, `2026-11-3` and
`9:00` are rejected.

Requests sent at the same time are handled as if one after the other: of several
overlapping bookings sent at once, exactly one is created and the others get 409, and
no id is given twice.

## Data file

The data file is JSON in this layout:

```json
{
  "nextId": 3,
  "bookings": [
    { "id": 2, "room": "Aurora", "title": "Standup", "date": "2026-11-03", "start": "09:00", "end": "10:00" }
  ]
}
```

`nextId` is the id the next booking will get. The server writes the file compactly (one
line); the layout above is spread out only for reading.

Persistence behaviour:

- The file is read once, at startup. After that the server's memory is the truth; edits
  made to the file while the server runs are not noticed (and are overwritten by the
  next save).
- The file is written only when a `POST` creates a booking or a `DELETE` removes one,
  never at startup or for any other request.
- Each change is saved before its reply is sent, so after a restart with the same
  `DATA_FILE` the bookings and the next id are as before.
- The server never creates folders. If a save fails (for example the folder does not
  exist), the reply is 500 `internal error` and nothing changes, the next id included.
- At startup the file must be exactly in the layout the server writes (exact keys,
  valid fields, unique ids below `nextId`, no overlapping bookings); otherwise the
  server exits with `cannot read data file <name>`.

## Tests

```sh
npm test
```

This runs `node --test "test/**/*.test.mjs"`, using Node's built-in test runner (`node:test`). Nothing
needs to be installed.

## Project layout

```
server.mjs          HTTP server: API, page serving, data file load and save
public/index.html   the booking page
public/app.js       the page's script (classic script, no build step)
test/               node:test tests
test/helpers/       test helpers (fake-dom.mjs: a minimal DOM to run app.js under Node)
package.json        "start" and "test" scripts; no dependencies
README.md           this file
```
