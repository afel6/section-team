# Held-out Benchmark Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run one pre-registered benchmark round of solo vs team (plugin `v0.1.1`) on three tasks the team was never tuned on, and publish the result plus reviewer-gate stats.

**Architecture:** Extend the existing `bench/` harness (run → score → anonymize → judge → aggregate) with task/rep options, seeded repos, a committed judge script, a calibration check for hidden tests, and a gate-stats reader over subagent transcripts. Add three tasks (`h1`, `h2`, `h3`). Freeze everything in one commit, then do the paid runs only after the user says yes.

**Tech Stack:** Node.js 26 built-ins only (`node:test`, `node:child_process`, `node:fs`), headless `claude -p`.

**Spec:** `docs/specs/2026-10-30-heldout-benchmark-design.md`

## Global Constraints
- Plugin frozen at tag `v0.1.1`: `git diff --stat v0.1.1 HEAD -- agents hooks skills brief .claude-plugin scripts types` prints nothing, before the first run and before publishing. No task in this plan touches those folders.
- Task names `h1`, `h2`, `h3`, with no dashes. Round tag `ho`. Setups `solo` and `team`, so the condition labels are `solo-ho` and `team-ho`.
- 3 runs per cell, 18 runs; 2 Opus judges per pair, 18 judges. Judge model `claude-opus-5-5`.
- Success rule (verbatim from spec): team mean blind judge quality ≥ solo's + **0.5**, and team mean hidden-test pass rate not below solo's.
- Task specs: Node.js built-ins only, no npm install, no outside services. The run prompt prefix in `run.mjs` stays unchanged.
- Hidden-test calibration: reference passes 100%; at least **3** near-miss versions per task each fail at least 1 hidden test.
- H1 pick deadline **2026-11-06**; after that, H1 is written in-house and the write-up says so.
- **No paid `claude -p` call (runs or judges) without the user's explicit yes**, asked twice: before the 18 runs, and before full judging.
- Work on branch `bench/heldout`. Commit at the end of each task (the approved plan authorizes these commits). Never push or open a PR without asking.
- House rules: files 200–400 lines (800 max), functions under 50 lines, no mutation of inputs, explicit errors, no `console.log` debugging left behind (CLI progress output via `console.log` in `main()` is the existing bench style and stays).
- Bench tests run with `node --test bench/*.test.mjs`. CI's "Benchmark scorer tests" step changes to exactly that command.

## Review Focus
1. **A run that timed out or crashed** has no `result` in `raw.json` and maybe no session transcript. `gate-stats.mjs` must report "no data" for it and must not throw. Test in Task 4.
2. **A judge that returns malformed or partial JSON.** Its raw output is saved, `judge.mjs` goes on with the other jobs and exits 1 at the end, and a rerun redoes only the missing job. Tests in Task 3.
3. **A reviewer transcript cut off before its GRADE block** counts as "no grade", never as a fail or a pass. Test in Task 4.
4. **A run that "fixes" H2 by editing or deleting the seed's own tests.** The hidden tests carry their own regression checks of seed behaviour, independent of the seed's tests, and judges see `SEED/` to compare. Tests in Task 7.
5. **A run folder outside `~/bench-runs`.** `freshRepo` refuses it, as it does today. Test in Task 1.

---

### Task 1: Runner options and seeded repos (`run.mjs`)

**Files:**
- Modify: `bench/run.mjs`
- Create: `bench/run.test.mjs`
- Modify: `.github/workflows/test.yml` (step "Benchmark scorer tests": `run: node --test bench/*.test.mjs`)

**Interfaces:**
- Produces: `export const TASKS = ['easy', 'medium', 'hard']`; `plan({ tag = '', conds = CONDITIONS, tasks = TASKS, reps = 2 } = {})` → `[{ id, task, cond, base, rep }]`; `parseArgs(argv)` → `{ tag, conds, round, tasks, reps, filters }`; `freshRepo(dir, { seed = null, root = RUNS } = {})`; `SEEDS = join(BENCH, 'seeds')`.

