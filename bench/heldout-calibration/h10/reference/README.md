# Quick polls

Create a poll, vote on it, close it. A small Node.js app (24.2 or later, no dependencies): a JSON API, a browser page, and one JSON data file. There are no accounts.

## Run

```
npm start
```

| Env | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on (127.0.0.1 only) |
| `DATA_FILE` | `polls.json` | The data file, relative to the working directory |

On start it prints `listening on http://127.0.0.1:<port>`; open that address for the page. A missing data file means no polls yet; a damaged one stops the server with `cannot read data file <name>`. Every change is saved (atomically) before its reply is sent.

## Test

```
npm test
```

## API

| Route | Body | Success | Errors |
|---|---|---|---|
| `GET /api/polls` | | 200 `{polls}`, newest first | |
| `POST /api/polls` | `{question, answers}` | 201 the poll | 400, 413, 415 |
| `GET /api/polls/:id` | | 200 the poll | 404 |
| `POST /api/polls/:id/votes` | `{voter, answer}` | 201 the poll | 400, 404, 409 `poll is closed`, 409 `already voted`, 413, 415 |
| `POST /api/polls/:id/close` | | 200 the poll | 404 |
| `DELETE /api/polls/:id` | | 204 | 404 |

A poll is `{id, question, closed, total, answers: [{text, votes, percent}]}`. Percentages are whole numbers that add up to 100 (largest remainders get the missing points, earlier answers first on a tie).

Rules: a question is 1 to 200 characters, a poll has 2 to 6 different answers (letter case ignored) of 1 to 80 characters each, a voter name is 1 to 40 characters, all trimmed; `answer` is the index of an answer, from 0. One vote per voter name per poll, names compared without letter case. Bodies are JSON objects of at most 10000 bytes sent as `application/json`. Errors are `{"error": "<message>"}`.

## Layout

- `server.mjs`: start-up and the request loop.
- `lib/routes.mjs`: the routes and handlers; handlers return a new state instead of changing the old one.
- `lib/polls.mjs`: the poll and vote rules, and the percentages.
- `lib/http.mjs`: body reading, the JSON body check, replies.
- `lib/store.mjs`: loading and atomic saving of the data file.
- `public/`: the page and its script.
