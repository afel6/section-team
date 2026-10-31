# Quality Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each project run section-team in Lean, Balanced or Max mode, picked with one tap or `/team mode <name>`, and fix the reliability gaps the held-out round exposed.

**Architecture:** One pure module (`hooks/lib/mode.mjs`) owns the mode file format, the per-mode gate values and the picker labels; the Node hooks read the file with `fs`, the Mods UI with `$.fs`, both through the same parse/serialize functions. The supervisor brief is assembled at session start from a shared core plus the mode's tier and gate parts; a new UserPromptSubmit hook announces a mid-session switch once. The PreToolUse gate reads the same mode for its thresholds.

**Tech Stack:** Node.js built-ins (ESM `.mjs`, `node:test`), Claude Code hooks (command hooks in `hooks/hooks.json`), the Mods API (`hooks/register.tsx`, `claude plugin test`).

**Spec:** `docs/specs/2026-11-01-quality-modes-design.md`

## Global Constraints

- Modes are exactly `lean`, `balanced`, `max`; the file is `<project root>/.team/mode.json`, shape `{"mode": "<mode>", "autoInstallSkills": <bool>}` (both keys optional); a missing file or unknown mode means `balanced`.
- Gate values, exact: lean — pass at overall ≥ 8, 1 fix round, reviewer call with `model: "sonnet"`; balanced — pass at ≥ 8 with no item < 6, 2 fix rounds, no `model`; max — pass at ≥ 9 with no item < 7, 3 fix rounds, no `model`, and every near-miss copy must fail a test.
- The assembled Balanced brief equals the v0.1.1 `brief/supervisor.md` word for word; the assembled Max brief is at most 90 lines.
- Section memory scope is `local` (`.claude/agent-memory-local/<agent>/` in the project).
- Plugin version becomes `0.2.0` everywhere it is stated.
- Node built-ins only, no new dependencies; files 200–400 lines (800 max), functions under 50 lines, no mutation of inputs, one-line errors.
- Every task keeps `npm test`, `claude plugin validate --strict .` and `npm run test:board` passing.
- Work on branch `feat/quality-modes`; commit at the end of each task; never push or open a PR without the user's yes.
- The paid mode benchmark round (spec "Measurement" step 2) is a separate plan after this build; this plan only adds the harness setups it needs.

## Review Focus

1. **A hand-edited `.team/mode.json` with bad JSON, an unknown mode or a non-boolean `autoInstallSkills`** — Balanced and the env value are used, the session brief says once what was wrong, and no hook crashes. Tests in Task 1, Task 3 and Task 5.
2. **A session started in a subfolder of the project** — every hook and the Mods UI find the same `.team/mode.json` at the project root. Test in Task 3 (hooks) and Task 7 (UI).
3. **Two sessions open on one project when the mode changes** — each session announces the switch once, on its own next prompt. Test in Task 4.
4. **A session that started before the upgrade (no recorded mode)** — the first prompt records the mode silently; no false "Mode is now" message. Test in Task 4.
5. **A project folder that cannot be written** — `/team mode max` and the strip picker report one line and leave the old mode in place. Tests in Task 1 and Task 7.

---

### Task 1: The mode module

**Files:**
- Create: `hooks/lib/mode.mjs`, `tests/mode.test.mjs`

**Interfaces:**
- Produces:
  - `MODES: readonly ['lean', 'balanced', 'max']`, `DEFAULT_MODE = 'balanced'`
  - `GATES: Record<Mode, { passOverall: number, minItem: number|null, fixRounds: number, reviewerModel: 'sonnet'|null, nearMiss: boolean }>` with the Global Constraints values
  - `MODE_LABELS: Record<Mode, string>`: `'Lean · ~1.3× usage (target)'`, `'Balanced · ~2.2× usage (measured 2026-10)'`, `'Max · ~3–4× usage (target)'`
  - `parseModeFile(text: string|null) → { mode: Mode, autoInstallSkills: boolean|null, problem: string|null }` (null text = no file)
  - `serializeMode(previousText: string|null, mode: Mode) → string` (keeps `autoInstallSkills`; throws on an unknown mode)
  - `readMode(root: string) → { mode, autoInstallSkills, problem }` and `writeMode(root: string, mode: Mode) → void` (Node `fs`; write via temp file + rename; creates `.team/`)

