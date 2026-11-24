# Contributing to section-team

Thanks for helping. Bug reports and ideas go through the issue forms; code changes go through pull requests.

## Set up
1. Install Node.js (tested on v26) and Claude Code with plugin support.
2. Clone the repo (`git clone https://github.com/afel6/section-team.git`) and try your copy once: `claude --plugin-dir <path-to-section-team>`.
3. To keep it on, set `env.CLAUDE_CODE_PLUGIN_DIRS` to the clone's path in `~/.claude/settings.json`; new sessions pick it up. To turn it off, set `"section-team@inline": false` under `enabledPlugins`, or remove the env entry.

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
- `skills/node-http/` holds the backend section's rules for a server built on node:http itself, loaded only for that server.
- `bench/` is the benchmark harness. A benchmark round runs real paid Claude sessions, so only run it if you know the cost. `--plugin-ref=<branch, tag or commit>` on `bench/preflight.mjs` names the ref the `--plugin` worktree must be at, and the pin records it. The default is `v<SECTION_TEAM_VERSION>` from `bench/clean-run.mjs`. `bench/run.mjs` holds a batch to the pin: leave the flag out or pass the same ref. The expected version comes from the plugin under test (its own manifest), not from the harness checkout. A batch names its `--tasks=` and `--reps=`, and `bench/anonymize.mjs --round=` names `--conds=`, `--tasks=` and `--reps=`: their defaults are for reports that only read. `bench/anonymize.mjs` runs after the round, so its `--task-reps=<task>:<n>,...` is no round setting: it gives some tasks their own number of reps, for example `--task-reps=h8:5`, and the other tasks keep `--reps`.
- Round settings (the harness reads them before any paid run, and the round's preflight pins them):
  - `SECTION_TEAM_LIVE_CHECKOUT` is the absolute path of your own section-team checkout. It is required on Windows, and a round refuses a plugin worktree that is that folder or inside it.
  - `BENCH_RUNS` names the folder the run folders go in (default `~/bench-runs`). The harness refuses a root with a `CLAUDE.md`, `CLAUDE.local.md` or `AGENTS.md` in it or in any folder above it, because Claude Code reads those as instructions in every run.
  - `--config-dir=<absolute path>` on `bench/preflight.mjs` and `bench/run.mjs` runs every session with that Claude Code profile (`CLAUDE_CONFIG_DIR`). The preflight refuses a profile that holds a `CLAUDE.md`, skills, agents, commands, plugins or hooks.
  - `--base-plugin=<absolute path>` and `--base-ref=<git ref>` name the worktree and the ref of the `base` setup, the control arm at an earlier release. `--conds=<setups>` on the preflight picks which setups it runs (default solo, team, max), for example `--conds=solo,base,team`.
  - `SECTION_TEAM_MEMORY_LIMIT_MB` (whole megabytes) sets the plugin's memory limit for the round. The preflight pins it, and a batch with another value is refused.
  - On Windows the preflight pins the Claude Code version `ROUND_CLI_VERSION` (2.1.318) from `~/.local/share/claude/versions/`. It never reads `claude --version` from PATH, which updates itself.

## Rules
- Write the failing test first for any change in behaviour, then make it pass.
- Keep files and functions small, validate input at boundaries, and never swallow errors.
- Use conventional commit messages: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`.
- Never commit secrets, keys, personal email addresses or private project names. A path may name the PC's user folder only in benchmark tests, fixtures and plans.
