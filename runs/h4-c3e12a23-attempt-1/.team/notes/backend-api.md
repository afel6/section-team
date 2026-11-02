# Backend API notes — owner: backend — 2026-11-02

Spec: `.team/notes/spec.md` is the source of truth; this note only records implementation choices.

## Running
- `node server.mjs` (or `npm start`) starts the server. `server.mjs` exports nothing; importing it starts the server.
- Tests: `npm test` runs `node --test "test/**/*.test.mjs"`. Plain `node --test test/` does NOT work on Node 22
  (a directory argument is treated as a file). Test files must be named `*.test.mjs` under `test/`;
  helpers in `test/helpers/` are not run as tests.

## Env vars
- `PORT`: unset/empty means 3000. Only ASCII digits, value <= 65535, else one stderr line `invalid PORT: <value>`, exit 1.
  `PORT=0` means the OS picks the port; the stdout line shows the real port.
- `DATA_FILE`: unset/empty means `bookings.json`, resolved against the cwd. ENOENT means start empty (the file is not created).
  Any other read error, or content not in the layout below, gives stderr `cannot read data file <DATA_FILE as given>`, exit 1.
- Bind failure gives stderr `cannot listen on 127.0.0.1:<port>: <code>`, exit 1.
- stdout: only `listening on http://127.0.0.1:<port>\n`. Unexpected request errors are logged to stderr as one line.

## Data file layout
`{"nextId": <int >= 1>, "bookings": [{"id","room","title","date","start","end"}, ...]}`
Loading is strict: the top level must have exactly the keys nextId and bookings; each booking needs exactly those 6 keys, a safe-integer id in 1..nextId-1, unique ids, valid
room/date/times, end > start, an already-trimmed title of 1-80 chars, and no two stored bookings may overlap.
Anything else counts as "not in this server's layout".

## Saving
- Written only on a successful POST create or DELETE remove. Writes `<DATA_FILE>.<pid>.<n>.tmp` in the same folder
  (flag `wx`), then renames it over the data file; on failure the temp file is removed and the reply is 500 `internal error`.
- Memory (bookings and nextId) changes only after the save succeeds. All mutations run one at a time through
  an in-process promise queue (overlap check + save inside the queue).

## Static files
- `GET /` serves `public/index.html` (`text/html; charset=utf-8`), `GET /app.js` serves `public/app.js`
  (`text/javascript; charset=utf-8`). Paths are resolved relative to `server.mjs` via `import.meta.url`, read per request.
  A missing file gives 500 `internal error`; the server keeps running. Other methods on these paths get 405.

## Strict readings taken
- ENOTDIR (a path component is a file) is not ENOENT, so it gives `cannot read data file`.
- HEAD on any known path gets 405 (no auto-HEAD for GET routes).
- Overlapping stored bookings in the data file count as an invalid layout.
