# p1 hidden tests: coverage of the task text

Task text: `bench/tasks/p1.md` (stage 1), `bench/tasks/p1-s2.md` (stage 2) and `bench/tasks/p1-s3.md` (stage 3). Sets, from
`bench/stages.mjs`: `s1` (stage-one cases on the copy after stage 1), `s2` (stage-two cases on the copy after stage 2), `s3`
(stage-three cases on the final code), `reg2` (stage-one cases on the copy after stage 2) and `reg3` (stage-one and stage-two cases
on the final code). Stage-one cases live in `bench/hidden/p1/stage-one-*.mjs` (startup, routing, accounts, tickets, tools, and one
case that reads a database written by stage 1's own code), stage-two cases in `stage-two-cases.mjs` (reports, chart, static
routes) and `stage-two-page.mjs` (markup and script), stage-three cases in `s3.test.mjs`. In the "covered by" column a title is the
start of the test's name.

The cases were written from the three task files alone: no run output, no result file and no solution was read. Each value the
text names is compared exactly (status, content type, error text, every key of a reply, every number). Servers are started on
port 0 in temp folders; the model is the stand-in server of `model-server.mjs` (Task 6), also on port 0.

How the cases were proved: `node bench/calibrate.mjs p1` runs the reference of each stage through every set (all pass), and
14 broken versions (5 on stage 1, 4 on stage 2, 5 on the final code; each changes one stated line) must each fail at least one
case (the last line is `p1: calibration ok`). The broken versions are listed at the end.

## Stage 1 (sets s1, reg2, reg3)

