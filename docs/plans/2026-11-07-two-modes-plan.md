# Two Modes That Keep Their Promise: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Lean, rebuild Max, send every job to a section, start the platform flow when work first spans two areas, then measure Balanced and Max on p1.

**Architecture:** The changes are text rules in brief/ and the foundation skill, plus mode data in hooks/lib/mode.mjs, one hook rule (Max grades every changed file), the board's mode picker, and the harness's mode lists and stage limit. The proof round reuses the p1 harness.

**Tech Stack:** Node ESM, `node:test`, the plugin's hooks, agent generator and board (tsx). No new dependency.

**Spec:** `docs/specs/2026-11-07-two-modes-design.md`

## Global Constraints

- **Repo and branch:**
  - Branch `fix/fresh-section-per-job`, PR 16; no new PR, no merge, tag or release without the user's yes.
  - Push the same branch only after all local checks pass.
  - Plugin version 0.3.0.
- **Paid runs:** any paid `claude` run needs the user's yes with its figure. The user's stop is 97% of the weekly limit.
- **Real user data is off limits:** `~/.claude/agent-memory`, `~/bench-section-memory-backup`, `C:/Users/Asus/section-memory-recovered-2026-11-05`, `C:/Users/Asus/claude-team` and every `C:/Users/Asus/claude-team-*` worktree other than claude-team-cloud. Never list them either.
- **Tests:** run them only through `bash C:/Users/Asus/AppData/Local/Temp/claude/fe4a2665bbce10fb/ee676256-31af-4e3b-9d52-82db522e5bdc/scratchpad/bench-in-fake-home.sh [files]`, with `tests/*.test.mjs` for the plugin; run both suites before each commit.
- **Size caps:** each mode's brief stays under 9000 characters, and session start's whole context under 10,000.
- **Models:** never pass `model` for section-team agents.
- **Modes:**
  - The modes are `balanced` (default) and `max`.
  - A saved `lean` runs as Balanced, with the session-start line `Lean was removed in 0.3.0; this project runs Balanced until you pick a mode.`
- **Max gate:**
  - pass at least 9 overall and no item under 7, at most 2 fix rounds;
  - every hand-back with a changed file needs a grade, docs and config included;
  - no near-miss copies;
  - a security pass;
  - two independent final reviews;
  - the supervisor drives every critical flow itself before done.
- **Max's stage limit:** 2 × the task's `TIMEOUT_MIN`.
- **Git:** LF line endings, conventional commits, no attribution lines, normal hooks.

## Review Focus

1. **A project saved as `lean`.** It must start, run as Balanced, and show the line once per session start. It must never crash or block (Task 1).
2. **A docs-only REPORT.** It is refused without a grade in Max and accepted without a grade in Balanced; `partial`, `blocked` and `ungraded` stay open in both (Task 4).
3. **A one-line fix in Balanced.** It goes to a builder section, not the supervisor, and the supervisor's brief has no sentence left telling it to build (Task 2).
4. **A request that adds a dashboard to an existing API.** It loads the foundation skill and wakes `plan-advisor`. A later request inside the same areas does not (Task 3).
5. **Max's brief.** It must not still mention near-miss copies anywhere: brief, agents, foundation skill, README (Task 4).

---

### Task 1: Remove Lean

**Files:**
- Modify:
  - `hooks/lib/mode.mjs`: `MODES`, `GATES`, labels and the unknown-mode error text;
  - `hooks/mode-lines.mjs`, `hooks/register.tsx`, `hooks/sessions-model.mjs`, `hooks/user-prompt-submit.mjs`, `hooks/subagent-stop.mjs`, `hooks/pre-tool-use.mjs`;
  - `scripts/gen-agents.mjs` and `skills/add-skill/SKILL.md`, wherever they name Lean;
  - `.claude-plugin/plugin.json` to 0.3.0;
  - `README.md` Modes.
- Delete: `brief/tiers-lean.md`, `brief/gate-lean.md`
- Modify (bench): `bench/run.mjs`, where `ROUND_CONDS` becomes `['solo', 'team', 'max']`. `CONDITIONS` keeps `lean` so old results still read.
- Test: `tests/mode.test.mjs`, `tests/mode-lines.test.mjs`, `tests/mode-record.test.mjs`, `tests/session-start.test.mjs`, `tests/user-prompt-submit.test.mjs`, `tests/board.test.tsx`, `tests/mode-picker.test.tsx`, `bench/run.test.mjs`, `bench/preflight.test.mjs`

