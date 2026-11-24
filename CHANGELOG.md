# Changelog

Each release's full notes are on the [GitHub releases page](https://github.com/afel6/section-team/releases).

## 0.6.0 (unreleased)

**Balanced direct tier (reverted: missed bar Q1)**
- The release candidate v0.6.0-rc.1 let Balanced's supervisor do a direct job itself (a question, a read, or a fix of about 30 lines or less of non-test code that adds no feature), test first and, when it changed behaviour, graded by the reviewer, instead of waking a section. Round nx measured rc.1 against v0.5.1 on h8, a small fix task, with 5 runs per setup and Codex as the one blind judge. It met its cost bar C1 at 0.65× v0.5.1's cost ($0.72 against $1.11 per run) and missed its quality bar Q1: rc.1 − v0.5.1 was -0.38 on Codex's five-dimension mean, 95% CI [-1.67, +0.91] over 5 groups, where the bar was at least -0.25. H1, T1 and the validity checks V1 to V6 were met. The keep rule pre-registered in tag `nx-freeze` reverts the tier on a missed bar, so 0.6.0 ships without it: every job goes to a section, as in 0.5.1. No round measured the exact 0.6.0 build. Details: [docs/benchmark-nx-2026-11.md](docs/benchmark-nx-2026-11.md).

**Safety and trust**
- A project's `.claude/settings.json` or `settings.local.json` (in the session's folder, a linked worktree's own folder or the main checkout) that sets `SECTION_TEAM_AUTO_INSTALL_SKILLS` keeps automatic skill installs off, one that sets `SECTION_TEAM_MEMORY_LIMIT_MB` keeps the memory guard off, and one that sets `HOME` or `USERPROFILE` keeps both off, a key in any letter case included, each with one line.
- The memory guard raises a limit under 1024 MB to 1024 MB, with one line, and names a limit that is not a whole number once per session instead of never.
- The memory guard stops a process with SIGTERM, then SIGKILL if it is still running 5 seconds later (on Windows any stop signal ends it at once).
- Saved long prompts and the memory-guard log replace recognised secrets with `[redacted]`: private-key blocks, bearer and Basic auth values, provider tokens, URL passwords, JSON secret values, password and token flags and `NAME=value` secrets; a value that looks like a placeholder is kept only when it is a whole one, such as `$NAME`, `${NAME}`, `%NAME%` or `<name>`.
- Each chat's status file redacts the request it keeps (its first 80 characters) the same way, and the supervisor's pointer to a saved prompt says recognised secrets are shown as `[redacted]`.
- With automatic installs on, a section's `Suggested skill:` installs without asking only when its GitHub owner is in `~/.claude/section-team/trusted-sources.json` and add-skill's review finds no red flag, as a searched skill already did.
- add-skill's review also flags bidi isolates, inline commands and frontmatter hooks; hooks or allowed-tools in the frontmatter, executable files and network calls turn an unattended install into the question; and the trusted-owner check asks when the project turns installs off.
- The supervisor is told that `.team/notes/` a repo commits are not your approved decisions until you confirm them, and sections take a committed `foundation.md` as approved only once you say so.
- A `.team/` plan or last summary that a repo ships in git, or that git does not ignore, is not loaded as instructions, with one line; a committed `.team/mode.json` that sets Max or off is named in one line at session start.
- In an off project whose `.team/` git does not ignore, no REPORT or team summary is saved, with one line.
- Builders, the coder and the reviewer carry a safety rule no project rule lifts: no push, force-push, deploy, publish, destructive git, command against production or remote services, or delete outside the project of what the job did not make; the supervisor asks you first.
- The supervisor asks you before it runs an MCP write, send or delete for a section.
- An advisor's write is refused when the advisor check itself fails.
- `SECURITY.md` says private vulnerability reporting is not enabled yet, gives the interim route and lists the known limits.

