# section-team

[![test](https://github.com/afel6/section-team/actions/workflows/test.yml/badge.svg)](https://github.com/afel6/section-team/actions/workflows/test.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A Claude Code plugin that turns every session into a **supervisor** of a small engineering team: every job goes to a specialist builder **section**, three advisors give advice without changing files, and code passes a **reviewer gate** before it comes back. Each project picks a **mode** (Balanced or Max) or turns the team **off**, and a live **Team Board** shows who is working. Terms: [Glossary](#glossary).

Current version: 0.5.1. What changed: [CHANGELOG.md](CHANGELOG.md).

## Quickstart
- **What it does:** every request goes to an Opus specialist agent (a *section*), whose code must pass an Opus reviewer before it comes back to you.
- **What it costs:** about 5× your normal Claude Code usage in Balanced (the default) and about 10× in Max, up to 13× on platform-sized tasks, and about 3 to 6× the wall time in Balanced and 6 to 12× in Max. Even a small change wakes a section, so it is not for quick edits or questions on a tight plan.
- **What you get:** blind judges scored the plugin's code higher, the largest part (42-44% in the mode round) for bigger test suites. No meaningful correctness gain has been measured: hidden tests tied in most rounds, the plugin passed fewer in the first three p1 rounds, and at most 2 more of 148 on one hq task (2 runs). On seeded near-miss bugs (mode round) its suites caught about as many as solo's: 21 and 19 against 20 of 24 on h6, and all 18 on h5 ([Results](#results)).
- **Needs:** Claude Code 2.1.318, Node 20.16+ or 22.3+, git 2.31+ and first-party access to Opus 5.5 ([details](#install)).
- **Install:** `/plugin install section-team --marketplace afel6/section-team`, then start a new session. A team strip appears above the prompt; ask for work as usual.
- **Turn it off:** `/team mode off` for one project, `claude plugin disable section-team@section-team` for every project, or `claude plugin uninstall section-team@section-team` to remove it ([details](#turn-it-off-or-uninstall)).

## What changes in your sessions
- **A brief in every session.** Session start adds the supervisor's instructions to every session in every project (about 8.3K characters in Balanced, 8.9K in Max). From then on the supervisor routes work and writes no product code itself.
- **Hooks.** SessionStart, UserPromptSubmit, PreToolUse (on Write, Edit, MultiEdit, NotebookEdit, Bash, PowerShell, Agent, SubagentHandback and SendMessage), SubagentStop and Stop run in every session, acting mainly on section-team agents. They fail open with one line per failure, and a section transcript the context guard or the grade check cannot read gets one line too; the exception is an advisor's write: if that check itself fails, the write is refused.
- **Files in each git repo.** `.team/notes/INDEX.md` at session start; later `.team/reports/<date>/` (every section REPORT, the supervisor's summary, and any message of 3000 characters or more, with recognised secrets replaced by `[redacted]`), `.team/tmp/<section>/`, `.team/mode.json` once you pick a mode, and `.claude/agent-memory-local/<section>/`.
- **`.git/info/exclude`.** Two lines are added, `.team/` and `**/.claude/agent-memory-local/`, so those folders stay out of git. The plugin commits nothing to your project.
- **Your home folder,** under `~/.claude/section-team/`: `sessions/` (one status file per chat: its project folder, the first 80 characters of your latest request and its token counts; deleted after 7 days), `modes/` (each session's mode, brief and board-check records), and, once you use them, `names.json`, `roster-extra.json` and `trusted-sources.json`.
- **A 1 s poll** of the team's agents, reports and mode file by the Team Board strip, in every session (every 10 s in a project set to off while neither board pane is open).
- **Memory guard: off** unless you set `SECTION_TEAM_MEMORY_LIMIT_MB` ([details](#use)).
- **Skill installs ask you.** A section may suggest a skill; the supervisor asks before installing it into `~/.claude/skills/`, unless you set `SECTION_TEAM_AUTO_INSTALL_SKILLS=1` in your user settings. Project settings that set it, `HOME` or `USERPROFILE` keep installs off ([details](#modes)), but a project's `.claude/settings.json` can still add hooks and other environment variables, so check it in repos you clone.
- **Sections skip your global `~/.claude/CLAUDE.md`** (`omitClaudeMd` in all 16 agent files). Put rules you rely on in the project's CLAUDE.md or AGENTS.md. Builders carry their own rule: no push, force-push, deploy or destructive git without your yes.
- **Network.** No telemetry: the hooks and the board make no network calls; sections use WebFetch and WebSearch, and a skill search queries skills.sh and GitHub.
- **In a project set to off,** the hooks still start on every prompt and matched tool call (one git call per prompt) but do nothing for the supervisor; the strip, its poll and the chat's status file remain; a project's first session may already have written `.team/` and the exclude lines. Off applies from your next session, `/clear` or `/compact`. To try the plugin in one project only, install it with `--scope local`.

## Install
**Needs:** Claude Code 2.1.318 (tested; this release has not been run on an older one, and before 2.1.280 the `opus` alias did not mean Opus 5.5), Node 20.16+ or 22.3+ and git 2.31+ on PATH (without Node every prompt and matched tool call shows a hook error), and first-party access to Opus 5.5 (Bedrock, Vertex and Foundry are untested; on Foundry the `opus` alias means Opus 4.6).

One command installs it from this repo:
```
/plugin install section-team --marketplace afel6/section-team
```
On older versions, run `/plugin marketplace add afel6/section-team`, then `/plugin install section-team@section-team`. To work on the plugin from a clone, see [CONTRIBUTING.md](CONTRIBUTING.md).

### Turn it off or uninstall
- **One project:** `/team mode off` or **Off** in the Mode picker (`/team mode balanced` turns it back on); it applies from your next session, `/clear` or `/compact`, and the hooks and the strip still run there ([what still runs](#what-changes-in-your-sessions)).
- **Every project, still installed:** `claude plugin disable section-team@section-team`; `claude plugin enable section-team@section-team` turns it back on.
- **Remove it:** `claude plugin uninstall section-team@section-team`.
- **What stays behind** (delete it by hand if you want): `.team/` and `.claude/agent-memory-local/` in each project, the two lines in each repo's `.git/info/exclude`, `~/.claude/section-team/`, and any skill you installed into `~/.claude/skills/`.
- **Emergency:** `claude --safe-mode` starts Claude Code with plugins off.
- The disable and uninstall commands are the ones `claude plugin --help` lists on Claude Code 2.1.318; a fresh-profile run of the marketplace install, disable and uninstall has not been recorded yet.

## Results
Hidden tests show no meaningful gain: they tied in most rounds; the plugin passed fewer than solo in the first three p1 rounds and in round tj's official scoring (one Balanced run's hidden suites were cut short under machine load; a reported rescore, not published, passed 264); and Max passed 2 more of 148 on one hq task. Each result rests on 2 or 3 runs per setup, on Node.js tasks with no npm packages, run headless.

**Baselines.** Solo is Claude Code with the plugin off. Only the mode round's baseline was plain Claude Code on a clean machine. The held-out round and the p1 rounds in `bench/data/p1/` used Claude Code with the author's setup (plugin off; their CLAUDE.md and other plugins on): 5 of 9 held-out solo runs and 16 of 20 solo runs in `bench/data/p1/` spawned the author's code-reviewer or security-reviewer agent. For rounds hq, fx, py and ph the machine setup was not recorded.

**Pre-registered rounds** (public freeze tag, targets set before the round), both on older versions:
- **Held-out (2026-10-31, v0.1.1, whose supervisor still built small and single-area work itself):** 3 new tasks, 3 runs, the author's setup; Opus judges 8.80 vs 8.16, all hidden tests passed by both, about 2.2× the cost ([data](bench/data/heldout/)).
- **Mode round (2026-11-04, v0.2.1, before 0.3.0 removed Lean and rebuilt Max):** 3 new tasks, 3 runs, plain Claude Code on a clean machine; Opus judges Balanced 8.77 and Max 9.06 vs 7.37 (Codex saw about half the gap), all hidden tests passed, 5.24× and 9.66× the cost ([data](bench/data/modes/)).

**Rounds on the rules that ship (0.3.0 and later).** Their targets were recorded privately, so they are not publicly pre-registered:
- **The p1 rounds (2026-11-07 to 2026-11-18)** built one help-desk platform in three stages. The sections' rules were tuned on this task, so these results are in-sample. Balanced judged 1.0 to 1.75 above solo on Codex at 3.4 to 5.6× (judged rounds; py's 6.0× was never judged); Max 6.1 to 13.0×. Round pr ran 0.2.3, so eleven of the twelve published p1 rounds are 0.3.0 or later. Raw data: [`bench/data/p1/`](bench/data/p1/), with rounds ph and py in [`bench/data/ph/`](bench/data/ph/) and [`bench/data/py/`](bench/data/py/).
- **Round hq (2026-11-19, plugin d795636: 0.3.0 plus the p1 fixes)** ran three other tasks. Balanced scored 8.58 (Codex) and 8.50 (Fable) against 7.92 and 7.17 for solo at 5.2× the cost, missing both of its pre-set bars; Max scored 9.42 and 9.00 at 10.5× and ranked first in all 12 cases on both judges. Fable also planned and reviewed some of the fixes it judged. Raw data: [`bench/data/hq/`](bench/data/hq/). Its two-stage task h7 shares a requirement word for word with p1.
- **Round fx (2026-11-20)** checked one Balanced fix, which missed its bar and does not ship. Raw data: [`bench/data/fx/`](bench/data/fx/).

Every round's numbers, targets and judge findings: [docs/benchmark-p1-hq-fx-2026-11.md](docs/benchmark-p1-hq-fx-2026-11.md); rounds 1 to 17: [docs/benchmark-2026-10-24.md](docs/benchmark-2026-10-24.md). Never benchmarked: the database, devops, uiux and mobile sections, the data-scientist advisor, any non-Node stack, and the desktop flows. Not measured: any saving in real use.

## Use
- Just talk to the supervisor. Each job wakes the matching builder section, which writes the code and its tests and runs its reviewer gate; multi-area work also wakes testing, and work for 3+ builder sections (testing, docs, the security pass and advisors not counted) shows a plan first. Routing, messages, reports and long messages in full: [docs/how-it-works.md](docs/how-it-works.md).
- **Reports** go to `.team/reports/<date>/`: every REPORT has a `Status:` line (`done`, `partial`, `blocked` or `ungraded`) and a `Quality:` line with the reviewer's grade, and each saved file ends with a `Plugin:` line (version and mode).
- **Notes** go to `.team/notes/` and, like reports, stay out of git; to keep them in git, create `.team/keep-in-git` and delete the `.team/` line from `.git/info/exclude`. In a project outside git, or one whose `.team/` git does not ignore or tracks (as with `.team/keep-in-git`), session start does not point the supervisor to `.team/notes/plan.md` or the last summary; one line tells you so.
- **Memory guard (opt-in).** It is off by default on every platform. To turn it on, set `SECTION_TEAM_MEMORY_LIMIT_MB` to a whole number of MB (for example `12288` on a 16 GB machine) under `env` in `~/.claude/settings.json`; `0` or a value that is not a whole number keeps it off. Once a section runs Bash or PowerShell, one guard checks every 5 seconds and stops any process the session started that holds more memory than the limit (SIGTERM, then SIGKILL if it is still running 5 seconds later), the session's MCP servers included, never Claude Code itself. Each stop is logged, secrets redacted, in `.team/tmp/memory-guard.log`.

## Modes
Balanced is the default. Lean, the third, was removed in 0.3.0 (a saved `lean` runs as Balanced, with one line saying so). The picker's labels round the usage measured in the [mode round](docs/benchmark-modes-2026-11.md) and round hq; in the mode round every setup passed every hidden test, and the setup with more test lines won almost every comparison. On the platform-sized task p1 usage ran higher: in rounds tg to ph Balanced cost 3.4 to 6.0 times and Max 8.4 to 13.0 times solo, and on hq's two-stage task h7 6.6 and 12.8 times. Reported only: on hq (2 runs) Max ranked first; in the published p1 data Max led Balanced by 0 to +0.75 at 1.4 to 2.7× its cost and scored below it in pr and tf.

| Picker label | Measured on v0.2.1 (mode round; Max was rebuilt in 0.3.0) | Reviewer gate |
|---|---|---|
| Balanced · ~5× usage | Quality 8.77, +1.40 over plain Claude Code (bar met, Codex confirms). Usage 5.24×, 4.26× on the two single-area tasks. | Opus. Pass: overall at least 8, no item under 6. 2 fix rounds. |
| Max · ~10× usage | Quality 9.06, +0.29 over Balanced (bar not measurable; Codex does not confirm). Usage 9.66×, then 7.52×. | Opus. Pass: overall at least 9, no item under 7. 2 fix rounds. |

**Max** adds proof steps: tests before code, probes even on small tasks, security reviews, two final reviews on multi-area work (the second is not shown the first's REPORT; it reads the code against the spec instead of probing again), one PASS or FAIL line per critical flow before done, and a grade on every changed file ([in full](docs/how-it-works.md#max)).

- **Pick a mode:** the **Mode** picker on the team strip, or `/team mode balanced|max|off`; `/team mode` alone shows the current mode. A change mid-session applies from your next message.
- **Turn it off in one project:** `/team mode off`, **Off** in the Mode picker, or `{"mode": "off"}` in `.team/mode.json`: no brief, and session start writes nothing in the project, though the hooks and the strip still run ([what still runs](#what-changes-in-your-sessions)). A REPORT or `## Team summary` from a section started there by hand is saved only where git ignores `.team/`; elsewhere nothing is saved and one line says so. It applies from your next session, `/clear` or `/compact`. A committed off turns the team off for everyone who clones the repo. A committed `.team/mode.json` that sets Max or off is named in one line at session start.
- **Mode file:** `.team/mode.json` at the project root, for example `{"mode": "max"}`; no file means Balanced. `"autoInstallSkills": false` there turns automatic skill installs off, never on, since a cloned repo can commit the file. Only `SECTION_TEAM_AUTO_INSTALL_SKILLS=1` in your user settings turns them on: a project's `.claude/settings.json` or `settings.local.json` that sets this variable, `HOME` or `USERPROFILE` (a key in any letter case counts) keeps automatic installs off, with one line saying so. [More](docs/how-it-works.md#mode-file).

## Team Board
- The strip, `/team` and `/chats` use the Mods API (`hooks/register.tsx`), an early-access Claude Code API that may change between releases, tested on Claude Code 2.1.318. When the board does not load, one line says so, once per session: "section-team: the Team Board did not load in this session (Claude Code's early-access Mods API); /team and the Mode picker are unavailable, and .team/mode.json still sets the mode." You can then turn the team off with `{"mode": "off"}` in `.team/mode.json`.
- A strip above the prompt shows who is awake, tokens, helpers and the mode picker; its **Board** button or `/team` opens one box per awake section with its tokens, helpers and grade.
- On desktop, VS Code and mobile the board shows an office: each builder's creature sits at its desk while its section has work, walks back when it ends and strolls the corridor while free; the advisors have no desk. It has board tests but has not been tried by hand on VS Code or mobile. The terminal keeps the text board. `/team name <section> <name>` renames a builder, and `/team name <section>` gives back its default name; names are saved in `~/.claude/section-team/names.json`.
- `/chats` shows one card per open chat (needs you, working or idle), read from the status files. Details: [docs/how-it-works.md](docs/how-it-works.md#team-board).

## Sections
Builders: frontend, backend, database, testing, security, devops, uiux, docs, ai-llm, mobile. Advisors, which change no project files: ai-engineer, data-scientist, plan-advisor. Heads keep design and integration and hand routine work to [helpers](#glossary). In full: [docs/how-it-works.md](docs/how-it-works.md#sections).
- **Models:** Sections and the reviewer use the `opus` model alias (they follow your session's Opus version, or the alias default), the coder `sonnet` and the scout `haiku`: on the Anthropic API Opus 5.5, Sonnet 5.5 and Haiku 5.5 (`opus` has meant Opus 5.5 since Claude Code 2.1.280); other providers map them to older models.
- **Skills:** a section never installs one; it names a `Suggested skill:` and the supervisor asks you, then installs it through `section-team:add-skill` after a safety review and saves the assignment in `~/.claude/section-team/roster-extra.json`: after `claude plugin update`, run `node "<plugin root>/scripts/assign-skill.mjs" --reapply` once to restore it. With automatic installs on, a skill found on GitHub installs without asking only if its owner is listed in `~/.claude/section-team/trusted-sources.json` (the plugin's own list ships empty).
- **Reviewer gate:** builders send changed files to `section-team:reviewer`; a hook refuses a done hand-back with changed code and no passing grade, so the section must run the reviewer or hand back as `partial`, `blocked` or `ungraded`.
- **Tools and MCP grants:** builder heads get the file, shell, agent and web tools and no project MCP servers. frontend, testing, uiux and ai-llm also list `mcp__Claude_Browser__*` (the desktop app's built-in browser, keeping any sign-in you made in it), `mcp__chrome-devtools__*` and `mcp__playwright__*`; whether these wildcards take effect has not been checked live. No section gets `mcp__claude-in-chrome__*`, which drives your own logged-in Chrome.

## Platform readiness (0.2.3)
Long sessions and multi-area platforms (fresh sections, the context guard, the grade check, the foundation and node:http skills, the two-stage task h7), and what of it is measured: [docs/long-sessions.md](docs/long-sessions.md).

## Glossary
- **Section:** an Opus specialist agent, a builder or an advisor.
- **Helper:** a section's cheaper agent: the scout (reads) or the coder (routine code).
- **Reviewer gate:** `section-team:reviewer` grading a builder's changed files.
- **REPORT:** a section's hand-back with `Status:` and `Quality:` lines, saved in `.team/reports/`.
- **Mode:** Balanced (the default), Max or off, per project in `.team/mode.json`.
- **Solo:** the benchmark baseline, Claude Code with the plugin off ([which setup](#results)).
- **Rounds:** p1 (a help-desk platform task: rounds pr, tm, tc, tf, tg to to, py, ph), hq (tasks h5 to h7), fx (tasks f1 to f3).
- **Judges:** blind graders: Opus in the early rounds, then Codex and Fable (which also planned and reviewed some of the fixes it judged).

## Support
[Open an issue](https://github.com/afel6/section-team/issues/new/choose) for bugs and questions. One person maintains the plugin, best effort, with a first reply within 7 days; vulnerabilities go by [SECURITY.md](SECURITY.md).

## Develop
Checks: `npm test`, `npm run test:board`, `npm run validate`, `node scripts/gen-agents.mjs --check` and `node --test bench/*.test.mjs`. What each covers, CI and the harness: [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/how-it-works.md](docs/how-it-works.md#develop).