- [ ] **Step 1: Write the failing tests** in `tests/mode.test.mjs`:
  - `parseModeFile(null)` → `{ mode: 'balanced', autoInstallSkills: null, problem: null }`
  - `parseModeFile('{"mode":"max","autoInstallSkills":false}')` → `{ mode: 'max', autoInstallSkills: false, problem: null }`
  - `parseModeFile('{"mode":"turbo"}')` → mode `balanced`, problem matching `/unknown mode "turbo"/`
  - `parseModeFile('{"mode":')` → mode `balanced`, problem matching `/not valid JSON/`
  - `parseModeFile('{"autoInstallSkills":"yes"}')` → `autoInstallSkills: null`, problem matching `/autoInstallSkills/`
  - `serializeMode('{"autoInstallSkills":true}', 'lean')` parses to `{ mode: 'lean', autoInstallSkills: true }`; `serializeMode(null, 'fast')` throws `/unknown mode/`
  - `writeMode(tmp, 'max')` then `readMode(tmp).mode === 'max'`; `writeMode` into a read-only or file-blocked `.team` (create a *file* named `.team`) throws, and `readMode` still returns the previous state
  - `GATES.max` deep-equals `{ passOverall: 9, minItem: 7, fixRounds: 3, reviewerModel: null, nearMiss: true }` (and the same exact check for lean and balanced)
- [ ] **Step 2:** `node --test tests/mode.test.mjs` → FAIL (module not found).
- [ ] **Step 3: Implement `hooks/lib/mode.mjs`** with the interfaces above; `readMode` maps `ENOENT` to the no-file case and any other read error to a problem string.
- [ ] **Step 4:** `node --test tests/mode.test.mjs` → PASS; `npm test` → PASS.
- [ ] **Step 5:** `git add hooks/lib/mode.mjs tests/mode.test.mjs && git commit -m "feat: per-project mode file and per-mode gate values"`

### Task 2: The brief in parts

