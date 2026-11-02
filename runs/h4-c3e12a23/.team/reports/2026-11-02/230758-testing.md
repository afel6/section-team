## REPORT · testing · 2026-11-02 23:40
Status:       done
Job:          Wrote the node:test suite for the room-booking app (server, API, page HTML, app.js in node:vm) and ran a near-miss gate.
Changed:      /root/bench-runs/h4-c3e12a23/test/helpers/{server-harness,api-assert,fake-dom,html-tree}.mjs; /root/bench-runs/h4-c3e12a23/test/{server-startup,server-persistence,api-routing,api-bookings-list,api-booking-rules,api-booking-fields,page-html,app-startup-list,app-actions}.test.mjs; /root/bench-runs/h4-c3e12a23/.team/near-miss/1..22-{server.mjs,app.js}; /root/bench-runs/h4-c3e12a23/.team/notes/testing-suite.md (new) and its INDEX.md line; one entry added to /root/bench-runs/h4-c3e12a23/.team/notes/decisions.md; scratch files in /root/bench-runs/h4-c3e12a23/.team/scratch/ (generator script, probes, backups of the originals).
Tests:        `npm test` passes on the real code: 485 tests, 0 fail, 0 skipped. I made 22 near-miss copies (13 in server.mjs, 9 in app.js), and every one fails the suite with 1–11 failing tests. I ran all 22 again after the review fixes and they still fail. After each swap, `diff -q` against the backups confirmed server.mjs and public/app.js were restored byte-identical.
Quality:      9/10 (reviewer, 1 fix round). Round 1 got 8.1 and failed because of duplicated helpers and no exact-success-status tests; round 2 passed with no item under 8.
Coordination: None needed. The suite found no spec violations in server.mjs, index.html or app.js, so I sent no fix lists to backend or frontend. I logged two strict readings in decisions.md: page text is compared exactly with no trimming, and "error status" means any status other than the exact success status.
Helpers used: sonnet ×9 (coder: 6 to write the test files, 3 for review fixes); opus ×2 (reviewer gate).
Problems:     
- **ECONNRESET was a test-client artifact.** One early failure (a 2 MB DELETE body got ECONNRESET) came from Node's HTTP client: it sends a DELETE body without a Content-Length, so the body was unframed and the connection was reset. It was not a server bug. The harness now always sends a Content-Length.
- **Non-ASCII request paths can't be tested.** Node's own HTTP parser rejects them with a 400 before server.mjs sees them.
- **Bash was restricted.** The sandbox blocked loops, runner scripts, python and redirects, so I ran each near-miss as its own swap–test–restore command. Two coders could not run their own tests, so I ran them myself.
- **Two minor reviewer findings were left as is** because the gate had already passed: `ROOMS` is written out by hand in several places, and html-tree.mjs uses short variable names.
- **The default-port test depends on port 3000.** If 3000 is busy, that test skips itself with a visible reason.
Next:         none
