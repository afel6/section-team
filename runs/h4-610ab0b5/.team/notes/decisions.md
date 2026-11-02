# Decisions (supervisor)

- Spec: see `spec.md` (verbatim, final; no human will answer questions; strict reading wins).
- Node built-ins only. Node v22. No npm install.
- File layout:
  - `server.mjs` (backend) — the whole server. Serves the page files by reading them from `public/index.html` and `public/app.js` resolved relative to `server.mjs` (via `import.meta.url`), NOT the cwd. Reads them at request time or at startup — backend's choice, but a missing page file must not break startup checks order (PORT → data file → listen).
  - `public/index.html`, `public/app.js` (frontend).
  - `test/*.test.mjs` (testing): `test/server.test.mjs` (API, spawns `node server.mjs` with PORT=0 and a temp DATA_FILE), `test/page.test.mjs` (static HTML checks + app.js behaviour with a tiny hand-made fake DOM/fetch run via `node:vm`).
  - `package.json`: `{"type":"module","scripts":{"start":"node server.mjs","test":"node --test test/"}}` (testing creates/owns it; backend may create it first).
  - `README.md` (docs).
- Data file layout: `{"nextId": <int>, "bookings": [ ...booking objects ]}` (backend owns; see backend note when written).
- 2026-11-02 · backend · Strict reading of "not data in the layout this server writes": startup rejects extra keys, invalid/untrimmed fields, ids >= nextId, duplicate ids and overlapping bookings. Why: spec says strict reading wins; only server-written files must load.
- 2026-11-02 · backend · `ENOENT` only means "no bookings"; `ENOTDIR` (a file on the path) is "any other read failure" -> exit 1. Why: spec names ENOENT explicitly.
- 2026-11-02 · testing · Test script is `node --test test/*.test.mjs` (not `node --test test/`). Why: Node 22 treats `test/` as a module path and fails; the glob also keeps `test/support/*.mjs` helpers out of the run. README updated to match.
- 2026-11-02 · frontend · A 200 reply to GET /api/rooms or /api/bookings whose `rooms`/`bookings` is not an array shows `Request failed.` and leaves #room / the list unchanged. Why: spec is silent; treating a malformed success body as an error is the stricter reading.
