# Round nx: 0.6.0-rc.1 against v0.5.1 and plain Claude Code (2026-11)

Round nx measured the release candidate of section-team 0.6.0 (`v0.6.0-rc.1`) against the previous release (v0.5.1) and against Claude Code without the plugin, on three new tasks. Its bars and keep rule were frozen in the tag [`nx-freeze`](https://github.com/afel6/section-team/tree/nx-freeze), which was pushed before the first run of the round. This page is published whatever the round showed.

## Summary

- **L1 missed its quality bar.** L1 is the Balanced direct tier that rc.1 added. On h8, the task built for it, team (rc.1) − base (v0.5.1) was -0.38 in Codex's five-dimension mean, 95% range [-1.67, +0.91], over 5 groups, with Codex as the only judge. The bar was at least -0.25. L1 met its cost bar (0.65× base, 5 runs per setup) and the hidden-test, near-miss and validity bars.
- **The range includes zero.** The round does not show that the direct tier made worse solutions, and it does not show that it did not. With 5 groups it cannot resolve a difference of a quarter point.
- **L1 was reverted, as the frozen keep rule requires.** The revert is commit `7dd5bf3`, merged into `next/0.6.0` as `9e76662`.
- **The released 0.6.0 is rc.1 without L1**, plus docs, data and label changes. No round measured that exact build.
  - On h8 the team numbers belong to the reverted lever. The nearest measured figure for how 0.6.0 handles a task like h8 is base (v0.5.1).
  - On h9 and h10 L1 did not fire, so team (rc.1) is the closest measured build.
- **Against plain Claude Code** (reported, no bar; Codex, one judge):
  - base (v0.5.1) scored +1.00 over solo on h8 at 2.92× solo's cost (5 groups), the nearest measured figure for how 0.6.0 handles h8;
  - h9 and h10 had 2 groups each; their gaps are in [the reported table](#plugin-against-plain-claude-code-reported).
- **Hidden tests were at ceiling.** Every run of every setup passed all of them (20 on h8, 40 on h9, 42 on h10), so they do not separate the setups.
- **The round cost $66.21**, above the quoted about $55 (at most about $63). The plugin runs on h10 cost far more than estimated.

## Why this round

rc.1 added L1, the Balanced direct tier. For a question, or a fix of about 30 lines of non-test code that adds no feature, the supervisor does the job itself and the Opus reviewer grades it. No builder section is woken. The round had three jobs:

1. decide whether L1 ships, by bars frozen before the round ran;
2. give per-tier cost and quality of the candidate against v0.5.1 and plain Claude Code, on tasks the sections were not tuned on;
3. run one publicly frozen round of the version being released, on unseen tasks.

The third job was meant for the shipping build. L1 was reverted, so the shipping build differs from the measured one ([What ships in 0.6.0](#what-ships-in-060)).

## Setup

- **Freeze.** Tag [`v0.6.0-rc.1`](https://github.com/afel6/section-team/tree/v0.6.0-rc.1) (`9ec796f`) holds the measured behaviour. Tag `nx-freeze` (`54e50c3`) holds:
  - rc.1;
  - the tasks h8 to h10, their hidden tests and their near-miss versions;
  - `bench/bars-nx.json` (the bars, the keep rule and the reported ranges);
  - the harness.

  The tag message lists the SHA-256 of each task and hidden-test file. Both tags were pushed to the public repo on 2026-11-23, before the first run of the round. The harness commit was checked clean before every run.
- **Setups.** All three ran on one fresh Claude Code profile on one Windows PC.

  | Setup | What it is | Ref |
  |---|---|---|
  | `solo` | plain Claude Code, no plugin | none |
  | `base` | section-team v0.5.1 in Balanced | `v0.5.1` (`043e00d`) |
  | `team` | section-team 0.6.0-rc.1 in Balanced, with L1 | `v0.6.0-rc.1` (`9ec796f`) |

- **Shared settings.**
  - Claude Code 2.1.318, pinned by binary hash in a preflight. The pin file is not published because it holds a local home path.
  - Model `claude-opus-5-5`, effort medium.
  - Advisor tool off, automatic skill installs off, `--strict-mcp-config`.
  - In both plugin setups the coder helper runs on Sonnet 5.5 by design.
- **Runs.**
  - h8 × 5, h9 × 2 and h10 × 2 per setup: 27 runs in 9 blind groups.
  - Odd reps ran solo, base, team and even reps ran in reverse, one run at a time, on 2026-11-23 and 24.
  - All 27 exited 0 on the first attempt. None was re-run and none timed out.
  - There was no Max arm.
  - **Pilot.** Before the freeze, a pilot of 8 runs (on h5 and h6 with the three setups, and on h5p with base and team) checked the harness. Its rows are in `summary.json`, with ids ending `-pnx-r1`. No bar or table on this page reads them.

### The tasks

| Task | Tier | What it asks | Hidden tests | Near-miss versions | Runs per setup |
|---|---|---|---|---|---|
| h8 | direct job (L1's tier) | An existing command-line lending tracker with two user bug reports: an impossible due date is accepted, and a loan number is reused after a delete. Fix both without adding features, and keep old data files working without a migration. | 20 | 6 | 5 |
| h9 | single-area | An arithmetic expression library and its command-line tool, built from a spec (reference solution: 226 lines). | 40 | 11 | 2 |
| h10 | multi-area | A quick-polls app: an HTTP JSON API, a browser page and one JSON data file (reference solution: 447 lines, 153 of them browser code). | 42 | 11 | 2 |

Reference sizes are raw source lines of the frozen reference solution, without tests, docs and `package.json`. The time limits per run (60, 60 and 120 minutes) are the harness's (`bench/run.mjs`).

All 5 team h8 runs took the direct tier: they spawned only the reviewer. All 5 base h8 runs woke the backend section, its coder and the reviewer.

**h8 to h10 were written by Claude agents this week**, for this round. They were not in either plugin version's tree (rc.1 was checked to hold no h8 to h10 file). They come from the same model family that builds them (Claude); the judge, Codex, is from another vendor. The round cannot remove that limit.

### Judging

- **Judge.** Codex (`gpt-6.1-sol`, ultra effort) judged blind, in one fresh session per case, in a read-only sandbox.
- **Cases.** 9 groups × 2 mirrored orders = 18 cases, each holding the three solutions under neutral labels.
  - All 18 were usable on the first attempt.
  - Judging paused twice at Codex usage limits; no attempt was used up.
- **Score.** The mean of five dimensions, each 1 to 10: correctness, code quality, tests, robustness/security and docs/usability.
- **One judge.** Codex is the only judge of this round. No second judge scored it, and the round had no held-out check of the judge.
- **Blocked suites.** Codex's sandbox blocked every test suite that spawns a process or makes a temp folder (EPERM). Codex did run:
  - in-process suites (`node --test --test-isolation=none`);
  - some suites again over an in-memory file system;
  - its own probes.

  So part of each solution's own tests was never run by the judge.

## Bars and keep rule

The bars come from `bench/bars-nx.json` in `nx-freeze`. Each is team against base on h8 unless it says otherwise; quality is Codex's five-dimension mean. The readings are the output of `bench/bars.mjs`, published as [`bench/data/nx/bars-nx.json`](../bench/data/nx/bars-nx.json).

| Bar | Result | What it asks | Reading |
|---|---|---|---|
| C1 | met | h8 mean cost: team at most 0.75× base | h8 cost team/base 0.65× (at most 0.75×): $0.72 vs $1.11 |
| Q1 | missed | h8: team − base at least -0.25 | h8 team − base -0.38 [-1.67, +0.91] over 5 groups (at least -0.25) |
| H1 | met | h8 hidden tests: team at least solo's, and at least base's − 1 | h8 hidden passed team 20.00 vs solo 20.00, base 20.00 − 1 |
| T1 | met | h8 near-misses caught by team's own suite: at least base's − 1 | h8 near-misses caught team 6.00 vs base 4.80 − 1 |
| V1 | met | all 5 team h8 runs wake no builder section (the lever fires) | all 5 team h8 runs spawned only the reviewer and built-ins |
| V1b | met | a base h8 run that wakes no builder is void and re-run once | no base h8 void is owed a rerun |
| V2 | met | plain baseline: the preflight is clean, and no solo run spawns a non-built-in agent | profile and runs root checked by the preflight; no solo run spawned a non-built-in agent |
| V3 | met | every run's plugin commit and version match its ref | every run's commit and version match its ref |
| V4 | met | main and every section whose agent file declares Opus answer as `claude-opus-5-5` | main and every opus section on the round's model |
| V5 | met | no run past its limit (60, 60 and 120 minutes for h8, h9 and h10) | no run past its limit |
| V6 | met | at least 8 of 9 groups usable on Codex, and at least 4 of the 5 on h8 | 9 of 9 groups usable (at least 8), 5 of 5 on h8 (at least 4) |

**Keep rule (frozen):** L1 ships only if C1, Q1, H1 and T1 are met and V1 to V6 hold. Q1 was missed, so the decision is: revert L1 (merge revert/l1). It was applied as commit `7dd5bf3`, which reverts the eight L1 commits, and merged into `next/0.6.0` as `9e76662`.

How to read the bars:

- **Q1.** L1 missed its quality bar: -0.38 over 5 groups, 95% range [-1.67, +0.91], one judge.
  - The range includes zero and the bar.
  - A faithful-only check gives the same figure: both runs that broke their mode's rules are on h10 ([Mode fidelity](#mode-fidelity-two-runs-flagged)), so it uses the same 5 h8 groups and gives -0.38.
- **H1.** Every run of every setup passed 20 of 20. That is a tie at the ceiling.
- **T1.** Team caught 6 of 6 near-misses in every run, which is the ceiling.
  - Base's 4.80 comes from r1 and r3, which caught 3 of 6. In each of them, one of the two test files failed alone against the reference solution, so it was not counted.
  - Why those files failed was not diagnosed.
- **V4** was frozen narrower than the plan's first wording, "every assistant turn reports `claude-opus-5-5`". It checks main and the Opus sections. The coder helper runs on Sonnet 5.5 in both plugin versions; it is reported in `mode-check-nx.json`, not checked.
- **Reported checks (frozen ranges, not bars).** h9 and h10 check the paths L1 does not touch, team against base. The frozen expectation was cost within 0.85 to 1.15× and quality at least -0.30.
  - h9: cost 0.92× base, quality -0.05 (2 groups), inside both ranges.
  - h10: cost 0.88× base, quality +0.10 (2 groups), inside both ranges.
  - The bars compute h9's 0.92× from exact means. The recompute table below shows 0.93× because it rounds each mean to cents ($1.86 / $2.01) before dividing. This page cites 0.92×.

## What ships in 0.6.0

- L1 was reverted (`7dd5bf3`, merged as `9e76662`). The release is rc.1 without L1, plus the docs, benchmark data and label changes made after the freeze. **No round measured that exact build.**
- **On h8** the team rows are the reverted lever: its cost, wall time, quality, mainPeak and cost by role. They are not what 0.6.0 costs or scores.
  - The nearest measured figure for how 0.6.0 routes a fix like h8 is base: +1.00 over solo at 2.92× solo's cost (5 groups, Codex, reported).
  - That figure is only approximate. 0.6.0 keeps rc.1's other changes (the safety and trust fixes and the other behaviour changes in the changelog), which v0.5.1 does not have.
- **On h9 and h10** L1 did not fire, so team (rc.1) is the closest measured build.
- **The overall cost rows include h8's L1 arm**, so they do not describe 0.6.0 either: team 7.26× solo with the tiers weighted equally (5.97× over all runs), and 0.87× (0.84×) base.
  - An estimate (not a measurement) takes h8 from base and h9 and h10 from team: $1.11 + $1.86 + $10.42 = $13.39 per set of three tasks, 7.48× solo's $1.79.
- What changed in the behaviour files between the measured commit and the release branch, at `next/0.6.0` = `9e76662`:

  ```text
  $ git diff --stat v0.6.0-rc.1 next/0.6.0 -- agents brief hooks skills scripts
   brief/gate-balanced.md       |  1 -
   brief/tiers-balanced.md      |  2 +-
   scripts/gen-agents.mjs       | 57 +++++++++-----------------------------------
   skills/direct-build/SKILL.md | 21 ----------------
   4 files changed, 12 insertions(+), 69 deletions(-)
  ```

  At release this will be refreshed against the v0.6.0 tag with `git diff --stat v0.6.0-rc.1 v0.6.0 -- agents brief hooks skills scripts`.

## Results

`node bench/data/nx/recompute.mjs` prints these tables from the published data alone ([Data](#data)). How to read them:

- **Means.** Each figure is a mean per run: 5 runs per setup on h8, 2 on h9 and h10.
- **Cost** is the CLI's reported `total_cost_usd`. On a Claude subscription it is plan usage, not a bill.
- **Overall rows.** "Tiers weighted equally" adds the three task means. "All runs" is the round's spend, where h8 counts five runs per setup.
- **Codex means** are over the groups judged for all three setups (every group here).
- **Near-misses** are frozen wrong versions of the reference solution. A run catches one when its own tests fail against it. Each test file must first pass alone against the reference, or it does not count.
- **mainPeak** is the largest context of any main-session turn: input plus cache read plus cache creation.
- **`team` is rc.1 with L1.** On h8 its rows describe the reverted lever, and the overall cost rows include them.
- **h9 team×base** prints 0.93× here and 0.92× in the bars (see above).

```text
round nx, recomputed from summary.json, judge-nxcx.json, blind-key-nxcx.json, test-strength-nx.json and cost-by-role-nx.json
cost (USD per run)
                                        solo      base      team team×solo team×base base×solo
  h8                                   $0.38     $1.11     $0.72     1.89×     0.65×     2.92×
  h9                                   $0.57     $2.01     $1.86     3.26×     0.93×     3.53×
  h10                                  $0.84    $11.90    $10.42    12.40×     0.88×    14.17×
  overall, tiers weighted equally      $1.79    $15.02    $13.00     7.26×     0.87×     8.39×
  overall, all runs (total)            $4.71    $33.36    $28.14     5.97×     0.84×     7.08×
wall time (minutes per run)
            solo      base      team team×solo team×base base×solo
  h8         1.2       3.6       2.3     1.92×     0.64×     3.00×
  h9         2.4       8.1       7.5     3.13×     0.93×     3.38×
  h10        3.3      29.7      31.7     9.61×     1.07×     9.00×
Codex five-dimension means
            solo      base      team team−base team−solo
  h8        7.44      8.44      8.06     -0.38     +0.62  (5 groups)
  h9        9.05      9.65      9.60     -0.05     +0.55  (2 groups)
  h10       7.10      8.50      8.60     +0.10     +1.50  (2 groups)
hidden tests passed (mean)
            solo      base      team
  h8        20.0      20.0      20.0  of 20
  h9        40.0      40.0      40.0  of 40
  h10       42.0      42.0      42.0  of 42
near-misses caught by the run's own suite (mean)
            solo      base      team
  h8         5.4       4.8       6.0  of 6
  h9        10.5      11.0      11.0  of 11
  h10        6.0       9.5       4.5  of 11
mainPeak (tokens, mean)
            solo      base      team
  h8       41010     38117     51846
  h9       42666     38244     39150
  h10      52876     67575     66088
cost by role (mean per run)
  h10 base: section-team:backend $2.71 (23%), section-team:reviewer $2.41 (20%), section-team:testing $2.01 (17%), section-team:frontend $1.99 (17%), section-team:coder $1.15 (10%), main $0.94 (8%), section-team:docs $0.39 (3%), section-team:plan-advisor $0.30 (2%)
  h10 solo: main $0.84 (100%)
  h10 team: section-team:backend $3.34 (32%), section-team:reviewer $1.74 (17%), section-team:frontend $1.35 (13%), section-team:testing $1.31 (13%), section-team:coder $1.03 (10%), main $0.97 (9%), section-team:docs $0.37 (4%), section-team:plan-advisor $0.31 (3%)
  h8 base: section-team:backend $0.53 (48%), main $0.25 (23%), section-team:reviewer $0.17 (15%), section-team:coder $0.15 (14%)
  h8 solo: main $0.38 (100%)
  h8 team: main $0.56 (78%), section-team:reviewer $0.16 (22%)
  h9 base: section-team:backend $1.15 (57%), section-team:coder $0.31 (15%), section-team:reviewer $0.30 (15%), main $0.25 (12%)
  h9 solo: main $0.57 (100%)
  h9 team: section-team:backend $0.76 (41%), section-team:coder $0.40 (22%), main $0.35 (19%), section-team:reviewer $0.34 (18%)
```

### h8 group by group

Codex's five-dimension mean per group (two mirrored cases each), and the two bugs Codex's notes describe:

| Group | solo | base | team | team − base | Legacy-delete bug | Scale bug |
|---|---|---|---|---|---|---|
| h8 r1 | 6.70 | 8.80 | 8.20 | -0.60 | solo | solo, team |
| h8 r2 | 7.00 | 7.60 | 8.70 | +1.10 | solo, base | solo |
| h8 r3 | 7.50 | 8.80 | 7.00 | -1.80 | solo, team | team |
| h8 r4 | 8.60 | 8.20 | 8.00 | -0.20 | none | base, team |
| h8 r5 | 7.40 | 8.80 | 8.40 | -0.40 | solo | team |

By dimension, over the same 5 groups:

| Dimension | solo | base | team | team − base |
|---|---|---|---|---|
| correctness | 7.10 | 8.40 | 8.10 | -0.30 |
| code quality | 8.00 | 8.60 | 8.10 | -0.50 |
| tests | 7.10 | 8.80 | 8.20 | -0.60 |
| robustness/security | 6.80 | 7.60 | 7.00 | -0.60 |
| docs/usability | 8.20 | 8.80 | 8.90 | +0.10 |

What Codex's notes say. Codex reported each bug in both mirrored cases of its group. Neither bug is among h8's six near-miss versions (three wrong date checks and three wrong numbering rules), and every one of these solutions passed 20 of 20 hidden tests.

- **Legacy-delete numbering.** Take a data file saved before the fix, which has no stored counter. Removing its highest loan and then adding one issues the removed number again, which the README forbids.
  - Reported in solo r1, r2, r3 and r5, base r2 and team r3.
  - Count: solo 4 of 5 groups, base 1, team 1.
- **Scale.** The new numbering code spreads every loan number into `Math.max(...)`. That throws `RangeError` on a valid store of 150,000 to 200,000 loans, where the original code works.
  - Reported in solo r1 and r2, base r4 and team r1, r3, r4 and r5.
  - Count: solo 2 of 5 groups, base 1, team 4.

Where the bugs fall:

- In the three groups where team scored lowest against base (r1, r3 and r5), Codex named the scale bug in team's solution and not in base's.
- In r2, where team led by +1.10, base had the legacy-delete bug.

This is a pattern in 5 groups from one judge. It is something to test next, not a measured effect of L1.

### Plugin against plain Claude Code (reported)

No bar was set for these gaps; they are reported. All quality figures are Codex's, from one judge.

| Task | Groups | base − solo | base cost × solo | team − solo | team cost × solo |
|---|---|---|---|---|---|
| h8 | 5 | +1.00 | 2.92× | +0.62 | 1.89× |
| h9 | 2 | +0.60 | 3.53× | +0.55 | 3.26× |
| h10 | 2 | +1.40 | 14.17× | +1.50 | 12.40× |

- **h8's team row is the reverted L1 arm.** The closest measured figure for how 0.6.0 handles h8 is base: +1.00 at 2.92×.
- **base − solo** is the difference of the Codex means in the recompute table. Every group has all three setups, so it equals the mean of the group gaps.
- **Plan against measured cost.** The round's plan expected team at about 1.7 to 2.0× solo on h8, 2 to 3.3× on h9 and 5 to 7× on h10, and overall team/base about 0.93. Those expectations were in the plan, not in the freeze.
  - h8: 1.89× measured.
  - h9: 3.26× measured.
  - h10: 12.40× measured.
  - Overall team/base: 0.87× with the tiers weighted equally, 0.84× over all runs.

### h9 and h10

- **Cost by pair.** With 2 runs per setup, team against base went both ways on each task:
  - h9 r1: team $1.96, base $1.87;
  - h9 r2: team $1.76, base $2.16;
  - h10 r1: team $11.21, base $15.29;
  - h10 r2: team $9.64, base $8.51.
- **h10 wall time.** Team took 1.07× base's time (31.7 against 29.7 minutes per run).
- **h10 near-misses are reported only and confounded.** Team caught 4.5, base 9.5 and solo 6.0 of 11.
  - The sample is 2 runs per setup.
  - The figures are confounded by layout coupling. Several test files import modules by paths the reference solution does not have (for example `lib/app.mjs`), so they fail alone against the reference and do not count.
  - `h10-team-nx-r1` was left with one valid file, a helper, and caught 0 of 11. Its API and server test files failed on such an import; its page test failed two assertions on the reference.
  - Files of base r1 and team r2 were also dropped for modules the reference does not have.
  - Read none of this as weaker or stronger tests. No conclusion is drawn from it.

## Validity

### Mode fidelity: two runs flagged

[`bench/data/nx/mode-check-nx.json`](../bench/data/nx/mode-check-nx.json) checks each run against its mode's rules. 25 of 27 runs were faithful. Two h10 runs were flagged not faithful, with three flags between them:

| Run | Flag | What it was |
|---|---|---|
| `h10-team-nx-r1` | "gate of aa65fceb56e8b180e graded again after a pass" (frontend) | A harness false positive. The checker starts a new gate only at one kind of transcript row. Claude Code 2.1.318 records the supervisor's resume message to a section as a different kind, so two gates were read as one. The harness stayed frozen for the round, so the flag is still in the published file. |
| `h10-team-nx-r1` | "gate of abeb8867a43def12a ended early" (testing, final review) | Real plugin behaviour, described below the table. |
| `h10-base-nx-r2` | "gate of a44f12166068e08ca ended early" (testing, final review) | The same class, in v0.5.1. |

The ended-early flag in `h10-team-nx-r1` happened like this:

- The supervisor's final-review job asked testing to return failing items rather than send verdicts to builders.
- Testing handed back a failing grade (7 of 10) with no fix round.
- The supervisor passed the fixes on, did not have them graded again, and marked the final review done.

The rule in `brief/core.md` ("only failing fix lists go to the builders") leaves open who grades the fixes, and the sentence is the same in v0.5.1. A fix is on the 0.6.1 list.

Unfaithful runs count in every figure on this page. Only the faithful-only check leaves them out.

### Leak checks

- **Transcript search after every run.** Each run's transcripts were searched for:
  - the hidden tests and calibration files;
  - the freeze tag and the task branch;
  - the public repo's address;
  - the near-miss files and other run folders.

  There were 0 hits, apart from two uses of the word "near-miss" in a reviewer's grade text in `h10-base-nx-r2`, with no file read behind them. No run touched another run's folder.
- **f3.** f3 is an older task that, like h10, is a polls server. It sits in the rc.1 tree that the team setup loads; it is not in v0.5.1. No run touched f3's task, hidden tests, seed or calibration files, and no run read anything under a plugin's `bench/` folder.
- **Tell scan before judging.** The scan of the anonymized solutions found no files outside each solution's deliverables, tests and docs. It reported hits of the word "section": solo 8, base 14, team 14.
- **A subagent saw the harness command line.** In `h10-team-nx-r1`, a subagent ran a process listing that showed the run id and the plugin and base paths. That reveals the arm and that the run was a benchmark. It held no hidden-test content.
- **Detection, not isolation.** The hidden tests were reachable through git, via the plugin checkout's shared object store. The checks looked afterwards for any read of them; they did not prevent one.

## Cost of the round

- **Total.** The 27 runs cost $66.21: solo $4.71, base $33.36, team $28.14. That is above the quoted about $55 (at most about $63).
- **Overrun.** It came from h10: the plugin runs averaged $11.90 (base) and $10.42 (team) per run, against an estimate of about $6.40. Plan usage was read between runs, but the run costs were not added up until the round was over.
- **Logged total.** The total logged during the round was $66.23, which is what adding each run's cost rounded to cents gives. The exact sum, from `summary.json`, is $66.21.
- **Not included:**
  - the 8 pilot runs ($11.75; they are in `summary.json` with ids ending `-pnx-r1`);
  - the preflight;
  - Codex's judging (Codex plan usage, not priced).

## Limits

- **One judge.** Codex alone scored the round, with no held-out check of the judge. Its sandbox blocked the suites that spawn a process or make a temp folder (EPERM).
- **Small n.** Q1 rests on 5 groups, and h9 and h10 on 2 groups each. Q1's range is about ±1.3 wide against a 0.25 margin, so this design cannot resolve a gap of a quarter point.
- **Hidden tests at ceiling.** All 27 runs passed 100%, as in the mode and held-out rounds. The two h8 bugs Codex found are in neither the hidden tests nor the near-miss set.
- **Near-miss sets.** They were at or near the ceiling on h8 and h9, and confounded on h10.
- **Who wrote the tasks.** h8 to h10 were written by Claude agents this week.
- **The released build is not itself measured.** 0.6.0 is rc.1 without L1 ([What ships in 0.6.0](#what-ships-in-060)).
- **Final reviews.** On h10, one run in each plugin setup ended its final review without a passing grade.

## Data

- **Files.** All files are in [`bench/data/nx/`](../bench/data/nx/), and [its README](../bench/data/nx/README.md) lists what each one holds.
- **Recompute.** `node bench/data/nx/recompute.mjs` reprints the tables above from that folder alone.
- **Not published.**
  - The preflight's pin file (`preflight-nx.json`), because it holds a local home path.
  - Run transcripts and the solutions.