- [ ] **Step 0:** `git switch -c bench/heldout`.
- [ ] **Step 1: Write the failing tests** in `bench/run.test.mjs`:
  - `plan defaults are unchanged`: `plan()` has 18 entries, `[0].id === 'easy-team-r1'`, `.at(-1).id === 'hard-team-r2'`.
  - `plan with tasks, reps and tag`: `plan({ tag: 'ho', conds: ['team', 'solo'], tasks: ['h1', 'h2', 'h3'], reps: 3 })` has 18 entries; ids include `'h1-team-ho-r1'`, `'h3-solo-ho-r3'`; every `base` is `'team'` or `'solo'`.
  - `parseArgs reads tasks and reps`: `parseArgs(['--tasks=h1,h2', '--reps=3'])` → `tasks` deep-equals `['h1', 'h2']`, `reps === 3`; `parseArgs([])` → `tasks` deep-equals `TASKS`, `reps === 2`.
  - `parseArgs rejects bad reps`: `'--reps=0'`, `'--reps=x'`, `'--reps=1.5'` each throw `RangeError`.
  - `freshRepo with a seed`: in a `mkdtemp` root with a seed folder holding `a.txt`, `freshRepo(join(root, 'r'), { seed, root })` → `a.txt` exists; `git log --format=%s` prints `seed\ninit`; `git status --porcelain` prints nothing.
  - `freshRepo without a seed` → one commit, `init`.
  - `freshRepo refuses a folder outside root` → throws.
- [ ] **Step 2:** `node --test bench/run.test.mjs`. Expected: FAIL (`TASKS` not exported, no `reps`).
- [ ] **Step 3: Implement.** Make the `tasks` and `reps` loops data-driven. `parseArgs` validates `reps` as an integer ≥ 1. `freshRepo` copies `seed` with `cpSync(seed, dir, { recursive: true })` after the `init` commit, then runs `git add -A` and commits `seed`. `main()` passes `{ seed: join(SEEDS, run.task) }` when that folder exists, and before any run throws a clear error listing every task that lacks `bench/tasks/<t>.md` or `bench/hidden/<t>.test.mjs`. Set `TIMEOUT_MIN` to `h1: 100, h2: 60, h3: 45`.
- [ ] **Step 4:** `node --test bench/*.test.mjs`. Expected: all pass.
- [ ] **Step 5:** Edit the CI step, then `git add bench/run.mjs bench/run.test.mjs .github/workflows/test.yml && git commit -m "feat(bench): task, rep and seed options for the runner"`.

### Task 2: Anonymizer and aggregate for new tasks

**Files:**
- Modify: `bench/anonymize.mjs`, `bench/aggregate.mjs:96`
- Create: `bench/anonymize.test.mjs`

**Interfaces:**
- Consumes: `TASKS`, `SEEDS`, `parseArgs` from Task 1.
- Produces: `export function anonymize({ conds, tasks = TASKS, reps = 2, results = RESULTS, judgeDir, seeds = SEEDS })` → blind key object `{ '<task>-r<rep>': { X: cond, Y: cond, … } }`. It copies each run into `<judgeDir>/<pair>/<label>/` and, for a task with a seed, the seed into `<judgeDir>/<pair>/SEED/`. `main()` writes the key file as today.

- [ ] **Step 1: Write the failing tests:**
  - `round-17 key is reproduced`: `anonymize({ conds: ['solo-v3', 'team-v3', 'team-v17'], results: <empty tmp>, judgeDir: <tmp> })` deep-equals `bench/data/blind-key-v17.json`.
  - `two setups, three reps`: `conds: ['solo-ho', 'team-ho'], tasks: ['h1'], reps: 3` → keys `h1-r1..h1-r3`, each with exactly labels `X`, `Y`.
  - `seeded task gets SEED and hides team traces`: a fake `results/h2-team-ho-r1/run.json` points at a tmp run dir containing `.team/x.md`, `.git/`, `app.mjs`, `data.db`; a seed dir has `s.mjs`. Afterwards `<pair>/X` or `<pair>/Y` has `app.mjs` and no `.team`, `.git` or `data.db`, and `<pair>/SEED/s.mjs` exists.
