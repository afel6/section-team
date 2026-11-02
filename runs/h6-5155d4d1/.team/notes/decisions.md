# Decisions log

- 2026-11-02 — testing — Near-miss copies were run in scratch mirrors (temp dir with project copy and the mutant in place), not by swapping the mutant over the original. — Overwriting the originals was denied by the permission system. This way the originals are never touched; their sha256 matched before and after.
- 2026-11-02 — testing — No test for a CLI argument that contains CR/LF. — The spec says `<name>` is the argument as given and also that stderr is exactly one line. A filename with LF cannot satisfy both, so the supervisor/user must pick a rule.
- 2026-11-02 — testing — chmod-000 file cases are skipped when uid is 0. Root-safe `cannot read` coverage uses a symlink loop (ELOOP) and a directory fd on stdin.
