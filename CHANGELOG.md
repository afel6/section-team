# Changelog

Each release's full notes are on the [GitHub releases page](https://github.com/afel6/section-team/releases).

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
