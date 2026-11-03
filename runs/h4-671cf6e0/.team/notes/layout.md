# File layout and ownership (supervisor)

- `server.mjs` — backend. Serves `public/index.html` at `GET /` and `public/app.js` at `GET /app.js`, files resolved relative to the folder of `server.mjs` (via `import.meta.url`), read at startup or per request (backend's choice; a read failure at request time → 500 `internal error`).
- `public/index.html`, `public/app.js` — frontend. The script must work against the API exactly as in the spec note.
- `test/*.test.mjs` — testing. `package.json` test script: `node --test test/`.
- `package.json` — backend creates it: `{"name":"room-bookings","type":"module","scripts":{"start":"node server.mjs","test":"node --test test/"}}`.
- `README.md` — docs.