- [ ] **Step 2:** `node --test bench/anonymize.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** `anonymize` by moving `main()`'s loop into it, keeping the shift formula `(t + rep) % conds.length`, where `t` is the task's index in `tasks`. In `aggregate.mjs:96` the order list becomes `['easy', 'medium', 'hard', 'h1', 'h2', 'h3', 'all']`.
- [ ] **Step 4:** `node --test bench/*.test.mjs`, all pass. Then run the recompute command from `bench/data/README.md`. Expected: the `all` rows still show 8.58 / 7.72 / 7.12.
- [ ] **Step 5:** `git commit -m "feat(bench): anonymize any task list, include the seed for judges"`.

### Task 3: Committed judge prompt and judge runner

**Files:**
- Create: `bench/judge-prompt.md`, `bench/judge.mjs`, `bench/judge.test.mjs`

**Interfaces:**
- Consumes: `RESULTS`, `parseArgs` (`round`) from `run.mjs`; `JUDGE` folder naming from `anonymize.mjs` (`~/bench-judge-<round>`).
- Produces: `parseVerdict(text, pair, labels)` → `{ pair, X: Scores, Y: Scores, ranking: string[] }` where `Scores = { correctness, codeQuality, tests, robustnessSecurity, docsUsability, overall: integer 1–10, notes: string }`; `pendingJobs(pairs, rows, perPair)` → `[{ pair, judge }]`; rows saved to `results/judge-<round>.json` with extra fields `judge` (1..perPair) and `costUSD`, which `judgeScores` ignores.

- [ ] **Step 1: Write `bench/judge-prompt.md`.** It is a blind code judge prompt with placeholders `{{LABELS}}`, `{{TASK}}` (the task spec text) and `{{SEED_NOTE}}` (empty, or "SEED/ is the repo before the change; judge only what each solution changed and whether it broke anything"). Rules it must state:
  - read the task;
  - inspect each solution folder and run its own tests;
  - probes run only in a folder made by `mktemp -d`, deleted afterwards by its exact path, and nothing else is ever deleted;
  - never edit a solution folder; no network;
  - score the 5 dimensions plus overall, as integers 1–10;
  - rank best to worst;
  - notes cite `file:line`;
  - end with exactly one fenced `json` block matching the `Scores` shape above, for example `{"X": {...}, "Y": {...}, "ranking": ["Y", "X"]}`.
- [ ] **Step 2: Write the failing tests:**
  - `parseVerdict` on valid text returns the row.
  - With two json blocks, it uses the last.
  - A missing `tests` field throws `/tests/`.
  - A score of `11` throws.
  - A ranking `['X', 'X']` throws `/ranking/`.
  - Text with no JSON throws.
  - `pendingJobs(['h1-r1', 'h1-r2'], [{ pair: 'h1-r1', judge: 1 }], 2)` deep-equals `[{ pair: 'h1-r1', judge: 2 }, { pair: 'h1-r2', judge: 1 }, { pair: 'h1-r2', judge: 2 }]`.
- [ ] **Step 3:** `node --test bench/judge.test.mjs`. Expected: FAIL.
- [ ] **Step 4: Implement** `bench/judge.mjs`. Usage: `node bench/judge.mjs --round=ho --per-pair=2 [--limit=1]`. For each pending job it runs `claude -p <filled prompt> --model claude-opus-5-5 --output-format json --allowedTools "Read,Glob,Grep,Bash(node *),Bash(npm *),Bash(mktemp *),Bash(rm *),Bash(ls *),Bash(cat *)"` with `cwd` set to the pair folder, parses `result` with `parseVerdict`, and appends the row with `judge` and `costUSD` to `results/judge-<round>.json`. On a parse error it saves the raw output to `results/judge-<round>-raw/<pair>-<judge>.json`, logs one line, continues, and exits 1 at the end. `--limit=1` is the paid dry run. The task text comes from `bench/tasks/<task>.md`, with `task = pair.split('-')[0]`.
- [ ] **Step 5:** `node --test bench/*.test.mjs`. Expected: all pass. No `claude -p` call in tests.
- [ ] **Step 6:** `git commit -m "feat(bench): commit the judge prompt and a resumable judge runner"`.

### Task 4: Gate stats

**Files:**
- Modify: `bench/score.mjs` (`collectRoles` adds fields; `hiddenTests` exported for Task 5), `bench/score.test.mjs`
- Create: `bench/gate-stats.mjs`, `bench/gate-stats.test.mjs`

**Interfaces:**
- Consumes: `collectRoles` (score.mjs), `parseReport` (`hooks/lib/report.mjs`, import only, no change).
- Produces:
  - `collectRoles(...)` entries gain `agentId` (from `agent-<id>.jsonl`), `parentId` (`meta.parentAgentId ?? null`) and `start` (the first message's `timestamp` or `null`); `main` stays as it is.
  - `parseGrade(text)` → `{ overall: number, verdict: 'pass' | 'fail' } | null`.
  - `gateSequences(roles)` → `{ [caller]: [{ overall, verdict } | null] }`, where caller = `parentId ?? 'main'`, only role `section-team:reviewer` counts, entries are ordered by `start`, and the text graded is the last assistant message's text.
  - `summarize(sequences)` → `{ calls, graded, passes, fails, ungraded, callers, firstTryPasses, fixRounds }`, where `fixRounds` counts fails followed by a later call from the same caller.
  - `failingTests(tap)` → names from `not ok N - <name>` lines.
  - `gateMisses(sequences, tap)` → `failingTests(tap)` when every caller's last entry is a pass, else `[]`.

- [ ] **Step 1: Write the failing tests:**
  - `collectRoles` with a fake home, holding a depth-2 meta with `parentAgentId: 'p1'`, returns `parentId === 'p1'` and `agentId` from the file name.
  - `parseGrade` on a reviewer answer ending in a `## GRADE` block with `Overall: 7/10` and `Verdict: fail` returns `{ overall: 7, verdict: 'fail' }`. With two blocks it uses the last. With no block it returns `null` (Review Focus 3).
  - `gateSequences` orders by `start`, groups by caller and ignores other roles.
  - `summarize({ main: [pass], p1: [fail, pass], p2: [fail] })` → `calls 4, passes 2, fails 2, callers 3, firstTryPasses 1, fixRounds 1`.
  - `gateMisses` returns names only when every last entry is a pass.
  - `gate stats for a run with no transcript` (`roles === null`) gives a row with `noData: true` and does not throw (Review Focus 1).
- [ ] **Step 2:** `node --test bench/score.test.mjs bench/gate-stats.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `main()` usage: `node bench/gate-stats.mjs --round=ho`.
  - It reads every `results/*-team-<round>-r*/` folder (`run.json`, `raw.json` sessionId, `hidden.tap`) and its `.team/reports/*/*.md`, counting `partial`/`blocked` with `parseReport`.
  - When `results/report-data-<round>.json` exists, it joins the judges' mean `codeQuality` per run.
  - It writes `results/gate-stats-<round>.json` and prints one markdown row per run: `id | calls | first-try passes/callers | fix rounds | final grades | partial/blocked | gate misses | judge code quality`.
- [ ] **Step 4:** `node --test bench/*.test.mjs`. Expected: all pass.
- [ ] **Step 5:** `git commit -m "feat(bench): reviewer gate stats from subagent transcripts"`.

### Task 5: Hidden-test calibration check

**Files:**
- Create: `bench/calibrate.mjs`, `bench/calibrate.test.mjs`

**Interfaces:**
- Consumes: `hiddenTests(task, dir)` exported from `score.mjs` (Task 4), `SEEDS` (Task 1).
- Produces: layout `bench/heldout-calibration/<task>/reference/` and `bench/heldout-calibration/<task>/near-miss/<name>/`, each a folder of files overlaid on (seed, if any) + reference; `calibrationVerdict({ reference: { rate }, nearMisses: [{ name, fail }] })` → `{ ok: boolean, problems: string[] }`.

- [ ] **Step 1: Write the failing tests** for `calibrationVerdict`:
  - Reference rate 1 with 3 near-misses that each have `fail ≥ 1` → `ok: true`.
  - Reference rate 0.9 → problem `/reference/`.
  - A near-miss with `fail: 0` → a problem naming it.
  - Only 2 near-misses → problem `/at least 3/`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3: Implement.** `node bench/calibrate.mjs <task>` builds each variant in a `mkdtemp` folder (seed, then reference, then near-miss, copied with `cpSync`), runs `hiddenTests`, prints one line per variant (`reference 15/15`, `near-miss dom-dow-and 13/15 (2 fail)`), deletes its temp folders by exact path, and exits 1 when `ok` is false.
- [ ] **Step 4:** `node --test bench/*.test.mjs`. Expected: all pass.
- [ ] **Step 5:** `git commit -m "feat(bench): calibration check for hidden tests"`.

### Task 6: H3 — cron library task

**Files:**
- Create: `bench/tasks/h3.md`, `bench/hidden/h3.test.mjs`, `bench/heldout-calibration/h3/reference/cron.mjs`, `bench/heldout-calibration/h3/near-miss/{dom-dow-and,inclusive-from,seven-not-sunday,range-step-from-min,names-case-sensitive}/cron.mjs`

- [ ] **Step 1: Write `bench/tasks/h3.md`** with exactly this text:

```
Build a cron expression library `cron.mjs` (an ES module) that exports `parse` and `next`. All times are UTC.

Expressions
- Exactly 5 fields separated by one or more spaces; leading and trailing spaces are ignored. Fields: minute (0-59), hour (0-23), day of month (1-31), month (1-12), day of week (0-7, where 0 and 7 both mean Sunday).
- Each field is a comma-separated list of items. An item is `*`, a number `n`, a range `a-b` with a <= b, or any of these followed by `/s` with s >= 1: `*/s` is every s-th value from the field's minimum, `a-b/s` every s-th value from a up to b, and `n/s` every s-th value from n up to the field's maximum. For day of week, `*` and `n/s` use 0-6; a range may end at 7.
- Month names JAN-DEC and day names SUN-SAT, in any letter case, may be used wherever a number may, including in ranges.
- Day rule: a field is unrestricted only when it is exactly `*`. If day of month and day of week are both restricted, a time matches when EITHER matches. Otherwise only the restricted one counts.

API
- `parse(expr)` returns `{ minute, hour, dayOfMonth, month, dayOfWeek }`, each an array of the matching numbers sorted ascending without duplicates; day of week uses 0-6 (7 becomes 0).
- `next(expr, from, n = 1)` returns an array of the next `n` matching times as Date objects, each strictly after `from`, ascending, with seconds and milliseconds 0.
- `expr` that is not a string, `from` that is not a valid Date, or `n` that is not an integer from 1 to 1000: throw a `TypeError`.
- A string that is not a valid expression: throw a `SyntaxError` whose message starts with `Invalid cron expression`.
- An expression with no match in the 5 years after `from` (for example `0 0 30 2 *`): `next` throws a `RangeError` whose message starts with `No match`.

Also add tests with node:test, a `package.json` ("type": "module" and a "test" script), and a README with usage.
```

