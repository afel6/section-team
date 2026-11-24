# section-team

[![test](https://github.com/afel6/section-team/actions/workflows/test.yml/badge.svg)](https://github.com/afel6/section-team/actions/workflows/test.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A Claude Code plugin that turns every session into a **supervisor** of a small engineering team: every job goes to an Opus specialist builder **section**, three advisors give advice without changing files, and code passes a **reviewer gate** before it comes back. Each project picks a **mode** (Balanced or Max) or turns the team **off**, and a live **Team Board** shows who is working. Terms: [Glossary](#glossary).

Current version: 0.6.0. What changed: [CHANGELOG.md](CHANGELOG.md).

## Quickstart
- **What it costs:** about 7× your normal Claude Code usage in Balanced (the default) and, in Max, about 10×, measured on 0.3.0+ rounds; 0.6.0 changes Max only in trust text and the model alias, not re-measured. In round nx (5, 2 and 2 runs per setup) Balanced cost 2.92× plain Claude Code on a small fix (v0.5.1, nearest to 0.6.0 there), 3.26× on a single-area task and 12.40× on a multi-area one (v0.6.0-rc.1), at 3.00×, 3.13× and 9.61× the wall time (reported, no bar; [setups](#results)). Max took 6 to 12× the wall time in earlier rounds. Even a small change wakes a section, so it is not for quick edits or questions on a tight plan.
- **What you get:** blind judges scored the plugin's code higher, the largest part (42-44% in the mode round) for bigger test suites. In round nx one judge, Codex, put Balanced +1.00 over plain Claude Code on the small fix (v0.5.1, 5 groups) and +0.55 on the single-area task (v0.6.0-rc.1, 2 groups), reported with no pre-set bar. No meaningful correctness gain has been measured: hidden tests tied in most rounds, the plugin passed fewer in the first three p1 rounds, and at most 2 more of 148 on one hq task (2 runs). On seeded near-miss bugs (mode round) its suites caught about as many as solo's: 21 and 19 against 20 of 24 on h6, and all 18 on h5 ([Results](#results)).
- **Needs:** Claude Code 2.1.318, Node 20.16+ or 22.3+, git 2.31+ and first-party access to Opus 5.5 ([details](#install)).
- **Install:** `/plugin install section-team --marketplace afel6/section-team`, then start a new session. A team strip appears above the prompt; ask for work as usual.
- **Turn it off:** `/team mode off` for one project, `claude plugin disable section-team@section-team` for every project, or `claude plugin uninstall section-team@section-team` to remove it ([details](#turn-it-off-or-uninstall)).

## What changes in your sessions
- **A brief in every session.** Session start adds the supervisor's instructions to every session in every project (about 8.3K characters in Balanced, 8.9K in Max). From then on the supervisor routes work and writes no product code itself.
- **Hooks.** SessionStart, UserPromptSubmit, PreToolUse, SubagentStop and Stop run in every session ([run time](docs/how-it-works.md#requirements-in-detail)), acting mainly on section-team agents. They fail open with one line per failure, and a section transcript the context guard or the grade check cannot read gets one line too; the exception is an advisor's write: if that check itself fails, the write is refused.
- **Files in each git repo.** `.team/notes/INDEX.md` at session start; later `.team/reports/<date>/` (every section REPORT and the supervisor's summary as written, and any message you send of 3000 characters or more with recognised secrets replaced by `[redacted]`), `.team/tmp/<section>/`, `.team/mode.json` once you pick a mode, and `.claude/agent-memory-local/<section>/`.
- **`.git/info/exclude`.** Two lines are added, `.team/` and `**/.claude/agent-memory-local/`, so those folders stay out of git. The plugin commits nothing to your project.
- **Your home folder,** under `~/.claude/section-team/`: `sessions/` (one status file per chat: its project folder, the first 80 characters of your latest request with recognised secrets replaced by `[redacted]`, and its token counts; deleted after 7 days), `modes/` (per-session mode and brief records), and, once you use them, `names.json`, `office.json`, `roster-extra.json` and `trusted-sources.json`.
- **A 1 s poll** of the team's agents, reports and mode file by the Team Board strip, in every session (every 10 s in a project set to off while neither board pane is open).
- **Skill installs ask you.** A section may suggest a skill; the supervisor asks before installing it into `~/.claude/skills/`, unless you set `SECTION_TEAM_AUTO_INSTALL_SKILLS=1` in your user settings and trust its owner ([details](#sections)). Project settings that set it, `HOME` or `USERPROFILE` keep installs off ([details](#modes)), but a project's `.claude/settings.json` can still add hooks and other environment variables, so check it in repos you clone.
- **Sections skip your global `~/.claude/CLAUDE.md`** (`omitClaudeMd` in all 16 agent files). Put rules you rely on in the project's CLAUDE.md or AGENTS.md. Builders carry their own rule: no push, force-push, deploy or destructive git without your yes.
- **Network.** No telemetry: the hooks and the board make no network calls; sections use WebFetch and WebSearch, and a skill search queries skills.sh and GitHub.
- **In a project set to off,** the hooks still start on every prompt and matched tool call (one git call per prompt) but do nothing for the supervisor; the strip, its poll and the chat's status file remain; a project's first session may already have written `.team/` and the exclude lines. Off applies from your next session, `/clear` or `/compact`. To try the plugin in one project only, install it with `--scope local`.

## Install
**Needs:** Claude Code 2.1.318 (tested; this release has not been run on an older one, and before 2.1.280 the `opus` alias did not mean Opus 5.5), Node 20.16+ or 22.3+ and git 2.31+ on PATH (without Node every prompt and matched tool call shows a hook error), and first-party access to Opus 5.5 (Bedrock, Vertex and Foundry are untested; on Foundry the `opus` alias means Opus 4.6).

One command installs it:
```
/plugin install section-team --marketplace afel6/section-team
```
Or in two steps: `/plugin marketplace add afel6/section-team`, then `/plugin install section-team@section-team`.

### Turn it off or uninstall
- **One project:** `/team mode off` or **Off** in the Mode picker (`/team mode balanced` turns it back on); it applies from your next session, `/clear` or `/compact`.
- **Every project, still installed:** `claude plugin disable section-team@section-team`; `claude plugin enable section-team@section-team` turns it back on.
- **Remove it:** `claude plugin uninstall section-team@section-team`.
- **What stays behind** (delete it by hand if you want): `.team/` and `.claude/agent-memory-local/` in each project, the two lines in each repo's `.git/info/exclude`, `~/.claude/section-team/`, and any skill you installed into `~/.claude/skills/`.
- **Emergency:** `claude --safe-mode` starts Claude Code with plugins off.
- A fresh-profile run of the install, disable and uninstall commands has not been recorded yet ([details](docs/how-it-works.md#requirements-in-detail)).

## Results
**Round nx (2026-11-23), the newest.** On one clean profile: **solo** is plain Claude Code (plugin off), **base** is section-team v0.5.1 and **team** is v0.6.0-rc.1, which added a direct tier (L1) for small fixes, both in Balanced. Tasks h8 (a small fix, 5 groups), h9 (single-area, 2) and h10 (multi-area, 2) were written by Claude agents that week; one judge, Codex, scored every group blind (five-dimension means). L1 met its cost bar (0.65× base on h8) and missed its quality bar (team − base −0.38, 95% CI [−1.67, +0.91] over 5 groups; bar at least −0.25), both pre-registered in the public tag `nx-freeze`, so it was reverted: 0.6.0 is rc.1 without L1 (plus docs and labels), and no round measured that exact build. The nearest figures for 0.6.0 are base on h8 and team on h9 and h10, where L1 did not fire; there team cost 0.92× and 0.88× of base (0.93× on h9 from cent-rounded means) and scored −0.05 against it on h9; h10's quality is not quoted (a flagged run in each group). Gaps against solo are reported, with no pre-set bar. Every setup passed every hidden test, so they do not separate the setups. On h8 the runs' own suites caught 6.0 (team), 4.8 (base) and 5.4 (solo) of 6 seeded near-miss bugs on average; h10's counts are confounded by how its test files import modules. Details: [docs/benchmark-nx-2026-11.md](docs/benchmark-nx-2026-11.md); data: [`bench/data/nx/`](bench/data/nx/).

**Earlier rounds** rest on 2 or 3 runs per setup, on Node.js tasks with no npm packages, run headless with any plan approved in advance. The plugin passed fewer hidden tests than solo in round tj's official scoring (one Balanced run's suites were cut short under machine load; a reported rescore, not published, passed 264). Details: [docs/benchmark-p1-hq-fx-2026-11.md](docs/benchmark-p1-hq-fx-2026-11.md); rounds 1 to 17: [docs/benchmark-2026-10-24.md](docs/benchmark-2026-10-24.md).

**Baselines.** Only the mode round (on a clean machine) and round nx (on a clean profile) used plain Claude Code. The held-out round and the p1 rounds in `bench/data/p1/` used Claude Code with the author's setup (plugin off; their CLAUDE.md and other plugins on): 5 of 9 held-out solo runs and 16 of 20 solo runs in `bench/data/p1/` spawned the author's code-reviewer or security-reviewer agent. For rounds hq, fx, py and ph the machine setup was not recorded.

- **Pre-registered on older versions:** the [held-out round](docs/benchmark-heldout-2026-11.md) (v0.1.1) and the [mode round](docs/benchmark-modes-2026-11.md) (v0.2.1, before 0.3.0 rebuilt Max).
- **The p1 rounds (2026-11-07 to 2026-11-18)** built one help-desk platform in three stages; the sections' rules were tuned on it (in-sample), and targets were recorded privately. Balanced judged 1.0 to 1.75 above solo on Codex at 3.4 to 5.6× (judged rounds; py's 6.0× was never judged); Max 6.1 to 13.0×. Round pr ran 0.2.3, so eleven of the twelve published p1 rounds are 0.3.0 or later. Raw data: [`bench/data/p1/`](bench/data/p1/), [`bench/data/ph/`](bench/data/ph/) and [`bench/data/py/`](bench/data/py/).
- **Round hq (2026-11-19, 0.3.0 plus the p1 fixes):** Balanced 8.58 against solo's 7.92 (Codex) at 5.2× the cost, missing both its privately set bars; Max 9.42 at 10.5×. Its two-stage task h7 shares a requirement word for word with p1. Raw data: [`bench/data/hq/`](bench/data/hq/).
- **Round fx (2026-11-20)** checked one Balanced fix, which missed its bar and does not ship. Raw data: [`bench/data/fx/`](bench/data/fx/).

Never benchmarked: the database, devops, uiux and mobile sections, the data-scientist advisor, any non-Node stack, and the desktop flows. Not measured: any saving in real use.

## Use
- Talk to the supervisor. Each job wakes the matching builder section, which writes the code and its tests and runs its reviewer gate; multi-area work also wakes testing, and work for 3+ builder sections (testing, docs, the security pass and advisors not counted) shows a plan first. In full: [docs/how-it-works.md](docs/how-it-works.md).
- **Reports** go to `.team/reports/<date>/`: every REPORT has a `Status:` line and a `Quality:` line with the reviewer's grade, and each saved file ends with a `Plugin:` line (version and mode).
- **Notes** go to `.team/notes/` and, like reports, stay out of git; to keep them in git, create `.team/keep-in-git` and delete the `.team/` line from `.git/info/exclude`. In a project outside git, or one whose `.team/` git does not ignore or tracks (as with `.team/keep-in-git`), session start does not point the supervisor to `.team/notes/plan.md` or the last summary; one line tells you so.
- **Memory guard (opt-in).** It is off by default on every platform. To turn it on, set `SECTION_TEAM_MEMORY_LIMIT_MB` to a whole number of MB (for example `12288` on a 16 GB machine) under `env` in `~/.claude/settings.json`; `0` or a value that is not a whole number keeps it off, and 1 to 1023 runs as 1024 MB, with one line. Project `.claude` settings that set the limit, `HOME` or `USERPROFILE` keep the guard off, one line per session. Once a section runs Bash or PowerShell, one guard checks every 5 seconds and stops any process the session started that holds more memory than the limit (SIGTERM, then SIGKILL if it is still running 5 seconds later), the session's MCP servers included, never Claude Code itself; on Windows any stop signal ends the process at once. Each stop is logged, secrets redacted, in `.team/tmp/memory-guard.log`.

## Modes
Balanced is the default. Lean, the third, was removed in 0.3.0 (a saved `lean` runs as Balanced, with one line saying so).

| Picker label | Usage behind the label | Reviewer gate |
|---|---|---|
| Balanced · ~7× usage | Round nx (reported, 9 runs per setup): v0.6.0-rc.1 at 7.26× plain Claude Code, three tiers weighted equally; estimated 7.48× with v0.5.1's h8 in place of the reverted L1. | Opus. Pass: overall at least 8, no item under 6. 2 fix rounds. |
| Max · ~10× usage | About 10×, measured on 0.3.0+ rounds; 0.6.0 changes Max only in trust text and the model alias, not re-measured. | Opus. Pass: overall at least 9, no item under 7. 2 fix rounds. |

On the platform-sized task p1, in rounds tg to ph Balanced cost 3.4 to 6.0 times and Max 8.4 to 13.0 times solo. Reported only: on hq (2 runs) Max ranked first; in the published p1 data Max led Balanced by 0 to +0.75 at 1.4 to 2.7× its cost and scored below it in pr and tf.

**Max** adds proof steps: tests before code, probes even on small tasks, security reviews, two final reviews on multi-area work (the second is not shown the first's REPORT; it reads the code against the spec instead of probing again), one PASS or FAIL line per critical flow before done, and a grade on every changed file ([in full](docs/how-it-works.md#max)).

- **Pick a mode:** the **Mode** picker on the team strip, or `/team mode balanced|max|off`; `/team mode` alone shows the current mode. A change mid-session applies from your next message.
- **Turn it off in one project:** `/team mode off`, **Off** in the Mode picker, or `{"mode": "off"}` in `.team/mode.json`: no brief, and session start writes nothing in the project, though the hooks and the strip still run. A REPORT or `## Team summary` from a section started there by hand is saved only where git ignores `.team/`; elsewhere nothing is saved and one line says so. It applies from your next session, `/clear` or `/compact`. A committed off turns the team off for everyone who clones the repo. A committed `.team/mode.json` that sets Max or off is named in one line at session start.
- **Mode file:** `.team/mode.json` at the project root, for example `{"mode": "max"}`; no file means Balanced. `"autoInstallSkills": false` there turns automatic skill installs off, never on, since a cloned repo can commit the file. Only `SECTION_TEAM_AUTO_INSTALL_SKILLS=1` in your user settings turns them on: a project's `.claude/settings.json` or `settings.local.json` that sets this variable, `HOME` or `USERPROFILE` (a key in any letter case counts) keeps automatic installs off, with one line saying so. [More](docs/how-it-works.md#mode-file).

## Team Board
- The strip, `/team` and `/chats` use the early-access Mods API, tested on Claude Code 2.1.318. If the board does not load, one line per session says so: "section-team: the Team Board did not load in this session (Claude Code's early-access Mods API); /team and the Mode picker are unavailable, and .team/mode.json still sets the mode." Then turn the team off with `{"mode": "off"}` in `.team/mode.json`.
- The strip shows who is awake, tokens, helpers and the mode picker; **Board** or `/team` opens one box per awake section with its grade.
- Outside the terminal the board shows an office: each builder's creature works at its desk, walks back when done and strolls while free; advisors have none. Press one to squish, click to fling (not VS Code). Not yet tried by hand on VS Code or mobile, nor the fling on desktop. The terminal keeps the text board. `/team name <section> <name>` renames a builder and `/team name <section>` gives back its default name; `/team office yellow` or `/team office night` paints the office (saved in `~/.claude/section-team/names.json` and `~/.claude/section-team/office.json`).
- `/chats` shows one card per open chat (needs you, working or idle). Details: [docs/how-it-works.md](docs/how-it-works.md#team-board).

## Sections
Builders: frontend, backend, database, testing, security, devops, uiux, docs, ai-llm, mobile. Advisors, which change no project files: ai-engineer, data-scientist, plan-advisor. Heads keep design and integration and hand routine work to [helpers](#glossary). In full: [docs/how-it-works.md](docs/how-it-works.md#sections).
- **Models:** Sections and the reviewer use the `opus` model alias (they follow your session's Opus version, or the alias default), the coder `sonnet` and the scout `haiku`: on the Anthropic API Opus 5.5, Sonnet 5.5 and Haiku 5.5 (`opus` has meant Opus 5.5 since Claude Code 2.1.280); other providers map them to older models.
- **Skills:** a section never installs one; it names a `Suggested skill:` and the supervisor asks you, then installs it through `section-team:add-skill` after a safety review and saves the assignment in `~/.claude/section-team/roster-extra.json`: after `claude plugin update`, run `node "<plugin root>/scripts/assign-skill.mjs" --reapply` once to restore it (session start shows the exact command when the agents lack it). With automatic installs on, a suggested or found skill installs without asking only if its owner is listed in `~/.claude/section-team/trusted-sources.json` (the plugin's own list ships empty).
- **Reviewer gate:** builders send changed files to `section-team:reviewer`; a hook refuses a done hand-back with changed code and no passing grade, so the section must run the reviewer or hand back as `partial`, `blocked` or `ungraded`.
- **Tools and MCP grants:** builder heads get the file, shell, agent and web tools and no project MCP servers. frontend, testing, uiux and ai-llm also list `mcp__Claude_Browser__*` (the desktop app's built-in browser, keeping any sign-in you made in it), `mcp__chrome-devtools__*` and `mcp__playwright__*`; whether these wildcards take effect has not been checked live. No section gets `mcp__claude-in-chrome__*`, which drives your own logged-in Chrome.

## Platform readiness (0.2.3)
Long sessions and multi-area platforms: [docs/long-sessions.md](docs/long-sessions.md).

## Glossary
- **Section:** an Opus specialist agent, a builder or an advisor.
- **Helper:** a section's cheaper agent: the scout (reads) or the coder (routine code).
- **Reviewer gate:** `section-team:reviewer` grading a builder's changed files.
- **REPORT:** a section's hand-back with `Status:` and `Quality:` lines, saved in `.team/reports/`.
- **Mode:** Balanced (the default), Max or off, per project in `.team/mode.json`.
- **Solo:** the benchmark baseline, Claude Code with the plugin off ([which setup](#results)).
- **Rounds:** p1 (a help-desk platform task: rounds pr, tm, tc, tf, tg to to, py, ph), hq (tasks h5 to h7), fx (tasks f1 to f3), nx (tasks h8 to h10).
- **Judges:** blind graders: Opus in the early rounds, then Codex and Fable (which also planned and reviewed some of the fixes it judged).

## Support
[Open an issue](https://github.com/afel6/section-team/issues/new/choose) for bugs and questions. One person maintains the plugin, best effort, with a first reply within 7 days; vulnerabilities go by [SECURITY.md](SECURITY.md).

## Develop
Checks, CI and the harness: [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/how-it-works.md](docs/how-it-works.md#develop).