| Line of the task | Covered by |
|---|---|
| Startup order: PORT, database, first user, listening | "the order of startup" (bad PORT before a bad database; bad database before a bad password and before the port is bound; bad password before the port is bound) |
| Listens on 127.0.0.1 | "it listens on 127.0.0.1 only" (::1 and the machine's other addresses refuse) |
| PORT unset or empty is 3000; non-digits, above 65535 or unbindable: one stderr line, exit 1 | "the listening line" (unset, empty; busy 3000 counts as the bind failure); "a bad PORT or a port in use" (many values, no file made); "PORT 65535 is allowed" |
| Listening line with the port bound; leading zeros; the only line on stdout | "the listening line" (PORT=0, `00<port>`); "no reply, no output of the server..." (stdout is that one line after a long script); "a 404 is the first thing a started server can say" |
| DB_FILE default `helpdesk.db`, relative to the working directory | "DB_FILE: unset or empty..." (unset, empty, `sub.db`) |
| New, empty or table-less version 0 file gets the schema; exactly these tables, columns, no triggers; CHECK and STRICT | "a missing file, an empty file and an empty database all get exactly the schema" (columns, keys, strict, unique, autoincrement, integrity, no triggers or views; four rejected inserts) |
| Version 1 is used as it is | "a version 1 database is used as it is" (other tool's table and index kept, the file is byte-identical after a start); "a database that stage 1's code wrote works on this code" (reg2, reg3) |
| Anything else: `cannot open database <name>`, exit 1, nothing listened, file unchanged | "a database the server cannot use" (garbage, versions 2, 99 and -1, tables with version 0, a folder, a missing folder, default and relative names, with and without ADMIN_PASSWORD) |
| First user `admin`, role admin, password as given, schema and user in one transaction | "the first user: admin..." (spaces, non-ASCII, scrypt form, new salt per database, no audit entry); the "one transaction" half has no case (see ambiguous lines) |
| ADMIN_PASSWORD 12 to 200 UTF-16 code units, the exact line, no write, new file absent or empty | "ADMIN_PASSWORD is 12 to 200 UTF-16 code units" (ASCII and emoji, 12 and 200 either side); "a bad ADMIN_PASSWORD leaves an existing file as it was" (empty file, empty database, version 1 without users) |
| When `users` has a row ADMIN_PASSWORD is ignored; a version 1 database without users gets the admin | "the first user is made when the users table has no row..." (unset, short, different password; members only) |
| Only that one line on stderr in each startup failure | `refused` compares the whole stderr (minus Node warnings) in every startup case |
| Times are whole milliseconds; one reading of `Date.now()` per request | "a login" (`expires_at` minus 8 h equals the audit `at`); "POST /api/tickets: 201..." and "comments: 201..." (`created_at` equals the audit `at`, inside the request window) |
| The database is the only truth (users, sessions, failures) | "the database is the only truth for users"; "a session is a row the database holds"; "only failures newer than 15 minutes count..." |
| Locked database: wait up to 3 s, then 503 `database busy`, nothing changes, server runs on | "a locked database: replies that need no database come at once..." (also an unknown token); "a locked database: a write and a login get 503 too"; "a lock that goes within 3 s is waited out" |
| Check 1, 2, and check 3 without a token never touch the database | first "a locked database" case (404, 405, no cookie, no `sid=` piece answered in under 2 s) |
| Write is all or nothing; unexpected failure is 500 `internal error`, server runs on | "an unexpected failure in a write" (every write route under a trigger; state, ids, hashes compared); "an unexpected failure in a read or a login" |
| Requests at the same time act as one at a time | "requests at the same time act as if one at a time" (8 logins); "requests at the same time give the result of some order" (tickets, comments, equal usernames); "two admins removing each other" |
| Only the JSON matters; JSON content type with charset; error shape `{"error"}` | `expect` and `view` compare type and body in every case; "every reply with a body is JSON with the charset; 204 has no body" |
| Replies are the object itself; user, ticket, comment, entry have exactly their keys | "a login", "POST /api/users: 201...", "POST /api/tickets: 201...", "GET /api/tickets/<id> is the ticket itself", "comments: 201...", "GET /api/audit" (key lists compared) |
| Path is the target up to the first `?`, byte for byte; query decoded like URLSearchParams, first value | "a path that is not listed is 404" (case, `%73`, `%00`, `//`, `.` and `..` segments, trailing and empty segments); "the path ends at the first ?"; "GET /api/tickets: newest first..." (`%32`, repeated `limit` and `before`, first value invalid) |
| `<id>`: non-empty, no `/`; not a positive integer without a leading zero, or no row: 404, including huge ids | "an <id> that is not a positive integer..." (over twenty ids, user and ticket routes, with a body that would fail later checks) |
| Every route needs a session except `POST /api/session`; admin only routes | "a route that needs a session answers 401", "an admin-only route answers 403", "a member cannot use /api/users at all" |
| Body is read whole before any reply | "the whole request body is read before any reply" (404, 401, 415, raw socket, body in two pieces) |
| Order of checks: 404, 405, 401, 403, id, 415, 413, 400, rules | "a path that is not listed...", "a listed path with an unlisted method", "a route that needs a session...", "an admin-only route...", "an <id>...", "POST and PATCH check Content-Type first", "a body over 100000 bytes", "a body that is not a JSON object" (each case sets a later check to fail as well) |
| Media type before the first `;`, spaces and tabs trimmed, case ignored | "POST and PATCH check Content-Type first" (refused and accepted forms) |
| Body over 100000 bytes is 413 (bytes, not characters); not an object is 400; decoded as UTF-8 for JSON.parse | "a body over 100000 bytes..." (ASCII, 2-byte, 4-byte, in pieces, 2 MB); "a body that is not a JSON object..." (many bodies, BOM, invalid UTF-8) |
| A key is present when the object has it, null included; other keys ignored | "a key counts as present..." (`null` title, priority, password, role; `__proto__`, inherited names) |
| Passwords: `scrypt$<16-byte salt>$<64-byte key>` of the UTF-8 bytes in lowercase hex, new salt each time | "passwords are stored as scrypt..." (ASCII, non-ASCII, same password for two users, same password set again); "the first user" |
| Tokens: 32 random bytes as 64 hex; stored as the SHA-256 of the 64 characters; `expires_at` = request time + 28800000 | "a login"; "a session is a row the database holds" (hash of the bytes is not the hash of the text) |
| Token read from the Cookie: split at `;`, spaces and tabs trimmed, first piece starting `sid=` | "the session cookie" (a dozen accepted and a dozen refused forms) |
| Session valid while `expires_at` is above the request time | "a session is a row the database holds" (planted past, near and later expiry; waits 3 s for a session to run out) |
| `POST /api/session`: exact Set-Cookie, failures deleted, audit; 400, 429, 401; failure recorded; 429 records nothing | "a login", "login errors", "5 recorded failures...", "a good login clears the failures of that username only", "only failures newer than 15 minutes count", "requests at the same time act as if one at a time" |
| `GET /api/session`; `DELETE /api/session` (204, exact Set-Cookie, one row, audit) | "a login", "a logout: 204..." |
| Only the login and the logout set a cookie | "a login keeps the session the request already has; only the login and the logout set a cookie" |
| `GET /api/users`; `POST /api/users` rules 1 to 4 in order, 409; used as given; audit | "POST /api/users: the rules of username..." (many bad usernames, passwords and roles, the order, the duplicate); "POST /api/users: 201..." |
| `PATCH /api/users/<id>`: rules, last admin, sessions of that user deleted (also the requester's), audit | "PATCH /api/users/<id>: the rules in order", "a successful update deletes every session", "the last admin cannot be removed" |
| A member's tickets, lists leave out others, admin sees all | "a member's own tickets are the ones they created", "a member's list leaves out other tickets before it counts limit and next" |
| `GET /api/tickets`: newest first, `limit`, `before`, `next`, checks in order | "GET /api/tickets: newest first..." (7 and 57 tickets, many bad limits and befores, order) |
| `POST /api/tickets`: rules in order, trimmed, status open, priority default, created_by and time, audit | "POST /api/tickets: 201...", "POST /api/tickets: title 1 to 120..." (code-unit limits with emoji, no-break space) |
| `PATCH /api/tickets/<id>`: rules in order, member 403 for status and priority, only given keys change, audit | "PATCH /api/tickets/<id>: rules in order" |
| `DELETE /api/tickets/<id>`: 204, comments gone, audit; ids never repeat, after deletes and restarts | "DELETE /api/tickets/<id> (admin only)"; "data lives in the file" |
| Comments: list by id, create (trim, 1 to 2000, closed 409 after the text rule), audit, 404 first | "comments: 201...", "comments: text 1 to 2000 code units..." |
| Audit entries: exactly one per success, none for failures, reads or startup; `GET /api/audit` shape, order, paging, admin only; nothing changes or removes an entry | "the audit log: one entry per successful audited request" (full sequence with 12 failing or reading requests in between); "GET /api/audit (admin only)"; 405 for POST, PUT, DELETE and PATCH in "a listed path with an unlisted method" |
| Secrets: no reply, no stdout or stderr, no table holds a password, hash or token (except the login's Set-Cookie) | "no reply, no output of the server and no table holds a password..." (logins, a created and a changed password, wrong passwords, bad JSON with a password, a 500, every list route) |

## Stage 2 (sets s2, reg3; the stage-one cases run again as reg2 and reg3)

| Line of the task | Covered by |
|---|---|
| Everything else keeps working, on new and on existing databases; schema stays version 1 | reg2 and reg3 run every stage-one case; "a database that stage 1's code wrote works on this code" (replies, schema, audit entries, ids) |
| `GET /api/reports/summary`: counts and total as numbers, tickets the user sees, filters | "GET /api/reports/summary: the counts..." (many filter sets by an admin and two members, planted tickets at day edges, leap day, 2000-01-01, 2099-12-31) |
| Filters checked in order: priority, from, to, from after to, created_by; the first failure decides | "the filters are checked in the order..." (ordered queries) |
| `priority`, `from`, `to` rules and messages; valid date range 2000 to 2099, leap years | same case (many invalid dates for `from` and for `to`, valid edge dates, invalid priorities) |
| `from` is at or after 00:00:00.000 UTC; `to` is before 00:00:00.000 of the next day | summary case (tickets 1 ms either side of the day edges) |
| `created_by`: admin only checked and applied; unknown id matches none; ignored for a member | summary case (known, unknown and huge ids), "a member's report counts only their own tickets" |
| Empty value counts as absent; repeated name is the first value | "the filters are checked in the order..." |
| `chart.svg`: same tickets, filters, rules and errors; type, `<svg` first, root attributes, 7 children, bars and labels | "GET /api/reports/chart.svg: image/svg+xml...", "the chart bars: heights are Math.round..." (10 count triples including half values 37.5 and 112.5), "the chart answers the same errors as the summary" |
| Numbers are ASCII digits only; other attributes allowed | chart cases (`/^[0-9]+$/` on each named number; extra attributes not forbidden) |
| `GET /` and `GET /app.js`: types, no session, no database (no 503) | "/ and /app.js need no session and no database" (also while the database is locked, 405 for POST, 404 for look-alikes) |
| Report routes need a session, 405 for other methods, read the database each time | "the report routes need a session..." |
| The page: `<script src="/app.js">` last in `<body>` with no other attribute, classic script, no inline code, no `on...` attribute | "the script is loaded by one <script src=...>" |
| Title, only h1, `#error`, login form, dashboard, filter form, select with four options, date inputs, buttons, labels | "the page markup: the title and h1..." |
| Browser APIs used by the script | the DOM stand-in throws on any member, event member, fetch option or fetch-reply member the task does not list, and `window`, `console` and timers do not exist in the script's context |
| Logged-in and logged-out views | "on load...", "a login submit...", "a logout that works" |
| Reply error rules (`Request failed.`, `Could not reach the server.`, 204 to a GET) | "on load, any other reply is an error..." (a table of replies and no reply), "a login that fails...", "a report that fails...", "a logout that fails..." |
| On load: GET /api/session; 200, 401, other | "on load: GET /api/session..." |
| Login submit: preventDefault, disabled while running, header and body exact, re-enabled, password emptied, no second /api/session | "a login submit...", "a login that fails..." |
| Report fetch URL: order, encodeURIComponent, empty fields give no `?` | "a report fetch: /api/reports/summary and the query..." |
| On 200: three `<li>`, `Total:`, chart source with the same query, `#error` emptied; on error nothing else changes | "a report that arrives...", "a report that fails..." |
| Plain text, never HTML | "every value is shown as plain text, never as HTML" |
| Overlapping fetches: only the last started counts; before a successful logout changes nothing | "report fetches that overlap...", "a report fetch started before a successful logout..." (also after a failed logout, and a late failure) |
| Filtering: submit never reloads, starts a fetch at once | "a submit of the filter form..." |
| Logging out: disabled while it runs, 204 empties the named elements and keeps the fields, errors keep the view | "a logout click...", "a logout that works...", "a logout that fails..." |
| Log in again after a logout | "after a logout the page can log in again..." |

## Stage 3 (set s3; reg3 runs stage-one and stage-two cases on the final code)

| Line of the task | Covered by |
|---|---|
| Startup now checks PORT, then MODEL_URL, then the rest | "startup order: PORT, then MODEL_URL, then the database" |
| Unset or empty MODEL_URL: server runs, both routes 503 `model not configured` | "an http or https MODEL_URL... lets the server start; an unset or empty one too" |
| Unparsable or non-http(s) MODEL_URL: the exact line, nothing else, exit 1, database not opened, no listening | "MODEL_URL that new URL() cannot parse..." (a table of values; no file made; a garbage file untouched and not reported) |
| Each attempt: POST to MODEL_URL as given, `Content-Type: application/json`, body with exactly `messages` of two objects with two keys | "each attempt is a POST of exactly..." (path and query kept, keys of body and of each message compared) |
| `<instructions>`: fixed per route, different between the routes, names all five categories, nothing from the database | same case (two tickets per route, five leak words per string) |
| `<ticket>` is `JSON.stringify({ title, description, comments })`, comments in id order, `[]` when none | same case (quotes, backslash, newline, line separator, emoji; three comments by three users; a ticket with none) |
| Nothing else from the database goes to the model | same case (other ticket and comment, usernames, tokens, password, hash, `created_by`, `user_id`) |
| A ticket's text is data; reply holds only what the route names | "a ticket's text is data..." (injection in title, description and comment; the model answers with extra keys and with a long text) |
| An attempt fails: send or connection fails, no whole reply in 2000 ms, status not 200 (3xx too), body not an object with a string `text`, or `text` fails the check | "an attempt fails on a status that is not 200..." (a table of failure forms), "the text must pass the route's check", "a model that cannot be reached", "an attempt that has not been fully answered within 2000 ms", "every attempt of one model call is the same request; a redirect is not followed" (own redirecting server) |
| A timed-out attempt is aborted and its late reply never used | the 2000 ms case (a reply at 2600 ms is not used; a reply at 1200 ms is; three late replies give 502 after about 6 s; the audit count does not move later) |
| At most 3 attempts, at once after a failure; first good one ends it; all fail: 502 `model call failed` | "an attempt fails on a status..." (1, 2, 3 bad then good; counts of calls) |
| While a model call waits, other requests are answered and no transaction is open | "while a model call waits..." (a read, a write, an outside writer with a 400 ms limit, three calls at the same time) |
| Both roles; a member only on their own tickets, else 404 | "the checks before the model...", "a good summary or category is audited..." (member own, admin any, closed ticket) |
| The request body is read and ignored (no type, size or JSON check) | "the request body of these two routes is read and ignored" |
| Order: path, method, session, id, then 503 when no model, then the call | "the checks before the model" (model not called; 404 and 401 before 503) |
| Summary: trimmed text 1 to 500 code units, reply `{summary}`, audit `ticket.summary` | "the text must pass the route's check", "a good summary or category is audited" |
| Category: trimmed text is one of the five words, reply `{category}`, not stored, audit `ticket.category` | same cases (refused spellings, the five words; tickets table and schema unchanged) |
| Audit target `ticket:<id>`; a reply other than 200 adds no entry | "a good summary or category is audited..." (400-level, 502 and 404 add nothing) |

## Ambiguous lines (no case asserts one reading)

- The schema and the first user are "written in one transaction" (stage 1): a test cannot make that step fail from outside, so only the
  result (both present, or neither) is checked.
- `HEAD` on a listed path is checked as 405 only; the task does not say how a HEAD request is read.
- The wait for a locked database is accepted from 2.7 s to 9 s (the task says "up to 3 seconds").
- A 401 whose body cannot be parsed as JSON on page load: the text says both "leaves `#error` empty" and "shows `Could not reach the
  server.`"; not asserted.
- What `#who`, `#counts` and the views show before the first reply to `GET /api/session`: not asserted.
- Whether the chart's labels or bars carry extra attributes or whitespace: allowed.
- The audit `at` of a model route: the request's time may be read when the request starts or when the reply is made; the case accepts
  any time inside the request.
- A model reply with a byte order mark before the JSON, and a reply that arrives slowly in pieces (the stand-in answers whole): not
  asserted.
- A ticket deleted while its model call waits: the task is silent; not asserted.
- Journal mode: a builder that switches the database to WAL changes a version 1 file at start and fails "a version 1 database is
  used as it is"; the text says "used as it is".

## Broken versions

Each is one changed file laid over the reference of its stage (`bench/heldout-calibration/p1/near-miss-s1/`, `near-miss-s2/`,
`near-miss/`).

| Stage | Name | The stated line it breaks |
|---|---|---|
| 1 | memberlist | `GET /api/users` is admin only (role check missing) |
| 1 | tokenlog | no session token in anything the server writes |
| 1 | nobusy | a locked database is waited for up to 3 seconds |
| 1 | nextoff | `next` only when more tickets follow (off by one at an exact fit) |
| 1 | keepsessions | a successful user update deletes that user's sessions |
| 2 | roundfloor | `h` is `Math.round(150 * c / m)` |
| 2 | memberby | `created_by` is ignored and never checked for a member |
| 2 | keeppassword | `#password` is emptied when the login settles |
| 2 | staleoutcome | only the outcome of the last report fetch is used |
| 3 | twoattempts | a model call makes at most 3 attempts |
| 3 | notimeout | an attempt not answered within 2000 ms fails and is aborted |
| 3 | leakuser | nothing else from the database goes to the model |
| 3 | txopen | no database transaction is open while a model call waits |
| 3 | extrakeys | the reply holds only what the route names |