- [ ] **Step 2: Write `bench/hidden/h3.test.mjs`.** It imports `${TARGET_DIR}/cron.mjs` via `pathToFileURL`. Before trusting any expected weekday, check it with `getUTCDay()`. Tests (ISO strings in UTC):
  - `*/15 * * * *` from `2026-01-01T00:07:00Z`, n=3 → `00:15`, `00:30`, `00:45`.
  - Strictly after: `0 12 * * *` from `2026-03-01T12:00:00Z` → `2026-03-02T12:00:00Z`.
  - Seconds zeroed: `* * * * *` from `2026-01-01T00:07:30.500Z` → `2026-01-01T00:08:00.000Z`.
  - OR rule: `0 0 13 * FRI` from `2026-01-01T00:00:00Z`, n=3 → `2026-01-02`, `2026-01-09`, `2026-01-13` (midnight).
  - 7 is Sunday: `parse('0 0 * * 7').dayOfWeek` → `[0]`; `parse('0 0 * * 5-7').dayOfWeek` → `[0, 5, 6]`.
  - Leap day: `0 0 29 2 *` from `2026-01-01T00:00:00Z` → `2028-02-29T00:00:00Z`.
  - Short month: `0 0 31 * *` from `2026-04-01T00:00:00Z` → `2026-05-31T00:00:00Z`.
  - Steps: `parse('1-10/3 * * * *').minute` → `[1, 4, 7, 10]`; `parse('5/20 * * * *').minute` → `[5, 25, 45]`; `parse('0 0 * * */2').dayOfWeek` → `[0, 2, 4, 6]`.
  - Names, any case: `parse('* * * jan-MAR mon,Fri')` → month `[1, 2, 3]`, dayOfWeek `[1, 5]`.
  - Duplicates: `parse('1,1,2 * * * *').minute` → `[1, 2]`.
  - Spaces: `parse('  0   0 * * *  ').hour` → `[0]`.
  - SyntaxError `/^Invalid cron expression/` for each of: `'60 * * * *'`, `'* * * *'`, `'5-1 * * * *'`, `'*/0 * * * *'`, `'1,,2 * * * *'`, `'* * * FOO *'`, `'* * 0 * *'`.
  - TypeError for: `parse(5)`, `next('* * * * *', 'x')`, `next('* * * * *', new Date('bad'))`, n = 0, 1001 and 1.5.
  - RangeError `/^No match/` for `next('0 0 30 2 *', new Date('2026-01-01T00:00:00Z'))`.
