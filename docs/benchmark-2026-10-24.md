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

## Round 3 — v3: solo-builder sections and the clean-code gate (commit 6779fe3)
v3 changes (design `docs/specs/2026-10-24-solo-builder-sections-design.md`):
- sections plan their part, take per-job skills, share notes and message each other directly;
- an Opus reviewer grades all code (pass 8/10, no item under 6, at most 2 fix rounds);
- the supervisor gates its own code too.

Setup notes:
- The global setup was slimmed between rounds 2 and 3, from 60k to 41k tokens per session.
- **Solo was therefore rerun (`solo-v3`)** so v3 is compared under the same setup. Team-v2's projects (old setup) were judged alongside as a reference.
- Same 3 tasks, 2 runs each, 2 blind Opus judges per group, same rubric.

| Way | Cost $ | Minutes | Judge quality /10 | Code quality | Tests | 1st places | Last places | Opus share | Grade /100 |
|---|---|---|---|---|---|---|---|---|---|
| solo-v3 | **0.85** | **2.7** | 7.57 | 7.88 | 7.25 | 3 of 12 | 4 of 12 | 97% | **86.4** |
| team-v2 (reference) | 2.47 | 4.3 | 7.48 | 7.58 | 7.58 | 1 of 12 | 8 of 12 | 97% | 75.9 |
| **team-v3** | 3.39 (×4.0) | 7.8 | **8.33** | **8.92** | **8.67** | **8 of 12** | **0 of 12** | 98% | 74.2 |

Grade under other weightings:
- quality-first: solo-v3 81.2 · team-v3 76.1 · team-v2 73.8
- cost-first: solo-v3 86.2 · team-v2 65.7 · team-v3 62.4

Hidden tests and own tests passed 100% in all 12 new runs, with no timeouts.

### What the per-agent split shows
The split comes from the subagent transcripts and reconciles exactly with `modelUsage` on every run.

- **The quality gate works and is cheap.** The reviewer ran on every task, including easy, where the supervisor built alone and gated its own code. It used 32k–294k input tokens per run.
- **Section heads still do the work themselves on Opus.**
  - **testing:** 58–77 turns (18–22 test runs, 8 edits), 1.0–4.2M Opus input. It is the largest single cost.
  - **backend:** 40–47 turns, writing and editing the code itself.
  - **Sonnet coder:** used only on hard (237k–375k input).
  - **Haiku scout:** never used.
  - Every Opus turn re-reads the growing context, so long head sessions dominate the bill.
- **Quality is clearly up.**
  - Team-v3 is +0.76 over same-setup solo and +0.85 over team-v2.
  - It has the best code quality (+1.0 over solo) and the best tests (+1.4 over solo), and it was never ranked last.
  - This is the "always clean" goal showing up in the judges' scores.

### Verdict after round 3
- **Quality goal: met.** Team-v3 produces the cleanest code and the best tests of every way tested so far.
- **Cost goal: missed, and not because of the gate.** The gate costs little. The extra cost is Opus section heads doing routine work (test runs, edits, writing files) instead of handing it to the Sonnet coder. v2's "delegate the bulk" wording was ignored the same way, so prompt wording alone does not move this.
- **The lever that would move it is a model change, which is the user's decision:** section heads on Sonnet, with the Opus reviewer as the higher model that checks and grades. The design kept heads on Opus at the user's request, so no tuning rerun was made.

## Round 4 — v4: builder heads on Sonnet, Opus reviewer kept (commit 653e99b)
Setup: same tasks and setup as round 3, and team only. These were judged blind together with round 3's solo-v3 and team-v3 projects, using 2 new Opus judges per group.

| Way | Cost $ | Minutes | Judge quality /10 | Code quality | Tests | Hard-task quality | 1st places | Last places | Opus share | Grade /100 |
|---|---|---|---|---|---|---|---|---|---|---|
| solo-v3 | **0.85** | **2.7** | 7.58 | 7.92 | 7.17 | 8.35 | 1 of 12 | 5 of 12 | 97% | **86.5** |
| team-v3 (Opus heads) | 3.39 | 7.8 | **8.23** | **8.67** | **8.58** | **8.90** | **7 of 12** | **1 of 12** | 98% | 73.9 |
| **team-v4 (Sonnet heads)** | 1.30 | 6.1 | 7.43 | 7.83 | 7.42 | 6.90 | 4 of 12 | 6 of 12 | 65% | 75.0 |

Hidden tests and own tests passed 100% in all 6 new runs, with no timeouts. Team-v3's grade from these judges (8.23) matches its round-3 grade (8.33) within noise.

