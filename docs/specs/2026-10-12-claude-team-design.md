# section-team — Design

Date: 2026-10-12 · Status: v4 — approved; Phase 0 results applied (no agent names → agentId map + relay; reports read from transcript) · Owner: Asus (personal tool)

## 1. Intent

**What the user said**
- A main page with one big box (the supervisor) and smaller boxes, one per coding specialty.
- Each specialty agent is like a fresh session: own context window, can call its own subagents.
- Each role is a *section*; sections talk to each other.
- The user talks only to the supervisor, which builds this platform and all future projects.
- The supervisor uses all skills and tells each section which skills to use.
- All agents must report.
- Personal tool. Works in **every** coding project, not one repo.
- Supervisor always on; sections wake only when needed.
- Section heads run on **Opus 5.5**; heads pick models for their helpers (Haiku / Sonnet / Opus / Fable), coordinate them, and can consult Fable.
- Reports go to the supervisor **and** are saved as files in the project, out of git by default.

**Assumptions**
- Claude desktop app, Code tab, native Windows 11 (not WSL). CLI 2.1.296 installed; the desktop app's bundled copy must be ≥ 2.1.289 (mods + `idle`/`waiting` agent statuses).
- Agent teams stay **off** (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` unset).
- Auto memory is on (needed for section memory).

**Success criteria**
1. In any project, a new Code-tab session has the supervisor brief in context (marker line `[section-team supervisor]` visible in `/context`), also after `/clear` and after compaction.
2. A task needing 3+ builder sections: the supervisor shows a plan and wakes no section before the user says OK.
3. Sections are woken by agent type, each job names its skills, and heads pass an explicit model to every helper.
4. A section's request for another section reaches that section through the supervisor relay during the acceptance task (§3.5).
5. Every section and advisor ends with a REPORT; it reaches the supervisor and is saved under `.team/reports/`; the supervisor's summary is saved too.
6. Team Board shows each section's state within ~2 s with the colours in §3.4.
7. Advisors cannot change project files (Write/Edit outside their memory folder, shell, and write-capable helpers are blocked).
8. `claude plugin validate --strict` clean; `node --test` and `claude plugin test` pass.
9. One action turns everything off (§2 Disable).

## 2. Architecture

One plugin, `section-team`, at `C:\Users\Asus\claude-team` (git repo), loaded globally.

```
section-team/
  .claude-plugin/plugin.json      name, version, description
  agents/                         12 section definitions
  hooks/hooks.json                classic hooks (Node scripts) + "modules": ["./register.js"]
  hooks/session-start.mjs         supervisor brief + git exclude          (Node, full fs)
  hooks/subagent-stop.mjs         report saver                             (Node, full fs)
  hooks/pre-tool-use.mjs          advisor read-only guard                  (Node)
  hooks/lib/*.mjs                 pure helpers shared by the scripts
  hooks/register.js               mod: Team Board pane + /team only        (mods runtime, $ API)
  brief/supervisor.md             the supervisor brief text (< 10,000 chars)
  tests/*.test.mjs                node --test (logic)
  tests/*.test.ts                 claude plugin test (board)
  docs/specs/                     this document
```

**Runtime split.** Logic that touches files runs as classic command hooks (plain Node: full `fs`, unit-testable with `node --test`). The mods runtime (no Node APIs, file access only via `$.fs`) is used only for the board UI.

**Data flow**
```
You ──► SUPERVISOR (main session; brief injected by SessionStart)
          ├─ small task → does it itself
          ├─ AI/data decision → asks advisor (ai-engineer / data-scientist), then decides
          ├─ 3+ builder sections → plan in chat → waits for OK
          └─ spawns heads: Agent(subagent_type "section-team:<id>", no model arg) → keeps id ↔ agentId map
                head (Opus 5.5, own context, own memory)
                  ├─ helpers: Agent(model haiku|sonnet|opus|fable) — helpers are leaves
                  └─ needs another section → SendMessage main → supervisor relays (§3.5)
                head ends with REPORT ──► supervisor (completion notification)
                                     ├─► SubagentStop hook → .team/reports/<date>/<HHMMSS>-<id>.md
                                     └─► Team Board box
You ◄── combined summary (also saved)
```

**Identifiers.** The authoritative section id is the agent type with the `section-team:` prefix stripped (`section-team:frontend` → `frontend`). The Agent tool has no `name` parameter in this build (Phase 0): the supervisor addresses a section only by the agentId its spawn returned, and keeps a section id → agentId map. The saver and the board key on agent type, never on the REPORT header text.

**Loading.** `CLAUDE_CODE_PLUGIN_DIRS=C:\Users\Asus\claude-team` in the `env` block of `~/.claude/settings.json` (Windows separator `;` if more paths are added). The plugin appears as `section-team@inline`; edits apply on `/reload-plugins` or next session. Phase 0 confirms the desktop app honours it. Fallback only if it does not: local marketplace in this repo with a relative `"./"` source, installed with `--scope user` (loads in place, no reinstall after edits). Never both at once.

**Disable.** Remove the env entry (or set `"section-team@inline": false` under `enabledPlugins`) and start a new session. Emergency: `claude --safe-mode`.

## 3. Components

### 3.1 Supervisor mode (`session-start.mjs`)
- Classic `SessionStart` hook, sources `startup|resume|clear|compact`, prints `hookSpecificOutput.additionalContext` = contents of `brief/supervisor.md` + one line naming the newest `*-supervisor-summary.md` (if any) for this project.
- Same run: if the cwd is in a git repo, resolve `git rev-parse --git-path info/exclude` and append `.team/` once (idempotent); skip when `.team/keep-in-git` exists. Not a repo → no-op.
- Never fails the session: any error → empty output, logged to stderr.

**Brief content (rules)**
| Task | Action |
|---|---|
| Small: touches ≤ 1 file and needs no new tests | Supervisor does it itself |
| One area, real work | Wake 1 builder section |
| Several areas | Wake several; independent parts in parallel; parts touching the same files one after another |
| AI or data **decision** | Ask the matching advisor first (only the supervisor consults advisors). ai-engineer advises; ai-llm builds |
| 3+ distinct **builder** sections (advisors not counted), or a task grows to need a 3rd | Show a short plan (who, what, order) in chat; wake nothing until the user says OK |

- **Job message** contains: goal · relevant files and prior decisions · skills/commands to use · definition of done · the full roster of section names currently awake and which to coordinate with · "end with REPORT".
- **Spawning**: `subagent_type: "section-team:<id>"`, never a `model` argument, never a `name` (not available). Record the agentId each spawn returns. Wake each section once per session; later jobs for it go by SendMessage to its agentId (keeps its context; a second SubagentStop fires — Phase 0 C5).
- **Retry**: on failure, SendMessage the same section once to resume; if that fails, tell the user with the error.
- **Missing REPORT**: ask the section once for it.
- **Precedence over global rules**: in supervisor mode, sections do the delegated work; ECC agents (planner, code-reviewer, tdd-guide, …) are used as helpers *inside* sections, not spawned directly by the supervisor for section work. For a multi-section task the testing section owns final review and verification; other heads skip a separate full review pass. (Confirmed by user — §9.1.)
- **Summary**: after a task, show per-section status lines, agreements and next steps, and write `<HHMMSS>-supervisor-summary.md` next to the reports.

### 3.2 Sections (`agents/*.md`)
Common frontmatter:
```yaml
name: <id>
description: <one line: when to use>
model: claude-opus-5-5     # pinned per user decision
color: <red|blue|green|yellow|purple|orange|pink|cyan>
memory: user
skills: [<real skills only, 0–3>]
```
Common body (short shared text + a role paragraph):
- You are the `<id>` section head. The supervisor sends you jobs.
- Go-to skills and commands for your role are listed below; use those named in the job too.
- **Helpers**: always pass `model` explicitly on the Agent call — `haiku` lookups/search/formatting/mechanical edits · `sonnet` routine code, tests, standard reviews · `opus` tricky bugs, design calls · `fable` consultant for the hardest problems (stuck after 2 attempts, major architecture, security-critical reasoning). Helpers do not spawn agents. You split work, check helper output, merge it, and own the result; your REPORT's "Helpers used" line covers them.
- To reach another section, SendMessage the supervisor (`main`) naming the section and the request; the supervisor forwards it and passes the answer back. If you cannot reach the supervisor, finish with `Status: blocked` and say what you need from which section. Record agreements in your REPORT's Coordination line.
- End with the REPORT block (§3.3). Nothing after it.

Roster (preloaded = verified skills; go-to = listed in body text):
| id | Kind | Colour | Preloaded skills | Go-to commands / skills | Suggested helper agents |
|---|---|---|---|---|---|
| frontend | builder | blue | frontend-design:frontend-design, modern-web-guidance:modern-web-guidance | /react-review | react-reviewer, typescript-reviewer, a11y-architect |
| backend | builder | green | anthropic-skills:backend-patterns, error-handling | — | code-reviewer, fastapi-reviewer, python-reviewer |
| database | builder | yellow | data:sql-queries | — | database-reviewer |
| testing | builder | cyan | tdd-workflow, e2e-testing, verification-loop | — | tdd-guide, e2e-runner, pr-test-analyzer, code-reviewer |
| security | builder | red | security-review, security-scan | — | security-reviewer, silent-failure-hunter |
| devops | builder | orange | anthropic-skills:docker-management, engineering:deploy-checklist | /build-fix | build-error-resolver |
| uiux | builder | pink | design:design-critique, design:accessibility-review, design:ux-copy | — | a11y-architect |
| docs | builder | purple | engineering:documentation | /update-docs | doc-updater |
| ai-llm | builder | purple | claude-api, eval-harness | — | rag-pipeline-reviewer |
| mobile | builder | green | — | /flutter-review, /kotlin-review | flutter-reviewer, swift-reviewer, kotlin-reviewer |
| ai-engineer | advisor | cyan | claude-api, council, architecture-decision-records | — | architect, code-explorer |
| data-scientist | advisor | yellow | data:statistical-analysis, data:explore-data, dataviz | — | code-explorer |

**Advisors are read-only for the project, not for their memory.**
- Frontmatter `tools:` allowlist: Read, Grep, Glob, WebSearch, WebFetch, Skill, SendMessage, Agent, Write, Edit (no Bash, PowerShell, NotebookEdit).
- `pre-tool-use.mjs` (classic PreToolUse): when `agent_type` is `section-team:ai-engineer` or `section-team:data-scientist` → deny Write/Edit unless the target path is inside that advisor's memory folder; deny Agent unless `subagent_type` ∈ `ADVISOR_HELPERS` = {architect, planner, code-explorer} (tools Read, Grep, Glob only; built-in Explore and Plan carry Bash and are excluded); deny Bash/PowerShell/NotebookEdit defensively.
- Advisors end with the same REPORT (`Changed: none`) and are saved and shown like sections.

### 3.3 Reports (`subagent-stop.mjs`)
REPORT block:
```markdown
## REPORT · <id> · <YYYY-MM-DD HH:MM>
Status:       done | partial | blocked
Job:          <one line>
Changed:      <files, or "none">
Tests:        <what ran, pass/fail, or "none">
Coordination: <who, what was agreed, or "none">
Helpers used: <model ×count (purpose), or "none">
Problems:     <or "none">
Next:         <or "none">
```
- Delivery to supervisor: automatic (completion notification).
- Saver: classic `SubagentStop` hook. Ignore events whose `agent_type` does not start with `section-team:` (this also skips empty types from internal agents). The payload carries no final text in this build (Phase 0 C2): read `agent_transcript_path` and take the last `SubagentHandback` tool_use `input.message`, else the last assistant text; use `last_assistant_message` first if a future build sends it. Find the `## REPORT` block; none → write nothing. Id = agent type minus prefix.
- Path: project root = main checkout (`git rev-parse --path-format=absolute --git-common-dir` → its parent; worktree-safe), else `cwd`. File `.team/reports/<YYYY-MM-DD>/<HHMMSS>-<id>.md`, local time; if it exists, append `-2`, `-3`… Never overwrite. Create folders as needed.
- Any error → log to stderr, exit 0. Never blocks the session.

### 3.4 Team Board (`register.js`, mods runtime)
- Pane `team-board`, opened by `/team`. Auto-open on first section spawn is attempted; Phase 0 records whether the desktop app shows it (the documented auto-open rule only covers terminal width). It opens at session start (user decision 2026-10-12, §9.3).
- Display only: plain Text in Box cards, no buttons.
- Model: pure function `boardModel(agents, latestReports) → { supervisor, sections[], advisors[] }`, stored in a `$.state` atom; a 1 s `$.clock.every` poll updates the atom (redraw follows automatically).
- Data: `$.agent.list()` (fields `id, type, status, name?`); section id from `type` minus prefix. Latest report per section: newest file in today's `.team/reports/` via `$.fs.list` / `$.fs.read`; show its Status and Job lines.
- Status → look:

| Agent state | Board |
|---|---|
| not in list | asleep · grey |
| pending, running | running · blue |
| waiting, idle | waiting · amber |
| completed + REPORT Status done | done · green |
| completed + REPORT Status partial/blocked, failed, killed | problem · red |

- Supervisor card: last user request (first line), counts (active / done / problem), time of last summary.
- Usage (user decision 2026-10-13): a section card adds `tokens <total> · out <output>` and `helpers <n> · <model>×<count> …`, each only when non-zero (the live helpers line replaces the report's "Helpers used" line on the card); the supervisor card adds `team tokens <sum> · <n> helpers`. Total = input + cache + output tokens of every model step of the section head and of every agent below it; helpers = agents the head spawned directly, by resolved model (haiku, sonnet, opus, fable). The hooks count `turn.step` results per agent and note each `agent.spawn` in the plugin (not in the stored board); the 1 s poll shows the sums. Counted since the session started; the supervisor's own steps and helpers are not.
- Layout: supervisor card on top; sections 3 per row when `bodyColumns ≥ 90`, else 2; advisors in their own row; legend line.

### 3.5 Section-to-section messaging
Decided by Phase 0 (C4): **relay**. Sections cannot address each other (no names; sibling agentIds unknown to them). A section sends its request to the supervisor (`main`, available to background subagents); the supervisor forwards it by SendMessage to the target section's agentId (waking it if asleep) and returns the answer. Criterion 4 tests this path.

## 4. Error handling
| Failure | Behaviour |
|---|---|
| Section turn ends on API error | Board red; supervisor resumes it once; second failure → tells user with the error |
| No REPORT block | Nothing saved; supervisor asks once |
| Hook script error | stderr log, exit 0; session continues |
| `.team/` missing | Created on first write |
| Board read fails | Box shows "unknown"; handlers never throw |
| Fable declined or unavailable | Head retries on opus and notes it in REPORT Problems |
| Plugin broken | Disable (§2) or `claude --safe-mode` |

## 5. Cost
- Sections sleep until needed; small tasks never wake one.
- Heads pinned to Opus 5.5 (user choice). Routing sends routine helper work to Haiku/Sonnet.
- **Fable**: in interactive sessions Claude Code asks for consent before a Fable request bills usage credits, and depending on plan it may bill credits instead of plan limits. Fable is for hard cases only; fallback is opus.
- Brief < 10,000 characters; role detail lives in agent files (loaded only when a section runs). Preloaded skills kept to 0–3 per head.

## 6. Testing
**Phase 0 spike (throwaway, before building).** Each check names its fallback.
1. Desktop app loads the plugin via `CLAUDE_CODE_PLUGIN_DIRS` → else local marketplace (§2).
2. SessionStart `additionalContext` reaches a desktop session on startup, `/clear` and compact.
3. A plugin head spawned as `section-team:<id>` runs on Opus 5.5 with memory and its preloaded skills (list what loaded) → else fix names / drop field.
4. A head spawns helpers with `model: haiku` and `model: fable`; both run on the requested model; observe the Fable consent prompt from inside a background subagent → else routing note in brief / fable-consultant agent file.
5. Head-to-head SendMessage, agent teams off: both running; target completed → else supervisor relay (§3.5).
6. A section reused via SendMessage fires a second completion notification and a second SubagentStop carrying the new REPORT → else spawn fresh each job.
7. SubagentStop payload has `agent_type` with prefix and `last_assistant_message` → else transcript fallback.
8. Advisor guard: Write in project denied, Write in memory folder allowed, Bash unavailable.
9. `$.agent.list()` entry shape in the installed build; board auto-open in desktop.

**Automated (`node --test`)**: REPORT parsing (valid, missing fields, none), id from agent type, path resolver (repo, worktree, non-repo), file naming collision, git-exclude idempotency + keep-in-git, advisor guard decisions, brief output shape.
**Automated (`claude plugin test`)**: `boardModel` state mapping, pane render on terminal and desktop surfaces.
**Static**: `claude plugin validate --strict`.
**Acceptance**: in a scratch git repo, a feature needing backend + frontend + testing: check criteria 1–9.

## 7. Build order (each step ends green)
1. Skeleton plugin + env loading; `validate --strict` clean.
2. Phase 0 spike; record results here; pick fallbacks.
3. `lib` helpers + `node --test`.
4. `session-start.mjs` + brief.
5. 12 agent files.
6. `subagent-stop.mjs`.
7. `pre-tool-use.mjs` advisor guard.
8. Board: `boardModel` + pane + `/team` + tests.
9. Acceptance run; disable test.

## 8. Out of scope
Agent teams; a browser web app; separate desktop sessions per section; messaging or buttons on the board; macOS/Linux/WSL; helpers spawning their own helpers.

## 9. User decisions (2026-10-12)
1. Precedence over global rules (§3.1): **yes** — sections do delegated work and use ECC agents as helpers; testing owns final review for multi-section tasks.
2. Fable (§5): **keep** for hard cases, with the consent prompt; opus fallback.
3. Board (§3.4): opens **automatically at session start** (changed 2026-10-12 from 'only on /team or first section'); `/team` reopens it.
4. Messaging (§3.5): supervisor relay is **acceptable** if direct section messaging fails Phase 0. Phase 0 result: relay is in use.

## 10. Risks
- Mods are new; API may shift → board logic in a pure function with tests.
- Twelve Opus heads + Fable → sleep-until-needed, routing, and plan-first gate.
- The user's many global instructions also load into heads → bodies short and directive; precedence rule (§9.1).