- [ ] **Step 3: Write the reference** `cron.mjs` (built-ins only, under 200 lines): parse into sets, then walk minute by minute with day-level skipping and a 5-year bound.
- [ ] **Step 4: Write the 5 near-misses**, each a copy of the reference with one change:
  - DOM/DOW combined with AND;
  - `next` includes `from` when it matches;
  - `7` rejected as a day of week;
  - `a-b/s` steps from the field minimum instead of `a`;
  - names matched case-sensitively.
- [ ] **Step 5:** `node bench/calibrate.mjs h3`. Expected: `reference` all pass, each near-miss at least 1 fail, exit 0. If the reference fails a test, recheck the expected date by hand before changing either one.
- [ ] **Step 6:** `git commit -m "feat(bench): held-out task h3 (cron library) with calibrated hidden tests"`.

### Task 7: H2 — existing-codebase task

**Files:**
- Create: `bench/seeds/h2/` (`package.json`, `server.mjs`, `lib/{store,validate,paginate,routes}.mjs`, `test/*.test.mjs`, `README.md`), `bench/tasks/h2.md`, `bench/hidden/h2.test.mjs`, `bench/heldout-calibration/h2/reference/…`, `bench/heldout-calibration/h2/near-miss/{qty-symptom-only,page-symptom-only,csv-no-quote,csv-shadowed,csv-lf}/…`