### What the split shows
- **Cost fell sharply.** Medium went from $3.69 to $1.30 and hard from $5.87 to $1.88. The sections' work moved to Sonnet; the remaining Opus spend is the supervisor and the reviewer.
- **The quality gate was mostly skipped.**
  - The reviewer ran in only 2 of 4 multi-section runs (medium-r2, hard-r1), once each (32–37k tokens).
  - The Opus heads in round 3 ran it in every run, several times each (99k–294k).
  - On the hard task, team-v4 ranked last in all 4 judgements.

### Verdict after round 4
- Sonnet heads keep the cost low, but they do not reliably follow the "always run the reviewer" rule. The clean-code gain from round 3 disappears with it.
- The gate has to be **enforced by the plugin, not just asked for in the prompt**, or the heads go back to Opus.

## Rounds 5–6 — forcing the gate with Sonnet heads
- **v5 (commit d2d16f6): gate forced at SubagentStop.** Quality 7.58, $1.43. It failed in two ways:
  - The supervisor already has a section's REPORT at handback, so holding the stop never re-ran the gate. It also lost the backend, frontend and testing REPORTs on the hard task.
  - The brief's "skip a separate full review pass" (aimed at testing's final review) made Sonnet heads skip their own gate. The REPORTs say "the brief said to skip".
- **v6 (commit f73f159): gate forced at handback.** A PreToolUse hook refuses an ungraded code REPORT, with partial or blocked as the honest ways out. The brief now says each builder runs its own gate.
  - A live spike confirmed it: the refused section came back `partial` instead of faking a grade.
  - In round 6 the reviewer ran in every run. Sections handed back `partial` first, then `done` with grades of 8–9/10 after fix rounds.

| Way | Cost $ | Minutes | Judge quality /10 | Code quality | Tests | Easy | Medium | Hard | Last places | Grade /100 |
|---|---|---|---|---|---|---|---|---|---|---|
| solo-v3 | **0.85** | **2.7** | 7.36 | 7.42 | 7.08 | 6.70 | 7.45 | 7.93 | 7 of 12 | **85.8** |
| team-v3 (Opus heads) | 3.39 | 7.8 | **8.17** | **8.63** | **8.58** | 7.35 | **8.45** | **8.73** | **0 of 12** | 73.7 |
| team-v6 (Sonnet heads, enforced gate) | 1.64 | 4.7 | 7.52 | 7.92 | 7.71 | 7.35 | 8.10 | 7.10 | 5 of 12 | 74.9 |

In round 6 the supervisor built the medium task alone and gated it. That run scored 8.10 for $0.89.

### Verdict after rounds 4–6
- **Team-v3 (Opus heads) is the only version that consistently beats solo on quality.** It scored 8.17–8.50 across four independent judge panels and was never ranked last.
- **Sonnet heads are about half the cost, but their code is judged at solo level even with a working Opus gate.** On the hard task the reviewer passed work at 8–9 that the blind judges scored about 7. The gate catches defects, but it does not add the design quality the builder did not write.
- **Recommendation:**
  - For "clean code above cost", run builder heads on Opus.
  - Keep the enforced handback gate either way: it costs little and guarantees every code REPORT carries a real grade.

## Round 7 — cheaper path for single-area tasks (commit 6f1b4a5)
Change: the supervisor builds single-area tasks of up to about 600 lines itself and gates them with the Opus reviewer. Opus sections wake only for multi-area work. Heads run on Opus, and the handback gate is enforced.

| Way | Cost $ | Easy quality | Medium quality | Medium cost | Hard quality | Hard cost | Code quality | Tests | Grade /100 |
|---|---|---|---|---|---|---|---|---|---|
| solo-v3 | **0.85** | 6.93 | 7.23 | **0.57** | 7.60 | **1.56** | 7.46 | 7.04 | **85.5** |
| team-v3 (sections for everything bigger) | 3.39 | **7.53** | **8.65** | 3.69 | 8.30 | 5.87 | **8.54** | **8.71** | 73.7 |
| team-v7 (supervisor + gate for one area) | 2.80 | 7.33 | 7.88 | 0.85 | **8.35** | 6.88 | **8.54** | 7.67 | 76.1 |

Hidden tests and own tests passed 100% in all 6 runs. The routing worked: medium was built by the supervisor plus the reviewer in both runs, and hard woke 4–5 sections.

