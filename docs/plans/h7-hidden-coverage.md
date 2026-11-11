# h7 hidden tests: coverage of the task text

Task text: `bench/tasks/h7.md` (stage 1) and `bench/tasks/h7-s2.md` (stage 2). Sets: `s1` and `reg` both run
`bench/hidden/h7/stage-one-cases.mjs` (its cases, plus `stage-one-more.mjs`, added in this change); `s2` is
`bench/hidden/h7/s2.test.mjs`. In the "covered by" column a title is the start of the test's name; **new** marks a case added
in this change. A line is "weak" when only part of it was asserted before this change; the new case closes that part.

Why: a single-agent run passed all 92 hidden tests, so the sets did not separate careful work from careless work. The cases
below were written from the task text alone (no run output, no solution was read).

## Stage 1 (sets s1 and reg)

| Line of the task | Covered by |
|---|---|
| Startup order: PORT, then database, then listening | "a bad PORT or a port in use" (no file made on bad PORT); **new** "the database is opened before the server listens" (busy port plus bad file gives the database refusal) |
| Listens on 127.0.0.1 | **new** "it listens on 127.0.0.1 only" (::1 and the other local addresses refuse) |
| Unset or empty PORT is 3000 | "the listening line" |
| PORT not only ASCII digits, above 65535, or cannot be bound: one stderr line, exit 1 | "a bad PORT or a port in use"; **new** "PORT is read whole" (trailing newline or space, `0065536`) |
| Leading zeros, PORT=0 | "the listening line"; **new** (30 leading zeros are fine) |
| Listening line with the bound port, `\n` | "the listening line" |
| That line is the only thing ever on stdout | weak (startup only); **new** "stdout holds the listening line and nothing more" (after requests, 404, 405, 400, 409, 500) |
| DB_FILE default `parts.db`, relative to cwd | "DB_FILE: unset or empty" |
| New, empty or table-less version 0 file gets the schema | "a missing file, an empty file and an empty database" |
| Version 1 is used as it is | weak (only through stage 2); **new** s1 only: "a version 1 database is used as it is" (other tools' objects, orphan move and negative balance not checked, reads change nothing, sequences continue) |
| Anything else is refused: `cannot open database <name>`, exit 1, no listening, file unchanged | "a database the server cannot use"; **new** "a user_version that is not supported is refused whole" (-1, 5, the first unsupported one, with and without tables) |
| `<name>` as given, `parts.db` when unset | "a database the server cannot use" |
| Schema is the contract: exact tables, columns, no triggers | "a missing file..." (SCHEMA compare) |
| Database is the only truth, no rows in memory | "the database is the only truth" |
| Locked database: wait up to 3 s, then 503 `database busy`, nothing changes, server keeps running | "a locked database" (two cases, POST part and POST move); **new** PATCH, DELETE move and transfer wait for a lock that goes (1 s); **new** a transfer still locked is 503 (one request per lock window: the server blocks while it waits) |
| Write is complete or nothing; unexpected failure is 500 `internal error`, server keeps running | "a failure inside a write" (every write route); **new** "a failure in a read is 500 internal error too" (table renamed away by another tool) |
| Concurrent requests act as if serial | "requests at the same time" |
| Only the parsed JSON matters; JSON replies have the JSON content type | `expect` checks the type in every case |
| Error reply is `{"error": message}` | `expect` in every case |
| Path is the target up to the first `?`; byte for byte, no decoding | "unknown paths are 404"; **new** "the query is cut at the first ?" (`?/moves`, `%3F`), "a path not listed is 404 ..." (`%2F`, `%0A`, `%00`, trailing and empty segments) |
| Query decoded as URLSearchParams; repeated name means first value | "GET /api/parts: ... limit rules" (repeated limit); **new** (`%32`, encoded name, `q=%FF`, `q=%`, repeated `q` and `after`, first value invalid) |
| Unknown path 404 `not found`, any method | "unknown paths are 404" (GET, POST, DELETE); **new** (PUT, PATCH, OPTIONS, HEAD; a wrong type, too big or unparsable body on an unknown path is still 404) |
| Listed path, unlisted method: 405 | "unknown paths ... 405" (also HEAD, OPTIONS) |
| `<id>`: non-empty, no `/`; not a positive integer without leading zero, or no row: 404 by route, also huge ids | "an <id> that is not a positive integer..."; **new** (`%2F`, `1%20`, `%0A` are ids that name no row, so `part not found`; an empty id is not a route) |
| Whole body is read before any reply | "body rules" (pieces) |
| Body checks in order: id, 415, 413, 400, route rules; media type trimmed, case ignored; other keys ignored | "body rules for POST and PATCH" |
| 10000 bytes, not characters | weak (ASCII only); **new** "the size limit counts bytes" (two-byte characters over and at the limit) |
| Body decoded as UTF-8, given to JSON.parse | weak; **new** (a character split between network pieces, padded JSON, a repeated key means the last) |
| Part shape: `on_hand` number, `value_cents` exact string | "value_cents is exact past 2^53 and past 2^63" |
| GET /api/parts sorted by sku in byte order, limit rules, default 20, next | "GET /api/parts: byte order..." |
| `q`: lowercased both sides, `%` and `_` plain | "q finds a sku or name"; **new** (`ß` is not `SS`, `İ`, the Kelvin sign, `.`, `[a-c]`, `\`, quotes; expected values are computed with `toLowerCase`) |
| `after`: sorts after, byte order | "GET /api/parts..." (`AB-0`); **new** (uppercase before lowercase, a prefix, `é`, `~`, `-`) |
| `limit`: digits, 1 to 100, no leading zero | "GET /api/parts..."; **new** (Arabic digit, `+1`, trailing newline, `%32`) |
| POST part: sku rule 1, name rule 2, duplicate 3, in order, trimmed name, case matters | "POST /api/parts: rules in order" |
| Name: `String.prototype.trim` and UTF-16 units | weak (ASCII, `é`, emoji over); **new** "the name is cut with String.prototype.trim" (no-break space, BOM, line separators trimmed; U+200B and U+0085 kept; 40 emoji fit; combining marks kept) |
| sku `-` and 1 to 32 characters | "POST /api/parts" (32); **new** (single dash) |
| GET, PATCH, DELETE part; 204 empty; moves go with the part | "GET, PATCH and DELETE of a part" |
| PATCH of an unknown part is 404 before the body rules | "an <id>..." (bad ids, wrong type); **new** (valid JSON without `name`) |
| An id is never given twice, also after restarts | "a restart keeps every row, and an id is never given twice" |
| Move shape; running balance order by `on_date`, then `id`; never below zero | "the running balance holds on every date" |
| GET moves: `balance`, order, unknown part 404 | "GET moves sorts by on_date, then id"; **new** (a part with no moves is `{"moves": []}`) |
| POST move rules 1 to 5 in order | "POST moves: the rules in order" |
| `on_date`: real day, 2000 to 2099, leap years divisible by 4 | weak; **new** "on_date is a real day ..." (30 and 31 day months, 2001, 2096, `+` sign, trailing newline, time part, full-width digits, types) |
| `qty`, `unit_cost_cents`: whole JSON number | "POST moves" (1.5, strings, 1e300); **new** (`1e2` is 100, `0.5e1` is 5, `-0`, `1e400`, `9007199254740993`) |
| `note`: string, at most 200 UTF-16 units, stored as given | "POST moves"; **new** (100 emoji fit, 101 do not, `''`, 199 two-byte characters plus one emoji) |
| 409 names the first date the balance breaks | "the running balance holds on every date" |
| DELETE move: 204, 404, 409 with the move kept | "DELETE /api/moves/<id>" |
| Transfers: two moves or neither, notes, same date and cost | "POST /api/transfers"; "a failure inside a write" (both legs) |
| Transfer rule 1 (404), 2 (differ), 3 to 6 in order | "POST /api/transfers"; **new** (the same unknown part twice is 404, not 400) |
| Transfer rule 6: 409 with the first date the source breaks | weak (the transfer's own date); **new** "transfers: ..." (a later move of the source breaks; the same day as the move that empties it) |
| Transfer ranges: qty up to 1e9, cost 0 and 1e9 | **new** (both edges) |
| `GET /` and `GET /app.js`: types, query ignored | "GET / and GET /app.js" |
| Script tag, no inline code, no `on...`, classic script, last element in body | "GET / and GET /app.js"; the script runs in a DOM stand-in that throws on any other API |
| `<title>` and only `<h1>` | "GET / and GET /app.js" |
| Markup: form, fields, labels, `#more`, `#error` | "page markup" |
| Plain text, never HTML | "page: at load ..." (`<b>` in names) |
| Error status, error message, `Request failed.`, `Could not reach the server.` | "page: a list fetch with an error status..."; **new** for Load more (no reply, not JSON, 201), add (200, 204, 500 text, `null`, error not a string) and delete (200, `null`) |
| List fetch at load, `q` added while the search is not empty, `encodeURIComponent` | "page: at load ..."; "page: Load more adds after the list ... everything encoded"; **new** (a space is a value, quotes, parentheses, `!*~`, `+=/?#`, `%41`; a cursor with the same characters) |
| One `<li>` per part, two children, `No parts.`, `#more` state | "page: at load ..." |
| Load more: URL with `&after=`, disables, adds, failure enables again | "page: Load more adds after the list"; **new** (no reply, a reply that is not JSON, 201, and a later success leaves `#error`) |
| Search: `change` fetches from the start, `input` does nothing | "page: change searches at once" |
| Overlapping list fetches: only the last started counts | "page: when list fetches overlap"; **new** (the fetch after an add and the one at load are list fetches too) |
| A failed list fetch shows the message and leaves the list; a success leaves `#error` | "page: a list fetch with an error status" |
| Adding: preventDefault, disabled meanwhile, header, body keys, empties on 201, refetch from the start | "page: adding sends the fields unchanged"; **new** (the refetch keeps the search and replaces what Load more added) |
| Add on an error status keeps the fields | "page: a refused add"; **new** (200 is an error for POST) |
| Deleting: disables, sends, refetch after either status, none without a reply | "page: Delete disables its button"; **new** (200, `null` body, the refetch keeps the search) |

## Stage 2 (set s2, and reg through the stage 1 cases)

| Line of the task | Covered by |
|---|---|
| Every part object gains `handle` | "every reply with a part has its handle"; reg runs every stage 1 reply through `plain` |
| Handle rule: NFKD, marks U+0300 to U+036F, lowercase, runs to `-`, ends trimmed, 40 characters, `part` | "a new part's handle follows the rule"; **new** (Kelvin sign, full-width, superscript, a combining mark outside the range, `ǆ`, `℃`, zero-width space) |
| Taken handle: `-2`, `-3`, smallest free number; suffix after the 40 characters | "a taken handle gets the smallest free number" |
| PATCH never changes it; a body cannot set it; delete frees it | "every reply with a part has its handle"; "a taken handle..." |
| Schema version 2, `parts` exactly, `moves` unchanged, new database gets 2 | `schemaOf(...) = SCHEMA_V2` in "the migration gives handles..." and reg's "a missing file..." |
| Other tools: rules for tables, columns, triggers, indexes stay | same schema compare |
| Migrate version 1 after opening and before listening | weak (checked after the server was up); **new** "the migration is done before the server listens" |
| Version 2 used as it is | "a version 2 database is used as it is: a restart"; **new** (a handle another tool chose stays, no balance or orphan check, handles it holds still count) |
| Handles in id order, each counting as taken | "the migration gives handles in id order" |
| Everything stays: ids and values | same; **new** "the migration changes no value, however odd" (untrimmed, empty and 200 character names, odd skus) |
| Other tools' tables, index, trigger, view stay and work | "the migration keeps what other tools added"; **new** (tables named `parts_new`, `parts_old`, `parts_tmp` and others; a table with a key to `parts` that cascades; a trigger on `moves` that the migration must not fire) |
| Ids never reused, also after deletes before the migration | "the migration keeps the id sequences"; "...also when every part was deleted" |
| `moves.part_id` still cascades | "after the migration the keys work" |
| All or nothing; killed at any moment | "killed at any moment" |
| Refused: orphan move, balance below zero; line `cannot migrate database <name>`; content and version unchanged | "a version 1 database that breaks the rules is refused whole"; "a refusal names the file"; **new** (same-date order by id, date order against id order, exactly zero is fine, one part short while another is rich) |
| 20000 parts, 100000 moves within 30 s | "a database of 20000 parts" |
| Report: shape, counts only moves on or before the date, sorted by handle, exact totals | "GET /api/report"; "the report's totals are exact" |
| Handle byte order, every part | weak (three parts); **new** "the report holds every part" (125 parts, `x-10` before `x-2`) |
| `as_of` missing or invalid: 400 | "the report's date rules and routes"; **new** (leap days, edges, encoded date, newline, time part, `+`, other parameters) |
| Page: list text starts with the handle | "page: each part's line starts with its handle" |
| Report form, label, button, list, total, all empty | "page markup: the report form" |
| Submit: preventDefault, `/api/report?as_of=<value>` encoded | "page: the report form never reloads"; **new** (empty date still asks; special characters) |
| Success fills list and total, empties `#error` | same |
| Error status or no reply: message, report kept | "page: a report with an error status"; **new** (201 and 204 are error statuses for a GET) |
| Overlapping reports; reports and list fetches independent | "page: when reports overlap"; "page: report requests and list fetches are independent" |

## Left out as ambiguous

- A request with a wrong method and a body on a listed path (`POST /` with `text/plain`): 405 as the listed-path rule says, or 415 if "a request with a body" is read as every POST. Not asserted.
- `DELETE` or `GET` with a body of another type: the text puts "(`POST`, `PATCH`)" in the body rule, but does not say what the others do with a body. Not asserted.
- Invalid UTF-8 inside a JSON string: replacement character or refusal. Not asserted.
- A database with only a view or trigger (no tables) and user_version 0: "no tables" suggests the schema, "no other tables, columns or triggers" suggests care. Not asserted.
- A 201 whose body is not JSON (add), and a `DELETE` whose body is not JSON: the text says both "shows `Could not reach the server.`" and "on 201 empties `#error` and the fields". Not asserted.
- `#more` after the first list reply is an error status or no reply: "disabled until the first reply has arrived" does not say whether an error counts as arrived. Not asserted.
- `Load more` after the search box changed without a `change` event: "the same URL" does not say whether it is the last request's URL or the box's value. Not asserted.
- The timing of `database busy`: the wait is "up to 3 seconds", but a lock window shorter than about 5 seconds can still be waited out on a slow clock; the cases hold the lock for 5 to 6.5 seconds, and reads are not asserted (a WAL build is not blocked by a lock for readers).
- A migration that finds the file locked at startup: the text does not say how long it waits. Not asserted.
- `unit_cost_cents` of `-0`: `-0 >= 0`, so it may be read as 0; not asserted.