**Files:**
- Create: `brief/core.md`, `brief/tiers-lean.md`, `brief/tiers-balanced.md`, `brief/tiers-max.md`, `brief/gate-lean.md`, `brief/gate-balanced.md`, `brief/gate-max.md`, `hooks/lib/brief.mjs`, `tests/brief.test.mjs`, `tests/fixtures/supervisor-v0.1.1.md` (a byte copy of today's `brief/supervisor.md`)
- Delete: `brief/supervisor.md`; update its mention in `CONTRIBUTING.md`

**Interfaces:**
- Consumes: `MODES`, `GATES` (Task 1)
- Produces: `assembleBrief(mode: Mode, briefDir?: string) → string`; `modeRules(mode: Mode, briefDir?: string) → string` (the tier and gate parts alone, for Task 4)

- [ ] **Step 1: Write the failing tests** in `tests/brief.test.mjs`:
  - `assembleBrief('balanced')` equals `tests/fixtures/supervisor-v0.1.1.md` trimmed, exactly
  - `assembleBrief('max').split('\n').length <= 90`
  - lean contains `model: "sonnet"`, `1 fix round` and the checklist line "give each spec line a test a plausible wrong implementation fails" and does not contain `wake only the testing section`
  - max contains `overall at least 9`, `no item under 7`, `3 fix rounds` and `near-miss`
  - every assembled brief states the mode's gate in the job-message rule: contains `Every job message states this mode's gate`
  - `modeRules('max')` contains the max tier and gate text and not the core's `## Sections` heading
- [ ] **Step 2:** `node --test tests/brief.test.mjs` → FAIL.
- [ ] **Step 3: Split and write the parts.** `brief/core.md` is today's brief with the "When to wake sections" bullets replaced by the line `{{TIERS}}` and the "Your own code" bullets replaced by `{{GATE}}`; `tiers-balanced.md` and `gate-balanced.md` hold the removed text unchanged. Write lean and max parts from the spec's mode table in the same voice; each gate part ends with "Every job message states this mode's gate (pass mark, fix rounds[, the near-miss check]) so the section applies it." — for balanced, that sentence goes in the core instead, so the Balanced text stays word for word. Implement `assembleBrief` as marker replacement.
- [ ] **Step 4:** `node --test tests/brief.test.mjs` → PASS; `npm test` → PASS (until Task 3, `session-start.mjs` still reads `brief/supervisor.md`: change its read to `assembleBrief('balanced')` in this task so nothing breaks).
- [ ] **Step 5:** commit `feat: assemble the supervisor brief from a core and per-mode parts`

### Task 3: Session start reads the mode

**Files:**
- Modify: `hooks/session-start.mjs`, `tests/session-start.test.mjs`

**Interfaces:**
- Consumes: `readMode` (Task 1), `assembleBrief` (Task 2)
- Produces: `modeRecordDir(home) → string` (`<home>/.claude/section-team/modes`); `recordMode(home, sessionId, mode) → void`; `buildContext(cwd, home, env, sessionId?)` returns the assembled brief for the project's mode plus a `## Mode` section

- [ ] **Step 1: Failing tests** (`tests/session-start.test.mjs`):
  - with `.team/mode.json` `{"mode":"max"}` at the repo root and `cwd` a subfolder: the context contains `overall at least 9` and `## Mode` with `This project runs in Max mode (from .team/mode.json).`
  - with no file: contains `This project runs in Balanced mode (default).`, and the rest equals the v0.1.1 brief
  - `autoInstallSkills: false` in the file with `env` `SECTION_TEAM_AUTO_INSTALL_SKILLS=1`: no `Automatic skill installs are on`, and `## Mode` says `Automatic skill installs: off (from .team/mode.json).`; with no file and env `1`: `on (from SECTION_TEAM_AUTO_INSTALL_SKILLS)`
  - a bad mode file: Balanced, and the context contains the problem line once
  - with a `sessionId`, `recordMode` leaves `<home>/.claude/section-team/modes/<sessionId>.json` holding `{"mode":"max"}`; old records are pruned with the existing `pruneStatus`
  - a failing side effect still returns the brief, and `main` adds a one-line `systemMessage` naming it (no silent failure)
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** `main` passes `input.session_id`; side-effect failures collected by `attempt` become one `systemMessage` line in the hook output.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** commit `feat: session start uses the project's mode and states it`

### Task 4: Mid-session switch hook

**Files:**
- Create: `hooks/user-prompt-submit.mjs`, `tests/user-prompt-submit.test.mjs`
- Modify: `hooks/hooks.json` (add `UserPromptSubmit` running `user-prompt-submit.mjs` like the other hooks)

**Interfaces:**
- Consumes: `readMode` (Task 1), `modeRules` (Task 2), `recordMode`, `modeRecordDir` (Task 3)
- Produces: `modeSwitch(e: { cwd, session_id }, home) → string|null`

- [ ] **Step 1: Failing tests:**
  - recorded `balanced`, file now `max` → returns text starting `Mode is now Max (was Balanced). From your next step on:` followed by `modeRules('max')`; the record now says `max`; a second call returns `null`
  - two session ids on one project, both recorded `balanced`, file switched to `lean` → each returns the notice once
  - no record (session older than the upgrade) → returns `null` and writes the record
  - a bad mode file or an unwritable record folder → returns `null` and the hook's output carries one `systemMessage` line
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement**; output `{ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } }` only when there is a notice.
- [ ] **Step 4:** `npm test` and `claude plugin validate --strict .` → PASS.
- [ ] **Step 5:** commit `feat: announce a mode switch on the next prompt`

### Task 5: The gate follows the mode

**Files:**
- Modify: `hooks/lib/report.mjs`, `hooks/pre-tool-use.mjs`, `tests/report.test.mjs`, `tests/pre-tool-use.test.mjs`

**Interfaces:**
- Consumes: `readMode`, `GATES` (Task 1)
- Produces: `failsGate(report, passOverall = PASS_OVERALL)`; `parseReport` recognises `Status: ungraded`; `needsGate`/`failsGate` treat `ungraded` like `partial` (an honest way out); `gateReasons(gate) → { ungraded: string, failing: string }`

- [ ] **Step 1: Failing tests:**
  - `parseReport('Status: ungraded — no Agent tool\nChanged: a.mjs\nQuality: n/a').status === 'ungraded'`, and `needsGate` is false for it
  - in a project whose mode file says `max`, a builder handback with `Quality: 8/10` and status done is refused, the reason names `9/10` and `3 fix rounds`; the same handback in a `balanced` project passes
  - in a `lean` project the ungraded reason says to pass `model: "sonnet"` and `at most 1 fix round`; in balanced and max it says `do not pass \`model\``
  - every reason says to hand back `Status: ungraded` when the gate truly cannot run
  - a bad mode file → Balanced thresholds, no throw
  - when the hook itself fails (stdin is not JSON), its output carries one `systemMessage` line instead of only a stderr line
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement**; `handbackGate` reads `readMode(projectRoot(e.cwd))`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** commit `feat: the handback gate uses the project's mode; ungraded is an honest status`

### Task 6: Sections: per-project memory, ungraded, mode gate

**Files:**
- Modify: every `agents/*.md` with `memory: user` (12 files), `hooks/pre-tool-use.mjs` (`isInMemory`), `hooks/subagent-stop.mjs`, `tests/agents.test.mjs`, `tests/pre-tool-use.test.mjs`, `tests/subagent-stop.test.mjs`

**Interfaces:**
- Consumes: `parseReport` with `ungraded` (Task 5)
- Produces: `isInMemory(target, id, cwd)` checks `<project root>/.claude/agent-memory-local/<id or section-team-id>/`

- [ ] **Step 1: Failing tests:**
  - `tests/agents.test.mjs`: every section file has `memory: local`; none has `memory: user`; every builder file contains `If the job states a mode gate, it replaces the numbers here` and `Status: ungraded`
  - `tests/pre-tool-use.test.mjs`: an advisor may write `<root>/.claude/agent-memory-local/section-team-ai-engineer/x.md` and may not write `~/.claude/agent-memory/...` or `<root>/.claude/agent-memory-local/../settings.json`
  - `tests/subagent-stop.test.mjs`: a saved REPORT with `Status: ungraded` is saved; a save that fails (the reports path is a file) prints one `systemMessage` line instead of failing silently
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement**: frontmatter to `memory: local`; one sentence in each builder's gate rule (the job's mode gate wins; with no Agent tool, finish `Status: ungraded` and say why); `isInMemory` re-rooted at the project.
- [ ] **Step 4:** `npm test` and `claude plugin validate --strict .` → PASS.
- [ ] **Step 5:** commit `fix: sections keep memory per project and report an ungraded gate honestly`

