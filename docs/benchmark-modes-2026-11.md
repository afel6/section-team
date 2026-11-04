# Mode round — Lean, Balanced and Max against plain Claude Code (2026-11)

## Why

Version 0.2.0 lets each project pick Lean, Balanced or Max. The picker showed Balanced's usage as measured and Lean's and Max's as targets. This round measures all three against Claude Code without the plugin, on three new tasks, by rules fixed before the first paid run. The result is published whatever it shows.

## Verdict

| Bar (fixed in advance) | Gap, 95% range | Hidden tests | Usage | Result | Outside judge (Codex) |
|---|---|---|---|---|---|
| **Lean** over solo: at least +0.30, and at most 1.50× solo's usage on h5 and h6 | **+0.79** [+0.27, +1.31] | 100% vs 100% | 1.42× on h5 and h6 | **met, outside-confirmed** | agrees in 8 of 9 groups, gap +0.43 |
| **Balanced** over solo: at least +0.50 | **+1.40** [+0.88, +1.92] | 100% vs 100% | not barred | **met, outside-confirmed** | agrees in 8 of 9 groups, gap +0.62 |
| **Max** over Balanced: at least +0.30, unless Balanced's mean is above 8.60 | +0.29 [+0.13, +0.44] | 100% vs 100% | not barred | **not measurable (scale ceiling)**: Balanced's mean is 8.77 | agrees in 5 of 9 groups (7 needed), gap +0.10 |

Gaps are in blind Opus judge quality, the mean of five dimensions on a 1–10 scale, over 9 groups (task × run).

Four things to read beside that table:

1. **Every run passed every hidden test.** All 36 solutions scored 100%, and their own tests passed. The gains are in what judges think of the code, not in whether it works.
2. **The bars cannot separate quality from size.** "The setup with more test lines" predicts the Opus direction in 8 of 9 groups for Lean and in 9 of 9 for Balanced and Max. The tests dimension alone accounts for 44% of Balanced's gap, 42% of Lean's and 42% of Max's. The one measure that does not reward size, [test strength](#test-strength-h5-h6), shows no such order: every solution caught all of h5's near-miss versions, and on h6 Lean caught 24 of 24, Balanced 21, solo 20 and Max 19.
3. **The outside judge saw much smaller gaps.** Codex's gaps are about half of Opus's for Lean and Balanced, and about a third for Max. Codex is the only outside judge in this round, and it passed its held-out check exactly at the bar (gap +0.50).
4. **These tasks cost far more than the picker's labels say.** Lean is 2.55× solo over all three tasks (1.42× on the two single-area tasks), Balanced 5.24× (4.26×) and Max 9.66× (7.52×). The labels said about 1.3×, 2.2× and 3–4×.

Max's rule result is "not measurable", and that is its label. Its raw numbers are shown because the rule requires them: at +0.29 it would have rounded just under the +0.30 bar, Codex did not confirm it, and it costs 1.84× Balanced.

## Setup

