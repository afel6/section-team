# section-team

[![test](https://github.com/afel6/section-team/actions/workflows/test.yml/badge.svg)](https://github.com/afel6/section-team/actions/workflows/test.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A Claude Code plugin that turns every session into a **supervisor** of a small engineering team. The supervisor builds small work itself and wakes specialist **sections** (frontend, backend, database, testing, security, devops, uiux, docs, ai-llm, mobile, plus two read-only advisors) for bigger work. Every piece of code passes a **reviewer gate** before it is handed back, each project picks how much the team does with a **mode** (Lean, Balanced or Max), section reports are saved in the project, and a live **Team Board** shows who is working.

## Results
Measured over 17 benchmark rounds (three tasks of rising size, two runs each, graded blind by 12 Opus judges per round). In the final round:

| | Cost per task | Judge quality (1–10) | Ranked 1st / last (of 12 judges) |
|---|---|---|---|
| Plain Claude Code (plugin off) | $0.85 | 7.1 | 0 / 9 |
| An earlier version of this team | $3.39 | 7.7 | 0 / 3 |
| **section-team now** | $3.10 | **8.6** | **12 / 0** |

It costs about 3.6 times as much as plain Claude Code, for cleaner, better-tested and more robust code.

**Limits:** every setup, plain Claude Code included, passed all the hidden tests, so the gains are in blind-judged quality, not in whether the code works. Each cell is 2 runs (about ±0.3 judge noise), and the team was tuned over 17 rounds on these same three tasks. A pre-registered held-out round on three new tasks it had never seen measured a smaller gain that still cleared the bar set in advance: blind judge quality 8.8 against 8.2 for plain Claude Code, both passing every hidden test, at about 2.2 times the cost ([details](docs/benchmark-heldout-2026-11.md)).

**Method:** each round builds the same three tasks (a small library, a command-line tool and a web app) twice per setup. Hidden tests check correctness, then the solutions are anonymised and graded blind by Opus judges on correctness, code quality, tests, robustness and docs. The tasks, hidden tests, harness and scorer are in [`bench/`](bench/), and every round's raw scores and judge notes are in [`bench/data/`](bench/data/); a round runs real paid Claude sessions. Full results and every round's changes: [docs/benchmark-2026-10-24.md](docs/benchmark-2026-10-24.md) (final summary at the end).

## Requirements
- Claude Code with plugin support. The Team Board strip, `/team` and `/chats` use the Mods API (`hooks/register.tsx`).
- Access to the Claude 5 models: sections and the reviewer run on Opus 5.5 (the reviewer on Sonnet 5.5 in Lean mode), the coder helper on Sonnet 5.5, the scout helper on Haiku 5.5.
- Node.js 22.3 or later (or 20.16 or later) for the hooks and tests, because they use `process.getBuiltinModule`; tested on v26.
- Recommended skills, preloaded by some sections: `frontend-design` (frontend), `tdd-workflow` (testing), `security-review` (security), `claude-api` (ai-llm, ai-engineer), `web-design-guidelines` (uiux). Other skills a job names are loaded only if they are installed.

## Install
In Claude Code 2.1.275 or later, one command installs it from this repo:
```
/plugin install section-team --marketplace afel6/section-team
```
On older versions, run `/plugin marketplace add afel6/section-team`, then `/plugin install section-team@section-team`.

To work on the plugin itself, clone it instead:
```bash
git clone https://github.com/afel6/section-team.git
```
- Try it once: `claude --plugin-dir <path-to-section-team>`.
- Keep it on: in `~/.claude/settings.json`, set `env.CLAUDE_CODE_PLUGIN_DIRS` to the clone's path. New sessions pick it up.
- Off: set `"section-team@inline": false` under `enabledPlugins`, or remove the env entry. Emergency: `claude --safe-mode`.

The section agents are generated: edit the roster in `scripts/gen-agents.mjs` and run `node scripts/gen-agents.mjs`. Skills you give a section with `node scripts/assign-skill.mjs <skill> <section>...` are kept in `scripts/roster-extra.json`.

## Use
- Just talk to the supervisor. In Balanced mode (the default): small tasks (about 50 lines, one or two small functions) it builds, tests and gates itself; a feature with its own behaviour to test (a CLI, an endpoint, a module with storage or I/O) is never small. Single-area tasks (up to about 600 lines): it builds the code itself, wakes only the testing section for the tests, and gates its code with the Opus reviewer. Multi-area work wakes the builder sections plus testing. 3+ builder sections (testing, docs and advisors not counted) → it shows a plan first. Lean and Max change these steps; see [Modes](#modes).
- Sections message each other directly by agent id and share contracts as notes in `.team/notes/`. If an id is missing or a message fails, the supervisor forwards the request with the asker's id, so the owner replies to the asker directly.
- The supervisor names up to 4 skills per job (`Skills for this job:`), picked from what is installed and fits that section and task.
- Reports: `.team/reports/<date>/` in each project. Every REPORT has a `Status:` line (`done`, `partial`, `blocked` or `ungraded`) and a `Quality:` line, the reviewer's grade (see Sections) or `n/a (no code)`. `ungraded` means the section truly could not run its reviewer gate (for example, it had no Agent tool) and says why; the supervisor then runs `section-team:reviewer` on that work with the mode's gate.
- Notes: `.team/notes/` in each project, `INDEX.md` plus one file per note. Notes and reports both live under `.team/`, kept out of git via `.git/info/exclude`; to keep them in git, create `.team/keep-in-git` and delete the `.team/` line from `.git/info/exclude`.
- If a plugin hook fails, or has to skip its job (for example, its input names no project folder), you see one `section-team` line saying so, instead of silence.

## Modes
Each project runs in one of three modes. Balanced is the default and is how the team worked before 0.2.0. Usage is compared with plain Claude Code: "measured" comes from the [held-out round](docs/benchmark-heldout-2026-11.md); "target" means the mode has not been measured yet.

| Picker label | What changes | Reviewer gate |
|---|---|---|
| Lean · ~1.3× usage (target) | The supervisor builds more itself: any single-area task up to about 600 lines, tests included, with no section woken. On multi-area work each builder writes the tests for its own code, and testing only does the final check. | Sonnet reviewer (`model: "sonnet"`). Pass: overall at least 8. 1 fix round. |
| Balanced · ~2.2× usage (measured 2026-10) | The steps under [Use](#use). | Opus reviewer. Pass: overall at least 8 and no item under 6. 2 fix rounds. |
| Max · ~3–4× usage (target) | The testing section probes even small tasks. On bigger ones it also writes near-miss copies of the key functions (one plausible bug each), and the gate fails while any copy passes the tests. The security section reviews multi-area work, and single-area code that takes user input or touches files or the network. Multi-area work always wakes docs. | Opus reviewer. Pass: overall at least 9 and no item under 7. 3 fix rounds. |

- **Pick a mode:** the **Mode** picker on the team strip, or `/team mode lean|balanced|max`. `/team mode` alone shows the current mode and the three labels; `/team` alone still opens the board. An unknown mode is refused and nothing is saved. On mobile the strip has no picker: tap its mode button to see the command.
- **When it applies:** a new session starts in the project's mode. A change mid-session applies from your next message: the supervisor is told the new mode and its rules, and the handback gate uses the new mode's pass mark at once. A change to `autoInstallSkills` applies from the next session.
- **Mode file:** the choice is saved in `.team/mode.json` at the project root (the main checkout of a git repo, so its worktrees share it; else the session's folder), for example `{"mode": "lean", "autoInstallSkills": true}`. Both keys are optional. No file means Balanced. A session that starts with a broken file (bad JSON or an unknown mode) runs Balanced, and a one-line message says what was wrong. If the file breaks mid-session, the session keeps its mode (the supervisor and the handback gate both), and each prompt shows a one-line warning until the file is fixed. `autoInstallSkills` overrides `SECTION_TEAM_AUTO_INSTALL_SKILLS` for that project. Like the rest of `.team/`, it stays out of git by default.

## Team Board
- Nothing opens by itself. A one-line team strip above the prompt shows who is awake, the team's tokens and helpers, how many sections sleep and the project's mode (the **Mode** picker); its **Board** button opens the board.
- `/team` opens the Team Board. Each awake section has a box with its live token use, how many helpers it started by model, and its reviewer grade once it is done; a section that ends `partial`, `blocked` or `ungraded` shows as a problem. Sections nobody woke are folded into one "N asleep" line.
- `/chats` opens a dashboard with one card per open chat: needs you, working or idle (a chat quiet for 30 minutes is idle; one that ended or has been quiet for a day drops off). It reads one status file per session in `~/.claude/section-team/sessions/`. A status file holds the project folder, the first line of your latest request (cut to 80 characters), the awake sections and the token and helper counts. Status files older than 7 days are deleted at session start.

## Sections
Builders: frontend, backend, database, testing, security, devops, uiux, docs, ai-llm, mobile. Advisors (read-only): ai-engineer, data-scientist.
Section heads work like solo builders. Each reads `.team/notes/INDEX.md` first, plans its part, then hands independent tasks out in parallel to cheap helpers (not sections, not on the board as cards): `section-team:scout` (Haiku, read-only: reads and searches, returns file:line facts) and `section-team:coder` (Sonnet, routine code and tests from the head's spec). Both helpers can load skills with the Skill tool. Heads run helpers in the foreground (`run_in_background: false`; several in one message still run in parallel), because a head that waits on a background helper ends its turn and is made to hand back unfinished. The plugin refuses a section's Agent call that asks for the background (PreToolUse hook). Where the Agent tool has no such option (the desktop app), helpers run in the background and the head keeps working until their results are in. The head keeps design, tricky bugs and integration for itself. Advisors may use the scout but not the coder.
- **Notes:** a head writes a note in `.team/notes/` for anything other sections depend on (an API, a schema, design tokens, a file layout) and adds one line to `INDEX.md` (`<file> — <owner section> — <one-line summary> — <date>`). Only the owner edits its note; shared decisions are appended to `.team/notes/decisions.md`.
- **Skills:** each section preloads at most one core skill; every other skill loads on demand, the job's `Skills for this job:` list first. If no installed skill fits, a section searches the open directory read-only (`skills.sh/api/search`) and names a `Suggested skill:` in its REPORT; it never installs. The supervisor lists the suggestion in its summary and asks you; on yes it installs it through `section-team:add-skill` (a safety review, then the install) for that section. To let it install without asking whenever the review finds no red flag, set `env.SECTION_TEAM_AUTO_INSTALL_SKILLS` to `1` in `~/.claude/settings.json`, or `"autoInstallSkills": true` in a project's [mode file](#modes); a red flag, or an existing skill of the same name, still stops the install and you are told.
- **Clean-code gate:** once the helpers' code is in, a builder sends its changed files to `section-team:reviewer` (never edits). In Balanced, the default: Opus grades, the pass is overall at least 8 out of 10 and no item under 6, and there are at most 2 fix rounds; the project's [mode](#modes) sets these numbers. On a fail the fix list goes to a coder and the reviewer grades again; if it still fails the section ends `Status: partial` with the grade. Jobs that change no code skip the gate. The plugin enforces it at handback: a builder whose REPORT lists changed code but no grade, or says done under the mode's pass mark, cannot hand it back (PreToolUse hook on `SubagentHandback`). It must run the reviewer first, or hand back honestly as `Status: partial`, `blocked` or `ungraded`. The supervisor runs the same gate on code it wrote itself.
- **Memory:** each section keeps its memory per project, one folder per section in `.claude/agent-memory-local/` under the session's folder (in a git worktree session, the worktree's folder). At session start section-team adds `**/.claude/agent-memory-local/` to the repo's `.git/info/exclude`, even with `.team/keep-in-git`, so memory folders stay out of git in every folder of the repo. Remote sessions (`CLAUDE_CODE_REMOTE_MEMORY_DIR`) keep memory elsewhere, so advisors there cannot save memory. Before 0.2.0 one memory served every project; those notes stay in `~/.claude/agent-memory/section-team-*`, and copying one of those folders into a project's `.claude/agent-memory-local/` brings it into that project. Advisors may write only inside their own memory folder there.

Section heads skip your global `CLAUDE.md` (it can cost many thousands of tokens per agent) but read the project's own rule files (`CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `.claude/rules/*.md`), and carry a short copy of the house rules.

## Develop
- `npm test` — hook logic (node:test)
- `npm run test:board` — Team Board (claude plugin test)
- `npm run validate` — plugin validation
- `node scripts/gen-agents.mjs --check` — agent files match the roster
- `node --test bench/*.test.mjs` — benchmark scorer. `bench/score.mjs` records each run's per-agent model split from the subagent transcripts; `bench/aggregate.mjs` reports the Opus share of cost (`opusSharePct`). `node bench/run.mjs --conds=...` also takes `lean` and `max` (the team with that mode file set), and blind judging labels up to four setups X, Y, Z and W. No mode round has been run yet.
- Design: `docs/specs/2026-11-01-quality-modes-design.md` (modes), `docs/specs/2026-10-24-solo-builder-sections-design.md` (v3), `docs/specs/2026-10-12-claude-team-design.md` · Plans: `docs/plans/2026-11-01-quality-modes-plan.md`, `docs/plans/2026-10-24-section-team-v3-plan.md` · Phase 0: `docs/phase0-results.md`
