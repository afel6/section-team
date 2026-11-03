# Decisions log — append only: date, section, decision, why

- 2026-11-03 — testing — Near-miss copies are run in a mirror dir (.team/scratch/mirror, via .team/scratch/run-near-miss.mjs) instead of swapping them over jsonpatch*.mjs. Why: originals are never touched (sha256 checked before/after), and the shell sandbox denies overwriting builder files.
- 2026-11-03 — testing — A symlink loop (ELOOP) is tested as `cannot read`: a file system entry exists, so it is not `no such file`. Why: stricter reading of the "no such file" rule; the only cannot-read case that works when tests run as root.
- 2026-11-03 — testing — CLI near-miss copies drop the shebang line for the `// near-miss:` comment (a shebang is only legal on line 1); tests run the CLI via `node`, so behaviour is unchanged.