**Interfaces:**
- Produces:
  - `MODES = ['balanced', 'max']`.
  - `readMode()` turns a stored `lean` into `{ mode: 'balanced', modeUsable: true, retired: 'lean' }`.
  - Session start adds the Global Constraints line when `retired` is set.

- [ ] **Step 1: Write failing tests.**
  - `MODES` deep-equals `['balanced', 'max']`.
  - A mode file with `lean` gives Balanced plus the exact line.
  - The picker lists two modes.
  - `/team` mode commands refuse `lean` with one friendly line.
  - A round's `ROUND_CONDS` is solo, team, max.
- [ ] **Step 2: Implement, regenerate agents, and run both suites.** For the `.tsx` board tests, use the project's tsx runner as `npm run test:board`, under a temp HOME.
- [ ] **Step 3: Commit** `feat!: remove Lean; Balanced and Max are the modes (0.3.0)`.

### Task 2: Every job goes to a section

**Files:**
- Modify: `brief/tiers-balanced.md` and `brief/tiers-max.md` (the Small task and Single-area lines), `brief/core.md` (any sentence telling the supervisor to build), `README.md`
- Test: `tests/session-start.test.mjs`, `tests/brief.test.mjs`, `tests/fixtures/supervisor-balanced.md`

**Interfaces:**
- Produces: the Small and Single-area lines both open with `Wake the matching builder section; it writes the code, its tests and any README asked for, and runs its own gate.`

- [ ] **Step 1: Pin the line and assert that no sentence in either mode's brief tells the supervisor to build.** Watch both fail.
- [ ] **Step 2: Edit, keeping each brief under 9000 characters.**
- [ ] **Step 3: Run both suites, then commit** `feat: send every job to a section so the supervisor's chat stays small`.

### Task 3: Start the platform flow when work first spans two areas

**Files:**
- Modify: the foundation line in `brief/tiers-balanced.md` and `brief/tiers-max.md`, and `skills/foundation/SKILL.md` (its description and first paragraph, and a line for an existing product)
- Test: `tests/platform-quality.test.mjs`, `tests/session-start.test.mjs`

**Interfaces:**
- Produces:
  - The tiers line: `When the work first spans two or more builder areas (a new platform, or a request that adds a second area to an existing product), load the section-team:foundation skill before you wake anyone; work inside the areas its note already covers does not load it again.`
  - The skill line: `For an existing product, write the note from the current code and the new request.`

- [ ] **Step 1: Pin both lines and the skill's description trigger, and watch them fail.**
- [ ] **Step 2: Edit, then run both suites.**
- [ ] **Step 3: Commit** `feat: start the platform flow when work first spans two areas`.

### Task 4: Rebuild Max

**Files:**
- Modify:
  - `brief/tiers-max.md` and `brief/gate-max.md`: remove near-miss copies; pass 9 with no item under 7; 2 fix rounds; security pass before the final review; two final reviews by fresh testing sections, the second not shown the first's REPORT; the supervisor drives every critical flow itself before done; every changed file graded;
  - `hooks/lib/mode.mjs` `GATES.max`: `{ passOverall: 9, minItem: 7, fixRounds: 2, nearMiss: false, gradeAll: true }`;
  - `hooks/pre-tool-use.mjs` `handbackGate`: in a gate with `gradeAll`, a REPORT whose Changed names any file needs a grade;
  - `scripts/gen-agents.mjs`: the reviewer line `For docs or config, score only the items that apply and write n/a for the rest.`, and any near-miss text;
  - `README.md` Modes.
- Test: `tests/pre-tool-use.test.mjs`, `tests/mode.test.mjs`, `tests/session-start.test.mjs`, `tests/agents.test.mjs`

**Interfaces:**
- Consumes: Task 1's `GATES` shape.
- Produces: `gradeAll` is read only by `handbackGate`.

- [ ] **Step 1: Write failing tests.**
  - In Max, a done REPORT changing only `README.md` with no grade is refused with the existing ungraded text.
  - In Balanced, the same REPORT passes.
  - In Max, `partial` passes.
  - Max's brief contains neither `near-miss` nor `3 fix rounds`, and holds the three proof-step sentences.
- [ ] **Step 2: Implement, regenerate agents, run both suites, and check brief sizes.**
- [ ] **Step 3: Commit** `feat: rebuild Max as Balanced plus proof steps and harsh grading on every file`.

### Task 5: Max's stage limit in the harness

