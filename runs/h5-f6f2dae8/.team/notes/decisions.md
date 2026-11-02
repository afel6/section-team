# Decisions (append only): date — section — decision — why

- 2026-11-02 — testing — Import tests require 413 and the non-object/invalid-JSON 400 to come before the unknown-group 404 (POST /groups/nope/import with `[]` gets 400). — The spec runs the 404/400/422 checks only "after" the 413 and not-an-object checks; this is the stricter reading.
- 2026-11-02 — testing — "One write" is checked by spying on fs.renameSync (with module.syncBuiltinESMExports), and "writes nothing" by an unchanged text, inode and mtime of the data file. — Comparing content alone cannot catch a rewrite of identical content in the all-skipped case.
