# Room bookings

A small meeting-room booking app. `server.mjs` is a Node.js HTTP server. It serves a JSON API and a browser page, and it keeps its bookings in a single JSON file.

There are three fixed rooms: `Aurora`, `Borealis` and `Cosmos`. Bookings are made per room, per date, with a start and end time, and two bookings of the same room may not overlap.

## Requirements

- Node.js 22 or later.
- Nothing else. The app uses only Node.js built-ins, so there is no `npm install` step.

## Usage

```sh
npm start
# or
node server.mjs
```

Then open http://127.0.0.1:3000 in a browser.

The server listens on `127.0.0.1` only. Once it is listening it prints exactly one line to stdout:

```
listening on http://127.0.0.1:3000
```

Nothing else is ever written to stdout.

### Environment variables

| Variable    | Default         | Meaning |
|-------------|-----------------|---------|
| `PORT`      | `3000`          | Port to listen on. If it is unset or empty, `3000` is used. `PORT=0` lets the OS pick a free port, and the printed line shows the port that was actually bound. |
| `DATA_FILE` | `bookings.json` | Path of the data file. If it is unset or empty, `bookings.json` is used. A relative path is resolved against the current working directory, not the folder that holds `server.mjs`. |

```sh
PORT=8080 DATA_FILE=/var/lib/rooms/bookings.json node server.mjs
```

### Startup and errors

At startup the server checks `PORT` first, then reads the data file, then starts listening.

