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
| `POST /groups/:id/import` | `{entries, dry_run?, skip_recorded?}` | 201 (200 with `dry_run`) `{expenses, payments, skipped, balances}` | 400 invalid, 404 unknown group, 413, 422 `import rejected` |

An expense is shown as `{id, description, payer, amount, split, shares}`, where `shares` maps each name in `split` to what that person's part of the expense is. A payment is `{id, from, to, amount}`: `from` pays `to` back. Expense ids and payment ids each count up from 1 across all groups and are never reused.

**Shares.** An expense is shared equally, in whole cents, by the people in its `split`. When the amount does not divide evenly, the first people in `split` pay one cent more each, so the shares always add up to the amount: 10.00 split between Ann, Ben and Cara is 3.34, 3.33 and 3.33.

**Balances.** `balances` maps every member, in the group's member order, to what the group owes them (positive) or what they owe the group (negative). The payer of an expense is owed its amount, and each person in its `split` owes their share. A payment raises `from`'s balance and lowers `to`'s by its amount. The balances of a group always add up to 0.

**Settling up.** `GET /groups/:id/settle-up` suggests the payments `[{from, to, amount}]` that would bring every balance to 0, without recording them. While someone owes money, the member who owes the most pays the member who is owed the most the smaller of those two amounts; on a tie, the member who comes first in the group's member order goes first.

**Editing.** `PATCH` changes only the fields its body gives, each checked by the same rule as on `POST`; the others keep their value. Shares and balances always follow the expense as it is now.

**Importing.** `POST /groups/:id/import` records a list of expenses and payments for a group in one go: all of them, or none of them. The body is `{"entries": [...], "dry_run": <boolean>, "skip_recorded": <boolean>}`; `dry_run` and `skip_recorded` may be left out and are then false. An entry is an expense `{"type": "expense", description, payer, amount, split?}` or a payment `{"type": "payment", from, to, amount}`, each field following the same rule as on `POST /groups/:id/expenses` or `POST /groups/:id/payments`. A field counts as left out only when its key is absent: `null` is checked like any other value. After the 413 and not-an-object checks, the first of these that fails decides the reply, and nothing is saved:

1. Unknown group: 404 `{"error": "not found"}`.
2. 400, with the first message that applies: `unknown field <name>` (any body field other than `entries`, `dry_run` and `skip_recorded`, the first in `Object.keys` order), `entries must be an array of 1 to 50 items`, `dry_run must be true or false`, `skip_recorded must be true or false`.
3. 422 `{"error": "import rejected", "problems": [{index, rule}]}`: one problem per entry that breaks a rule, sorted by `index` (the entry's position, from 0), with the first rule it breaks:
   - `not-an-object`: the entry is not a JSON object (null and arrays are not).
   - `bad-type`: `type` is not `"expense"` or `"payment"`.
   - `unknown-field`: a field its type does not take (an expense takes `type`, `description`, `payer`, `amount`, `split`; a payment takes `type`, `from`, `to`, `amount`).
   - Expense: `bad-description`, `bad-payer`, `bad-amount`, `bad-split`; then `duplicate` when an earlier entry that broke none of those rules is an expense with the same payer, amount and description (even if that earlier entry is itself `duplicate`, `already-recorded` or skipped); then `already-recorded` when the group already has an expense with the same payer, amount and description. Descriptions are compared after `trim()` and `toLowerCase()`, amounts in cents; `split` is not compared.
   - Payment: `bad-from` (not a member), `bad-to` (not a member, or the same as `from`), `bad-amount`. Payments are never `duplicate` or `already-recorded`.
   - With `"skip_recorded": true`, an entry whose first broken rule is `already-recorded` is skipped instead of being a problem.
4. 201 `{expenses, payments, skipped, balances}`: the new expenses and payments in entry order, shown as their POST routes show them, with consecutive ids of each kind starting at the next free id (skipped entries take no id); `skipped` lists the indexes of skipped entries in ascending order; `balances` is the group's balances after the import, as in `GET /groups/:id/balances`. The whole import is saved in one write; when every entry is skipped nothing is written.

With `"dry_run": true` every check and error is the same and a passing import gets the same body with status 200, but nothing is saved, so the ids it shows are still the next ones.

**Rules**
- `id` (group): 1 to 30 characters of `a-z`, `0-9` and `-`, starting with a letter.
- `name` (group): a non-empty string of at most 100 characters.
- `members`: an array of 2 to 20 different member names. A member name is 1 to 30 characters of `A-Z`, `a-z`, `0-9`, `_` and `-`, starting with a letter; letter case matters.
- `description`: a non-empty string of at most 200 characters.
- `payer`, `from`, `to`: members of the group; `from` and `to` must differ.
- `amount`: a JSON number from 0.01 to 1000000 with at most 2 decimals, such as `12.5` or `4.35`. It is kept as whole cents and shown back as the same number.
- `split`: optional, a non-empty array of different members of the group. Without it the expense is split between every member, in the group's member order.
- Request bodies are JSON objects of at most 10 KB: a bigger body gets 413, a body that is not a JSON object gets 400. On every route except `POST /groups/:id/import`, unknown fields are ignored; the import refuses them.
- Every error is `{"error": "<message>"}`. An unknown route is 404 `{"error": "not found"}`. Fields are checked in the order the table lists them; the first bad one decides the 400 message.

## Layout

- `server.mjs`: start-up, and the request loop: find the route, read the body, run the handler, save.
- `lib/http.mjs`: body reading, JSON replies, errors.
- `lib/routes.mjs`: route table.
- `lib/groups.mjs`, `lib/expenses.mjs`, `lib/import.mjs`: handlers. Handlers return a new store instead of changing the old one.
- `lib/validate.mjs`: input parsers; they throw `ValidationError` (400).
- `lib/ledger.mjs`: money maths on cents: shares, balances, and how expenses and payments are shown.
- `lib/store.mjs`: loading and atomic saving of the data file.
- `test/`: `node:test` suites; `helpers.mjs` starts the app on a free port with a temp data file.
