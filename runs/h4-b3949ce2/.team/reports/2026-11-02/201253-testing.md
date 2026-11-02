## REPORT · testing · 2026-11-02 20:20
Status:       done
Job:          Write and run the node:test suite for the booking app, near-miss check, reviewer gate (≥9, no item <7)
Changed:      /root/bench-runs/h4-b3949ce2/test/helpers/{server,fake-dom,html,app}.mjs; /root/bench-runs/h4-b3949ce2/test/{startup,persistence,api-routes,api-list,booking-body,booking-fields,page-html,app-load-list,app-submit-cancel}.test.mjs; /root/bench-runs/h4-b3949ce2/.team/near-miss/ (72 copies); /root/bench-runs/h4-b3949ce2/.team/scratch/near-miss-defs.mjs, near-miss-run.mjs, fd-smoke.mjs; /root/bench-runs/h4-b3949ce2/.team/notes/tests.md, INDEX.md (my line), decisions.md (2 entries)
Tests:        npm test: 607 pass, 0 fail (~6 s); 72/72 near-misses fail the suite (re-run after the round-1 refactor, not after the small post-pass fixes); server.mjs, app.js and index.html sha256 match their pre-swap values
Quality:      9/10 (reviewer, 1 fix round)
Coordination: backend (a92ce805b33e418ff) changed package.json test script to `node --test test/*.test.mjs` at my request (Node 22 fails on `node --test test/`), logged in decisions.md
Helpers used: sonnet ×11 (7 test-writing, 4 fix-round coders), opus ×2 (reviewer gate)
Problems:     no real bugs found in server.mjs, app.js or index.html. Near-miss 37 (Unicode-digit date regex) was equivalent to the real code and was replaced by a non-equivalent one. A near-miss once wrote bookings.json into the repo root; deleted, and the runner now cleans it up. Bash denied `$(...)` and redirects, so scratch scripts live in .team/scratch/.
Next:         optional nits from the passing review: share one deleteBooking helper, ROOM_NAMES and LISTEN_RE in the remaining spots; backend may add `--test-timeout=30000` to package.json as a second guard (every helper wait already has a time limit)
