# Room bookings

A small meeting-room booking app. One Node.js file (`server.mjs`) serves a
JSON API and a browser page, and keeps every booking in a single JSON file.

There are three fixed rooms: `Aurora`, `Borealis` and `Cosmos`.

## Requirements

- Node.js 22 or later.
- No dependencies. The app uses only Node.js built-ins, so there is nothing to
  `npm install`.

## Running the server

```sh
npm start
# or
node server.mjs
```

The server listens on `127.0.0.1` only. Once it is listening it prints one
line to stdout:

```
listening on http://127.0.0.1:3000
```

### Environment variables

| Variable    | Default         | Meaning |
|-------------|-----------------|---------|
| `PORT`      | `3000`          | Port to listen on. Must be ASCII digits only and at most 65535. `0` lets the OS choose a free port; the printed line shows the port actually bound. |
| `DATA_FILE` | `bookings.json` | Path of the data file. A relative path is resolved against the current working directory, not the folder of `server.mjs`. |

An unset or empty variable uses its default.

Examples:

```sh
PORT=8080 node server.mjs
PORT=0 node server.mjs                      # OS picks the port
DATA_FILE=/var/data/rooms.json npm start
DATA_FILE=data/bookings.json PORT=4000 npm start
```

### Startup and exit codes

At startup the server checks `PORT`, then reads the data file, then starts
listening. It exits with code 1, after writing one line to stderr, when:

- `PORT` is not made only of digits, is above 65535, or cannot be bound
  (for example because it is already in use);
- the data file cannot be read for any reason other than "does not exist"
  (for example the path is a directory), or its content is not valid data
  (for example empty or not JSON). The message is then
  `cannot read data file <name>`, where `<name>` is `DATA_FILE` as given.

A data file that does not exist (or whose folder does not exist) simply means
there are no bookings yet.

### The data file

The data file is UTF-8 JSON managed by the server. It holds the id the next
booking will get and the list of bookings:

```json
{
  "nextId": 3,
  "bookings": [
    { "id": 2, "room": "Aurora", "title": "Standup", "date": "2026-11-03", "start": "09:00", "end": "10:00" }
  ]
}
```

At startup the server checks the content strictly. The top level must have
exactly the keys `nextId` (an integer, at least 1) and `bookings` (an array).
Each booking must have exactly the six booking keys and follow the booking
rules: a known room, a trimmed title of 1 to 80 characters, a valid date and
times, and `start` before `end`. Each id must be unique and below `nextId`,
and no two bookings may overlap. Anything else, including an empty file,
invalid JSON or a byte order mark, stops startup with
`cannot read data file <name>`. To start with an empty store, delete the file
or write `{"nextId":1,"bookings":[]}`.

Keep these points in mind:

- It is read once, at startup. Changes made to it from outside while the
  server runs are not noticed.
- It is written only when a booking is created or deleted, and each change is
  saved before the reply is sent. After a restart with the same `DATA_FILE`,
  the bookings and the next booking id are the same as before.
- A save writes a temporary file `<DATA_FILE>.<pid>.tmp` next to the data
  file and then renames it over the data file. An interrupted save therefore
  never leaves a half-written data file.
- The server never creates folders. If saving fails (for example the folder
  does not exist), the request gets `500 internal error`, nothing changes, and
  the server keeps running.

## The browser page

Open `http://127.0.0.1:3000/` (or whichever port you chose). The page has:

- a form (Room, Title, Date, Start, End, then **Book**) that creates a booking;
- a booking list, with a **Cancel** button next to each booking;
- a **Show date** filter that shows only the bookings on one date, and a
  **Show all** button that clears it;
- an error line that shows the server's error message, or
  `Could not reach the server.` when there is no reply. If a reply has an
  unexpected shape, it shows `Request failed.` instead.

The page itself does no validation: every check is made by the server, and
its error message is shown as is. The page loads its script from `/app.js`.

## API

All paths are matched exactly, byte for byte: no percent-decoding, no
case folding, no trailing-slash or dot-segment normalisation. The query
string is ignored unless a route says otherwise.

Every JSON reply has `Content-Type: application/json; charset=utf-8`. An
error reply is always:

```json
{ "error": "<message>" }
```

### Bookings

A booking is a JSON object with exactly these keys:

```json
{
  "id": 1,
  "room": "Aurora",
  "title": "Standup",
  "date": "2026-11-03",
  "start": "09:00",
  "end": "10:00"
}
```

`id` is a number; the other fields are strings. The first booking gets id 1
and every new booking the next integer. Ids are never reused, even after
deletes and restarts.

### Routes

| Method   | Path                  | Success |
|----------|-----------------------|---------|
| `GET`    | `/api/rooms`          | `200 {"rooms": ["Aurora", "Borealis", "Cosmos"]}` |
| `GET`    | `/api/bookings`       | `200 {"bookings": [...]}` |
| `POST`   | `/api/bookings`       | `201` with the new booking |
| `DELETE` | `/api/bookings/<id>`  | `204` with an empty body |
| `GET`    | `/`                   | `200` the page (`text/html; charset=utf-8`) |
| `GET`    | `/app.js`             | `200` the page script (`text/javascript; charset=utf-8`) |

