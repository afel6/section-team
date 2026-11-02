# Room bookings

A small meeting-room booking app: one Node.js HTTP server (`server.mjs`) that
serves a JSON API and a browser page, and keeps its data in a single JSON file.
There are three fixed rooms: `Aurora`, `Borealis` and `Cosmos`.

## Requirements

- Node.js 22 or later.
- No dependencies: only Node.js built-ins are used, so there is nothing to
  `npm install`.

## Usage

```sh
npm start
# or
node server.mjs
```

The server listens on `127.0.0.1` only. Once it is listening it prints exactly
one line to stdout, and nothing else ever:

```
listening on http://127.0.0.1:3000
```

The port shown is the one actually bound (with `PORT=0`, the port the OS
picked).

### Environment variables

| Variable    | Default         | Meaning                                                                 |
| ----------- | --------------- | ----------------------------------------------------------------------- |
| `PORT`      | `3000`          | Port to listen on. Unset or empty means the default.                    |
| `DATA_FILE` | `bookings.json` | Path of the JSON data file. Unset or empty means the default. Relative paths are resolved against the current working directory, not the folder of `server.mjs`. |

```sh
PORT=8080 DATA_FILE=/var/lib/rooms/bookings.json node server.mjs
```

At startup the server checks `PORT`, then reads the data file, then starts
listening. It exits with code 1 and writes one line to stderr when:

- `PORT` is not made only of ASCII digits `0-9`, or is above `65535`
  (`invalid PORT: "<value>"`, e.g. `invalid PORT: "abc"`);
- the port cannot be bound, for example because it is already in use
  (`cannot listen on 127.0.0.1:<port>: <code>`);
- the data file cannot be read for any reason other than "does not exist"
  (for example, the path is a directory), or its content is not in the layout
  this server writes (for example, empty or invalid JSON). The line is
  `cannot read data file <name>`, where `<name>` is `DATA_FILE` as given.

A missing data file (or a missing folder on its path) is not an error: the
server starts with no bookings.

### Data handling

- The file is read once, at startup. After that the server's memory is the
  truth; outside edits to the file are not noticed.
- The file is written only when a booking is created or deleted, and each
  change is saved before the reply is sent. The server never creates folders.
- Saves are atomic (write a temporary file next to the data file, then
  rename). If a save fails, the reply is `500 internal error` and nothing
  changes, the next id included. The server keeps running.
- Requests are handled as if one at a time: of several overlapping bookings
  sent at once, exactly one is created and the rest get 409.

## Browser page

Open <http://127.0.0.1:3000/> (adjust the port if you set `PORT`). The page
lets you:

- book a room with a title, date, start and end time (errors from the server
  are shown as-is, for example `room is already booked from 09:00 to 10:00`);
- see the bookings, optionally filtered by date (`Show date`), and clear the
  filter with `Show all`;
- cancel a booking with its `Cancel` button.

The page is `public/index.html` and its script is `public/app.js`, served at
`GET /` and `GET /app.js`.

## API

All JSON replies use `Content-Type: application/json; charset=utf-8`. Errors
have the body `{"error": "<message>"}`.

A booking looks like this:

```json
{"id": 1, "room": "Aurora", "title": "Standup", "date": "2026-11-03", "start": "09:00", "end": "10:00"}
```

Ids start at 1 and increase by one; an id is never reused, even after deletes
and restarts.

Paths are matched byte for byte: no percent-decoding and no slash, dot-segment
or letter-case normalisation. The query string (after the first `?`) is
ignored unless a route says otherwise.

### `GET /api/rooms`

`200`

```json
{"rooms": ["Aurora", "Borealis", "Cosmos"]}
```

### `GET /api/bookings`

`200` with every booking, sorted by date, then start, then room (in the order
above).

```sh
curl http://127.0.0.1:3000/api/bookings
```

```json
{"bookings": [{"id": 1, "room": "Aurora", "title": "Standup", "date": "2026-11-03", "start": "09:00", "end": "10:00"}]}
```

Optional `?date=YYYY-MM-DD` returns only that day's bookings. If `date` is
present but not a valid date (empty included, e.g. `?date` or `?date=`), the
reply is `400 date must be a valid YYYY-MM-DD date`. When repeated, the first
`date` is used. Other parameters are ignored.

