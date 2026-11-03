# Room bookings

A small meeting-room booking app. One HTTP server (`server.mjs`) serves a JSON API and a browser page, and stores bookings in one JSON file. There are three fixed rooms: `Aurora`, `Borealis` and `Cosmos`.

## Requirements

- Node.js 22 or later
- No dependencies. The app uses only Node.js built-ins, so there is nothing to `npm install`.

## Usage

```sh
npm start          # or: node server.mjs
```

The server listens on `127.0.0.1` only. When it is ready it prints one line to stdout:

```
listening on http://127.0.0.1:3000
```

Then open `127.0.0.1:3000` in a browser (use your port if you changed it).

### Environment variables

| Variable    | Default         | Meaning |
|-------------|-----------------|---------|
| `PORT`      | `3000`          | Port to listen on. Must be ASCII digits only, at most `65535`. `PORT=0` lets the OS pick a free port, and the startup line shows that port. Unset or empty means the default. |
| `DATA_FILE` | `bookings.json` | File the bookings are stored in. A relative path, the default included, is resolved against the **current working directory**, not the folder of `server.mjs`. Unset or empty means the default. |

Example:

```sh
PORT=8080 DATA_FILE=/var/lib/rooms/bookings.json node server.mjs
```

### Startup and errors

At startup the server checks `PORT`, then reads the data file, then starts listening, in that order. It exits with code 1 and writes one line to stderr when:

- `PORT` is invalid (not made only of digits 0-9, or above 65535), or the port cannot be bound (for example it is already in use);
- the data file cannot be read for a reason other than "does not exist" (for example the path is a directory), or its content is not in the layout this server writes (for example empty or invalid JSON). The message is `cannot read data file <name>`, where `<name>` is `DATA_FILE` as given.

A missing data file (or a missing folder on its path) just means there are no bookings yet.

### Data file

- It is read once, at startup. After that the server's memory is the truth; edits made to the file from outside are not noticed.
- It is written only when a booking is created or deleted, and each change is saved before the reply is sent. Bookings and the next id survive a restart with the same `DATA_FILE`.
- The server never creates folders. If saving fails (for example the folder does not exist), the request gets 500 `internal error`, nothing changes, and the server keeps running.

## API

All JSON replies use `Content-Type: application/json; charset=utf-8`. Errors are `{"error": "<message>"}`.

Paths are matched exactly, byte for byte: no percent-decoding, no case folding, no trailing-slash or dot-segment normalisation. The query string (after the first `?`) is ignored unless stated.

A booking looks like this:

```json
{ "id": 1, "room": "Aurora", "title": "Standup", "date": "2026-11-03", "start": "09:00", "end": "10:00" }
```

Ids start at 1 and increase by one. An id is never reused, even after deletes and restarts.

### Routes

| Method & path | Success | Notes |
|---------------|---------|-------|
| `GET /` | 200 | The page (`text/html; charset=utf-8`). |
| `GET /app.js` | 200 | The page's script (`text/javascript; charset=utf-8`). |
| `GET /api/rooms` | 200 | `{"rooms": ["Aurora", "Borealis", "Cosmos"]}` |
| `GET /api/bookings` | 200 | `{"bookings": [...]}`, sorted by date, then start, then room (in the order above). |
| `GET /api/bookings?date=YYYY-MM-DD` | 200 | Only the bookings on that date. An invalid date (the empty value included, as in `?date` or `?date=`) gets 400 `date must be a valid YYYY-MM-DD date`. Other query parameters are ignored. |
| `POST /api/bookings` | 201 | Creates a booking and returns it. See the rules below. |
| `DELETE /api/bookings/<id>` | 204 | Deletes the booking; empty body. 404 `booking not found` if `<id>` is not a positive integer without a leading zero, or no booking has that id. |

Other replies:

| Status | Message | When |
|--------|---------|------|
| 404 | `not found` | Any other path, whatever the method. This includes `/api/bookings/` and paths like `/api/bookings/1/`. |
| 405 | `method not allowed` | A known path with a method not listed for it (HEAD and OPTIONS included), for example `GET /api/bookings/abc`. |
| 500 | `internal error` | Saving failed, or any other unexpected failure. The server keeps running. |

### Booking rules

`POST /api/bookings` takes a JSON body with `room`, `title`, `date`, `start` and `end`; other keys are ignored. The first rule that fails decides the reply:

| # | Rule | Status and message |
|---|------|--------------------|
| 1 | `Content-Type` media type is `application/json` (case-insensitive; parameters such as `; charset=utf-8` are allowed) | 415 `content type must be application/json` |
| 2 | Body is at most 10000 bytes | 413 `body too large` |
| 3 | Body is a JSON object | 400 `body must be a JSON object` |
| 4 | `room` is exactly `Aurora`, `Borealis` or `Cosmos` (case matters) | 400 `room must be one of Aurora, Borealis, Cosmos` |
| 5 | `title` is a string of 1 to 80 characters after trimming; the trimmed title is stored | 400 `title must be 1 to 80 characters` |
| 6 | `date` is `YYYY-MM-DD`, a real day from 2000-01-01 to 2099-12-31 | 400 `date must be a valid YYYY-MM-DD date` |
| 7 | `start` is `HH:MM`, from `00:00` to `23:59` | 400 `start must be HH:MM` |
| 8 | `end` is `HH:MM`, from `00:00` to `23:59` | 400 `end must be HH:MM` |
| 9 | `end` is later than `start` | 400 `end must be after start` |
| 10 | No overlap with another booking of the same room on the same date (back-to-back is fine) | 409 `room is already booked from <start> to <end>`, naming the earliest-starting overlapping booking |

Only `title` is trimmed. Values such as ` 2026-11-03`, `2026-11-3` or `9:00` are rejected.

Concurrent requests behave as if handled one at a time: of several overlapping bookings sent at once, exactly one is created and the rest get 409.

### Examples

```sh
curl -s 127.0.0.1:3000/api/rooms

curl -s -X POST 127.0.0.1:3000/api/bookings \
  -H 'Content-Type: application/json' \
  -d '{"room":"Aurora","title":"Standup","date":"2026-11-03","start":"09:00","end":"10:00"}'

curl -s '127.0.0.1:3000/api/bookings?date=2026-11-03'

curl -s -X DELETE 127.0.0.1:3000/api/bookings/1
```

## The page

The page at `/` lets you pick a room, enter a title, date, start and end, and click **Book**. The booking list below it shows each booking as `<date> <start>-<end> <room>: <title>` with a **Cancel** button. Use **Show date** to filter the list by day and **Show all** to clear the filter. Error messages from the server are shown on the page as plain text; if the server is down, the page shows `Could not reach the server.`

## Testing

```sh
npm test
```

This runs `node --test`, which picks up the `node:test` files in `test/`:

- `test/server.test.mjs` starts the real server with `PORT=0` and a temporary `DATA_FILE`, then exercises the API.
- `test/app.test.mjs` runs `public/app.js` against a fake DOM and fake `fetch`, and checks `public/index.html`.

## Project layout

```
server.mjs            HTTP server and JSON API
public/index.html     the page
public/app.js         the page's script
test/                 node:test tests
package.json          "type": "module"; start and test scripts
```

`server.mjs` loads `public/` from its own folder, so you can start it from any working directory. Only `DATA_FILE` depends on the working directory.
