# Benchmark — section-team vs the old way (2026-10-24)

## Setup
- **3 tasks**, each in a fresh empty git repo:
  - **easy:** two text utilities (`bench/tasks/easy.md`)
  - **medium:** a todo command-line app with storage and error codes (`medium.md`)
  - **hard:** a URL-shortener web app with SQLite, rate limit, admin delete, frontend, tests and README (`hard.md`)
- **3 ways of working**, each run **twice**, 18 runs in total, all headless `claude -p` on Opus 5.5 with an identical prompt:
  - **solo:** plugin switched off, which is the old way.
  - **team:** plugin on, and the supervisor decides by itself whether to wake sections.
  - **forced:** plugin on, and the prompt also says "delegate the building to the sections".
- **Fairness:** same model, same global setup (CLAUDE.md and plugins), and Fable disabled in every run. Every run was told the plan was pre-approved.
- **Measured:**
  - cost and tokens, from Claude Code's own usage report;
  - wall time;
  - **hidden acceptance tests** written by me and calibrated on independent reference solutions (8, 11 and 12 tests);
  - the project's own `npm test`;
  - **2 blind Opus judges per group**, who saw the three solutions as X, Y and Z (anonymized, with every trace of the team removed), scored them 1–10 on 5 dimensions and ranked them.

## Results

| Task | Way | Cost $ | Tokens (M) | Minutes | Hidden tests | Judge quality /10 | Judge 1st places | Grade /100 |
|---|---|---|---|---|---|---|---|---|
| easy | solo | **0.60** | 0.43 | **0.9** | 100% | 6.85 | 0 | **87.9** |
| easy | team | 0.63 | 0.45 | 1.1 | 100% | 7.10 | 1 | 85.7 |
| easy | forced | 1.27 | 0.92 | 1.8 | 100% | **7.43** | **3** | 75.8 |
| medium | solo | **0.83** | 0.95 | **2.1** | 100% | 7.60 | 0 | **88.7** |
| medium | team | 1.66 | 1.23 | 2.2 | 100% | 8.20 | 2 | 86.2 |
| medium | forced | 2.45 | 2.10 | 3.9 | 100% | **8.35** | 2 | 76.1 |
| hard | solo | **1.13** | 0.93 | **2.7** | 100% | 7.03 | 0 | **90.6** |
| hard | team | 1.38 | 1.28 | 3.9 | 100% | 7.85 | 1 | 85.8 |
| hard | forced | 3.35 | 4.09 | 8.5 | 100% | **8.32** | **3** | 75.2 |
| **all** | **solo** | **0.85** | **0.77** | **1.9** | 100% | 7.16 | **0 of 12** | **89.0** |
| **all** | **team** | 1.22 (×1.4) | 0.99 | 2.4 (×1.3) | 100% | 7.72 | 4 of 12 | 85.9 |
| **all** | **forced** | 2.36 (×2.8) | 2.37 | 4.7 (×2.5) | 100% | **8.03** | **8 of 12** | 75.7 |

The grade combines correctness 40 (hidden tests), quality 30 (judges), cost 15 (relative to the cheapest run of that task) and speed 15 (relative to the fastest). The default weighting and two others:

| Weighting | solo | team | forced |
|---|---|---|---|
| default 40 / 30 / 15 / 15 | **89.0** | 85.9 | 75.7 |
| quality-first 20 / 60 / 10 / 10 | 81.3 | **81.5** | 75.9 |
| cost-first 30 / 20 / 35 / 15 | **91.0** | 83.8 | 65.1 |

### Where the quality difference comes from
Judge averages per dimension, out of 10:

| Way | correctness | code quality | tests | robustness/security | docs | overall |
|---|---|---|---|---|---|---|
| solo | 7.96 | 7.92 | 6.96 | 7.04 | 5.92 | 7.21 |
| team | 8.63 | 7.96 | 7.54 | 7.75 | 6.71 | 7.77 |
| forced | 8.75 | **8.17** | **8.17** | **8.08** | **7.00** | **8.19** |

