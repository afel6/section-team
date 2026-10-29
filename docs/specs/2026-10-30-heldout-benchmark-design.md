# Held-out benchmark round — design (2026-10-30)

## Why
The team was tuned over 17 rounds on the same three tasks (easy, medium, hard), and the README says so: "expect smaller gains on real projects". This round asks whether the gain over plain Claude Code holds on tasks the team has never seen, and how the reviewer gate behaves there. The result is published whatever it shows.

## Pre-registration
Before the first paid run, one commit (the **freeze commit**) holds the tasks, the seed repo, the hidden tests, the reference solutions, the judge prompt and this success rule. The write-up cites that commit.

**Success rule.** The gain holds when both are true over all held-out pairs:
1. team's mean blind judge quality is at least **0.5** above solo's (above the ±0.3 noise of the old rounds), and
2. team's mean hidden-test pass rate is not below solo's.

Anything else is reported as "the gain did not hold", with the numbers.

## What is frozen
- **Plugin:** the files at tag `v0.1.1`. Before the first run and again before publishing, `git diff --stat v0.1.1 HEAD -- agents hooks skills brief .claude-plugin scripts types` must print nothing. On 2026-10-30 it prints nothing.
- **Harness, tasks, hidden tests, judge prompt:** the freeze commit. A harness bug found during the runs may be fixed only if it does not touch scoring rules; affected runs are rerun and the write-up lists them.
- **No tuning on these tasks**, before or after. Once published, H1–H3 are no longer held out; any later change measured on them must say so.

## Tasks
Three tasks, named `h1`, `h2`, `h3` (no dashes: `aggregate.mjs` splits pair ids on `-`). Specs live in `bench/tasks/<task>.md`, hidden tests in `bench/hidden/<task>.test.mjs`, as for the old tasks. Same rules as before: Node.js built-ins only, no npm install, headless, no outside services.

- **H1 — outside pick.** One task picked by the person who raised the question: a one-paragraph spec that a developer could build in an afternoon. I turn it into a spec in the house format, write the hidden tests and a reference solution, and he may review the hidden tests. If no pick arrives by **2026-11-06**, I write H1 myself and the write-up says so.
- **H2 — existing codebase.** A seeded repo in `bench/seeds/h2/`: a small Node.js HTTP JSON service of about 500 lines with its own passing `node:test` suite. The task text gives two bug reports written as users would (symptom, not cause) and one feature request. Each bug's root cause sits in a function shared by more than one path, so a patch on only the reported path fails a hidden test on a sibling path. The existing tests must keep passing.
- **H3 — tricky-spec library.** A 5-field cron expression library, UTC only: `parse(expr)` and `next(expr, from, n)` returning the next `n` matching times strictly after `from`. The spec covers `*`, lists, ranges, steps, month and weekday names, `7` as Sunday, the day-of-month / day-of-week OR rule when both are restricted, short months and leap years, and exact errors for invalid and never-matching expressions.

H2 and H3 are chosen so the hidden tests can separate the setups. On the old tasks every setup passed 100%.

## Hidden tests
- Each requirement line in a task spec has at least one hidden test.
- Calibration: the reference solution passes 100%. For each task at least **3 near-miss versions** of the reference (an off-by-one, a symptom-only fix, a dropped edge case) each fail at least one hidden test. The near-miss versions are kept in the freeze commit under `bench/heldout-calibration/` so anyone can rerun the check.

## Harness changes (all in the freeze commit)
- `run.mjs`: `--tasks=` (default `easy,medium,hard`) and `--reps=` (default `2`); timeouts for `h1`–`h3`; when `bench/seeds/<task>/` exists, `freshRepo` copies it in and commits it as `seed` so the run's own changes are a diff from that commit.
- `anonymize.mjs`: the same `--tasks=` and `--reps=`; for a seeded task it also copies the untouched seed into `<pair>/SEED/` so judges can see what the run changed.
- `aggregate.mjs`: task order includes `h1`–`h3`.
- `judge.mjs` (new): runs one blind judge per pair as a headless `claude -p --model claude-opus-5-5` session in the anonymized folder with `bench/judge-prompt.md`, and appends its JSON to `results/judge-<round>.json` in the format `judgeScores` already reads (`pair`, `X`, `Y`, `ranking`, `notes`). Resumable like `run.mjs`.
- `bench/judge-prompt.md` (new): the judge prompt, committed this time. Same 5 dimensions (correctness, code quality, tests, robustness/security, docs/usability, 1–10) plus overall and a ranking; judges may run tests and probes in a `mktemp -d` folder they delete by exact path.
- `gate-stats.mjs` (new): see below.
- Existing tests in `bench/*.test.mjs` keep passing; new parsing code gets tests.

## Runs
- Setups: **solo** (plugin off) and **team** (plugin at `v0.1.1`). Forced mode is dropped.
- **3 runs per cell**: 3 tasks × 2 setups × 3 runs = **18 runs**, tag `ho` (`node bench/run.mjs --tag=ho --conds=team,solo --tasks=h1,h2,h3 --reps=3`).
- Same prompt prefix, allowed tools, model and global setup as round 17.

## Judging
- Blind X/Y pairs, **2 Opus judges per pair**: 9 pairs, 18 judges.
- **Judge-prompt check:** the old judge prompt was not kept, so before judging the held-out pairs, if the round-17 run folders still exist, 2 of their pairs are judged with the new prompt and compared with the stored round-17 scores. The gap is reported; it does not change the success rule.

## Gate stats (no extra runs)
`gate-stats.mjs` reads each team run's subagent transcripts (`collectRoles` in `score.mjs`) and its saved REPORTs (`parseReport` in `hooks/lib/report.mjs`), and writes `results/gate-stats-<round>.json` plus a markdown table:
- per run: reviewer calls, the sequence of `Overall` grades and verdicts, first-try pass (yes/no), fix rounds used, final grade, and REPORTs that ended `partial` or `blocked`;
- **gate misses:** hidden tests that fail in a run whose last gate verdict was pass, by test name;
- a per-run table of final gate grade next to the judges' code-quality score. With 9 team runs, no correlation claim is made; the table is shown as is.

## Publishing
- `docs/benchmark-heldout-2026-11.md`: setup, freeze commit, success rule, results table, gate stats, judge-prompt check, limits.
- Raw data in `bench/data/heldout/`: `summary.json`, `judge-ho.json`, `blind-key-ho.json`, `gate-stats-ho.json`, and the recompute command.
- README: the **Limits** line under the results table gets the held-out outcome, in one sentence, with a link.

## Cost and approvals
- Runs: about **$36** at round-17 averages (team $3.10 and solo $0.85 per run, 9 runs each). New tasks may cost more or less.
- Judging: measured on one dry-run judge first, then estimated for all 18 plus the judge-prompt check.
- **No paid run without the user's yes**, asked twice: before the 18 runs (with the estimate) and before judging (with the measured judge cost).

## Out of scope
- A gate-off setup (would show whether the gate causes the gain; needs a plugin switch and about 50% more cost). Revisit if the gate stats suggest it.
- Python or other languages, forced mode, any plugin change, more tuning rounds.