**Seed design (about 400–500 lines in total, house style, own tests pass):**
- `server.mjs`: env `PORT` (default 3000) and `DATA_FILE` (default `stock.json`); prints `listening on http://127.0.0.1:<port>`; JSON bodies over 10 KB → 413; bad JSON → 400 `{"error": …}`.
- `lib/store.mjs`: `load(file)` returns `{ items: [], reservations: [], nextReservationId: 1 }` on ENOENT; `save(file, data)` is atomic (temp file + rename).
- `lib/validate.mjs`:
  - `parseSku(v)` matches `/^[A-Z0-9-]{1,20}$/`.
  - `parseQuantity(v)` returns an integer ≥ 1 or throws `ValidationError`. **Planted bug 1:** it uses `parseInt(v, 10)`, so `2.5` becomes `2`. Both `POST /items` and `POST /reservations` call it.
  - `parsePage(query)` → `{ page, perPage }`, default 1/20, perPage max 100.
- `lib/paginate.mjs`: `paginate(list, page, perPage)` → `{ items, page, per_page, total }`. **Planted bug 2:** `list.slice(start, start + perPage - 1)`. Both `GET /items` and `GET /reservations` call it.
- Routes:
  - `GET /items` returns items sorted by sku.
  - `POST /items {sku, name, qty}` → 201 `{sku, name, qty, reserved: 0}`, 409 on an existing sku.
  - `GET /items/:sku` → 200, or 404 `{"error": "not found"}`.
  - `POST /reservations {sku, qty}` → 201 `{id, sku, qty}`; 404 on an unknown sku; 409 `{"error": "insufficient stock"}` when qty > qty − reserved.
  - `GET /reservations` returns reservations sorted by id.
  - `DELETE /reservations/:id` → 204, and frees the stock.
- The seed's own tests use integer quantities and fewer than 19 items per list, so the planted bugs stay hidden.

- [ ] **Step 1: Write the seed and run** `cd bench/seeds/h2 && npm test`. Expected: pass. Then confirm both planted bugs by hand with a 25-item list and qty `2.5`.
- [ ] **Step 2: Write `bench/tasks/h2.md`** with exactly this text:

```
This repo is a small stock-keeping HTTP service (see README.md), and its tests pass. Work on it as you would on a teammate's project.

Bug reports from users
1. "I reserved 2.5 units of WIDGET-1 and the request succeeded: it reserved 2. Quantities must be whole numbers."
2. "GET /items?per_page=10 shows only 9 items on the first page, even though we have 25 items."

Feature request
- Add `GET /items/export.csv`: every item sorted by sku, as CSV with the header line `sku,name,qty,reserved`. Every line, the header and the last line included, ends in "\r\n". A field that contains a comma, a double quote, a CR or an LF is wrapped in double quotes, with each double quote inside it doubled. Respond with status 200 and the header `Content-Type: text/csv` exactly.

Keep the existing tests passing, add tests for your changes, and update the README.
```

