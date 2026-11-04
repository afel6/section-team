# Parts store

A JSON API and a page over one SQLite file. `node server.mjs` listens on 127.0.0.1.

- `PORT`: the port, 3000 by default, 0 for one the OS picks.
- `DB_FILE`: the database file, `parts.db` by default.

A database of schema version 1 is migrated to version 2 at startup, in one transaction: parts get their handles in id order.
`GET /api/report?as_of=YYYY-MM-DD` gives the stock on that date.

`npm test` runs the tests.
