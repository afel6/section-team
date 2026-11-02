## REPORT · backend · 2026-11-02 22:35
Status:       done
Job:          Fix the testing section's finding: the data-file loader must reject extra top-level keys.
Changed:      /root/bench-runs/h4-c3e12a23/server.mjs (rule that the top level must have exactly nextId and bookings, shared `hasExactKeys` helper, quoted PORT value in the startup error), /root/bench-runs/h4-c3e12a23/.team/notes/backend-api.md
Tests:        `npm test`: 146 pass, 3 fail. All server tests pass (smoke, datafile, startup); the 3 failures are frontend page tests (rooms 204, Cancel 204 ×2).
Quality:      9/10 (reviewer, 0 fix rounds — gate passed earlier; these small follow-up fixes were not regraded)
Coordination: testing (a603c34b5ed12b6fd): told them the extra-key fix is in and that the remaining failures are frontend's.
Helpers used: none (fix under 20 lines)
Problems:     server.startup.test.mjs failed once and then passed with no change (cause unknown). It may have run while the testing section was editing it, or it may be flaky when many server processes start at once.
Next:         Frontend: 3 failing page tests (page-list / page.behaviour: rooms GET answered 204, Cancel 204 handling).
