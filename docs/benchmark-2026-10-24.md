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

## Limits of this benchmark
- **2 runs per cell:** treat small differences (under about 0.5 judge points) as noise.
- **The tasks were solved fully by every approach**, so harder tasks are needed to test correctness differences.
- **Headless runs:** no Team Board, sections ran in the foreground, and relay messaging between sections was not exercised.
- **Fable was disabled** for safety, since `-p` would bill it without asking.
- **Costs** are Claude Code's API-equivalent estimates. On a subscription they count against usage limits instead.

Data: `bench/results/` (local, git-ignored): `summary.json`, `report-data.json`, `judge.json` (all judge notes) and `blind-key.json`. Reproduce with `node bench/run.mjs`, `node bench/score.mjs`, `node bench/anonymize.mjs`, the judging workflow, and `node bench/aggregate.mjs`.
