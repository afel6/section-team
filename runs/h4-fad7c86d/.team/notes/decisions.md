# Decisions — owner: supervisor — 2026-11-02

- Spec: see `spec.md` (verbatim, authoritative; every string/status is exact).
- File layout:
  - `server.mjs` (backend) — HTTP server + API; serves `public/index.html` at `GET /` and `public/app.js` at `GET /app.js`, resolved relative to the folder of `server.mjs` (via `import.meta.url`), read at startup or per request (backend's choice; serving must not depend on cwd).
  - `public/index.html`, `public/app.js` (frontend).
  - `test/*.test.mjs` (testing) — node:test, run by `node --test "test/**/*.test.mjs"`.
  - `package.json` — `"type": "module"`, scripts `start: node server.mjs`, `test: node --test "test/**/*.test.mjs"`. Owner: backend.
  - `README.md` (docs).
- No npm dependencies anywhere. Node v22 built-ins only.
- Data file layout: `{"nextId": <int>, "bookings": [<booking>...]}` — backend validates this layout strictly at startup (see backend note once written).
- 2026-11-02 — frontend — A success status (200) whose JSON body lacks the expected `rooms`/`bookings` array is treated as an error reply (`#error` shows `body.error` or `Request failed.`; the list and `#room` are not touched). Why: the spec doesn't cover this case, and showing a message is safer than rendering garbage or failing silently.
- 2026-11-02 — frontend — GET fetches call `fetch(url)` with no options object. Why: the spec allows the method/headers/body options but doesn't require them, and this is the simplest reading.
- 2026-11-02 — backend — `test` script is `node --test "test/**/*.test.mjs"`, not `node --test test/`. Why: on Node 22.23 a folder argument fails ("Cannot find module") and the quoted glob works. Test files must be named `test/*.test.mjs`.
- 2026-11-02 — backend — Stricter reading of "not data in the layout this server writes": exactly the keys nextId/bookings, valid six-key bookings with unique ids below nextId, trimmed titles and no overlaps; anything else gives `cannot read data file`. Why: when a spec line can be read two ways, the team builds the stricter reading.
- 2026-11-02 — backend — A save writes a temp file beside the data file and renames it over. Why: a failed save must change nothing, including the file on disk.
- 2026-11-02 — testing — Tests compare label text trimmed of surrounding whitespace and require no markup inside the label; `#error` must be exactly empty, `#room`/`#booking-list` may hold whitespace only. Why: the spec says "exactly this text" for labels while markup whitespace is free; the strict check goes on the one element the spec calls "empty".
- 2026-11-02 — testing — Content-Type values with a leading `\v`/`\f` are tested as a parser-level 400 (Node rejects them before server.mjs); NBSP/BOM around `application/json` must give 415. Why: rule 1 strips only spaces and tabs, and Node's HTTP parser decides the control-character cases.
