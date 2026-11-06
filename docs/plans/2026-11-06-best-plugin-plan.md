# Each Mode Keeps Its Promise: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove, on a platform-sized benchmark, that Lean, Balanced and Max each meet their cost and quality targets, and add a plan check and a skill search to the platform flow.

**Architecture:** The benchmark harness learns tasks with any number of stages (h7 keeps 2; the new task p1 has 3). p1 is a help-desk platform with hidden tests per stage, a fake model server and calibrated reference versions. Cost cuts and the two plugin features are text rules plus small code. Each one is measured on p1 before it stays.

**Tech Stack:** Node ESM, `node:test`, `node:sqlite`, the Claude Code plugin hooks and agent files already in this repo. No new dependency.

**Spec:** `docs/specs/2026-11-06-best-plugin-design.md`

## Global Constraints

- Branch `fix/fresh-section-per-job`, PR 16. No new PR, no merge, tag or release without the user's yes. Push only the same branch, after all local checks pass.
- Any command that starts a paid `claude` (preflight, a batch, judge.mjs) needs the user's yes, given with its figure. Stop paid steps at 90% of the weekly limit.
- Real user data is off limits: `~/.claude/agent-memory`, `~/bench-section-memory-backup`, `C:/Users/Asus/section-memory-recovered-2026-11-05`, `C:/Users/Asus/claude-team`, and any plugin worktree a pin names.
- Run tests only through `bash C:/Users/Asus/AppData/Local/Temp/claude/fe4a2665bbce10fb/ee676256-31af-4e3b-9d52-82db522e5bdc/scratchpad/bench-in-fake-home.sh [files]`, with `tests/*.test.mjs` in place of `npm test`. Its real-note count must not change.
- Each mode's brief stays under 9000 characters, and session start's whole context under 10,000.
- Never pass `model` for section-team agents (the user's rule). The reviewer gate for own code passes `model: "sonnet"` only in Lean, as now.
- h4 stays frozen. h7's behaviour, prompts, hidden sets and scores stay as they are.
- Benchmark tasks use Node built-ins only, with `node:sqlite`, and no npm install.
- p1's hidden cases come from p1's task text alone. Nothing that writes them may open `~/bench-runs`, `C:/Users/Asus/bench-results-*`, `bench/results` or any run's output.
- Trusted skill sources: `anthropics`, `vercel-labs`, `microsoft`, plus owners the user adds to `skills/add-skill/trusted-sources.json`.
- `section-team:plan-advisor` is read-only and returns at most 8 fixes, each with its reason.
- The mode targets, counting the mean of 2 runs against solo on p1:
  - **Lean:** cost ≤ 2×; hidden tests ≥ solo; judged quality ≥ solo + 1.0.
  - **Balanced:** cost ≤ 3.5×; hidden tests ≥ Lean; judged quality ≥ solo + 1.5.
  - **Max:** cost uncapped; hidden tests ≥ Balanced; judged quality ≥ Balanced; no high-severity security finding.
  - **Every mode:** each stage within its time limit, and the supervisor chat under 150K tokens.
- LF line endings. Conventional commits, no attribution lines, normal hooks.

## Review Focus

1. **A run that stops in stage 2 of 3.** It must not pay for stage 3. Its s3 and reg3 count as failed, and scoring must not crash (Tasks 2 and 3).
2. **h7 after the harness changes.** Rescoring the saved h7 runs must give the same numbers as before: solo 148/148, team 99/148 (Task 3).
3. **The fake model server's port.** Hidden sets bind port 0 and pass `MODEL_URL` in. Nothing may depend on port 3000 or on a fixed port (Task 6).
4. **A look-alike skill owner.** `anthropic`, `vercel-lab`, `microsoft-x` and the same names in other cases are not trusted, and a clean review of an untrusted skill still asks the user (Task 13).
5. **The plan advisor's reach.** It writes nothing outside its memory folder, and it runs only on platform work, never on a single-area task (Task 12).

---

## Phase 1: harness for tasks with N stages (free)

### Task 1: A stage registry

**Files:**
- Create: `bench/stages.mjs`
- Modify: `bench/run.mjs:51-56` (remove `TWO_STAGE_TASKS`, `isTwoStage` and `HIDDEN_SETS`, and import from `stages.mjs`), `bench/run.mjs:287-288` (taskFiles)
- Test: `bench/stages.test.mjs`

**Interfaces:**
- Produces:
  - `STAGES = { h7: 2, p1: 3 }`
  - `stageCountOf(task) → number`: 1 for any task not in STAGES
  - `isStaged(task) → boolean`
  - `stagePromptFile(task, stage) → string`: `tasks/<task>.md` for stage 1, else `tasks/<task>-s<stage>.md`
  - `hiddenSetsOf(task) → [{ set, from }]`, where `from` is `'s1' | 's2' | 'final'`, the folder the set runs on. h7 gives `[s1:s1, s2:final, reg:final]`. p1 gives `[s1:s1, s2:s2, s3:final, reg2:s2, reg3:final]`.
  - `stageCopyOf(dir, stage) → '<dir>-s<stage>'`

- [ ] **Step 1: Write failing tests.**
  - `stageCountOf('h7') === 2`, `stageCountOf('p1') === 3`, `stageCountOf('h4') === 1`.
  - `stagePromptFile('p1', 3) === 'tasks/p1-s3.md'`.
  - `hiddenSetsOf('h7')` deep-equals the h7 list above, and `hiddenSetsOf('p1')` the p1 list.
  - `hiddenSetsOf('h4')` is `[]`.
- [ ] **Step 2: Run the tests through the wrapper and see them fail.**
- [ ] **Step 3: Implement `bench/stages.mjs`.** Rewire `run.mjs`'s taskFiles to list every stage prompt and every set file.
- [ ] **Step 4: Run all bench tests.** Every existing h7 test passes unchanged.
- [ ] **Step 5: Commit** `refactor: describe staged benchmark tasks in one registry`.

### Task 2: run.mjs runs N stages, and can stop early

**Files:**
- Modify: `bench/run.mjs` (`twoStages` becomes `stagedRun`; `parseArgs` gains `--stages=<n>`)
- Test: `bench/run-stages.test.mjs`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `stagedRun(claude, { run, outDir, dir, sessionId, attempt, ctx, upTo })`
  - `parseArgs(...).stages`: a whole number from 1 to `stageCountOf(task)`, or null for all stages.
  - Per stage k, the run writes `raw-s<k>.json`, `stderr-s<k>.txt`, git tag `stage-<k>` and the copy `<dir>-s<k>` (for each k below the last), and `run.json.stages[k-1]`.

- [ ] **Step 1: Write failing tests with the existing fake spawn.**
  - A 3-stage run that ends ok writes `raw-s1..3`, copies `-s1` and `-s2`, tags `stage-1..3`, and resumes stages 2 and 3 with `--resume <same session>`.
  - A run whose stage 2 times out starts no stage 3 and records 2 stages.
  - `--stages=1` on p1 runs stage 1 only.
  - `--stages=4` on p1 is refused before any spawn.
  - `--stages=` on a 1-stage task is refused.
- [ ] **Step 2: Run them and see them fail.** Then implement, keeping h7's file names and messages as they are.
- [ ] **Step 3: Run all bench tests, then commit** `feat: run benchmark tasks with any number of stages`.

### Task 3: Scoring, calibration and judging per stage

**Files:**
- Modify: `bench/score.mjs` (`hiddenSets` and `stageChange`, from Task 1's `hiddenSetsOf`), `bench/calibrate.mjs:71-72` (`reference-s<k>` and `near-miss-s<k>` for k below the last stage), `bench/judge.mjs:276` (join every stage's prompt in order)
- Test: `bench/score.test.mjs`, `bench/calibrate.test.mjs`, `bench/judge.test.mjs`

**Interfaces:**
- Produces:
  - `metrics.stages = [{ stage, change, calls }]` for stages 2 and up. `metrics.stage2` stays, equal to `metrics.stages[0]`, so h7 reports do not change.
  - A set whose source folder is missing, because the run stopped earlier, counts every one of its tests as failed, as h7's s2 does now.
  - `metrics.mainPeak` is the largest context of any main-session turn (input plus cache read plus cache creation), for the 150K target.

- [ ] **Step 1: Write failing tests.**
  - p1's five sets run on the folders Task 1 names.
  - A p1 run that stopped after stage 2 fails s3 and reg3 and scores the rest.
  - calibrate lays `near-miss-s2/<name>` on `reference-s2` for s2 and reg2.
  - The judge prompt for p1 holds stage 1, 2 and 3 in order.
  - `mainPeak` of a fixture transcript whose turns have contexts 40K, 90K and 60K is 90,000.
- [ ] **Step 2: Implement, then run all bench tests.**
- [ ] **Step 3: Rescore the saved h7 runs alone.** Run `BENCH_RESULTS=C:/Users/Asus/bench-results-rd node bench/score.mjs`. It is free, but nothing else may run at the same time. Expected: `h7-solo-rd-r1 hidden 148/148` and `h7-team-rd-r1 hidden 99/148`, as before this phase.
- [ ] **Step 4: Commit** `feat: score, calibrate and judge every stage of a staged task`.

## Phase 2: task p1, a help-desk platform (free)

### Task 4: p1's task text

**Files:**
- Create: `bench/tasks/p1.md`, `bench/tasks/p1-s2.md`, `bench/tasks/p1-s3.md`

These follow h7.md's form: a numbered list of exact requirements, every value stated exactly, and every error reply given as status plus body. They hold the spec's content:

- **Stage 1:**
  - users and sessions, with scrypt hashes from `node:crypto`;
  - the roles `admin` and `member`;
  - tickets with comments, and an audit log;
  - a role check on every route;
  - a login rate limit, with the window and count stated;
  - no password or token in any log or reply.
- **Stage 2:** a dashboard page and a reporting API: counts by status, filters, an SVG chart, members limited to their own tickets.
- **Stage 3:** summarise and categorise through `MODEL_URL`, with:
  - a time limit in milliseconds;
  - a retry count;
  - the output checks (shape and length);
  - the leak rule against an injected ticket;
  - what a failed model call returns.
- **Every stage:** the startup and error rules, written the way h7 writes them.

- [ ] **Step 1: Write the three files.** Each line is one requirement a test can check.
- [ ] **Step 2: Have read-only Codex check that no line can be read two ways.** Rewrite any line it flags, or list it as ambiguous in Task 5's coverage table.
- [ ] **Step 3: Commit** `docs: add task p1, a three-stage help-desk platform`.

### Task 5: Hidden sets and a coverage table

**Files:**
- Create: `bench/hidden/p1/{lib.mjs, stage-one-cases.mjs, stage-two-cases.mjs, s1.test.mjs, s2.test.mjs, s3.test.mjs, reg2.test.mjs, reg3.test.mjs}`, `docs/plans/p1-hidden-coverage.md`

**Interfaces:**
- Consumes: Task 6's `startModel`.
- Produces: `reg2` runs stage-one cases on the `-s2` folder; `reg3` runs stage-one and stage-two cases on the final folder.

- [ ] **Step 1: Make the coverage table.** It maps every requirement line of the three task files to its cases, and lists the ambiguous lines.
- [ ] **Step 2: Write the cases** in h7's style, with temp folders, port 0, and exact equality on every value the text names.
- [ ] **Step 3: Commit with Task 7** (calibration proves them).

### Task 6: The fake model server

**Files:**
- Create: `bench/hidden/p1/model-server.mjs`
- Test: `bench/hidden/p1/model-server.test.mjs`

**Interfaces:**
- Produces: `startModel({ script }) → { url, calls, close }`.
  - `script` maps a request to `{ status, body, delayMs }`.
  - `calls` lists every request the server received.
  - It binds `127.0.0.1` on port 0.

- [ ] **Step 1: Write failing tests.**
  - It answers a scripted reply.
  - It records a call's body.
  - A `delayMs` above the client's limit lets the client time out.
  - Two servers run at once on different ports.
- [ ] **Step 2: Implement, run, and commit with Task 7.**

### Task 7: Reference versions, broken versions and calibration

**Files:**
- Create: `bench/heldout-calibration/p1/{reference-s1, reference-s2, reference, near-miss-s1/*, near-miss-s2/*, near-miss/*}`
- Modify: `bench/run.mjs:52`, adding `TIMEOUT_MIN.p1 = 150`, a first value until Task 8 sets it

- [ ] **Step 1: Write the reference for each stage.** Each is the code a careful builder would hand in after that stage.
- [ ] **Step 2: Write at least 3 broken versions per stage.** Each breaks one stated line: a missing role check, a token in a log, no model time limit, a leak through an injected ticket, an off-by-one in the counts.
- [ ] **Step 3: Run `node bench/calibrate.mjs p1` alone.** Expected: `reference` passes every case, each near-miss fails at least one, and the last line is `p1: calibration ok`.
- [ ] **Step 4: Run all bench tests, then commit** `test: add p1 hidden sets, fake model server and calibration`.

### Task 8: The solo calibration run (paid: about $1 preflight plus $10–15; needs the user's yes)

- [ ] **Step 1: Make a plugin worktree and run preflight.** Make a plugin worktree at the branch head and run preflight with a new tag. The skill list changed since tag `rd`, so the old pin no longer matches.
- [ ] **Step 2: Run solo once on p1.** `--conds=solo --tasks=p1 --reps=1`, then score it alone.
- [ ] **Step 3: Set the time limit.** `TIMEOUT_MIN.p1` = 6 × solo's slowest stage, rounded up to 10 minutes, at least 60 and at most 180. Commit `chore: set p1's stage limit from the solo run`.
- [ ] **Step 4: If solo passes every hidden case, harden the sets before going on,** from the task text only, as for h7.

## Phase 3: cost cuts, measured (free to build; Task 11 is paid)

### Task 9: Tests in proportion

**Files:**
- Modify: `scripts/gen-agents.mjs:179` (the testing role) and the builders' tests line, then regenerate `agents/`
- Test: `tests/agents.test.mjs`

**Interfaces:**
- Produces: in both texts, the sentence `Write one test per requirement line and one per bug you find; add no other tests.`

- [ ] **Step 1: Pin the sentence in `tests/agents.test.mjs` and watch it fail.**
- [ ] **Step 2: Edit, regenerate, run the plugin tests, then commit** `fix: keep tests in proportion to the requirements`.

### Task 10: A late fix list goes to a fresh head

**Files:**
- Modify: `brief/core.md:14` (the line saying SendMessage only continues the same job)
- Test: `tests/session-start.test.mjs`, `tests/fixtures/supervisor-balanced.md`

**Interfaces:**
- Produces: the clause `a fix list sent more than 5 minutes after the section handed back goes to a fresh Agent call with its REPORT and changed files, because the old head's cache has expired`. Old words are cut so that every mode stays under 9000 characters.

- [ ] **Step 1: Pin the clause and every mode's size cap, and watch them fail.**
- [ ] **Step 2: Edit, run the plugin tests, then commit** `fix: send a late fix list to a fresh head`.

### Task 11: Measure the cuts (paid: about $30–60; needs the user's yes)

- [ ] **Step 1: Run Balanced on stage 1 only, twice.** Use `--stages=1` on p1. The baseline is a plugin worktree at `40c2eae`; the candidate is a worktree at the commit after Task 10. Use one preflight per pin.
- [ ] **Step 2: Score both alone, and judge both blind.**
- [ ] **Step 3: Keep the result only if it improves on both counts.** The candidate stays if its cost is lower and its judged quality is not lower. Otherwise, revert Tasks 9 and 10 one at a time and say which one hurt. Record the numbers in the plan's Evidence section and commit `docs: record the stage-1 cost cut measurements`.

Measured 2026-11-06: neither cut lowered cost (Balanced p1 stage 1, one run each: $7.47 without, $8.07 with; judged 8.5 each), so both are taken out (commit after 91aea3d).

The spec's third candidate, one grade per job in Lean, is left out here: Lean already allows only 1 fix round. It is tried only if Lean misses its cost target in the proof round.

## Phase 4: plan check and skill search (free)

### Task 12: `section-team:plan-advisor`

**Files:**
- Modify:
  - `scripts/gen-agents.mjs:31-32`: a roster entry with `kind: 'advisor'`, a description and a role saying what it checks and that it returns at most 8 fixes, each with its reason;
  - `hooks/lib/report.mjs:5`: add `'plan-advisor'` to `ADVISOR_IDS`;
  - `brief/core.md:6`: the advisors line, shortened so every mode stays under 9000 characters;
  - `skills/foundation/SKILL.md`: a "Check the plan" step between writing the note and "Get the OK", which wakes the plan advisor on the note, revises it, and shows the user the advice taken and not taken, with why;
  - regenerate `agents/`.
- Test: `tests/agents.test.mjs`, `tests/pre-tool-use.test.mjs`, `tests/session-start.test.mjs`, `tests/platform-quality.test.mjs`

- [ ] **Step 1: Write failing tests.**
  - `agents/plan-advisor.md` exists, with the advisor tools.
  - A Write by plan-advisor outside its memory folder is refused, and a Bash call is refused.
  - The foundation skill has "Check the plan" before "Get the OK" and names `section-team:plan-advisor`.
  - The tiers' single-area lines do not mention it.
  - Every mode's brief is under 9000 characters.
- [ ] **Step 2: Implement, regenerate, and run plugin and bench tests.**
- [ ] **Step 3: Commit** `feat: add a read-only plan advisor that checks a platform plan`.

### Task 13: Skill search with trusted sources

**Files:**
- Create: `skills/add-skill/trusted-sources.json`, holding `["anthropics", "vercel-labs", "microsoft"]`; `scripts/trusted-source.mjs`
- Modify:
  - `skills/add-skill/SKILL.md`, step 6 and a new search section. A missing skill is found by searching skills.sh (`npx skills find <words>`) and GitHub, the best match gets the same review, and an unattended install happens only when `node scripts/trusted-source.mjs <owner>` exits 0 and the review is clean; otherwise it asks.
  - `brief/core.md:32`: one line for a missing skill, reusing the words of the existing Suggested-skill line.
- Test: `tests/trusted-source.test.mjs`, `tests/session-start.test.mjs`

**Interfaces:**
- Produces: `isTrusted(owner, list) → boolean`, an exact case-insensitive match against the list. The CLI exits 0 when trusted, 1 when not, and 2 with one line on bad input.

- [ ] **Step 1: Write failing tests.**
  - `anthropics` and `Vercel-Labs` are trusted.
  - `anthropic`, `vercel-lab`, `microsoft-x`, an empty string, `../x` and a 200-character owner are not.
  - A missing or broken `trusted-sources.json` exits 2 with one line and trusts no one.
- [ ] **Step 2: Implement, then run the plugin tests.**
- [ ] **Step 3: Run a security pass** (the `security-review` skill) on the install path. Stop and report any real issue.
- [ ] **Step 4: Commit** `feat: search for missing skills and install unattended only from trusted sources`.

## Phase 5: proof (paid: roughly $250–400; needs the user's yes with the figure)

### Task 14: The proof round

- [ ] **Step 1: Run all local checks, push the branch, and wait for CI to be green.**
- [ ] **Step 2: Make one preflight, then run 2 reps of each setup.** The setups are solo, Lean, Balanced and Max on p1 with all stages. The order follows `plan()`, and usage is checked between runs, with the stop at 90% weekly.
- [ ] **Step 3: Score every run alone, then judge them blind.**
- [ ] **Step 4: Compare each mode with its targets in the Global Constraints.** Include that every team run woke `section-team:plan-advisor` before its first builder, and that `mainPeak` stayed under 150K. Write the table, with each miss and its number, into the readiness plan's Evidence section and README's Results. Commit `docs: record the p1 proof round`.

**Measured 2026-11-07 (tag `pr`, plugin 98338a6, results in `C:/Users/Asus/bench-results-proof`, Codex judge in both orders):**

| Target | Lean | Balanced | Max |
|---|---|---|---|
| Cost (target: Lean ≤ 2×, Balanced ≤ 3.5×, Max uncapped) | 2.33× ✗ | 4.46× ✗ | 6.12× (uncapped) |
| Hidden tests (≥ solo / ≥ Lean / ≥ Balanced) | 264 vs 264 ✓ | 263 vs 264 ✗ | 210 vs 263 ✗ |
| Judged (≥ solo+1.0 / ≥ solo+1.5 / ≥ Balanced); solo 7.5 | 7.75 ✗ | 8.75 ✗ (+1.25) | 7.0 ✗ |
| Every stage within 60 minutes | ✓ | ✓ | ✗ (r2 stage 3 timed out) |
| Supervisor chat under 150K | ✗ (198K, 201K) | ✗ (195K, 189K) | ✗ (205K, 158K) |
| plan-advisor woke before the first builder | ✗ never | ✗ never | ✗ never |
| No user data touched | ✓ | ✓ | ✓ |

Balanced was ranked first in all 4 judged groups. plan-advisor never ran, because p1's stage 1 is a single-area API, so the foundation flow never started. Solo's chat peaked at 154K and 176K.

### Task 15: Report

- [ ] **Step 1: Update PR 16's description.** Show the user the text first.
- [ ] **Step 2: Give the user a final harsh grade and the open items,** and ask about merging. Nothing merges without their yes.