**Behaviour**
- Sections and the reviewer use the `opus` model alias, so they follow your session's Opus version or the alias default.
- A section transcript the context guard or the grade check cannot read is named in one line, where before it was allowed in silence.
- The off line says `/team mode balanced` turns section-team back on from your next session, `/clear` or `/compact`, and the mode save line says a switch to or from off applies from then.
- Session start prunes old status files and mode records in an off project too.

**Board**
- When the Team Board does not load, one line says so once per session and that `.team/mode.json` still sets the mode.
- An off project's strip polls every 10 s while neither board pane is open.
- A rename re-reads `names.json` first, so names another chat saved are kept, and a poll tick is skipped while the last one still runs.

**Install and updates**
- The plugin ships an empty roster (`scripts/roster-extra.json`), so sections lose the extra go-to skills 0.5.1's roster gave them and any assignment you made under 0.5.1 (the skills stay installed in `~/.claude/skills/`); to keep one, assign it again once with `node "<plugin root>/scripts/assign-skill.mjs" <skill> <section>`.
- Your skill assignments are saved in `~/.claude/section-team/roster-extra.json`, outside the plugin folder: after a later `claude plugin update`, `node "<plugin root>/scripts/assign-skill.mjs" --reapply` restores them, and session start shows that exact command when the agents lack one.
- add-skill no longer commits in the plugin folder.

**Rule precedence**
- The sections' and the reviewer's section-team default rules give way where the project's CLAUDE.md, AGENTS.md or `.claude/rules` say otherwise; in 0.5.1 they were called the user's standards.
- Projects with a tests-first rule now get tests first. In Balanced, builders write the code first and its tests after it, from the spec; a tests-first rule in the project's CLAUDE.md or AGENTS.md now holds over that order, as a job message that asks for tests first already did. In 0.5.1 such a rule gave way. Max still writes tests first.

**Benchmark**
- Raw data of rounds hq, fx, py and ph is published, with recompute scripts.
- Round fx's tasks f1 to f3 and their hidden tests are published.
- The harness can run a base arm at its own ref, pins the profile, the Claude Code version and the memory limit per batch, and checks the clean profile and the instruction files above the runs folder.

**Changed after the measured commit v0.6.0-rc.1**

Round nx measured v0.6.0-rc.1 (`9ec796f`). These commits came after it, newest first; of them, only the revert changes what the plugin does.
- `fe9900c` Round nx's derived data published in `bench/data/nx/`.
- `9e76662` Merge of the revert below, as round nx's keep rule requires.
- `7dd5bf3` Revert of the Balanced direct tier: Balanced's brief and the generated agents go back to waking a section for every job, and `skills/direct-build/` is removed.
- `54e50c3` Merge of round nx's tasks, tagged `nx-freeze` with the bars and the keep rule; benchmark files only.
- `ee3f36a` h10's task text says the body decodes as Buffer toString does and keeps a leading byte order mark (benchmark only).
- `c6e65fd` h10's hidden tests compare a failed list fetch with the list as loaded and check that a list success keeps `#error` (benchmark only).
- `9cd74e7` h9's task text says a long flat chain of operators must evaluate (benchmark only).
- `28fe0a9` Held-out task h10, a polls app with an API, a page and a JSON file, its hidden tests and 11 near-misses (benchmark only).
- `f0a0efc` Held-out fix task h8, a loans CLI seed with two bugs, its hidden tests and 6 near-misses (benchmark only).
- `486f01d` Held-out task h9, an expression calculator, its hidden tests and 11 near-misses (benchmark only).
- Docs pass 2 lands in this release after these commits: the README, the docs and these notes take round nx's numbers, and the Balanced picker label becomes `Balanced · ~7× usage` (was `~5×`). It rounds rc.1's cost over plain Claude Code on h8 to h10 with the three tasks weighted equally, 7.26× (reported, no bar; 9 runs per setup: 5 on h8, 2 each on h9 and h10); with h8 taken from v0.5.1, which routes it as 0.6.0 does, the estimate is 7.5×.

## 0.5.1 (2026-11-22)

Version 0.5.0 was served from `main` for a few hours without the safer defaults below; 0.5.1 is the first release with them. If you installed 0.5.0, update with `claude plugin update section-team@section-team`.