- **Freeze:** tag [`mo-freeze-cloud`](https://github.com/afel6/section-team/tree/mo-freeze-cloud) = `3fb14ef`, on branch `bench/mode-round-cloud`, pushed before the first paid run. It was made from the earlier freeze `mo-freeze` (`1024a67`) under the spec's [Cloud amendment](specs/2026-11-01-mode-round-design.md#cloud-amendment-2026-11-02), dated 2026-11-02, before any batch had run. `bench/bars-mo.json` holds every bar. The tasks, hidden tests and bars did not change between the two tags.
- **Plugin:** section-team frozen at [`v0.2.1`](https://github.com/afel6/section-team/tree/v0.2.1) (`404b934`). `git diff --stat v0.2.1 mo-freeze-cloud -- agents hooks skills brief .claude-plugin scripts types package.json tests` printed nothing at the freeze, before each batch and before publishing.
- **Machine:** the builds and Opus judges ran on a cloud Linux machine (Claude Code on the web). Codex judged on the user's Windows PC. Analysis ran on the PC ([below](#what-differed-from-the-plan)).
- **Setups:** `solo` (Claude Code with every plugin off), `lean`, `team` (Balanced) and `max`. Automatic skill installs were off. MCP servers and synced skills were off in every setup.
- **Runs:** 3 tasks × 4 setups × 3 runs = 36 headless runs, 2026-11-02 18:43 to 2026-11-03 04:38 UTC.
- **Pinned:** Claude Code 2.1.296 from npm, binary SHA-256 `24972e3bc859fab2b46ed4c1e51f7d6130f06d3bd550811a114640de3370d0de`, model `claude-opus-5-5`, effort `medium`.
- **Opus judging:** 9 groups, 2 Opus judges each, 4 anonymized solutions per judge labelled W, X, Y, Z. The second judge saw the mirrored order. Section-team was off for judges.

### The tasks

| Task | Shape | Hidden tests | Near-miss versions | Reference size |
|---|---|---|---|---|
| **h4** | HTTP JSON API plus a browser page, one JSON file for storage (multi-area) | 38 | 6 | 464 lines, 171 of them browser code |
| **h5** | Existing Node.js service of about 500 lines: two user bug reports and one validated endpoint (single-area) | 25 | 6 | about 151 new lines (about 122 without blank and comment lines) |
| **h6** | Tricky-spec library with exact errors and a command-line entry (single-area) | 47 | 8 | 340 lines |

Reference sizes are raw source lines without tests, docs and `package.json`, blank and comment lines included unless stated. The h4 reference came in below the spec's 500–800 target and h5's code-only count below its 150 target; both were accepted by ruling on 2026-11-02, before the freeze. The reference passes 100% of its hidden tests, and each near-miss version fails at least one (`node bench/calibrate.mjs h4`, and h5, h6, rerun it).

## Results

| Task | Setup | Cost $ | × solo | Minutes | Hidden tests | Opus quality /10 | Opus 1st places | Code lines | Test lines |
|---|---|---|---|---|---|---|---|---|---|
| h4 | solo | **0.92** | 1 | **3.5** | 100% | 6.80 | 0 of 6 | 476 | 462 |
| h4 | lean | 4.17 | 4.54 | 12.0 | 100% | 8.37 | 0 of 6 | 566 | 1576 |
| h4 | balanced | 6.40 | 6.97 | 20.4 | 100% | 8.83 | 0 of 6 | 612 | 2247 |
| h4 | max | 12.35 | 13.44 | 43.5 | 100% | **9.10** | **6 of 6** | 626 | 2821 |
| h5 | solo | **0.72** | 1 | **2.1** | 100% | 7.97 | 0 of 6 | 314 | 398 |
| h5 | lean | 1.22 | 1.69 | 3.5 | 100% | 8.57 | 0 of 6 | 316 | 674 |
| h5 | balanced | 3.03 | 4.19 | 9.2 | 100% | 8.80 | 1 of 6 | 318 | 828 |
| h5 | max | 5.44 | 7.53 | 17.6 | 100% | **8.97** | **5 of 6** | 326 | 983 |
| h6 | solo | **0.91** | 1 | **3.8** | 100% | 7.33 | 0 of 6 | 414 | 237 |
| h6 | lean | 1.10 | 1.22 | 5.0 | 100% | 7.53 | 0 of 6 | 355 | 435 |
| h6 | balanced | 3.91 | 4.32 | 18.0 | 100% | 8.67 | 1 of 6 | 383 | 1460 |
| h6 | max | 6.81 | 7.52 | 32.0 | 100% | **9.10** | **5 of 6** | 394 | 1771 |
| **all** | **solo** | **0.85** | 1 | **3.1** | 100% | 7.37 | 0 of 18 | 401 | 366 |
| **all** | **lean** | 2.16 | 2.55 | 6.8 | 100% | 8.16 | 0 of 18 | 412 | 895 |
| **all** | **balanced** | 4.45 | 5.24 | 15.9 | 100% | 8.77 | 2 of 18 | 437 | 1512 |
| **all** | **max** | 8.20 | 9.66 | 31.0 | 100% | **9.06** | **16 of 18** | 449 | 1858 |

Each row is the mean over 3 runs (9 for `all`). Cost is what the CLI reports per run (`total_cost_usd`); no run needed a cost computed from transcripts. On a Claude subscription it is plan usage, not a bill. Lean's h4 cost is 0.65× Balanced's. Code lines count source files that are not tests; on h5 a file byte-identical to the seed's is left out, and a changed seed file counts in full.

### Where the difference comes from

| Setup | correctness | code quality | tests | robustness/security | docs/usability | overall |
|---|---|---|---|---|---|---|
| solo | 8.72 | 7.39 | 5.89 | 7.61 | 7.22 | 7.06 |
| lean | 8.83 | 8.28 | 7.56 | 7.72 | 8.39 | 7.67 |
| balanced | 9.22 | 8.50 | 8.94 | 8.50 | 8.67 | 8.50 |
| max | **9.44** | **8.72** | **9.56** | **8.83** | **8.72** | **9.00** |

Tests moved most at every step. Correctness and robustness moved least from solo to Lean (+0.11 each), and all setups passed the same hidden tests. Overall is shown beside the quality score and is not used for any bar.

### Group gaps

| Group | Lean − solo | Balanced − solo | Max − Balanced |
|---|---|---|---|
| h4 r1 | +1.6 | +2.2 | +0.1 |
| h4 r2 | +1.2 | +1.5 | +0.3 |
| h4 r3 | +1.9 | +2.4 | +0.4 |
| h5 r1 | +0.8 | +1.0 | +0.2 |
| h5 r2 | +0.6 | +0.8 | +0.1 |
| h5 r3 | +0.4 | +0.7 | +0.2 |
| h6 r1 | +0.6 | +1.4 | +0.6 |
| h6 r2 | −0.2 | +0.6 | +0.6 |
| h6 r3 | +0.2 | +2.0 | +0.1 |

Lean's gain is largest on the multi-area task and small on h6, where it fell below solo in one group.

## Sensitivity check: faithful runs only

A group enters only when both of its runs followed their mode's rules ([below](#mode-fidelity-and-tiers)). This check never changes a bar's result.

| Comparison | Groups | Gap, 95% range | Hidden tests | Rule reading |
|---|---|---|---|---|
| Lean over solo | 8 | +0.69 [+0.15, +1.22] | 100% vs 100% | met; usage 1.42× on h5 and h6 |
| Balanced over solo | 9 | +1.40 [+0.88, +1.92] | 100% vs 100% | met |
| Max over Balanced | 5 | +0.24 [−0.02, +0.50] | 100% vs 100% | not measurable (scale ceiling) |

## Secondary measures

These are reported and are never bars.

| Comparison | Rank wins (both judges agree) | Sign-test p | Judgments | More test lines agrees | Tests gap, 95% range |
|---|---|---|---|---|---|
| Lean over solo | 8–1, 0 split | 0.039 | 16–2 | 8 of 9 | +1.67 [+1.12, +2.21] |
| Balanced over solo | 8–0, 1 split | 0.008 | 17–1 | 9 of 9 | +3.06 [+2.46, +3.65] |
| Max over Balanced | 7–0, 2 split | 0.016 | 16–2 | 9 of 9 | +0.61 [+0.29, +0.93] |

For comparison, "more test lines" agreed with the held-out round's Opus winner in 8 of 9 pairs.

### Test strength (h5, h6)

The share of a task's frozen near-miss versions that a solution's own tests catch. Each test file first has to pass alone against the reference, or it is not valid and does not count.

| Setup | h5 caught | h5 valid files | h6 caught | h6 valid files |
|---|---|---|---|---|
| solo | 18 of 18 | 10 of 10 | 20 of 24 | 5 of 6 |
| lean | 18 of 18 | 12 of 12 | **24 of 24** | 6 of 6 |
| balanced | 18 of 18 | 13 of 13 | 21 of 24 | 18 of 21 |
| max | 18 of 18 | 21 of 21 | 19 of 24 | 21 of 26 |

No solution was n/a and no test file was skipped. H5 does not separate the setups at all. On h6 the order does not follow size: Lean's two test files per run caught everything.

Max's low h6 count does not show that its tests are weaker. A test file is thrown out whole if any one of its tests fails against the reference. All 9 invalid h6 files came from Max (5), Balanced (3) and solo (1), and 8 of them test the command line. The two near-miss versions they would most likely have caught, `depth-limit` and `size-limit`, live only in the reference's command-line file and make up 9 of the 12 misses. After the results were in, 5 of the 9 files were run against the reference by hand: each failed 1 or 2 of its tests (for example 1 of 78, "stdin that is a directory" expecting exit 1 where the reference exits 3). This rule is frozen and the table stands, but it penalizes large, strict test files. What it does show is that more test lines did not catch more of these near-miss versions.

## Mode fidelity and tiers

`bench/mode-check.mjs` reads each run's copied transcripts and its `.team/` folder. A run is faithful when all of its mode's rules hold.

| Setup | Faithful | Tier the supervisor chose: h4 | h5 | h6 |
|---|---|---|---|---|
| solo | 9 of 9 | – | – | – |
| lean | 8 of 9 | multi | small | small |
| balanced | 9 of 9 | multi | single | single |
| max | 5 of 9 | multi | single | single |

Every run of a setup and task chose the same tier. The runs that were not faithful:

| Run | Broken rule |
|---|---|
| h4-lean-mo-r1 | a gate graded again after a pass |
| h4-max-mo-r2 | a gate graded again after a pass |
| h4-max-mo-r3 | a gate graded again after a pass |
| h6-max-mo-r2 | a gate graded again after a pass |
| h5-max-mo-r2 | a file outside `.team/` has `near-miss` in its path: `.claude/agent-memory-local/section-team-testing/near-miss-via-loader-hook.md` |

The h5 file is an 11-line section memory note about how to run near-miss copies, not a copy of broken code. The rule matches on the path, so the run stays not faithful. No near-miss copy of code was left in a project: mode-check found none, and every hidden test passed. The re-grading broke the wording of the plugin's "a pass ends the gate" rule, in 4 of 27 team-setup runs and mostly in Max.

**Correction, 2026-11-04.** This page first called the re-grading a real miss. A later trace of the four callers' transcripts does not support that: in all four, code or tests changed between the pass and the next grade. In `h4-lean-mo-r1` and `h6-max-mo-r2` the section got a new job from the supervisor and changed code for it. In `h4-max-mo-r2` the testing section edited tests after the pass and got another message before it graded again. In `h4-max-mo-r3` it edited tests and its near-miss script within the same job. So the rule's wording was too blunt: v0.2.2 says a later job that changes code gets its own grade. The fidelity table above is unchanged, because it applies the rule as it was frozen.

## Gate stats

| Mode | Runs | Reviewer calls | Callers | First try at the mode's mark | Fails then re-called | Finals at the mark | Partial REPORTs | Gate misses |
|---|---|---|---|---|---|---|---|---|
| Lean (8) | 9 | 15 | 14 | 14 of 14 | 0 | 14 of 14 | 0 | none |
| Balanced (8, no item under 6) | 9 | 26 | 21 | 16 of 21 | 5 | 21 of 21 | 1 | none |
| Max (9, no item under 7) | 9 | 31 | 21 | 14 of 21 | 6 | 21 of 21 | 3 | none |

No hidden test failed after a passing gate, since none failed at all. Per-run rows, with every graded item, are in [`gate-stats-mo.json`](../bench/data/modes/gate-stats-mo.json).

## Leak scan

The frozen word list ran over every anonymized solution before any judge, and nothing was edited or removed.

| Setup | Word hits | Extra files | Test lines (sum of 9 runs) |
|---|---|---|---|
| solo | none | `h4-r1/W/.gitignore`, `h4-r3/Y/.gitignore` | 3293 |
| lean | `section` 1, `REPORT` 1 | none | 8056 |
| balanced | `.team` 1 | none | 13605 |
| max | none | none | 16725 |

Test-line counts differ by a factor of five and judges can see them, so they are the main tell. The two `.gitignore` files appear only in solo.

## Void runs, reruns and re-asks

- **Void runs:** none. **API failures:** none. **Timeouts:** none. All 36 counted runs ended without an error.
- **Reruns:** two, both after the cloud container restarted and killed a run in progress. Attempt 1 of `h4-max-mo-r2` was killed at 22:30 UTC on 2026-11-02, about 49 minutes in, and attempt 1 of `h4-team-mo-r3` at 01:43 UTC on 2026-11-03. Their folders are kept under `results/<id>/attempt-1/` and they are not scored. A third restart hit no run.
- **Why these were rerun:** the spec scores "a crash after the run started", and the plan's cloud runbook says a run in progress when the machine vanished runs again. The ruling, made before any solution or score was seen, was to rerun: a machine restart is an infrastructure failure like an API failure, no setup caused it, and scoring a half-built Max against a finished solo would bias the result.
- **Re-asks:** one. Judge 2 of group h5-r3 returned JSON that did not parse, and a fresh session gave a usable verdict. No judgment was left out, no blind-key check failed, and no judge session compacted.
- **Edge positions** (how often a setup was a judge's first or last folder): lean 5 and 5, balanced 5 and 5, solo 4 and 4, max 4 and 4.
- **Harness bugs fixed after the freeze:** none. No script changed after `mo-freeze-cloud`.

## How the outside judges were run

Outside judges use no Claude usage. The case set had 18 cases: each group twice, case numbers shuffled, once in the Opus order renamed A–D and once mirrored.

**Codex** counted. It ran headless on the user's Windows PC, one fresh session per case, from the frozen run sheet:

```
codex exec --ephemeral --ignore-user-config -m gpt-6.1-sol -c model_reasoning_effort="ultra" --disable memories -c windows.sandbox="unelevated" --skip-git-repo-check -C <case folder> -s read-only
```

- All 18 cases were usable on their first counted attempt. Codex's ChatGPT usage limit stopped the run 3 times (cases 06, 10 and 15), which used no attempt by the spec's rule. Judging ran from 2026-11-03 17:07 to 2026-11-04 09:15 (GMT+3). The last two restarts were made by a small script outside the freeze that reran the same frozen command after each reset and changed none of its values.
- None of its 471 logged commands names a key file or the results branch. Each exact command line and log is on the verdicts branch.
- **Held-out check, recorded once before its mode-round verdicts were imported:** passed at the bar, with gap +0.50 and the same winner as Opus in 8 of 9 pairs. "More test lines" also predicts 8 of 9.
- **Context only:** Codex's earlier one-session run (`hocx1`) had gap +0.46 and 7 of 9, which would not have passed.

**Antigravity** did not count: it was **not used**, by the user's decision on 2026-11-04. Its fresh-session held-out set (`hoag2`) and its mode-round set were never judged. Its earlier one-session verdicts (`hoag`, gap +0.93, 8 of 9, every team solution 10 on every dimension) are context only. So "outside-confirmed" in this round rests on one judge.

**Held-out inputs (SHA-256):**

| File | SHA-256 |
|---|---|
| `blind-key-ho.json` | `feea2b2202ee0d244e15cec481b57e0cf5408aa106e10d588ce3c27c932bcaf0` |
| `blind-key-hoag.json` | `feea2b2202ee0d244e15cec481b57e0cf5408aa106e10d588ce3c27c932bcaf0` |
| `judge-ho.json` | `cacb6b2325a4feb23c34aef222a406d25b5c41b2eafd7ea708cbb519f2f25ad8` |
| `judge-hoag.json` | `dfdd2aebfa9dd4438b4ad58cd6041cdbd8fa3167b58d0d8d744fff941cf0383f` |
| `external-key-ho.json` | `2d6ba5fb28a129c9da2b5cac37f1d9e4b63397cb1feb99f8c643148a8a2e7271` |

## What differed from the plan

- **Imports and analysis moved to the user's PC.** The Cloud amendment and run sheet say they run on the cloud machine, but the cloud credits ran out after judging. The results branch, which holds the blind keys, was first fetched to the PC only after every Codex verdict, log and held-out record was pushed to `bench/mode-round-cloud-verdicts` (`932d83c`, 2026-11-04 08:17 UTC), so the public history shows the verdicts before the keys reached that machine.
- **Where the analysis ran.** Frozen code and results commit `f37b48c` were laid out in WSL (Ubuntu 24.04) at the cloud machine's paths, every file checked byte-identical to git, and `/root/bench-runs` restored without the solutions' `.git` folders, which no analysis step reads. Node was 26.10.0, against the cloud machine's Node 22, and solutions' tests ran as root, as on the cloud machine. `bars-mo.json` came out byte-identical when recomputed on Windows with Node 26.2.0.
- **A false start on test strength.** The first test-strength pass reported "no valid test file" for all 24 solutions, because that Node needed a library path that the hidden-test environment strips, so no test ever started. That output was discarded and the step rerun with the library linked for the run. No solution or script changed.
- **The results branch was public while Codex judged.** It holds the run ids and, from the case-set step on, the blind keys. The PC did not fetch it, and the harness rejects an attempt whose logged commands name a key.
- **Cost above the estimate.** Spec: about $137, range $109–163. Actual: $140.90 for the 36 counted runs (solo 7.64, lean 19.46, balanced 40.03, max 73.77), at least $16.03 more in the 2 killed attempts, and $33.41 for the 18 saved Opus judgments (h4 14.57, h5 8.42, h6 10.42; the failed re-ask attempt's cost is unrecorded). That is at least $190.34, plus the preflight. The trial judge cost $2.15 against an estimated $1.30.
- **Not reviewed the usual way.** The Cloud amendment was built without the usual reviewer gate, by the user's instruction, as the spec's dated note says.

## How this compares with earlier rounds

It does not compare directly. Solo scored 8.16 in the held-out round, with the user's plugins, CLAUDE.md and skills on, and 7.37 here, on a clean machine home with none of them. Balanced's gap of +1.40 here is against that barer baseline, and the held-out round's +0.64 is against the user's everyday setup. Solo's cost barely moved ($0.86 then, $0.85 now), while Balanced's rose from $1.87 to $4.45, or $3.47 on the two single-area tasks alone. The tasks differ too.

## Limits

- **Few tasks and runs.** With three tasks and three runs per cell, the smallest reliably detectable gap is about 0.45 for a mode against solo and about 0.6 for Max against Balanced, so +0.3 bars can pass or fail on noise; the ranges show it. The range treats the 9 groups as independent: it describes run and judge noise on h4–h6 only, not how a mode would do on other tasks.
- **Scale ceiling.** Judges score 1–10 in whole numbers and almost never give 10 (4 of 180 dimension scores in the held-out round), so Max can hit the ceiling (the 8.60 rule).
- **Size bias.** Outside judges and Opus may both favour larger solutions; the "more test lines wins" rate shows how much agreement that alone explains. The leak scan lists other tells.
- **Measurement gaps.** Test strength is n/a for a solution whose tests import modules the reference lacks (2 of 18 h1 solutions on held-out data). Mode fidelity does not see files the supervisor writes through shell commands. Besides its own rules, Max's brief also differs from Balanced's in shared wording: v0.2.1 cut seven phrases to fit the 9000-character cap (for example, Max's small-task line drops "(one or two small functions)"). h5's hidden `npm test` check stops only the shell on a 120 s timeout, on Windows and on Linux (checked on the cloud machine, 2026-11-02); a hung solution's processes stay until the machine is cleaned.
- **h4's page tests** (7 of 38) restrict the script to a short list of browser APIs (no querySelector, dataset, event.target, res.ok, timers or AbortController), so they measure behaviour under that restriction, not idiomatic DOM code. Every setup gets the same restriction.
- **Untrusted code.** Outside judges and Opus judges run the solutions' code on the user's machine.
- **Judges' reach.** Opus judges' allowed tools (Read, Glob, Grep, and Bash for node, npm, ls and cat) are not confined to the copied case folder. The harness rejects an attempt whose tool calls name a blind key, but it sees only tool calls that spell out a key's file name or the results folder; a wildcard, a folder-wide search or a path built at run time goes unseen. Transcripts are kept for every attempt that returns a result. Outside judges are not confined either: Codex's sandbox limits writes, not reads; its logged commands get the same check. Antigravity, run by hand, leaves no tool record.
- **Codex runs no test suite.** In its `read-only` sandbox Codex cannot start child processes, so `npm test` and `node --test` fail; it reads the tests and may replay them in one process instead. Opus judges and Antigravity can run them. Codex is offered the user's skill names (without descriptions; the probe's events show it), and per Codex's own help `--ignore-user-config` skips only `config.toml`, so the user's global `~/.codex/AGENTS.md` still applies, as Opus judges keep the user's CLAUDE.md and skills.
- **The baseline is the user's, minus plugins.** Builders and Opus judges still read the user's `~/.claude/CLAUDE.md` and `~/AGENTS.md`, and keep the user-level skills, agents and rules (the same set in every setup).
  - CLAUDE.md names skills from plugins that are off in every run (superpowers, frontend-design), and the synced skills are off too; a session that asks for one gets an error and carries on.
  - h1–h3 ran from inside the desktop app, with its session environment; this round strips it, so the built-in plugin list may differ from h1–h3's (the preflight records it).
  - Section agents and the reviewer skip CLAUDE.md, so it steers solo's whole run but only the supervisor in team setups.
  - Solo here is therefore neither bare Claude Code nor the user's everyday setup, and h1–h3 (solo 8.16) ran with the user's plugins on, so the two rounds' numbers are not directly comparable.
- **Clean home on the cloud machine** (Cloud amendment, 2026-11-02). The cloud machine's home has no `~/.claude/CLAUDE.md`, no `~/AGENTS.md` and no user agents, rules or commands. Its only user-level skill is `session-start-hook`, which the cloud environment installs in `~/.claude/skills`; a probe's init lists it beside the built-in skills. So the previous bullet's baseline does not exist there: solo is close to bare Claude Code with the recorded built-in plugins and skills, and every setup's supervisor works without the user's instructions. Solo's baseline therefore differs from rounds h1–h3 (run from the desktop app on Windows, with the user's plugins, CLAUDE.md and skills on; solo 8.16), and the two rounds' numbers are not directly comparable. The difference between solo and the team setups in what CLAUDE.md steers also goes away.
- **Account email in the pushed results** (Cloud amendment, change 5). Claude Code writes the account email into every session transcript. The round pushes with `--redact-email`, so the pushed copies of results files differ from the local evidence in that address alone; a restored machine's evidence has the placeholder `[account email removed]`.
- **Opus judges' time limit** (Cloud amendment, change 8). Each Opus judge attempt has 60 minutes. A judge still working at the limit is cut off and re-asked, so a very slow but sound judgment is lost and costs an attempt; three timeouts leave the judgment out.
- **Outside judges' own instructions.** Outside judges read their own global instructions.

## Recompute

Raw data and the recompute command are in [`bench/data/modes/`](../bench/data/modes/). The full evidence (each run's transcripts, solution folders and judge transcripts) is on the branch `bench/mode-round-cloud-results`, at commit `f37b48c`.