### Task 7: The picker: strip and `/team mode`

**Files:**
- Modify: `hooks/register.tsx`, `tests/board.test.tsx`

**Interfaces:**
- Consumes: `MODES`, `MODE_LABELS`, `parseModeFile`, `serializeMode` (Task 1)
- Produces: one async helper in `register.tsx`, `setMode($, mode) → Promise<string>` (reads, serializes and writes `<root>/.team/mode.json` with `$.fs`, the root from the existing git-root lookup; returns the line to show), used by both the strip and the command

- [ ] **Step 1: Probe (no commit):** add a `Select` with three static options to the strip, run `claude plugin validate --strict .` and `npm run test:board`. If the strip cannot hold a `Select`, use the fallback: a Button labelled `● <Mode>` that runs `$.command.run({ command: 'team', args: 'mode' })`. Record which one in the commit message.
- [ ] **Step 2: Failing tests** in `tests/board.test.tsx`:
  - `/team mode max` writes `{"mode":"max"}` at the project root (session cwd a subfolder) and returns text `section-team mode: Max (applies from your next message)`
  - `/team mode` returns the current mode and the three `MODE_LABELS`
  - `/team mode turbo` returns `unknown mode "turbo": pick lean, balanced or max` and writes nothing
  - `/team` (no args) opens the board as today
  - a write that fails (`.team` is a file) returns one line starting `section-team mode: could not save` and leaves the old file
  - the strip draws the mode picker with the current mode selected; picking `lean` writes the file
