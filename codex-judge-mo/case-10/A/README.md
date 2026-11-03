# Room bookings

A small meeting-room booking app: a Node.js HTTP server (`server.mjs`, built-ins only) that serves a JSON API and a browser page, and keeps its data in one JSON file.

## Usage

```sh
npm start                              # http://127.0.0.1:3000, data in ./bookings.json
PORT=8080 DATA_FILE=data/rooms.json node server.mjs
npm test                               # runs the node:test suite
```

- `PORT`: port to listen on, on 127.0.0.1 (default `3000`; `0` lets the OS pick one).
- `DATA_FILE`: the JSON data file, resolved against the current directory (default `bookings.json`). If it is missing, the app starts with no bookings. The file is only written when a booking is created or deleted, and the server never creates folders.

When the server is ready it prints `listening on http://127.0.0.1:<port>`. If `PORT` is invalid, the port can't be bound, or the data file can't be read, it writes an error to stderr and exits with code 1.

Open `http://127.0.0.1:3000/` in a browser to book rooms, filter the list by date, and cancel bookings.

## API

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/rooms` | `200 {"rooms": ["Aurora", "Borealis", "Cosmos"]}` |
| GET | `/api/bookings[?date=YYYY-MM-DD]` | `200 {"bookings": [...]}`, sorted by date, start, room |
| POST | `/api/bookings` | `201` with the new booking |
| DELETE | `/api/bookings/<id>` | `204`, or `404 booking not found` |

A POST body is a JSON object (`Content-Type: application/json`, at most 10000 bytes) with:

- `room`: one of the room names
- `title`: 1–80 characters after trimming
- `date`: `YYYY-MM-DD`, from 2000-01-01 to 2099-12-31
- `start` and `end`: `HH:MM`, where `end` is after `start`

A booking that overlaps another booking of the same room on the same day is rejected with `409`.

Errors look like `{"error": "<message>"}`. A path that doesn't exist gets `404 not found`, and a known path called with the wrong method gets `405 method not allowed`.

## Layout

- `server.mjs`: the HTTP server and the API
- `public/index.html`, `public/app.js`: the page and its script
- `test/`: the tests (server API, startup, persistence, and the page script run against a fake DOM)
