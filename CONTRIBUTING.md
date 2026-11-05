# Contributing to section-team

Thanks for helping. Bug reports and ideas go through the issue forms; code changes go through pull requests.

## Set up
1. Install Node.js (tested on v26) and Claude Code with plugin support.
2. Clone the repo and try your copy: `claude --plugin-dir <path-to-section-team>`.

## Before you open a pull request
Run every check and make sure all pass:

```bash
npm test
npm run test:board
npm run validate
node scripts/gen-agents.mjs --check
node --test bench/*.test.mjs
```

## How the code is organised
- `brief/` holds the supervisor's instructions: `core.md` with the `{{TIERS}}` and `{{GATE}}` markers, filled from `tiers-<mode>.md` and `gate-<mode>.md` by `hooks/lib/brief.mjs` and injected at session start. The Balanced brief must stay equal to `tests/fixtures/supervisor-balanced.md`.
- `agents/*.md` are generated. Never edit them by hand: change the roster or the shared text in `scripts/gen-agents.mjs`, then run `node scripts/gen-agents.mjs`.
- `hooks/` holds the hooks (session start, the mode switch check on each prompt, the handback gate, the report writer) and the Team Board (`hooks/register.tsx`). The modes and their gate numbers live in `hooks/lib/mode.mjs`.
- `hooks/lib/head-context.mjs` (the context guard on `SendMessage`) and `hooks/lib/grade.mjs` (the grade-versus-reviewer check at handback) hold the 0.2.3 enforcement. Both fail open.
- `skills/add-skill/` is the procedure for reviewing and installing a skill from GitHub.
- `skills/foundation/` is the supervisor's on-demand procedure for starting a new platform.
- `bench/` is the benchmark harness. A benchmark round runs real paid Claude sessions, so only run it if you know the cost. `--plugin-ref=<branch, tag or commit>` on `bench/preflight.mjs` names the ref the `--plugin` worktree must be at, and the pin records it. The default is `v<SECTION_TEAM_VERSION>` from `bench/clean-run.mjs`. `bench/run.mjs` holds a batch to the pin: leave the flag out or pass the same ref. The expected version comes from the plugin under test (its own manifest), not from the harness checkout. A batch names its `--tasks=` and `--reps=`, and `bench/anonymize.mjs --round=` names `--conds=`, `--tasks=` and `--reps=`: their defaults are for reports that only read.

## Rules
- Write the failing test first for any change in behaviour, then make it pass.
- Keep files and functions small, validate input at boundaries, and never swallow errors.
- Use conventional commit messages: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`.
- Never commit secrets, keys, personal email addresses or private project names. A path may name the PC's user folder only in benchmark tests, fixtures and plans.