#### `GET /api/bookings`

Returns every booking, sorted by date, then start time, then room (in the
order Aurora, Borealis, Cosmos).

With a `date` query parameter, only the bookings on that date are returned.
`?date` with no value counts as the empty value; when `date` is repeated, the
first one is used. Other query parameters are ignored.

- `400 date must be a valid YYYY-MM-DD date` when the `date` value is not a
  valid date (see rule 6 below), the empty value included.

#### `POST /api/bookings`

Send `Content-Type: application/json` and a JSON object with `room`, `title`,
`date`, `start` and `end`. Other keys are ignored. The reply is `201` and the
new booking.

#### `DELETE /api/bookings/<id>`

Deletes the booking. Any path of the form `/api/bookings/<id>`, where `<id>`
is non-empty and holds no `/`, is this route.

- `404 booking not found` when `<id>` is not a positive integer written in
  digits without a leading zero (for example `abc`, `0`, `01`), or no booking
  has that id.

### Booking rules

`POST /api/bookings` checks these rules in order; the first one that fails
decides the reply.

| # | Rule | Reply |
|---|------|-------|
| 1 | The `Content-Type` media type (before any `;`, case-insensitive) must be `application/json` | `415 content type must be application/json` |
| 2 | The body must be at most 10000 bytes | `413 body too large` |
| 3 | The body must be a JSON object (not empty, invalid JSON, `null`, an array, a string, a number or a boolean) | `400 body must be a JSON object` |
| 4 | `room` must be exactly `Aurora`, `Borealis` or `Cosmos` (case matters) | `400 room must be one of Aurora, Borealis, Cosmos` |
| 5 | `title` must be a string of 1 to 80 characters after trimming whitespace at both ends | `400 title must be 1 to 80 characters` |
| 6 | `date` must be `YYYY-MM-DD`, a real day from 2000-01-01 to 2099-12-31 | `400 date must be a valid YYYY-MM-DD date` |
| 7 | `start` must be `HH:MM`, from `00:00` to `23:59` | `400 start must be HH:MM` |
| 8 | `end` must be `HH:MM`, from `00:00` to `23:59` | `400 end must be HH:MM` |
| 9 | `end` must be later than `start` | `400 end must be after start` |
| 10 | The booking must not overlap another booking of the same room on the same date | `409 room is already booked from <start> to <end>` |

Notes:

- The title is stored trimmed. No other field is trimmed or changed, so
  ` 2026-11-03`, `2026-11-3` and `9:00` are all invalid.
- Two bookings overlap when each starts before the other ends. A booking may
  start exactly when another ends. The 409 message names the start and end of
  the overlapping booking that starts earliest.
- Requests sent at the same time behave as if handled one at a time: of
  several overlapping bookings sent at once, exactly one is created and the
  others get 409.

### Other errors

| Reply | When |
|-------|------|
| `404 not found` | Any other path, whatever the method. This includes `/api/bookings/` and paths such as `/api/bookings/1/`. |
| `405 method not allowed` | A known path with a method it does not support, `HEAD` and `OPTIONS` included. For example `GET /api/bookings/abc` or `PUT /api/rooms`. |
| `500 internal error` | Saving the data file failed, or any other unexpected failure. The server keeps running. |

### curl examples

```sh
# List the rooms
curl http://127.0.0.1:3000/api/rooms

# Create a booking
curl -i -X POST http://127.0.0.1:3000/api/bookings \
  -H 'Content-Type: application/json' \
  -d '{"room":"Aurora","title":"Standup","date":"2026-11-03","start":"09:00","end":"10:00"}'
# HTTP/1.1 201 Created
# {"id":1,"room":"Aurora","title":"Standup","date":"2026-11-03","start":"09:00","end":"10:00"}

# The same slot again is a conflict
curl -i -X POST http://127.0.0.1:3000/api/bookings \
  -H 'Content-Type: application/json' \
  -d '{"room":"Aurora","title":"Retro","date":"2026-11-03","start":"09:30","end":"10:30"}'
# HTTP/1.1 409 Conflict
# {"error":"room is already booked from 09:00 to 10:00"}

# List all bookings, or only one date
curl http://127.0.0.1:3000/api/bookings
curl 'http://127.0.0.1:3000/api/bookings?date=2026-11-03'

# Delete a booking
curl -i -X DELETE http://127.0.0.1:3000/api/bookings/1
# HTTP/1.1 204 No Content
```

## Running the tests

The tests use the built-in `node:test` runner:

```sh
npm test
# which runs: node --test test/*.test.mjs
```

## File layout

```
server.mjs          HTTP server: JSON API, page serving, data file handling
public/index.html   The browser page (served at /)
public/app.js       The page script (served at /app.js)
test/*.test.mjs     Tests (node:test)
package.json        "type": "module"; "start" and "test" scripts
bookings.json       Default data file, created on the first booking (in the cwd)
```

`public/` is resolved relative to the folder of `server.mjs`, so the page
works whatever the current working directory is. The data file, by contrast,
is resolved against the current working directory.