- [ ] **Step 3: Write `bench/hidden/h2.test.mjs`.** Start the server the way `bench/hidden/hard.test.mjs` does (free port, `PORT` and `DATA_FILE` env, wait for `listening on`). Tests:
  - qty `2.5` → 400 on `POST /reservations`, with the item's reserved count unchanged, and on the sibling `POST /items`; qty `3` → 201.
  - 25 items, `per_page=10` → pages of 10, 10 and 5. Sibling: 12 reservations, `per_page=5` → 5, 5, 2.
  - CSV: an exact body for 3 items, one named `Bolt, "hex" 5mm` (→ `"Bolt, ""hex"" 5mm"`) and one holding a reservation; `\r\n` endings; `content-type === 'text/csv'`; status 200 (not shadowed by `/items/:sku`); an empty store gives exactly `sku,name,qty,reserved\r\n`.
  - Seed regression, independent of the seed's tests (Review Focus 4): duplicate sku → 409; over-reserve → 409; `DELETE` frees stock; data survives a restart on the same `DATA_FILE`.
- [ ] **Step 4: Write the reference** (fixes in `validate.mjs` and `paginate.mjs`, the CSV route before `/items/:sku`, and tests) and the 5 near-misses:
  - qty fixed only in the reservations route;
  - paging fixed only in the items route;
  - CSV without quoting;
  - CSV route registered after `/items/:sku`;
  - CSV with `\n` endings.
- [ ] **Step 5:** `node bench/calibrate.mjs h2`. Expected: exit 0.
- [ ] **Step 6:** `git commit -m "feat(bench): held-out task h2 (existing service: two bugs and a CSV export)"`.

### Task 8: H1 — outside pick

**Files:** `bench/tasks/h1.md`, `bench/hidden/h1.test.mjs`, `bench/heldout-calibration/h1/…` (at least 3 near-misses)

- [ ] **Step 1:** Wait for his one-paragraph pick until **2026-11-06**. If none arrives, use the fallback: an `ini2json.mjs` CLI that converts INI to JSON, with sections, duplicate-key and syntax errors on exact stderr lines and exit codes. Record which source was used in `bench/tasks/h1.md`'s commit message.
- [ ] **Step 2:** Rewrite the pick in the house task format (exact names, messages, exit codes, Node built-ins only, "Also add tests… README" line). If his text is ambiguous, ask him, and do not guess. Send him the final text before freezing.
- [ ] **Step 3:** Write the hidden tests (each requirement line has at least 1 test), the reference and at least 3 near-misses. Then `node bench/calibrate.mjs h1`. Expected: exit 0.
- [ ] **Step 4:** `git commit -m "feat(bench): held-out task h1 (<source>)"`.

### Task 9: Freeze

- [ ] **Step 1:** Run `npm test`, `node --test bench/*.test.mjs` and `node bench/calibrate.mjs h1`, `h2`, `h3`. Expected: all pass, all exit 0.
- [ ] **Step 2:** `git diff --stat v0.1.1 HEAD -- agents hooks skills brief .claude-plugin scripts types`. Expected: no output.
- [ ] **Step 3:** Run the reviewer gate (`section-team:reviewer`) on the changed `bench/*.mjs` files. Pass: overall ≥ 8 and no item under 6, with at most 2 fix rounds.
- [ ] **Step 4:** `git commit` anything left; record `git rev-parse HEAD` as the **freeze commit**. Ask the user whether to push the branch and open a PR now, so the freeze is public before the runs (recommended).

### Task 10: Paid runs (needs the user's yes)

