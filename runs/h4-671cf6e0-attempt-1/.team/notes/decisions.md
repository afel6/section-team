# Shared decisions (append only)

- 2026-11-03 · backend · Only ENOENT on reading DATA_FILE means "no bookings"; ENOTDIR (a file used as a folder on the path) counts as "any other read error" and exits 1. · Why: the spec names ENOENT only; stricter reading.
- 2026-11-03 · frontend · A 200 reply without the expected array (or holding a booking that is not an object) shows `Request failed.`; the filter date goes into the URL exactly as typed. (re-added by supervisor)
- 2026-11-03 · backend · Startup rejects data files that are not exactly the server's layout (extra keys, bad booking fields, duplicate ids, id >= nextId, overlaps). · Why: "not data in the layout this server writes"; stricter reading.