**Safer defaults. Read these first if you are upgrading.**
- A project's `.team/mode.json` can no longer turn on automatic skill installs. Only the `SECTION_TEAM_AUTO_INSTALL_SKILLS=1` environment variable turns them on (a project's own `.claude/settings.json` can set environment variables too, so check that file in repos you clone); `"autoInstallSkills": false` in a project still turns them off there, and a `true` is ignored with a one-line notice.
- `skills/add-skill/trusted-sources.json` ships empty, and a trusted owner installs without asking only when `SECTION_TEAM_AUTO_INSTALL_SKILLS=1`. Before, skills found from `anthropics`, `vercel-labs` or `microsoft` installed without asking, with no setting.
- The memory guard is off on every platform until you set `SECTION_TEAM_MEMORY_LIMIT_MB` to a whole number of MB. Before, it was on by default on Windows at 75% of RAM. To keep that on a 16 GB machine, set it to `12288`.
- No section is granted `mcp__claude-in-chrome__*` (your own logged-in Chrome) any more. frontend, testing, uiux and ai-llm keep the built-in browser, chrome-devtools and playwright; the README lists every grant.

**New**
- A per-project off switch: `/team mode off`, the **Off** picker entry or `{"mode": "off"}` in `.team/mode.json`. That project's sessions get no brief, and session start writes nothing there. It applies from the next session.
- The Team Board office: ten desks with a named creature per builder section, which walk to their desk while their section works. `/team name <section> <name>` renames one; names are saved in `~/.claude/section-team/names.json`.
- `SECURITY.md` with a private reporting route.

**Docs**
- The README opens with a quickstart (what it does, the cost, what the gain is, install, off), a list of what changes in your sessions, and how to disable or uninstall the marketplace install.
- The round-by-round results moved to `docs/benchmark-p1-hq-fx-2026-11.md`, and raw data for ten p1 rounds is now in `bench/data/p1/` with a recompute script. Rounds py, ph, hq and fx are labelled as reported, with no raw data published.
- Corrected: the CI scope, the advisor count, the review gate as a best-effort check that fails open, and the office as not yet tried by hand on VS Code or mobile.

## 0.4.1 (2026-11-22)
Shorter mode labels (`Balanced · ~5× usage`, `Max · ~10× usage`); the board's task line and the saved long request skip messages from other sessions; the board legend wraps in a narrow pane.

## 0.4.0 (2026-11-19)
Section rules from nine paid rounds on the platform task p1; a design check by `plan-advisor` before Max writes complex single-area code; the `section-team:node-http` skill; the memory guard; the saved team summary.

## 0.3.0 (2026-11-11)
Breaking: Lean is removed (a saved `lean` runs as Balanced). Every job goes to a section; the `section-team:foundation` plan check before a platform and the `plan-advisor` advisor; skill search through `section-team:add-skill`; Max rebuilt; a smaller supervisor chat. Includes the 0.2.3 changes, which were never released on their own.

## 0.2.2 (2026-11-04)
The picker shows measured usage; near-miss copies stay out of git; saved reports end with a `Plugin:` line; CI also runs on macOS and on the oldest supported Node versions.

## 0.2.1 (2026-11-04)
The version the pre-registered mode round measured. In Max, near-miss copies stay in `.team/near-miss/`.

## 0.2.0 (2026-11-01)
Lean, Balanced and Max modes, with the Mode picker and `/team mode`; the honest `ungraded` status for a section that cannot run its reviewer gate.

## 0.1.1 (2026-10-26)
One-command install from the repo's own marketplace; the supervisor asks before installing a suggested skill unless `SECTION_TEAM_AUTO_INSTALL_SKILLS=1`; section helpers work in the desktop app. This is the version the pre-registered held-out round measured.

## 0.1.0 (2026-10-26)
First public release: the supervisor, ten builder sections and two advisors, the Opus reviewer gate, saved reports, the Team Board and `/chats`.
