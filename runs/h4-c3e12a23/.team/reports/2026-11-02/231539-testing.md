## REPORT · testing · 2026-11-02 23:59
Status:       done
Job:          Final spec review of server.mjs, index.html, app.js, README.md and package.json, plus crash-path probes. Verdict: pass.
Changed:      /root/bench-runs/h4-c3e12a23/test/server-edge-requests.test.mjs (new, 4 tests); the 22 copies in /root/bench-runs/h4-c3e12a23/.team/near-miss/ rebuilt from the new server.mjs; .team/notes/decisions.md (CONNECT/Expect strict reading); .team/notes/testing-suite.md; probe scripts in .team/scratch/
Tests:        `npm test` 489/489 pass. The 3 edge tests failed before backend's fix and pass after it. All 22 near-miss copies fail the suite, and the originals are restored byte-identical.
Quality:      9.3/10 (reviewer, 1 fix round). The fix round was backend's CONNECT/Expect fix; I reviewed its diff and it is covered by the new tests.
Coordination: Backend (a36085e454f13bf41) got the failing CONNECT and Expect tests, fixed server.mjs and replied; I re-verified. Frontend and docs needed no changes.
Helpers used: opus ×1 (reviewer, final spec review)
Problems:     
- **Backend's ~30-line fix had no separate grade.** I reviewed its diff myself and it is covered by the new tests.
- **The security section's review never ran** (it failed twice on a tool error). My live probes stand in for its crash-path check only.
Next:         Optional findings, no action required:
- server.mjs saves the data file in place, so a write that fails partway (for example a full disk) could leave a cut-short file that the next startup refuses. Backend chose this on purpose (decisions.md).
- app.js `loadRooms` and `loadList` repeat the same reply handling.
- README.md:37 says every booking or cancel fails with 500 when the folder is missing. Only creates and deletes that would succeed fail; an unknown id still gets 404.
- README.md:46 could say that `<name>` is `DATA_FILE` exactly as given.
- In the tests, `ROOMS` is written out by hand in several files, and html-tree.mjs uses short variable names.
