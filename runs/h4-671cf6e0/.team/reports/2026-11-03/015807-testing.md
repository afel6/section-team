## REPORT · testing · 2026-11-03 02:30
Status:       partial
Job:          Write the node:test suite for the booking app, run it until green, and do the final spec review of server.mjs, public/ and README.
Changed:      /root/bench-runs/h4-671cf6e0/test/{helpers.mjs, api-util.mjs, fake-dom.mjs, startup.test.mjs, persistence.test.mjs, api-routes.test.mjs, api-list.test.mjs, api-concurrency.test.mjs, booking-rules.test.mjs, page-static.test.mjs, app-list.test.mjs, app-actions.test.mjs}; .team/notes/decisions.md (2 testing entries)
Tests:        `node --test 'test/*.test.mjs'`: 322/322 pass, 0 skipped. `npm test` FAILS: package.json:6 `node --test test/` gives `Cannot find module .../test` on Node 22.23.4.
Quality:      8/10 (reviewer, 0 fix rounds; post-pass quick fixes applied)
Coordination: none sent directly (per instruction). Fix list to route — backend: package.json:6 → `"test": "node --test test/*.test.mjs"`. docs: README.md:257 → match the new script. supervisor: layout.md has the same broken command.
Helpers used: sonnet ×6 (coder: 5 test files or groups and 1 fix pass), opus ×1 (reviewer)
Problems:     `npm test` cannot pass until backend fixes package.json:6. No spec violations or crashes found in server.mjs, public/index.html or public/app.js. README is accurate apart from line 257. Two coders could not run their tests because Bash was denied; I ran them myself.
Next:         Route the package.json:6 fix to backend and the README.md:257 fix to docs, then re-run `npm test` (expect 322 pass).
