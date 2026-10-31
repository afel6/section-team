# Held-out benchmark — section-team on tasks it was never tuned on (2026-10-31)

## Why

The team was tuned over 17 rounds on the same three tasks, and the README said so: "expect smaller gains on real projects". Someone asked the fair question: does the gain hold on tasks the team has never seen, and how does the reviewer gate behave there? This round answers it, and the result was to be published whatever it showed.

## Pre-registration and verdict

Everything was fixed in one commit before the first paid run: **freeze commit [`c988fce`](https://github.com/afel6/section-team/commit/c988fce5c7ef2caae1f9111069fc0716d63f3ce9)** (tag `heldout-freeze`, pushed before the runs). It holds the three tasks, the h2 seed repo, the hidden tests, the calibration references and near-miss versions, the judge prompt, the harness and this rule.

**Success rule.** The gain holds when both are true over all held-out pairs:
1. team's mean blind judge quality is at least **0.5** above solo's, and
2. team's mean hidden-test pass rate is not below solo's.

**Verdict: the gain held.** Team's mean blind judge quality was **8.80** against solo's **8.16** (+0.64, above the 0.5 bar), and both passed **100%** of the hidden tests. The gain is smaller than on the tuned tasks (+1.46 in round 17), as the README predicted, and it costs about 2.2 times as much per task.

## Setup

- **Plugin:** section-team frozen at `v0.1.1`; `git diff v0.1.1 -- agents hooks skills brief .claude-plugin scripts types` was empty at the freeze, after the runs and at publishing.
- **Setups:** *solo* (plugin off, plain Claude Code) and *team* (plugin on, the supervisor decides when to delegate). Same prompt prefix, tools, model and global setup as round 17.
- **Runs:** 3 tasks × 2 setups × 3 runs = 18 headless `claude -p` runs, on 2026-10-31.
- **Judging:** 9 blind X/Y pairs, 2 Opus judges each, scoring correctness, code quality, tests, robustness/security, docs/usability and overall from 1 to 10, plus a ranking. *Judge quality* is the mean of those six scores.

### The tasks (none existed before 2026-10-30)

| Task | Shape | What makes it hard |
|---|---|---|
| **h1** — `ini2json.mjs` | command-line tool with an exact spec | typed values, quoted strings with escapes, merged repeated sections, `__proto__` as a key, exact errors, line numbers and exit codes |
| **h2** — stock-keeping service | an existing ~500-line HTTP service with its own tests | two user bug reports whose root cause sits in a shared function (a fix on the reported path only fails the sibling path), plus a CSV export |
| **h3** — `cron.mjs` | library with a tricky spec | steps and ranges, names, `7` as Sunday, the day-of-month / day-of-week OR rule, leap years, exact errors |

H1 was first offered to the person who asked the question; we chose not to wait for a pick, so H1 was written in-house. Its text went through an adversarial ambiguity review (four reviewers, a skeptic per issue, five ambiguities fixed) before any test was written.

### Hidden tests

Each task's hidden tests were written by one agent and its reference solution by another, apart. Calibration (rerunnable with `node bench/calibrate.mjs h1|h2|h3`):

| Task | Hidden tests | Reference | Near-miss versions (each one plausible bug) |
|---|---|---|---|
| h1 | 42 | 42/42 | 6, failing 1–4 tests each |
| h2 | 17 | 17/17 | 5, failing 1–5 each; the untouched seed fails 10 |
| h3 | 23 | 23/23 | 5, failing 1–3 each |

### Keeping the round blind and independent

A review of the harness before the freeze found ways the round could have been skewed. Each was fixed in the frozen harness:

- **Section memory.** Section agents keep a persistent memory, and it held notes written while these tasks were built. The user's section memory was moved aside for the round, every team run started with empty memory (the plugin as a new user installs it), and each run's notes were filed with its results.
- **No skill installs** during the round, so no run changed the next one's tools; a paid preflight confirmed it, and that section-team loaded for team runs only.
- **Neutral names.** Run folders are `<task>-<hash>`, so "team" or "solo" never reaches a file a judge reads.
- **Neutral judges.** Judges ran with section-team off, each in its own copy of the pair, and the second judge of each pair saw X and Y swapped.
- A no-cost dry run of the whole pipeline with a fake `claude` checked all of this before any paid run.

## Results

| Task | Way | Cost $ | Minutes | Hidden tests | Judge quality /10 | Judge 1st places |
|---|---|---|---|---|---|---|
| h1 | solo | **0.87** | **3.3** | 100% | 8.30 | 0 of 6 |
| h1 | team | 2.09 | 9.0 | 100% | **8.93** | **6 of 6** |
| h2 | solo | **0.85** | **2.6** | 100% | 8.33 | 2 of 6 |
| h2 | team | 1.41 | 4.1 | 100% | **8.63** | **4 of 6** |
| h3 | solo | **0.86** | **2.9** | 100% | 7.83 | 0 of 6 |
| h3 | team | 2.10 | 6.1 | 100% | **8.83** | **6 of 6** |
| **all** | **solo** | **0.86** | **2.9** | 100% | 8.16 | 2 of 18 |
| **all** | **team** | 1.87 (×2.2) | 6.4 (×2.2) | 100% | **8.80** | **16 of 18** |

Cost is what the CLI reports per run (`total_cost_usd`); on a Claude subscription it is plan usage, not a bill.

### Where the difference comes from

| Way | correctness | code quality | tests | robustness/security | docs/usability | overall |
|---|---|---|---|---|---|---|
| solo | 9.00 | 8.22 | 7.00 | 8.39 | 8.17 | 8.00 |
| team | **9.11** | **8.50** | **8.94** | **8.61** | **8.83** | **8.89** |

Most of the gap is in **tests** (+1.94) and docs (+0.67): the team's testing section writes broader test suites. On correctness, code quality and robustness the two are close (+0.11 to +0.28): both setups wrote working code, and every run passed every hidden test.

**The judges agreed.** In all 9 pairs both judges picked the same winner, although the second judge saw the solutions under swapped labels; team led by the same +0.89 overall whether a judge saw it as X or as Y. Team won 8 of the 9 pairs. Solo won h2 rep 1: that team run saved four of the seed's files with Windows line endings, so every line showed as changed, and both judges marked its code quality down (7 against 8–9) for that and a latent content-type bug. Its fixes were correct.

## The reviewer gate

| Run | Reviewer calls | First-try passes / callers | Fix rounds | Final grades | Partial / blocked REPORTs | Gate misses | Judges' code quality |
|---|---|---|---|---|---|---|---|
| h1 r1 | 2 | 2/2 | 0 | 8 pass, 9 pass | 0/0 | none | 9 |
| h1 r2 | 2 | 2/2 | 0 | 9 pass, 9 pass | 0/0 | none | 8 |
| h1 r3 | 2 | 2/2 | 0 | 9 pass, 9 pass | 0/0 | none | 9 |
| h2 r1 | 1 | 1/1 | 0 | 9 pass | 0/0 | none | 7 |
| h2 r2 | 2 | 2/2 | 0 | 9 pass, 9 pass | 0/0 | none | 9 |
| h2 r3 | 1 | 1/1 | 0 | 9.4 pass | 0/0 | none | 9 |
| h3 r1 | 3 | 1/2 | 1 | 9 pass, 8 pass | 0/0 | none | 8.5 |
| h3 r2 | 2 | 2/2 | 0 | 9 pass, 9 pass | 0/0 | none | 8 |
| h3 r3 | 2 | 2/2 | 0 | 9 pass, 9 pass | 0/0 | none | 9 |

17 reviewer calls in 9 team runs; 15 of 16 callers passed on the first try, and one fix round was needed (h3 r1). Every final grade passed (8–9.4), and no hidden test failed after a passing gate. The gate did not catch everything the judges disliked: h2 r1 passed it at 9, while the judges gave its code quality 7 (the line-ending churn above). With 9 runs, no correlation claim is made.

## Limits

- n = 3 per cell; one judge prompt; Node.js tasks only.
- Hidden tests did not separate the setups: both passed all of them, as in every earlier round. The verdict rests on blind judge quality.
- Builders and judges ran with the user's other plugins, shell environment and *auto* permission mode, as in round 17, the same for both setups. Auto mode let judges run safe commands beyond their tool list (`find`, `mkdir`, writing probe files in their own folder); each judge worked on a temporary copy, so this could not affect the solutions or the other judges.
- Judges could in principle read the blind key with `node`; nothing suggests one did.
- A few spec lines have no hidden test because they cannot be produced the same way on every OS (for example "any other read error" in h1).
- The judge-prompt check against round 17 was skipped: the round-17 run folders no longer existed, so the two rounds' judge scores come from different prompts and are not strictly comparable.
- **Post-freeze change:** one reporting fix, after the runs: `gate-stats.mjs` read background reviewers' grades as missing (they answer through a `SubagentHandback` tool call). No scoring rule changed and no run was rerun.
- **Reruns:** none; no run crashed, timed out or ended on an API error.
- Usage for the round: $24.57 for the 18 runs, $11.84 for the 18 judges, plus a small preflight.

## Recompute

Raw data and the recompute command are in [`bench/data/heldout/`](../bench/data/heldout/).