### `POST /api/bookings`

Body: a JSON object with `room`, `title`, `date`, `start` and `end`. Other keys
are ignored. Header `Content-Type: application/json` is required.

```sh
curl -X POST http://127.0.0.1:3000/api/bookings \
  -H 'Content-Type: application/json' \
  -d '{"room":"Aurora","title":"Standup","date":"2026-11-03","start":"09:00","end":"10:00"}'
```

`201` with the new booking:

```json
{"id": 1, "room": "Aurora", "title": "Standup", "date": "2026-11-03", "start": "09:00", "end": "10:00"}
```

The rules below are checked in order; the first one that fails decides the
reply.

| #  | Rule                                                                                                   | Status | Error message                                        |
| -- | ------------------------------------------------------------------------------------------------------ | ------ | ---------------------------------------------------- |
| 1  | `Content-Type` media type (before the first `;`, spaces and tabs removed from both ends, letter case ignored) is `application/json` | 415    | `content type must be application/json`              |
| 2  | Body is at most 10000 bytes                                                                            | 413    | `body too large`                                     |
| 3  | Body (UTF-8) parses as a JSON object (not empty, `null`, an array, string, number or boolean; a leading BOM makes it invalid) | 400    | `body must be a JSON object`                         |
| 4  | `room` is exactly one of `Aurora`, `Borealis`, `Cosmos` (case-sensitive)                                | 400    | `room must be one of Aurora, Borealis, Cosmos`       |
| 5  | `title` is a string of 1 to 80 UTF-16 code units after trimming; the trimmed title is stored            | 400    | `title must be 1 to 80 characters`                   |
| 6  | `date` is `YYYY-MM-DD`, a real day from 2000-01-01 to 2099-12-31 (Feb 29 in years divisible by 4)      | 400    | `date must be a valid YYYY-MM-DD date`               |
| 7  | `start` is `HH:MM`, from `00:00` to `23:59`                                                            | 400    | `start must be HH:MM`                                |
| 8  | `end` is `HH:MM`, from `00:00` to `23:59`                                                              | 400    | `end must be HH:MM`                                  |
| 9  | `end` is later than `start`                                                                            | 400    | `end must be after start`                            |
| 10 | No overlap with a booking of the same room on the same date (back-to-back is fine)                     | 409    | `room is already booked from <start> to <end>`       |

For rule 10, `<start>` and `<end>` are those of the overlapping booking that
starts earliest. Only `title` is trimmed: values such as ` 2026-11-03`,
`2026-11-3` or `9:00` are invalid.

### `DELETE /api/bookings/<id>`

`204` with an empty body; the booking is gone.

```sh
curl -X DELETE http://127.0.0.1:3000/api/bookings/1
```

`404 booking not found` when `<id>` is not a positive integer in ASCII digits
without a leading zero, or no booking has that id.

### Other replies

| Case                                                                                  | Status | Error message          |
| ------------------------------------------------------------------------------------- | ------ | ---------------------- |
| Unknown path, any method (includes `/api/bookings/` and `/api/bookings/1/`)           | 404    | `not found`            |
| Known path with a method not listed for it (HEAD and OPTIONS included), e.g. `GET /api/bookings/abc` | 405    | `method not allowed`   |
| Save failure or any other unexpected error                                            | 500    | `internal error`       |

## Data file

The data file is JSON in this layout:

```json
{
  "nextId": 3,
  "bookings": [
    {"id": 1, "room": "Aurora", "title": "Standup", "date": "2026-11-03", "start": "09:00", "end": "10:00"}
  ]
}
```

`nextId` is the id the next booking will get (an integer, at least 1, greater
than every booking id). On startup the file is validated strictly: the top
level must have exactly the two keys `nextId` and `bookings`, a UTF-8 byte
order mark before the JSON is rejected, every booking must have exactly the six keys and pass the booking rules (with an
already-trimmed title), ids must be unique, and no two bookings may overlap.
Anything else makes the server exit with `cannot read data file <name>`.

## Tests

```sh
npm test
```

Runs the `node:test` suites in `test/` (`node --test "test/**/*.test.mjs"`).
