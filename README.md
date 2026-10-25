# section-team

A personal Claude Code plugin: every session is a **supervisor** that wakes specialist **sections** (Opus 5.5, all code graded by an Opus reviewer) when a task needs them, saves their reports, and shows a live **Team Board**.

## On / off
- On: `~/.claude/settings.json` → `env.CLAUDE_CODE_PLUGIN_DIRS = C:\Users\Asus\claude-team`. New sessions pick it up.
- Off: set `"section-team@inline": false` under `enabledPlugins`, or remove the env entry. Emergency: `claude --safe-mode`.

## Use
- Just talk to the supervisor. Small tasks (about 50 lines, one or two small functions) it builds, tests and gates itself; a feature with its own behaviour to test (a CLI, an endpoint, a module with storage or I/O) is never small. Single-area tasks (up to about 600 lines): it builds the code itself, wakes only the testing section for the tests, and gates its code with the Opus reviewer. Multi-area work wakes the builder sections plus testing. 3+ builder sections (testing, docs and advisors not counted) → it shows a plan first.
- Sections message each other directly by agent id and share contracts as notes in `.team/notes/`. If an id is missing or a message fails, the supervisor forwards the request with the asker's id, so the owner replies to the asker directly.
- The supervisor names up to 4 skills per job (`Skills for this job:`), picked from what is installed and fits that section and task.
- Reports: `.team/reports/<date>/` in each project. Every REPORT has a `Quality:` line, the reviewer's grade (see Sections) or `n/a (no code)`.
- Notes: `.team/notes/` in each project, `INDEX.md` plus one file per note. Notes and reports both live under `.team/`, kept out of git via `.git/info/exclude`; to keep them in git, create `.team/keep-in-git` and delete the `.team/` line from `.git/info/exclude`.

## Team Board
- Nothing opens by itself. A one-line team strip above the prompt shows who is awake, the team's tokens and helpers, and how many sections sleep; its **Board** button opens the board.
- `/team` opens the Team Board. Each awake section has a box with its live token use, how many helpers it started by model, and its reviewer grade once it is done. Sections nobody woke are folded into one "N asleep" line.
- `/chats` opens a dashboard with one card per open chat: needs you, working or idle (a chat quiet for 30 minutes is idle; one that ended or has been quiet for a day drops off). It reads one status file per session in `~/.claude/section-team/sessions/`. A status file holds the project folder, the first line of your latest request (cut to 80 characters), the awake sections and the token and helper counts. Status files older than 7 days are deleted at session start.

## Sections
Builders: frontend, backend, database, testing, security, devops, uiux, docs, ai-llm, mobile. Advisors (read-only): ai-engineer, data-scientist.
Section heads work like solo builders. Each reads `.team/notes/INDEX.md` first, plans its part, then hands independent tasks out in parallel to cheap helpers (not sections, not on the board as cards): `section-team:scout` (Haiku, read-only: reads and searches, returns file:line facts) and `section-team:coder` (Sonnet, routine code and tests from the head's spec). Both helpers can load skills with the Skill tool. Heads run helpers in the foreground (`run_in_background: false`; several in one message still run in parallel). The plugin refuses a section's background Agent call (PreToolUse hook), because a head that waits on a background helper ends its turn and is made to hand back unfinished. The head keeps design, tricky bugs and integration for itself. Advisors may use the scout but not the coder.
- **Notes:** a head writes a note in `.team/notes/` for anything other sections depend on (an API, a schema, design tokens, a file layout) and adds one line to `INDEX.md` (`<file> — <owner section> — <one-line summary> — <date>`). Only the owner edits its note; shared decisions are appended to `.team/notes/decisions.md`.
- **Skills:** each section preloads at most one core skill; every other skill loads on demand, the job's `Skills for this job:` list first.
- **Clean-code gate:** once the helpers' code is in, a builder sends its changed files to `section-team:reviewer` (Opus, never edits). Pass: overall at least 8 out of 10 and no item under 6. On a fail the fix list goes to a coder and the reviewer grades again, at most 2 fix rounds; if it still fails the section ends `Status: partial` with the grade. Jobs that change no code skip the gate. The plugin enforces it at handback: a builder whose REPORT lists changed code but no grade cannot hand it back (PreToolUse hook on `SubagentHandback`). It must run the reviewer first, or hand back honestly as `Status: partial` or `blocked`. The supervisor runs the same gate on code it wrote itself.

Section heads skip your global `CLAUDE.md` (it costs about 14k tokens per agent) but read the project's own rule files (`CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.claude/rules/*.md`), and carry a short copy of the house rules.
Edit the roster in `scripts/gen-agents.mjs`, then run `node scripts/gen-agents.mjs`.

## Develop
- `npm test` — hook logic (node:test)
- `npm run test:board` — Team Board (claude plugin test)
- `npm run validate` — plugin validation
- `node scripts/gen-agents.mjs --check` — agent files match the roster
- `node --test bench/*.test.mjs` — benchmark scorer. `bench/score.mjs` records each run's per-agent model split from the subagent transcripts; `bench/aggregate.mjs` reports the Opus share of cost (`opusSharePct`).
- Design: `docs/specs/2026-10-24-solo-builder-sections-design.md` (v3), `docs/specs/2026-10-12-claude-team-design.md` · Plan: `docs/plans/2026-10-24-section-team-v3-plan.md` · Phase 0: `docs/phase0-results.md`
