BLIND CODE REVIEW. No human will answer questions: work autonomously from start to finish, then give your verdict.

The current folder holds solutions to one task, each in its own folder: A, B, C, D. You do not know who or what wrote them; do not try to guess. Judge each one on its own merits.
SEED/ is the repo before the change; judge only what each solution changed and whether it broke anything

## The task the solutions were given

This repo is a small HTTP service that shares expenses within groups (see README.md), and its tests pass. Work on it as you would on a teammate's project.

Problems users reported
1. "I added a 4.35 coffee to our trip group, and the expense list shows it as 4.34."
2. "Ann paid a 10.00 taxi for Ann, Ben and Cara. Our balances now say Ann is owed 6.67 while Ben and Cara owe 3.33 each, so they don't add up to zero."

README.md describes how the service is meant to work: where the code disagrees with it, the code is wrong. Fix the code only, and leave the records already saved in the data file as they are (no migration).

Feature request
- Add `POST /groups/:id/import`. Its handler and its checks go in a new module `lib/import.mjs`, exported under any name; it may call the existing parsers in `lib/validate.mjs` and `lib/expenses.mjs`. Your tests and the hidden checks reach the import over HTTP only, so the export name is free. It records a list of expenses and payments for a group in one go: all of them, or none of them.
- The body is `{"entries": [...], "dry_run": <boolean>, "skip_recorded": <boolean>}`; `dry_run` and `skip_recorded` may be left out, and are then false. An entry is either an expense `{"type": "expense", "description", "payer", "amount", "split"}`, where `split` may be left out, or a payment `{"type": "payment", "from", "to", "amount"}`. Each field follows the same rule as on `POST /groups/:id/expenses` or `POST /groups/:id/payments`. In the body and in entries, a field counts as left out only when its key is absent: a key that is present is checked whatever its value, `null` included (so `"dry_run": null` gets the 400 `dry_run must be true or false`, and `"split": null` is `bad-split`).
- As on the other routes, a body over 10 KB gets 413 and a body that is not a JSON object gets 400. After that, the checks below run in this order; the first one that fails decides the reply, and a failed check saves nothing.
  1. Unknown group: 404 `{"error": "not found"}`.
  2. 400 `{"error": "<message>"}` with the first of these messages that applies: `unknown field <name>` when the body has a field other than `entries`, `dry_run` and `skip_recorded` (`<name>` is the first such field, in the order `Object.keys` lists them); `entries must be an array of 1 to 50 items`; `dry_run must be true or false`; `skip_recorded must be true or false`.
  3. 422 `{"error": "import rejected", "problems": [...]}` when at least one entry breaks a rule below. `problems` holds one `{"index": <n>, "rule": "<rule>"}` for each entry that breaks a rule, sorted by `index`, which is the entry's position in `entries` counting from 0; `rule` is the first rule that entry breaks, in this order:
     - `not-an-object`: the entry is not a JSON object (null and arrays are not objects).
     - `bad-type`: the entry's `type` is not `"expense"` or `"payment"`.
     - `unknown-field`: the entry has a field its type does not take. An expense takes `type`, `description`, `payer`, `amount` and `split`; a payment takes `type`, `from`, `to` and `amount`.
     - For an expense: `bad-description`, `bad-payer`, `bad-amount`, then `bad-split`, when that field breaks its rule. Then `duplicate`, when an earlier entry that broke none of the rules from `not-an-object` to `bad-split` is an expense with the same payer, amount and description. Then `already-recorded`, when the group already has an expense with the same payer, amount and description. Two descriptions are the same when they are equal after removing white space at both ends and lowering the letter case (JavaScript's `trim()` and `toLowerCase()`); amounts are compared in cents; `split` is not compared. An earlier entry counts for `duplicate` even when it is itself `duplicate` or `already-recorded`, skipped or not. Example: two identical expense entries that both match an expense the group already has give 422 with `"problems": [{"index": 1, "rule": "duplicate"}]` when `skip_recorded` is true, and `"problems": [{"index": 0, "rule": "already-recorded"}, {"index": 1, "rule": "duplicate"}]` when it is false.
     - For a payment: `bad-from` when `from` is not a member of the group, then `bad-to` when `to` is not a member of the group or is the same as `from`, then `bad-amount` when `amount` breaks its rule. Payments are never `duplicate` or `already-recorded`: identical payments are all imported.
     - With `"skip_recorded": true`, an entry whose first broken rule is `already-recorded` is not a problem: it is skipped instead, and left out of the import. An import whose entries are all skipped succeeds: it replies 201 (200 with `dry_run`) with `"expenses": []`, `"payments": []`, `skipped` listing every index and the current balances, and it writes nothing to the data file.
  4. Success: 201 `{"expenses": [...], "payments": [...], "skipped": [...], "balances": {...}}`. Each expense entry that is not skipped becomes an expense, and each payment entry a payment, exactly as the POST routes would make them from the same fields. Each kind gets consecutive ids in entry order, starting at the id its POST route would give next, and the whole import is saved in one write. Skipped entries take no id, and an entry takes no id of the other kind: with entries [expense, skipped expense, payment, expense] and next ids E for expenses and P for payments, the new expenses get E and E+1 and the payment gets P, and afterwards the next ids are E+2 and P+1. `expenses` and `payments` list the new ones in entry order, in the same shape as the POST routes' replies (`[]` when there are none); `skipped` lists the indexes of the skipped entries in ascending order (`[]` when there are none); `balances` is the member-to-amount map that `GET /groups/:id/balances` returns under its `balances` key (not nested), with every member in group order, for the group after the import, e.g. `"balances": {"Ann": 6.66, "Ben": -3.33, "Cara": -3.33}`.
- With `"dry_run": true`, every check and every error reply stays the same, and an import that passes them gets the same reply body with status 200, but nothing is saved: the ids in the reply are the ones a real import would get now, and the next expense or payment made still gets the first of them.

Keep the existing tests passing, add tests with node:test for your changes (the `package.json` "test" script must run them all), and document the new endpoint in the README:
- The README must contain the literal text `POST /groups/:id/import`, and its API table gets a row that starts with it and lists 201/200, 400, 404, 413 and 422 `import rejected`.
- It names the `dry_run` and `skip_recorded` fields and every rule: `not-an-object`, `bad-type`, `unknown-field`, `bad-description`, `bad-payer`, `bad-amount`, `bad-split`, `duplicate`, `already-recorded`, `bad-from` and `bad-to`.
- Its "Unknown fields are ignored." is limited to the other routes, since the import refuses unknown fields.


## Rules

1. Read the task above.
2. Inspect each solution folder: code, tests, docs. Run each solution's own tests (for example `npm --prefix <label> test`, or `node --test` on that folder's test files).
3. Probes (scratch scripts, edge cases, bad input) go only in the empty `scratch` folder in the current folder. It is not deleted for you here; leaving it is fine. Do not delete anything yourself.
4. Never edit a solution folder: do not edit, create or delete anything in A, B, C, D or `SEED` yourself (running a solution's own tests is fine). Do not use the network.

## Scores

Score each solution on these 5 dimensions plus overall, each an integer from 1 (very poor) to 10 (excellent):
- `correctness`: does it do what the task asks, including the edge cases and errors the task names?
- `codeQuality`: structure, naming, readability, no needless complexity.
- `tests`: do its own tests pass, and would they catch real bugs?
- `robustnessSecurity`: bad input, error handling, limits, unsafe operations.
- `docsUsability`: README, usage, clear error messages, ease of use.
- `overall`: your overall judgement of the solution.

Rank the solutions best to worst, with no ties.

In `notes`, give each solution's main strengths and defects. Cite `file:line` for each (for example `src/cron.mjs:42`), and say what you ran and what it showed.

## Answer format

End your answer with exactly one fenced `json` block, with nothing after it. It has one key per solution label plus `ranking`, for example:

```json
{"A": {"correctness": 8, "codeQuality": 7, "tests": 6, "robustnessSecurity": 7, "docsUsability": 5, "overall": 7, "notes": "src/a.mjs:12 ..."}, "B": {"correctness": 6, "codeQuality": 5, "tests": 4, "robustnessSecurity": 5, "docsUsability": 6, "overall": 5, "notes": "index.mjs:8 ..."}, "C": {"correctness": 9, "codeQuality": 8, "tests": 8, "robustnessSecurity": 6, "docsUsability": 7, "overall": 8, "notes": "lib/b.mjs:30 ..."}, "D": {"correctness": 7, "codeQuality": 6, "tests": 7, "robustnessSecurity": 5, "docsUsability": 6, "overall": 6, "notes": "src/c.mjs:41 ..."}, "ranking": ["C", "A", "D", "B"]}
```

## How to hand in your verdict

- This folder is the whole case: judge only what is in it. Do not open other case folders, any repository or the web.
- Put probes only in the `scratch` folder here.
- When you are done, also write your final JSON object (the same one, without the fence) to `verdict.json` in this folder.
