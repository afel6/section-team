# File layout (owner: supervisor) — 2026-11-03

- `server.mjs` — backend. The whole HTTP server. Serves `GET /` from `public/index.html` and `GET /app.js` from `public/app.js`, both resolved relative to the folder of `server.mjs` (via `import.meta.url`), NOT the cwd. Files are read per request (not at startup — startup order is PORT check, data file, listen). A read failure → 500 `internal error` JSON.
- `public/index.html`, `public/app.js` — frontend. Must contain no `http://` / `https://` at all (not even in comments).
- `test/*.test.mjs` — testing. `package.json` "test": `node --test test/*.test.mjs`.
- `package.json` — backend creates it: `{"name":"room-bookings","private":true,"type":"module","scripts":{"start":"node server.mjs","test":"node --test test/*.test.mjs"}}`.
- `README.md` — docs.
- Data file layout: backend's choice, documented in `.team/notes/data-file.md` by backend.
