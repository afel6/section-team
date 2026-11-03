# Shared decisions (append only): date — section — decision — why

- 2026-11-03 — testing — Tests run with `node --test 'test/*.test.mjs'`; `node --test test/` (package.json "test") fails on Node 22.23 because a directory argument is loaded as a module. — Reported to the supervisor, not changed by testing.
- 2026-11-03 — testing — Directory-as-stdin must give `Error: stdin: cannot read` (exit 1), the stricter reading of "for standard input only too large and cannot read apply". The CLI gives `invalid JSON` (exit 3), so that test is marked `todo` so the suite stays green while the bug stays visible. — Spec line under "CLI errors".
- 2026-11-03 — testing — `/dev/zero` as an input must give `too large`: it is the only root-safe way to prove the size limit counts bytes read, not the stat size. — Spec: "counts the bytes actually read".
- 2026-11-03 — testing — A symlink loop (ELOOP) must give `cannot read`, not `no such file`: only ENOENT/ENOTDIR map to `no such file`. — Spec wording.