### Verdict after round 7
- **The medium path is 77% cheaper ($0.85 against $3.69) and the code is just as clean** (code quality 8.54 on both). The gate holds the code standard.
- **What it loses is test depth.** The supervisor writes fewer, shallower tests than the dedicated testing section, so medium quality is 7.88 against 8.65. That is still +0.65 over solo.
- **Hard is unchanged in quality** (8.35). It costs 17% more because the enforced gate now always runs, with fix rounds.

## Round 8 — testing section for single-area tasks (commits 76c098b + 26643c6)
Change: for single-area tasks the supervisor still builds the code, but wakes only the testing section to write the tests. Tasks of about 150 lines or less stay supervisor-only.

| Way | Cost $ | Easy quality | Medium quality | Medium cost | Hard quality | Hard cost | Code quality | Tests | Grade /100 |
|---|---|---|---|---|---|---|---|---|---|
| solo-v3 | **0.85** | 6.78 | 7.20 | **0.57** | 7.83 | **1.56** | 7.29 | 7.17 | **85.5** |
| team-v3 (sections for everything bigger) | 3.39 | **7.45** | **8.55** | 3.69 | **8.40** | 5.87 | **8.54** | **8.50** | 73.6 |
| team-v8 | 2.70 | 7.13 | 7.65 | 0.84 | 8.30 | 6.60 | 8.46 | 7.67 | 75.5 |

Hidden tests and own tests passed 100% in all 6 runs.

### Verdict after round 8
- **The change was never exercised.** Both medium runs used only the supervisor and the reviewer; the testing section was not woken. The medium task (a CLI with storage and error handling) fell under the new 150-line small tier, so the supervisor built it and its tests alone. Medium results match round 7 (7.65 at $0.84), as expected for the same path.
- **Fix (after round 8):** the small tier is now about 50 lines (one or two small functions), and a feature with its own behaviour to test (a CLI, an endpoint, a module with storage or error handling) is never a small task. Round 9 should show whether the testing section closes the test gap (7.67 against 8.50).

## Round 9 — the fixed tiers (commit 86c9033)
Change: the small tier is about 50 lines, and a feature with its own behaviour to test is never small. Single-area tasks get the supervisor's code plus the testing section's tests.

| Way | Cost $ | Easy quality | Medium quality | Medium cost | Hard quality | Hard cost | Code quality | Tests | Wins–losses | Grade /100 |
|---|---|---|---|---|---|---|---|---|---|---|
| solo-v3 | **0.85** | 6.85 | 7.50 | **0.57** | 7.68 | **1.56** | 7.46 | 6.88 | 1–9 | **85.8** |
| team-v3 (sections for everything bigger) | 3.39 | 6.95 | **8.35** | 3.69 | **8.35** | 5.87 | 8.46 | **8.33** | 6–3 | 72.8 |
| team-v9 | 3.07 | **7.45** | **8.35** | 1.66 | 8.32 | 6.88 | **8.54** | 8.29 | **5–0** | 73.6 |

Hidden tests and own tests passed 100% in all 6 runs. The routing worked: easy stayed supervisor-only, both medium runs woke the testing section (plus the reviewer, once a coder), and hard woke backend, frontend, testing and docs.

### Verdict after round 9
- **Medium now matches team-v3 at 55% less cost:** 8.35 for $1.66 against 8.35 for $3.69. The testing section closed the test gap: medium tests 8.50, against 7.67 in round 8 without it.
- **Best overall on this panel:** 8.04, no losses in 12 judge votes, and code quality 8.54. This panel scored team-v3 lower (7.88) than round 8's panel did (8.13), so read the overall lead as a tie with team-v3 at 10% less cost.
- **Hard is the remaining cost:** $6.88, about 17% above team-v3, for the same quality. The testing section used the most tokens there (3.5–4.8M on Opus), more than any builder.

## Round 10 — helpers in the foreground (commit 033b1c4)
What the round-9 transcripts showed: the testing section already handed test writing to Sonnet coders. The waste was waiting. Heads launched helpers in the background and ended their turn to wait for them. A subagent that ends its turn must hand back, so backend, frontend and testing each handed back unfinished 1–2 times per hard run, stopped their own coders, and were resumed by the supervisor. Every idle or redone turn re-read 90–130k tokens of Opus context.
Change: heads pass `run_in_background: false` on every Agent call (several in one message still run in parallel), and the plugin refuses a section's background Agent call.

