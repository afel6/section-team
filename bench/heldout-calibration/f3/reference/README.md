# Poll service

A small HTTP JSON service for polls: create a poll, vote once per voter, take a vote back, close the poll. Node.js 22 or later, no dependencies.

## Run

```
PORT=3000 DATA_FILE=polls.json node server.mjs
```

It listens on 127.0.0.1 and prints `listening on http://127.0.0.1:<port>`. All data is kept in `DATA_FILE`, written (temp file, then rename) before each change is answered. A missing file is an empty service; a file it cannot load stops it with `cannot load <file>` and exit code 1.

## Routes

| Route | Body | Success | Errors |
|---|---|---|---|
| `POST /polls` | `{question, options}` | 201 the poll | 400, 413 |
| `GET /polls` | `?status=open\|closed` | 200 `{polls: [{id, question, closed, total}]}` by id | 400 `status must be open or closed` |
| `GET /polls/:id` | | 200 the poll | 404 `poll not found` |
| `POST /polls/:id/votes` | `{voter, option}` | 201 `{poll, voter, option}` | 400, 404, 409 `poll closed`, `already voted`, `poll is full`, 413 |
| `DELETE /polls/:id/votes/:voter` | | 204 | 404 `poll not found`, `vote not found`, 409 `poll closed` |
| `POST /polls/:id/close` | | 200 the poll | 404, 409 `poll closed` |

A poll is `{id, question, options, closed, results: [{option, votes}], total}`. Unknown paths get 404 `not found`; a known path with another method gets 405 `method not allowed` with an `Allow` header. Bodies are JSON objects of at most 16384 bytes; unknown fields are refused. Saving failures get 500 `cannot save`.

Rules: `question` 1 to 200 characters after trimming; `options` 2 to 10 strings of 1 to 100 characters, different ignoring case; `voter` 1 to 32 of `a-z`, `0-9`, `_`; `option` exactly one of the poll's options. A poll holds at most 100 votes.

## Test

```
npm test
```
