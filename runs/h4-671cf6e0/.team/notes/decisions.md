# Shared decisions (append only): date — section — decision — why

- 2026-11-03 — backend — Data file layout `{nextId, bookings[]}`, validated strictly at startup (exact keys, valid fields, unique ids < nextId, no overlaps); see data-file.md — stricter reading of "content is not data in the layout this server writes".
- 2026-11-03 — backend — Saves write `<DATA_FILE>.<pid>.tmp` then rename it over the data file; memory changes only after the rename succeeds — an interrupted save never corrupts the file, and a failed save leaves state and next id unchanged.
- 2026-11-03 — backend — Content-Type media type folds ASCII A-Z only; trims only spaces and tabs — exact reading of rule 1.
- 2026-11-03 — testing — Test script must be `node --test test/*.test.mjs`, not `node --test test/`: on Node 22.23 a directory argument is loaded as a module and fails (`Cannot find module .../test`). test/ also holds helpers (helpers.mjs, api-util.mjs, fake-dom.mjs), so keep the `.test.mjs` suffix in the glob — plain `node --test` would run the helpers as test files.
- 2026-11-03 — testing — Startup/persistence tests seed the data file in backend's layout (data-file.md); a layout change must update test/startup.test.mjs and test/persistence.test.mjs.
- 2026-11-03 — frontend — A 200 reply whose body has the wrong shape shows `Request failed.` and leaves the room list and booking list unchanged — the spec does not cover this case; this is the safest reading.