| Way | Cost $ | Easy quality | Medium quality | Medium cost | Hard quality | Hard cost | Code quality | Tests | Wins–losses | Grade /100 |
|---|---|---|---|---|---|---|---|---|---|---|
| solo-v3 | **0.85** | 6.85 | 7.08 | **0.57** | 7.55 | **1.56** | 7.33 | 6.83 | 1–9 | **85.2** |
| team-v3 (sections for everything bigger) | 3.39 | 7.18 | **8.25** | 3.69 | **8.58** | 5.87 | 8.33 | 8.33 | 7–3 | 73.2 |
| team-v10 | 2.69 | **7.68** | 8.10 | 1.69 | 8.38 | 5.59 | **8.71** | **8.42** | **4–0** | 73.0 |

Hidden tests and own tests passed 100% in all 6 runs. Every helper ran in the foreground, and no Agent call was refused.

### Verdict after round 10
- **Hard is 19% cheaper than round 9** ($5.59 against $6.88) and now below team-v3 ($5.87). The testing section read 1.0–1.9M tokens, against 3.5–4.8M.
- **Quality ties team-v3 at 21% less cost overall:** 8.05 against 8.00 on this panel, with the best code quality so far (8.71) and no losses. Hard is 0.2 below team-v3 and medium 0.15 below, both inside the noise of 2 runs.
- **What is left:** after its final review, testing sends "passed, plus optional nits" to the builders. That wakes them to make optional fixes, and their replies reach testing after it has handed back, forcing 1–2 more handbacks. Sending builders only failing fix lists, with optional nits kept in the REPORT, would cut those turns.

## Round 11 — testing sends builders only failing fix lists (commit 7259b26)
Change: after its final review, testing messages a builder only with a failing fix list. A passing verdict and optional nits stay in its REPORT, and the supervisor no longer asks testing for a verdict per builder.

| Way | Cost $ | Easy quality | Medium quality | Medium cost | Hard quality | Hard cost | Code quality | Tests | Wins–losses | Grade /100 |
|---|---|---|---|---|---|---|---|---|---|---|
| solo-v3 | **0.85** | 6.90 | 7.25 | **0.57** | 7.90 | **1.56** | 7.58 | 6.92 | 2–9 | **85.8** |
| team-v3 (sections for everything bigger) | 3.39 | **7.50** | **8.60** | 3.69 | **8.45** | 5.87 | **8.71** | **8.54** | **7–1** | 73.7 |
| team-v11 | 2.57 | 7.45 | 8.18 | 1.68 | 7.85 | 4.96 | 8.42 | 8.33 | 3–2 | 72.1 |

Hidden tests and own tests passed 100% in all 6 runs. Both hard runs had no turns after handback and no forced handbacks; testing took 11–12 turns (33–45 in round 9).

