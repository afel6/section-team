# File layout — supervisor — 2026-11-02

- `server.mjs` — backend. HTTP server, JSON API, data file. Serves `public/index.html` at `GET /` and `public/app.js` at `GET /app.js` (read from the folder of server.mjs via `import.meta.url`, not cwd).
- `public/index.html`, `public/app.js` — frontend (page + classic script).
- `test/*.test.mjs` — testing section (node:test). `npm test` = `node --test test/`.
- `package.json` — backend writes it: `{"type":"module","scripts":{"start":"node server.mjs","test":"node --test test/"}}`.
- `README.md` — docs.
- Full requirements: see `spec.md`.
