# Split service

A small HTTP JSON service for groups of people who share expenses: who paid what, who owes whom. Node.js 24.2 or later, no dependencies.

## Run

```
npm start
```

| Env | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on (127.0.0.1 only) |
| `DATA_FILE` | `groups.json` | Where the store is kept |

On start it prints `listening on http://127.0.0.1:<port>`. A missing data file is an empty store. Every change is written to the data file atomically (temp file, then rename), so a crash never leaves half a file.

## Test

```
npm test
```

## API

| Route | Body | Success | Errors |
|---|---|---|---|
| `POST /groups` | `{id, name, members}` | 201 the group | 400 invalid, 409 `group already exists` |
| `GET /groups/:id` | | 200 `{id, name, members}` | 404 |
| `POST /groups/:id/expenses` | `{description, payer, amount, split?}` | 201 the expense | 400 invalid, 404 unknown group |
| `GET /groups/:id/expenses` | | 200 `{expenses}`, sorted by id | 404 |
| `PATCH /groups/:id/expenses/:expenseId` | any of `{description, payer, amount, split}` | 200 the changed expense | 400 invalid, 404 |
| `DELETE /groups/:id/expenses/:expenseId` | | 204 | 404 |
| `POST /groups/:id/payments` | `{from, to, amount}` | 201 the payment | 400 invalid, 404 unknown group |
| `GET /groups/:id/payments` | | 200 `{payments}`, sorted by id | 404 |
| `GET /groups/:id/balances` | | 200 `{balances}` | 404 |
| `GET /groups/:id/settle-up` | | 200 `{payments}`, suggested, not recorded | 404 |

An expense is shown as `{id, description, payer, amount, split, shares}`, where `shares` maps each name in `split` to what that person's part of the expense is. A payment is `{id, from, to, amount}`: `from` pays `to` back. Expense ids and payment ids each count up from 1 across all groups and are never reused.

**Shares.** An expense is shared equally, in whole cents, by the people in its `split`. When the amount does not divide evenly, the first people in `split` pay one cent more each, so the shares always add up to the amount: 10.00 split between Ann, Ben and Cara is 3.34, 3.33 and 3.33.

**Balances.** `balances` maps every member, in the group's member order, to what the group owes them (positive) or what they owe the group (negative). The payer of an expense is owed its amount, and each person in its `split` owes their share. A payment raises `from`'s balance and lowers `to`'s by its amount. The balances of a group always add up to 0.

**Settling up.** `GET /groups/:id/settle-up` suggests the payments `[{from, to, amount}]` that would bring every balance to 0, without recording them. While someone owes money, the member who owes the most pays the member who is owed the most the smaller of those two amounts; on a tie, the member who comes first in the group's member order goes first.

**Editing.** `PATCH` changes only the fields its body gives, each checked by the same rule as on `POST`; the others keep their value. Shares and balances always follow the expense as it is now.

**Rules**
- `id` (group): 1 to 30 characters of `a-z`, `0-9` and `-`, starting with a letter.
- `name` (group): a non-empty string of at most 100 characters.
- `members`: an array of 2 to 20 different member names. A member name is 1 to 30 characters of `A-Z`, `a-z`, `0-9`, `_` and `-`, starting with a letter; letter case matters.
- `description`: a non-empty string of at most 200 characters.
- `payer`, `from`, `to`: members of the group; `from` and `to` must differ.
- `amount`: a JSON number from 0.01 to 1000000 with at most 2 decimals, such as `12.5` or `4.35`. It is kept as whole cents and shown back as the same number.
- `split`: optional, a non-empty array of different members of the group. Without it the expense is split between every member, in the group's member order.
- Request bodies are JSON objects of at most 10 KB: a bigger body gets 413, a body that is not a JSON object gets 400. Unknown fields are ignored.
- Every error is `{"error": "<message>"}`. An unknown route is 404 `{"error": "not found"}`. Fields are checked in the order the table lists them; the first bad one decides the 400 message.

## Layout

- `server.mjs`: start-up, and the request loop: find the route, read the body, run the handler, save.
- `lib/http.mjs`: body reading, JSON replies, errors.
- `lib/routes.mjs`: route table.
- `lib/groups.mjs`, `lib/expenses.mjs`: handlers. Handlers return a new store instead of changing the old one.
- `lib/validate.mjs`: input parsers; they throw `ValidationError` (400).
- `lib/ledger.mjs`: money maths on cents: shares, balances, and how expenses and payments are shown.
- `lib/store.mjs`: loading and atomic saving of the data file.
- `test/`: `node:test` suites; `helpers.mjs` starts the app on a free port with a temp data file.
