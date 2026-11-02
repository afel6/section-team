# Test suite — testing — 2026-11-02

Run: `npm test` (= `node --test test/*.test.mjs`), ~6 s, 607 tests, Node built-ins only.

## Layout
- `test/helpers/server.mjs` — spawn server.mjs (PORT=0, cwd = tmp dir), request/rawRequest/openSocket, MSG (all spec error texts), expectError, uniqueDate, withServer, withTmpDir, exists.
- `test/helpers/fake-dom.mjs` — vm-loaded app.js with only `document` + `fetch`; any other API is a recorded violation; ordered `page.log`.
- `test/helpers/app.mjs` — boot(), NO_REPLY, FAILED, errorText for app tests.
- `test/helpers/html.mjs` — tiny HTML parser for index.html checks.
- `test/startup|persistence|api-routes|api-list|booking-body|booking-fields|page-html|app-load-list|app-submit-cancel.test.mjs`.

## Near-miss check
- 72 one-bug copies in `.team/near-miss/<n>-<file>` (first line names the bug), defined in `.team/scratch/near-miss-defs.mjs`.
- `node .team/scratch/near-miss-run.mjs make` rebuilds them; `... run [n,n]` swaps each in, runs the suite, restores the original and verifies its sha256. All 72 fail the suite.
- Edits to server.mjs / app.js / index.html can make a definition stop matching; `make` then reports which one.