**Files:**
- Modify: `bench/run.mjs` (`runOne`'s default `timeoutMs`), through a new `timeoutFor(task, base)`
- Test: `bench/run.test.mjs`

**Interfaces:**
- Produces: `timeoutFor(task, base) → minutes`, which is `TIMEOUT_MIN[task] × (base === 'max' ? 2 : 1)`.

- [ ] **Step 1: Write failing tests.** `timeoutFor('p1', 'max') === 120`, `timeoutFor('p1', 'team') === 60`, and `timeoutFor('p1', 'solo') === 60`.
- [ ] **Step 2: Implement, run the bench suite, then commit** `feat: give Max twice the stage limit in the benchmark`.

### Task 6: The second proof round (paid: about $120; needs the user's yes)

- [x] **Step 1: Run all local checks, then push and wait for CI to be green.**
- [x] **Step 2: Run the round.** Make a new pin worktree at the head and one preflight with a new tag. Then 2 runs each of solo, team and max on p1, all stages, one at a time, checking usage before each run, with the user's 97% stop.
- [x] **Step 3: Score every run alone,** then run anonymize, the leak scan, `external-judge prepare` and `codex-judge`, with both orders.
- [x] **Step 4: Compare with the spec's targets.** Include the supervisor's peak and whether `plan-advisor` ran at stage 2. Write the table into README Results and this plan, and commit `docs: record the second p1 proof round`.

**Evidence (2026-11-09, plugin 5b9ba51, round tag `tm`, CLI 2.1.318, Codex judge CLI 0.167 at gpt-6.1-sol, effort ultra, 4 cases in two orders):**

| | Run 1 | Run 2 | Mean | Target | Result |
|---|---|---|---|---|---|
| Solo cost | $4.27 | $3.50 | $3.89 | | |
| Solo hidden (of 264) | 264 | 264 | 264 | | |
| Solo judged | 7, 7 | 7, 8 | 7.25 | | |
| Balanced cost | $15.50 | $16.42 | 4.1× solo | ≤ 5× | met |
| Balanced hidden | 262 | 261 | 261.5 | ≥ solo (264) | missed |
| Balanced judged | 8, 9 | 8, 8 | 8.25 | ≥ solo + 1.5 (8.75) | missed |
| Balanced longest stage | 20.4 min | 23.0 min | | ≤ 60 | met |
| Balanced supervisor peak | 117K | 115K | | < 150K | met |
| Max cost | $34.93 | $37.45 | 9.3× solo | reported | |
| Max hidden | 262 | 262 | 262 | ≥ Balanced (261.5) | met |
| Max judged | 8, 8 | 9, 9 | 8.5 | ≥ Balanced + 0.25 (8.5) | met, at the bar |
| Max longest stage | 43.2 min | 54.9 min | | ≤ 120 | met |
| Max supervisor peak | 171K | 176K | | < 150K | missed |
| `plan-advisor` at stage 2 | yes, yes (Balanced); yes, yes (Max) | | | every team run | met |
| No high security finding in Max | security section stopped at start both runs | | | none | not measurable |
| User data | section notes still 137 files | | | none read, moved or lost | met |

- Judged columns list each run's two cases (one per order). Ranked first: Balanced in both p1-r1 cases, Max in both p1-r2 cases, solo never; the pair winner was the same in both orders.
- Hidden failures: "every value is shown as plain text, never as HTML" (stage 2 and its stage-3 regression) in Balanced run 1 and both Max runs, because the page type-checked the report reply (`typeof … === 'number'`) and drew nothing for string counts; "invalid UTF-8 inside a string is replaced, not refused" in Balanced run 2. Both are checks the spec does not state.
- Shared defects Codex found in every setup, solo included: valid ticket ids above 2^53 return 500 in every run but Max run 2, and a summary that overlaps an edit can return the old title with an audit order no serial run gives.
- The leak scan found one tell, a `.team/notes` comment in one Max copy; left unedited, as in the mode round.
- After the round, f7787b0 fixed the security start (`security-review` is no longer preloaded and loads only when `git merge-base HEAD origin/HEAD` succeeds) and the unstated checks (house rules, reviewer rubric, gate and supervisor lines), and Max's supervisor now runs the testing section's one flow command. Unmeasured: another round costs about $112.

### Task 7: Report

- [ ] **Step 1: Update PR 16's description.** Show the user the text first.
- [ ] **Step 2: Give the final harsh grade and the open items,** and ask about merging.