- [ ] **Step 1:** Ask: "Preflight (about $0.10), then 18 runs, about $36 at round-17 averages. Go?" Wait for yes. Then `node bench/preflight.mjs`: it must print `preflight ok`. It checks from the CLI's own init message that section-team loads for team and not for solo with the exact settings builders get, and that automatic skill installs are off. On any problem, stop and fix the harness before the runs.
- [ ] **Step 2:** Before the runs, save `ls ~/.claude/skills` and `git status --short` to `bench/results/pre-round-ho.txt`. Then `node bench/run.mjs --tag=ho --conds=team,solo --tasks=h1,h2,h3 --reps=3` in the background (it resumes after a stop). It moves the user's section memory (`~/.claude/agent-memory/section-team-*`) to `~/bench-section-memory-backup` for the round, gives every team run empty section memory, files each team run's new notes under `bench/results/<id>/section-memory/`, and moves the user's memory back when it ends. Do not use section-team in any other Claude Code session while the round runs: its sections would read and write the round's memory. Ctrl+C or closing the console puts the memory back; if the process is killed outright, run `node bench/run.mjs --restore-memory` before using section-team again. After the round, `ls ~/.claude/skills` and `git status --short` must match the saved file, and the freeze diff (Task 9 Step 2) must still print nothing: a run that changed the plugin or the skills is reported and rerun.
- [ ] **Step 3:** `node bench/score.mjs`. Check every `ho` run: `timedOut=false`, and `hidden x/y` printed. Rerun only crashed runs, and list them for the write-up. A crashed run is one that did not time out and either has no `result` in `raw.json` (the CLI failed; the score line shows `$0.00`) or ended on an API error (the score line ends in `API ERROR`; `isError` in `summary.json`). `run.mjs` counts it as done, so to rerun it delete `bench/results/<id>/run.json` and run the Step 2 command again; it redoes only that run. A timed-out run is a result, not a crash, and is not rerun.
- [ ] **Step 4:** `node bench/anonymize.mjs --round=ho --conds=solo-ho,team-ho --tasks=h1,h2,h3 --reps=3`. It exits 1 and names any run that has not finished; finish those first, then anonymize again.
- [ ] **Step 5:** `node bench/judge.mjs --round=ho --per-pair=2 --limit=1`, the dry run. Check that its row was saved in `bench/results/judge-ho.json`, read its `costUSD` and its notes (the judge followed the prompt and probed only in `scratch/`). Each judge works in its own temp copy of the pair, with section-team off; judge 2 of each pair sees X and Y swapped, and its row is mapped back and marked `swapped`.
- [ ] **Step 6:** Ask: "Judging: 17 more judges at about $<dry-run cost> each. Go?" Wait for yes. Then run without `--limit` until it exits 0. If a run is rerun after judging started, delete that pair's rows from `judge-ho.json` and anonymize again before judging it.
- [ ] **Step 7:** Judge-prompt check: `~/bench-runs` held no round-17 folders on 2026-10-30, so the check is skipped; the write-up says so.

### Task 11: Results and write-up

**Files:** `bench/data/heldout/` (`summary.json`, `judge-ho.json`, `blind-key-ho.json`, `gate-stats-ho.json`, `README.md`), `docs/benchmark-heldout-2026-11.md`, `README.md` (Limits line)

- [ ] **Step 1:** `node bench/aggregate.mjs --round=ho`, then `node bench/gate-stats.mjs --round=ho`.
- [ ] **Step 2:** Apply the success rule to the `all` rows (`judgeQuality` and `hiddenPassPct` of `team-ho` vs `solo-ho`), and state the verdict in one sentence using the spec's words.
- [ ] **Step 3:** Write `docs/benchmark-heldout-2026-11.md` in the style of `docs/benchmark-2026-10-24.md`:
  - setup, freeze commit, success rule and verdict;
  - per-task and `all` tables (cost, minutes, hidden %, judge quality, 1st/last places);
  - the gate-stats table and gate misses;
  - the skipped judge-prompt check;
  - reruns;
  - limits (n = 3 per cell, one judge prompt, Node.js only; judges and builders run with the user's other plugins and shell environment, as in round 17; judges could read the blind key with `node`; a timed-out run counts as $0 in the cost columns; the hidden tests skip a few untestable spec lines, listed per task).
- [ ] **Step 4:** Copy the `ho` files from `bench/results/` into `bench/data/heldout/`; its `README.md` gives the recompute command. Update the README Limits line with the outcome in one sentence and a link.
- [ ] **Step 5:** Run the freeze diff check again (Task 9 Step 2); expected no output. Then `git commit -m "docs: publish the held-out benchmark round"`. Ask the user before pushing or opening the PR.
