# Supervisor summary — meeting-room booking app

The app is built. `npm test` passes all 132 tests.

- ✅ backend: built `server.mjs`, `package.json`, `test/server.test.mjs` and `test/helpers.mjs`, then fixed the one failure found in the final review (a bad `PORT` containing a line break printed more than one line to stderr). Quality 8.5/10 for the build, 9/10 for the fix.
- ✅ frontend: built `public/index.html`, `public/app.js` and `test/app.test.mjs`. The tests run the script against a fake DOM. Quality 9/10.
- ✅ docs: wrote `README.md` and updated it for the final test command. Docs only, so no grade.
- ✅ testing: checked everything against the spec, both by reading the code and by sending requests to the running server, and added `test/final.test.mjs`. Found one failure, now fixed. Quality 8/10.

Decisions (recorded in `.team/notes/decisions.md`):
- The test script is `node --test "test/*.test.mjs"`, because `node --test test/` fails on Node 22.23.
- Data file layout is `{nextId, bookings}`, checked strictly when the server starts.
- Requests are handled one at a time: after the body is read, the work, including the save, runs synchronously.
- The `PORT` error message on stderr is fixed text and never repeats the value.
- A 200 reply with the wrong shape shows `Request failed.` on the page.

Next steps (optional):
- `test/final.test.mjs` puts several cases in each test, so one failure hides the cases after it.
- The page has not been tried in a real browser.