- **Bad `PORT`**: if `PORT` contains anything other than the ASCII digits 0-9, is above 65535, or cannot be bound (for example because the port is in use), the server writes one error line to stderr and exits with code 1.
- **Missing data file**: if the file, or a folder on its path, does not exist, the server starts with no bookings. It does not create the file at startup.
- **Unreadable or invalid data file**: if the file cannot be read for any other reason (for example the path is a directory), or its content is not in the layout described under [Data file](#data-file) (for example it is empty or not valid JSON), the server writes the line below to stderr and exits with code 1 without listening. `<name>` is `DATA_FILE` exactly as given, or `bookings.json` when it is unset.

  ```
  cannot read data file <name>
  ```

## API

Every reply body is JSON with `Content-Type: application/json; charset=utf-8`. The only exceptions are the page and its script. Error replies look like `{"error": "<message>"}`.

| Method   | Path                    | Success                         |
|----------|-------------------------|---------------------------------|
| `GET`    | `/api/rooms`            | 200 `{"rooms": ["Aurora", "Borealis", "Cosmos"]}` |
| `GET`    | `/api/bookings`         | 200 `{"bookings": [...]}`       |
| `POST`   | `/api/bookings`         | 201 and the new booking         |
| `DELETE` | `/api/bookings/<id>`    | 204, empty body                 |
| `GET`    | `/`                     | 200, the page (`text/html; charset=utf-8`) |
| `GET`    | `/app.js`               | 200, the page's script (`text/javascript; charset=utf-8`) |

### Routing

- The path is the request target up to the first `?`. It is compared byte for byte, with no percent-decoding and no normalisation of case, slashes or dot-segments. So `/API/rooms`, `/api/./rooms`, `/api/%62ookings` and `/api/bookings/` do not match any route.
- Any other path returns 404 `not found`, whatever the method. This includes `/api/bookings/` and `/api/bookings/1/`.
- A known path with a method it does not support (HEAD and OPTIONS included) returns 405 `method not allowed`. For example, `GET /api/bookings/abc` returns 405.
- The query string is ignored, except for `date` on `GET /api/bookings`.

### Bookings

A booking has exactly these keys:

```json
{ "id": 1, "room": "Aurora", "title": "Standup", "date": "2026-11-03", "start": "09:00", "end": "10:00" }
```

`id` is a number. The first booking gets 1 and each new booking gets the next integer. An id is never reused, even after deletes and restarts.

#### `GET /api/bookings`

Returns every booking, sorted by date, then start, then room (in the order Aurora, Borealis, Cosmos).

`?date=YYYY-MM-DD` returns only the bookings on that date. If `date` is present (even as `?date` with no value) and is not a valid date under the rules below, the reply is 400 `date must be a valid YYYY-MM-DD date`. If `date` is repeated, the first value is used. Other query parameters are ignored.

#### `POST /api/bookings`

The body is a JSON object with `room`, `title`, `date`, `start` and `end`. Other keys are ignored. The checks run in this order, and the first one that fails decides the reply:

| # | Rule | Reply |
|---|------|-------|
| 1 | The `Content-Type` media type must be `application/json` (case-insensitive; parameters such as `; charset=utf-8` are allowed) | 415 `content type must be application/json` |
| 2 | The body must be at most 10000 bytes | 413 `body too large` |
| 3 | The body must parse as a JSON object (not empty, `null`, an array or another non-object value) | 400 `body must be a JSON object` |
| 4 | `room` must be exactly `Aurora`, `Borealis` or `Cosmos` (case-sensitive) | 400 `room must be one of Aurora, Borealis, Cosmos` |
| 5 | `title` must be a string of 1 to 80 characters after trimming whitespace from both ends. The trimmed title is the one stored | 400 `title must be 1 to 80 characters` |
| 6 | `date` must be `YYYY-MM-DD` and a real day from 2000-01-01 to 2099-12-31 | 400 `date must be a valid YYYY-MM-DD date` |
| 7 | `start` must be `HH:MM` from `00:00` to `23:59` | 400 `start must be HH:MM` |
| 8 | `end` must be `HH:MM` from `00:00` to `23:59` | 400 `end must be HH:MM` |
| 9 | `end` must be later than `start` | 400 `end must be after start` |
| 10 | The booking must not overlap another booking of the same room on the same date. Back-to-back bookings are fine | 409 `room is already booked from <start> to <end>` (the earliest-starting overlapping booking) |

Only `title` is trimmed. Other fields must match exactly, so ` 2026-11-03`, `2026-11-3` and `9:00` are rejected.

#### `DELETE /api/bookings/<id>`

Deletes the booking and returns 204 with an empty body. If `<id>` is not a positive integer without a leading zero, or no booking has that id, the reply is 404 `booking not found`.

#### Server errors

If saving the data file fails (for example because its folder does not exist), the reply is 500 `internal error` and nothing changes, including the next id. Any other unexpected failure also returns 500 `internal error`. In both cases the server keeps running.

Requests that arrive at the same time give the same result as if they had been handled one after another. If several overlapping bookings are sent at once, exactly one is created and the others get 409.

### Examples

```sh
curl http://127.0.0.1:3000/api/rooms

curl -X POST http://127.0.0.1:3000/api/bookings \
  -H 'Content-Type: application/json' \
  -d '{"room":"Aurora","title":"Standup","date":"2026-11-03","start":"09:00","end":"10:00"}'
# 201 {"id":1,"room":"Aurora","title":"Standup","date":"2026-11-03","start":"09:00","end":"10:00"}

curl 'http://127.0.0.1:3000/api/bookings?date=2026-11-03'

curl -i -X DELETE http://127.0.0.1:3000/api/bookings/1
# HTTP/1.1 204 No Content
```

## The page

Open `/` in a browser to use the page. From there you can:

- book a room with the form (room, title, date, start, end). Validation is done by the server, and its error messages appear on the page;
- see the list of bookings, filter it by date with **Show date**, and clear the filter with **Show all**;
- cancel a booking with its **Cancel** button.

If the server cannot be reached, the page shows `Could not reach the server.`

## Data file

The server reads the data file once, at startup. After that its in-memory state is what counts, and changes made to the file from outside are not noticed. The file is written only when a booking is created or deleted, and the write finishes before the reply is sent, so a restart with the same `DATA_FILE` keeps the bookings and the next id. The server never creates folders.

Layout:

```json
{
  "nextId": 2,
  "bookings": [
    { "id": 1, "room": "Aurora", "title": "Standup", "date": "2026-11-03", "start": "09:00", "end": "10:00" }
  ]
}
```

`nextId` is the id the next booking will get. The file is checked strictly when it is loaded. It must contain exactly these two keys. Every booking must follow the booking rules above, ids must be unique and lower than `nextId`, and bookings must not overlap. If the file fails any of these checks, the server refuses to start (see [Startup and errors](#startup-and-errors)).

## Running tests

```sh
npm test
```

This runs `node --test "test/*.test.mjs"`, which runs the backend and frontend tests with the built-in `node:test` runner.

## Project layout

```
server.mjs              HTTP server, JSON API and data file handling
public/index.html       the page
public/app.js           the page's script (served as /app.js)
test/server.test.mjs    API and server tests
test/app.test.mjs       page and script tests
test/helpers.mjs        shared test helpers
package.json            "type": "module"; start and test scripts
bookings.json           default data file (created on the first booking)
```