- [ ] **Step 3:** run `npm run test:board` → FAIL.
- [ ] **Step 4: Implement**; the command's description becomes `Show the Team Board, or set this project's mode: /team mode lean|balanced|max`.
- [ ] **Step 5:** `npm run test:board`, `npm test`, `claude plugin validate --strict .` → PASS.
- [ ] **Step 6:** commit `feat: pick the project's mode from the team strip or /team mode`

### Task 8: Benchmark setups for the modes

**Files:**
- Modify: `bench/run.mjs`, `bench/anonymize.mjs`, `bench/run.test.mjs`, `bench/anonymize.test.mjs`

**Interfaces:**
- Produces: setups `lean` and `max` in `CONDITIONS` (condition labels `lean-<tag>`, `max-<tag>`); `builderArgs` treats them like `team`; `runOne` writes `.team/mode.json` into the fresh run folder for them; `LABELS` becomes `['X', 'Y', 'Z', 'W']`

- [ ] **Step 1: Failing tests:**
  - `plan({ conds: ['solo', 'lean', 'team', 'max'], tasks: ['h1'], reps: 1 })` yields four runs with conds `solo`, `lean`, `team`, `max`
  - a helper `modeFileFor(base) → string|null` returns `'{"mode":"lean"}\n'` for `lean`, `'{"mode":"max"}\n'` for `max`, `null` for `team`, `solo`, `forced`
  - `anonymize` with four conditions labels them X, Y, Z, W; the round-17 key test still passes
- [ ] **Step 2:** `node --test bench/*.test.mjs` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `node --test bench/*.test.mjs` → PASS.
- [ ] **Step 5:** commit `feat(bench): lean and max setups and a fourth judge label`

### Task 9: Docs and version

**Files:**
- Modify: `README.md`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `package.json`, `CONTRIBUTING.md`

- [ ] **Step 1:** README: a **Modes** section (the three modes, the picker, `/team mode`, the cost labels with "target" vs "measured"), a **Memory** note (sections now keep memory per project in `.claude/agent-memory-local/`; old notes stay in `~/.claude/agent-memory/section-team-*`, and copying a folder into a project's `.claude/agent-memory-local/` brings it into that project), and the `ungraded` status in the reports section.
- [ ] **Step 2:** version `0.2.0` in `plugin.json`, `marketplace.json` and `package.json`; `npm test` (the marketplace test checks they agree) → PASS.
- [ ] **Step 3:** final checks: `npm test`, `node --test bench/*.test.mjs`, `claude plugin validate --strict .`, `npm run test:board` → all PASS.
- [ ] **Step 4:** commit `docs: modes, per-project memory and 0.2.0`
- [ ] **Step 5:** after the branch is merged (the user's call), the `v0.2.0` tag becomes the plugin freeze for the mode benchmark round; tagging and pushing it needs the user's yes.