The gains are mostly in **tests (+1.2)**, **robustness (+1.0)** and **docs (+1.1)**. Those are exactly the jobs the dedicated testing and docs sections do. Code quality itself is about the same in all three.

## What happened inside
- **Everything worked:** 18/18 runs passed 100% of the hidden tests and their own `npm test`. These tasks were not hard enough to separate correctness, so the differences are cost, speed and quality.
- **The supervisor's delegation was inconsistent in team mode.** It did easy and hard itself ("small app, about 6 files, doing it directly"). It woke 3 sections (backend, testing, docs) on medium run 1 and none on medium run 2.
- **Forced mode used 1 section on easy, 3 on medium (backend, testing, docs) and 4 on hard (backend, frontend, testing, docs).**
- **Reports were saved correctly** by the SubagentStop hook in every section run (1–4 report files each).
- **No section ever started a cheaper helper** (Haiku or Sonnet). All work ran on Opus 5.5, so the intended helper saving never happened.
- **Fixed cost per session:** every call carries about 80k tokens of the user's global setup (CLAUDE.md and the plugins). Each woken section pays that again, which is the main reason forced mode costs about 3×.

## Verdict
- **Cheapest and fastest: solo (the old way).** It has the highest grade under the default and cost-first weightings. But it was **never** ranked best by a judge (0 of 12) and was ranked worst 7 times.
- **Best quality: forced team.** It was ranked best 8 of 12 times, with clearly better tests, robustness and docs, at about **2.8× the cost and 2.5× the time**.
- **Best balance: team (auto).** It adds about 0.6 quality points over solo for about 1.4× the cost, and ties solo when quality is weighted highest (81.5 vs 81.3).

**Recommendation:** keep team mode as the default. For important or larger work where tests, docs and robustness matter, tell the supervisor "use your sections". Use solo, or ask it to do the work itself, for quick throwaway changes.

## What would make the team better (from this data)
1. **Make sections actually use cheap helpers.** Haiku for searching and reading, Sonnet for routine tests. That is the designed saving, and it never happened.
2. **Make the delegation rule firmer.** The supervisor skipped sections on the hard task, so team mode behaves like solo plus overhead.
3. **Trim the about 80k-token global setup** (CLAUDE.md and the always-on plugins). Every section reloads it, so this cuts the team's cost most.

## Round 2 — after the efficiency fixes (commit 99e9d42 + ddb7dcd)
The fixes were:
- cheap `scout` (Haiku) and `coder` (Sonnet) helpers;
- section heads skip the global CLAUDE.md;
- the supervisor must delegate anything over about 150 lines.

Setup: the same 3 tasks, 2 runs each, of **team-v2** and **forced-v2**, and the same anonymizing. The solo projects from round 1 were reused as the anchor (the plugin is off in solo, so the fixes cannot change it). There were 2 new blind Opus judges per group with the same rubric.

| Way | Cost $ | Minutes | Sections woken | Judge quality /10 | Over solo, same round | 1st places | Last places | Grade /100 |
|---|---|---|---|---|---|---|---|---|
| solo (same projects) | **0.85** | **1.9** | 0 | 6.89 | — | 1 of 12 | 10 of 12 | **88.1** |
| team v1 (round 1) | 1.22 | 2.4 | 0.5 | 7.72 | +0.56 | 4 of 12 | 3 of 12 | 85.9 |
| **team-v2** | 2.47 (×2.9) | 4.3 | 2.5 | 7.85 | **+0.96** | 3 of 12 | 2 of 12 | 79.2 |
| forced v1 (round 1) | 2.36 | 4.7 | 2.7 | 8.03 | +0.87 | 8 of 12 | 2 of 12 | 75.7 |
| **forced-v2** | 2.58 (×3.0) | 4.4 | 3.7 | **8.24** | **+1.35** | **8 of 12** | **0 of 12** | 75.2 |