### Verdict after round 11
- **Hard is 11% cheaper again** ($4.96 against $5.59 in round 10, $6.88 in round 9).
- **Hard quality fell (7.85), but the change did not cause it.** A traced and verified check of every judge-flagged defect in 4 hard runs (rounds 10 and 11) found that almost all of round 11's were never found by anyone on the team, so no optional nit was held back. In round 10's higher-scoring run, the nits that were sent left its judged gaps open (backend declined them). The difference is which spec-edge bugs the builders happened to write. With 2 runs, a 0.5 swing is within the noise.
- **The gap the judges keep finding:** spec edge cases nobody probed (URL validation that's too loose, a raw non-ASCII Location header, an empty or null code treated as absent, no PORT validation), plus spec ambiguities settled with the lenient reading.
- **Easy routing slipped once:** one easy run read "a module with … error handling is never small" as covering two small functions that throw, and woke testing ($1.44 against $0.70). The wording now says storage or I/O, and that input checks that throw do not make a function a feature.

## Round 12 — spec probing and the stricter reading (commit 96e5e9c)
Change: before grading, testing probes every spec line (boundaries, empty and null values, non-ASCII and control characters reaching headers, missing, empty or invalid environment values) and turns each break into a test plus an owner fix list. Builders and the supervisor take the stricter reading of an ambiguous spec line and log the choice.

| Way | Cost $ | Easy quality | Medium quality | Medium cost | Hard quality | Hard cost | Robustness | Tests | Wins–losses | Grade /100 |
|---|---|---|---|---|---|---|---|---|---|---|
| solo-v3 | **0.85** | 6.85 | 6.50 | **0.57** | 7.65 | **1.56** | 7.17 | 6.50 | 1–9 | **84.7** |
| team-v3 (sections for everything bigger) | 3.39 | 7.00 | 7.95 | 3.69 | 8.28 | 5.87 | 7.38 | 7.96 | 3–2 | 72.4 |
| team-v12 | 2.83 | **7.40** | **8.70** | 1.79 | **8.40** | 6.07 | **8.75** | **8.38** | **8–1** | 74.0 |

Hidden tests and own tests passed 100% in all 6 runs. Both easy runs stayed supervisor-only (the round-11 wording fix held).

### Verdict after round 12
- **Best result so far against team-v3 on the same panel:** 8.17 against 7.74 (+0.43), with 8 wins and 1 loss, at 17% less cost. Earlier gaps against team-v3: +0.16 (round 9), +0.05 (round 10), −0.35 (round 11).
- **Robustness rose the most:** 8.75 against 7.38, the dimension that probing targets. Medium rose to 8.70 (robustness 9.0, tests 9.0).
- **The price is on hard:** $6.07 against $4.96 in round 11, because testing reads about 2M tokens while probing and the probes send real fix lists to backend.
- **Hard correctness (7.63) is still the weakest score:** some spec violations survive even the probe pass.

## Round 13 — spec-named values are exact (commit ef631f8)
What a traced and verified root-cause check of 12 real spec violations in 4 hard runs (rounds 11–12) showed: the notes carried the spec faithfully. The causes were lenient readings (5: an accepted null or empty code, `application/json; charset=utf-8` twice, loose URL checks), builders departing from a faithful note (3, plus one note testing itself changed: `Location` re-serialized with `new URL(url).href`, `/api` reserved as a code, a rate-limiter reset), and 3 probe misses. Builders "improved" values the spec names exactly, without seeing an ambiguity.
Change: builders and the supervisor treat every value the spec names as exact (send exactly that value, never extend or normalize it, add no rule the spec does not state); testing asserts spec-named values with exact equality.

| Way | Cost $ | Easy quality | Medium quality | Medium cost | Hard quality | Hard cost | Correctness | Hard correctness | Wins–losses | Grade /100 |
|---|---|---|---|---|---|---|---|---|---|---|
| solo-v3 | **0.85** | 7.03 | 7.05 | **0.57** | 7.60 | **1.56** | 8.58 | **8.25** | 2–6 | **85.4** |
| team-v3 (sections for everything bigger) | 3.39 | 7.18 | 8.20 | 3.69 | 8.07 | 5.87 | 8.17 | 7.63 | 2–5 | 72.6 |
| team-v13 | 3.46 | **7.57** | **8.45** | 1.75 | **8.43** | 7.88 | **8.83** | 8.00 | **8–1** | 73.0 |

Hidden tests and own tests passed 100% in all 6 runs.

### Verdict after round 13
- **The traced defects are gone:** the judges confirm Content-Type is exactly `application/json`, `Location` is the stored url verbatim, and a null or empty code gets 400.
- **Correctness rose:** 8.83 overall (8.63 in round 12) and 8.00 on hard (7.63), now above team-v3 on the same panel (7.63) but still under solo on hard (8.25). Overall 8.15 against team-v3's 7.82 (+0.33), 8 wins and 1 loss.
- **The price is hard cost:** $7.88 against $6.07, because exact-value probes send real fix lists and backend re-runs its reviewer gate (5 times in one run). Overall cost per task is now about team-v3's ($3.46 against $3.39), for +0.33 quality.
- **Left on hard:** one run still accepts `http:example.com` (it checks only `new URL().protocol`), and both reject valid non-ASCII URLs, an unstated rule that the stricter reading pushed too far.

## Limits of this benchmark
- **2 runs per cell:** treat small differences (under about 0.5 judge points) as noise.
- **The tasks were solved fully by every approach**, so harder tasks are needed to test correctness differences.
- **Headless runs:** no Team Board, sections ran in the foreground, and relay messaging between sections was not exercised.
- **Fable was disabled** for safety, since `-p` would bill it without asking.
- **Costs** are Claude Code's API-equivalent estimates. On a subscription they count against usage limits instead.

Data: `bench/results/` (local, git-ignored): `summary.json`, `report-data.json`, `judge.json` (all judge notes) and `blind-key.json`. Rounds 2–7 have `-v2` … `-v7` versions of the last three (`node bench/run.mjs --tag=v2 --conds=team,forced`, `node bench/anonymize.mjs --round=v2 --conds=solo,team-v2,forced-v2`, `node bench/aggregate.mjs --round=v2`). Reproduce with `node bench/run.mjs`, `node bench/score.mjs`, `node bench/anonymize.mjs`, the judging workflow, and `node bench/aggregate.mjs`.
