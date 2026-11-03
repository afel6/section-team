# Decisions (supervisor, 2026-11-03)

- Full spec: see `spec.md` in this folder. It is final; nobody can answer questions.
- File layout:
  - `server.mjs` (project root) — backend. Serves `GET /` from `public/index.html` and `GET /app.js` from `public/app.js`, both resolved relative to the folder of `server.mjs` (via `import.meta.url`), NOT the cwd.
  - `public/index.html`, `public/app.js` — frontend.
  - `test/server.test.mjs` — backend tests. `test/app.test.mjs` — frontend tests (static HTML checks + app.js run against a small fake DOM/fetch, using node:vm or similar).
  - `package.json` — backend owns it: `{"type":"module","scripts":{"start":"node server.mjs","test":"node --test test/"}}`, no dependencies.
  - `README.md` — docs.
- Only Node.js built-ins. No npm install.
- Data file layout: backend's choice, documented in the backend note `.team/notes/api.md`.

- 2026-11-03 · backend · package.json test script is `node --test test/*.test.mjs`, not `node --test test/` · On Node v22 `node --test test/` fails with "Cannot find module .../test" (a directory argument is not expanded). The glob runs only `*.test.mjs` files, so helper modules in `test/` (helpers.mjs, app-fake-dom.mjs) are not run as tests. Name test files `*.test.mjs`.
- 2026-11-03 · backend · Data file validated strictly at startup (exact keys, valid fields, unique ids < nextId, no overlaps); anything else is "cannot read data file". Stricter reading of "not data in the layout this server writes".
