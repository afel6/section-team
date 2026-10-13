# section-team

A personal Claude Code plugin: every session is a **supervisor** that wakes specialist **sections** (Opus 5.5) when a task needs them, saves their reports, and shows a live **Team Board**.

## On / off
- On: `~/.claude/settings.json` → `env.CLAUDE_CODE_PLUGIN_DIRS = C:\Users\Asus\claude-team`. New sessions pick it up.
- Off: set `"section-team@inline": false` under `enabledPlugins`, or remove the env entry. Emergency: `claude --safe-mode`.

## Use
- Just talk to the supervisor. Small tasks it does itself; bigger ones wake sections. 3+ builder sections (advisors not counted) → it shows a plan first.
- Sections are addressed by agent id; a section's request for another section goes through the supervisor.
- The Team Board opens automatically when a session starts; `/team` reopens it. Each section box shows its live token use and how many helpers it started, by model.
- Reports: `.team/reports/<date>/` in each project (kept out of git via `.git/info/exclude`; to keep them in git, create `.team/keep-in-git` and delete the `.team/` line from `.git/info/exclude`).

## Sections
Builders: frontend, backend, database, testing, security, devops, uiux, docs, ai-llm, mobile. Advisors (read-only): ai-engineer, data-scientist.
Edit the roster in `scripts/gen-agents.mjs`, then run `node scripts/gen-agents.mjs`.

## Develop
- `npm test` — hook logic (node:test)
- `npm run test:board` — Team Board (claude plugin test)
- `npm run validate` — plugin validation
- Design: `docs/specs/2026-10-12-claude-team-design.md` · Phase 0: `docs/phase0-results.md`
