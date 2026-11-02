## REPORT · backend · 2026-11-02 19:45
Status:       done
Job:          Build `server.mjs` (built-ins only: JSON API, the page files, one JSON data file) and `package.json` for the meeting-room booking app.
Changed:      /root/bench-runs/h4-b3949ce2/server.mjs, /root/bench-runs/h4-b3949ce2/package.json, /root/bench-runs/h4-b3949ce2/.team/notes/api.md, /root/bench-runs/h4-b3949ce2/.team/notes/decisions.md, /root/bench-runs/h4-b3949ce2/.team/notes/INDEX.md (my lines only), /root/bench-runs/h4-b3949ce2/.team/scratch/smoke.mjs (scratch smoke script, not shipped)
Tests:        `node .team/scratch/smoke.mjs` prints ALL OK (about 55 checks). It covers: rooms; list, sort and `?date`; rule order 415→413→400s→409; a body that starts with a BOM; the 10000-byte limit; 404 vs 405 and byte-for-byte paths; HEAD and OPTIONS; delete; 8 overlapping POSTs at once giving exactly one 201; restart keeping the next id; a relative and a default DATA_FILE; a failed save giving 500 with nothing changed; bad PORT, port in use, folder, empty or invalid data file all exiting 1. The page files did not exist yet, so the smoke test accepts 200 or 500 for `/` and `/app.js`. Nothing in test/ was touched.
Quality:      9/10 (reviewer, 1 fix round)
Coordination: none with other sections. I wrote `.team/notes/api.md` for testing: data file layout, how to spawn the server with PORT=0 and read the port from stdout, and how to make a save fail.
Helpers used: opus ×2 (reviewer gate)
Problems:     Bash refused `cd /tmp`, `mktemp`, background jobs and `kill`, so the smoke test runs as a Node script. When I wrote `.team/notes/decisions.md` the tool said "updated", not "created". If another section had already put lines in it, those lines may be lost. I did not apply the reviewer's temp-file + rename advice: plain writeFile was your stated preference, and rename would also quietly replace a read-only data file. The cost is that a write failing partway (for example a full disk) can leave the file damaged; this is logged in decisions.md.
Next:         Spec lines that can be read two ways, where I built the stricter reading (all in decisions.md):
              - The data file must be exactly `{nextId, bookings}`. Each booking must have exactly the 6 keys with valid values and a title that is already trimmed. Ids must be unique and below nextId, and no two bookings may overlap. Anything else exits with `cannot read data file <name>`.
              - Only ENOENT means "no bookings yet". ENOTDIR, EISDIR and other read errors are fatal.
              - Content-Type: only spaces and tabs are trimmed and only ASCII letters are lowercased.
              - A 500 writes one `server error: <code>` line to stderr. stdout still carries only the listening line.
              Testing should run the full suite with the frontend's `public/` files in place.
