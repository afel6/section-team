# API / server notes — backend — 2026-11-02

Implements spec.md sections Server, API, Booking rules and Page bullet 1 in `server.mjs` (one file, built-ins only).

## Data file layout (DATA_FILE, default `bookings.json`, resolved against cwd)
```json
{"nextId": 3, "bookings": [{"id": 1, "room": "Aurora", "title": "Standup", "date": "2026-11-03", "start": "09:00", "end": "10:00"}]}
```
- Written compactly (`JSON.stringify`, no trailing newline) with a plain `writeFile`, only after a successful POST or DELETE.
- Bookings are kept in insertion order in the file. The API sorts them on GET.
- Startup accepts only exactly this layout (see decisions.md): the top level has exactly the keys `nextId` and `bookings`; every booking has exactly the 6 keys with valid values; ids are unique, at least 1 and below `nextId`; no two bookings overlap. Anything else, including an empty file, bad JSON or a folder, prints `cannot read data file <DATA_FILE as given>` and exits 1. ENOENT (missing file or folder) means start empty with `nextId` 1.
- To seed a test, write a valid file like the one above before starting the server.

## Starting it in tests
- Run `spawn(process.execPath, [<abs path to server.mjs>], { cwd: <tmp dir>, env: { ...process.env, PORT: '0', DATA_FILE: <path> } })`.
- Wait for stdout to match `/^listening on http:\/\/127\.0\.0\.1:(\d+)\n$/` and take the port from it. stdout carries only that line.
- Startup failures write one line to stderr and exit with code 1, without printing on stdout:
  - Bad PORT (not all digits, or above 65535): `invalid PORT "<value>"`.
  - Port already in use: `cannot listen on 127.0.0.1:<port>: EADDRINUSE`.
- Kill the child process with `child.kill()` when done. There is no graceful-shutdown handler.
- To make a save fail, point DATA_FILE into a folder that does not exist, for example `<tmp>/missing/b.json`. Startup works (ENOENT), but every POST or DELETE that would change data replies 500 `internal error` and nothing changes.
- The page files are read on every request from `<folder of server.mjs>/public/` (`index.html`, `app.js`). If one is missing, that request gets 500 `internal error` as JSON, and the API keeps working.

## Behaviour details testers may care about
- The body is always read in full (all of it is counted, only the first 10000+ bytes are kept), and the reply is sent after it ends. Rule order is 415, 413, 400 (object, room, title, date, start, end, order), then 409.
- Overlap checks, saving and the in-memory change all run inside one promise queue, so concurrent overlapping POSTs give one 201 and the rest 409.
- DELETE `<id>` must match `^[1-9][0-9]*$` and is compared to `String(booking.id)`.
- 405 replies have no `Allow` header. HEAD and OPTIONS get 405 on known paths.
- The scratch smoke script `.team/scratch/smoke.mjs` (backend, not shipped) covers about 55 cases. Testing may copy ideas from it.
