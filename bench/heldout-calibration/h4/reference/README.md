# Room bookings

A meeting-room booking app: a small HTTP server with a JSON API and a browser page. Bookings are kept
in one JSON file. Node.js 22 or later, no dependencies.

## Run

```sh
npm start                              # http://127.0.0.1:3000, data in ./bookings.json
PORT=8080 DATA_FILE=data/rooms.json npm start
```

- `PORT`: the port to listen on (127.0.0.1 only). Unset or empty means 3000; `0` lets the OS pick one.
  Anything other than ASCII digits, or a value above 65535, is an error (exit code 1), as is a port that
  cannot be bound.
- `DATA_FILE`: the data file, relative to the current working directory. Unset or empty means
  `bookings.json`. A missing file means no bookings yet; a file that cannot be read or is damaged stops
  the server with `cannot read data file <name>` (exit code 1). The server never creates folders.

On start the server prints `listening on http://127.0.0.1:<port>`. It reads the data file once, at start,
and writes it only when a booking is created or deleted, before replying.

Open the address in a browser to book a room, list bookings (all, or one date) and cancel them.

## API

All replies other than the page are JSON (`application/json; charset=utf-8`). Errors are `{"error": "<message>"}`.

| Request | Reply |
| --- | --- |
| `GET /api/rooms` | 200 `{"rooms": ["Aurora", "Borealis", "Cosmos"]}` |
| `GET /api/bookings` | 200 `{"bookings": [...]}` sorted by date, start, then room |
| `GET /api/bookings?date=YYYY-MM-DD` | the bookings on that date; an invalid or empty date is 400 |
| `POST /api/bookings` | 201 and the new booking |
| `DELETE /api/bookings/<id>` | 204; 404 `booking not found` |
| `GET /`, `GET /app.js` | the page and its script |

Any other path is 404 `not found`; a listed path with another method is 405 `method not allowed`.
Paths are compared exactly (no decoding or normalisation); the query string is ignored except `date`.

A booking is `{"id", "room", "title", "date", "start", "end"}`. Ids start at 1 and are never reused.

```sh
curl -X POST http://127.0.0.1:3000/api/bookings \
  -H 'Content-Type: application/json' \
  -d '{"room":"Aurora","title":"Standup","date":"2026-11-03","start":"09:00","end":"10:00"}'
```

`POST /api/bookings` checks, in order (the first failure decides the reply):

1. `Content-Type` media type is `application/json`, else 415.
2. Body at most 10000 bytes, else 413.
3. Body is a JSON object, else 400.
4. `room` is one of the rooms (case matters).
5. `title` is 1 to 80 characters after trimming; the trimmed title is stored.
6. `date` is a real day `YYYY-MM-DD` from 2000-01-01 to 2099-12-31.
7. `start` and 8. `end` are `HH:MM` from `00:00` to `23:59`.
9. `end` is later than `start`.
10. No overlap with a booking of the same room and date, else 409
    `room is already booked from <start> to <end>` (the earliest overlapping booking). Back-to-back
    bookings are fine.

A failed save replies 500 `internal error` and changes nothing.

## Test

```sh
npm test
```

The tests use `node:test` only: the rules and the data file as units, the API in-process, the server's
start-up as a child process, and the page script against a small fake DOM.

## Files

- `server.mjs`: start-up (PORT, DATA_FILE, listen).
- `lib/app.mjs`: routing and request handling.
- `lib/bookings.mjs`: the booking rules and list order.
- `lib/store.mjs`: reading and writing the data file.
- `public/index.html`, `public/app.js`: the page.