Notes on the table:
- The same solo projects scored 7.16 with the round-1 judges and 6.89 with the round-2 judges. That ~0.3 gap is judge calibration noise, so compare each way against solo **within its own round** (the "over solo" column).
- Hidden tests and own tests passed 100% in all 12 new runs, with no timeouts.

Grade under other weightings (round 2):
- default: solo 88.1 · team-v2 79.2 · forced-v2 75.2
- quality-first: solo 79.7 · team-v2 77.5 · forced-v2 76.4
- cost-first: solo 90.3 · team-v2 71.2 · forced-v2 63.4

Judge averages per dimension in round 2:

| Way | correctness | code quality | tests | robustness/security | docs | overall |
|---|---|---|---|---|---|---|
| solo | 8.25 | 7.50 | 6.63 | 6.33 | 5.75 | 7.08 |
| team-v2 | 8.75 | 8.08 | 8.00 | 7.83 | 6.58 | 7.96 |
| forced-v2 | **8.92** | **8.38** | **8.25** | **8.58** | **7.08** | **8.46** |

Share of spend by model:

| Way | Opus | Sonnet | Haiku |
|---|---|---|---|
| team v1 / forced v1 | 100% | 0% | 0% |
| team-v2 | 95% | 5% (38k output tokens) | 0% |
| forced-v2 | 97% | 3% | 0% |

### What changed
- **The delegation fix worked.**
  - Team-v2 did easy alone (0 sections, same cost as solo: $0.62 vs $0.60).
  - It woke sections on medium (3.5) and hard (4), where v1 skipped them.
- **Quality went up.** Team-v2 moved from +0.56 to +0.96 over solo, and forced-v2 from +0.87 to +1.35. Forced-v2 was never ranked last. The gains are again in tests (+1.4 to +1.6), robustness (+1.5 to +2.3) and docs.
- **Cost went up too.**
  - Team-v2 now costs about the same as forced (2.9× solo), because it delegates.
  - Lighter section heads did not offset the extra agents: forced-v2 has 2.40M tokens vs 2.37M in v1.
- **Cheap helpers barely ran.** The Sonnet coder took only 3–5% of spend, and the Haiku scout was never used. Section heads still do most of the work on Opus.

### Verdict after round 2
- **Quality per dollar is still best with solo.** Solo wins every weighting, because the quality gap (about 1 point out of 10) is small next to a ~3× cost and ~2.3× time gap.
- **Team-v2 now behaves like a cheaper forced mode.** It brings most of forced's quality gain at the same price. It is no longer the "small overhead" middle option that team v1 was.
- **To get the v1 balance back with the v2 quality, the next fix is to move work off Opus**, not to delegate more. Options:
  - a lean default that delegates only multi-area tasks;
  - making helpers mandatory for test-writing;
  - a per-task "quality mode" the user switches on.

## Limits of this benchmark
- **2 runs per cell:** treat small differences (under about 0.5 judge points) as noise.
- **The tasks were solved fully by every approach**, so harder tasks are needed to test correctness differences.
- **Headless runs:** no Team Board, sections ran in the foreground, and relay messaging between sections was not exercised.
- **Fable was disabled** for safety, since `-p` would bill it without asking.
- **Costs** are Claude Code's API-equivalent estimates. On a subscription they count against usage limits instead.

Data: `bench/results/` (local, git-ignored): `summary.json`, `report-data.json`, `judge.json` (all judge notes) and `blind-key.json`. Round 2 has `-v2` versions of the last three (`node bench/run.mjs --tag=v2 --conds=team,forced`, `node bench/anonymize.mjs --round=v2 --conds=solo,team-v2,forced-v2`, `node bench/aggregate.mjs --round=v2`). Reproduce with `node bench/run.mjs`, `node bench/score.mjs`, `node bench/anonymize.mjs`, the judging workflow, and `node bench/aggregate.mjs`.
