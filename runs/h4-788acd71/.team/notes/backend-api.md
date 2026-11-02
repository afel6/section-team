# Backend API notes (owner: backend) — 2026-11-02

Implements spec.md Server/API/Booking rules exactly; see spec for every message and status.

- Run: `npm start` (= `node server.mjs`); env `PORT` (default 3000, digits only, <= 65535), `DATA_FILE` (default `bookings.json`, relative to cwd).
- Stdout: only `listening on http://127.0.0.1:<port>\n`.
- Test: `npm test` = `node --test "test/*.test.mjs"` (runs backend and frontend tests).
- Data file: `{"nextId": <int>, "bookings": [{id, room, title, date, start, end}, ...]}`; written only on successful POST/DELETE; folders never created.
- Static: `GET /` → public/index.html (`text/html; charset=utf-8`), `GET /app.js` → public/app.js (`text/javascript; charset=utf-8`), read per request relative to server.mjs.
- Endpoints: `GET /api/rooms`, `GET /api/bookings[?date=YYYY-MM-DD]`, `POST /api/bookings`, `DELETE /api/bookings/<id>`.
- Errors: `{"error": "<message>"}` with `application/json; charset=utf-8`.
