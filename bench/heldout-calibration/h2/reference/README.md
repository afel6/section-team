# Stock service

A small HTTP JSON service that keeps stock levels and reservations. Node.js 24.2 or later, no dependencies.

## Run

```
npm start
```

| Env | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on (127.0.0.1 only) |
| `DATA_FILE` | `stock.json` | Where the store is kept |

On start it prints `listening on http://127.0.0.1:<port>`. A missing data file is an empty store. Every change is written to the data file atomically (temp file, then rename), so a crash never leaves half a file.

## Test

```
npm test
```

## API

| Route | Body | Success | Errors |
|---|---|---|---|
| `GET /items` | | 200, page of items sorted by sku | 400 bad paging |
| `POST /items` | `{sku, name, qty}` | 201 `{sku, name, qty, reserved: 0}` | 400 invalid, 409 sku exists |
| `GET /items/export.csv` | | 200, every item sorted by sku as CSV | |
| `GET /items/:sku` | | 200 the item | 404 |
| `POST /reservations` | `{sku, qty}` | 201 `{id, sku, qty}` | 400 invalid, 404 unknown sku, 409 `insufficient stock` |
| `GET /reservations` | | 200, page of reservations sorted by id | 400 bad paging |
| `DELETE /reservations/:id` | | 204, the stock is free again | 404 |

An item's free stock is `qty - reserved`; a reservation asks for part of it.

**Rules**
- `sku`: 1 to 20 characters of `A-Z`, `0-9` and `-`.
- `name`: a non-empty string of at most 200 characters.
- `qty`: a JSON number that is whole and at least 1. `2.5` and `"3"` are refused with 400, never rounded.
- Request bodies are JSON objects of at most 10 KB: a bigger body gets 413, a body that is not a JSON object gets 400.
- Every error is `{"error": "<message>"}`. An unknown route is 404 `{"error": "not found"}`.

**CSV export** (`GET /items/export.csv`): status 200, `Content-Type: text/csv`, header line `sku,name,qty,reserved`, then one line per item sorted by sku. It is not paged. Every line, the last one included, ends in CRLF (`\r\n`). A field holding a comma, a double quote, a CR or an LF is wrapped in double quotes, with each inner double quote doubled.

**Paging** (`GET /items`, `GET /reservations`): `?page=` (default 1) and `?per_page=` (default 20, at most 100). The reply is `{items, page, per_page, total}`, where `total` counts every entry, not just this page.

## Layout

- `server.mjs`: HTTP plumbing (body reading, JSON replies, errors) and start-up.
- `lib/routes.mjs`: route table and handlers. Handlers return a new store instead of changing the old one.
- `lib/validate.mjs`: input parsers; they throw `ValidationError` (400).
- `lib/paginate.mjs`: paging shared by both list routes.
- `lib/csv.mjs`: CSV writing for the export.
- `lib/store.mjs`: loading and atomic saving of the data file.
- `test/`: `node:test` suites; `helpers.mjs` starts the app on a free port with a temp data file.
