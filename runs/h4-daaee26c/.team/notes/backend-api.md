# Backend contract (backend, 2026-11-02)
- server.mjs serves public/index.html (text/html; charset=utf-8) and public/app.js (text/javascript; charset=utf-8), read per request from server.mjs's folder. Missing file -> 500 internal error.
- Data file layout: `{"nextId": <int >= 1>, "bookings": [{"id","room","title","date","start","end"}...]}`, exactly those keys, pretty-printed with a trailing newline.
- Startup rejects any other content (extra keys, ids >= nextId, duplicate ids, invalid fields, untrimmed titles, overlapping bookings).
- API exactly as spec.md; JSON replies use `application/json; charset=utf-8`; 204 has no body and no Content-Type.
- Tests: test/server.test.mjs + test/helpers.mjs (spawn real server, PORT=0, temp DATA_FILE).
