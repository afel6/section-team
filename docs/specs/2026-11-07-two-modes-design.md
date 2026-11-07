# Two modes that keep their promise: design

Date: 2026-11-07. Branch: `fix/fresh-section-per-job` (PR 16 stays open and unmerged; no new PR). This design follows the p1 proof round recorded in `docs/plans/2026-11-06-best-plugin-plan.md`.

## What the proof round showed

These are means of 2 runs on task p1, judged by Codex in both orders.

| | × solo cost | Judged | Hidden (of 264) | Stages in time |
|---|---|---|---|---|
| Solo | 1.0 | 7.5 | 264 | 6 of 6 |
| Lean | 2.3 | 7.75 | 264 | 6 of 6 |
| Balanced | 4.5 | 8.75, ranked first in all 4 groups | 263 | 6 of 6 |
| Max | 6.1 | 7.0 | 210 | 5 of 6 |

Three more findings:

- `plan-advisor` never ran. p1's stage 1 is a single-area API, so the foundation flow never started, and adding the dashboard in stage 2 did not start it either.
- The supervisor's own chat peaked at 189K–205K tokens in team runs, against 154K–176K for solo. On single-area work the supervisor builds the code itself.
- Max's extra depth used its time without raising quality. The extra depth was broken test copies, up to 3 fix rounds, 13 reviewer calls and 16 coders.

## The user's decisions

- **Lean is removed.**
- **Max is the mode for a working platform or app when cost does not matter.** It must be the best on correctness and judged quality.
- **Max runs Balanced's proven flow plus proof steps.** These are a security section pass, a second independent final review, and the supervisor running every critical flow before it says done. There are no broken test copies, at most 2 fix rounds, and harsh grading on everything.
- **Every job goes to a section**, so the user's chat holds plans and reports only.
- **The platform flow starts when the work first spans two builder areas.** That includes a later request that adds a second area to an existing product.

## Modes

There are two modes, Balanced (the default) and Max.

A project whose `.team/mode.json` says `lean` runs as Balanced. Session start says so in one line, until the user picks a mode again. The board's mode picker offers Balanced and Max only.

Because a mode is removed, the plugin version becomes 0.3.0.

## Every job goes to a section

In both modes the supervisor writes no product code, tests or docs itself. It plans, writes and keeps notes, wakes sections, reads REPORTs, answers the user and runs the checks its mode names.

The small-task and single-area tiers wake the matching builder section. That section writes its own tests and runs its own gate. The testing section wakes for the final check only on multi-area work, as now.

## When the platform flow starts

The trigger for the foundation skill becomes: the work first spans two or more builder areas. That covers a new platform or product, and a request that adds a second area to an existing product.

- **Before waking anyone,** the supervisor loads `section-team:foundation`.
- **For an existing product,** the foundation note is written from the current code and the new request.
- **`plan-advisor` checks the note** before the user sees it. It runs again only when the frozen note changes.
- **Work that stays inside the areas the note already covers** does not trigger it again.

## Max

Max runs Balanced's flow, with these changes:

- **Gate:** a pass needs at least 9 overall and no item under 7, with at most 2 fix rounds.
- **Harsh grading on everything.** Every hand-back with a changed file gets a reviewer grade, docs and config included. The handback hook enforces this in Max as it does for code today. For docs and config the reviewer scores the items that apply and marks the rest `n/a`.
- **No broken test copies.** The near-miss rules and the `.team/near-miss/` folder are gone from Max.
- **A security pass.** The security section reviews the changed files before the final review, as Max does now.
- **Two final reviews.** Two independent final reviews by two fresh testing sections, one after the other. The second is not shown the first's REPORT. Failing items from either go to the builders.
- **The supervisor's own check.** After the fixes and before it reports done, the supervisor itself starts the app and drives every critical flow named in the foundation note or the task, and reports each one.
- **Docs.** The docs section still runs on every multi-area task in Max.

## Targets for the next proof round

These are measured on p1, as the mean of 2 runs per setup against solo, with Codex judging in both orders:

| Mode | Judged quality | Hidden tests | Cost | Time per stage |
|---|---|---|---|---|
| Balanced | ≥ solo + 1.5 | ≥ solo | ≤ 5× solo | ≤ 60 minutes |
| Max | ≥ Balanced + 0.25 | ≥ Balanced | not capped, reported | ≤ 120 minutes |

Every team run must also meet these:

- The supervisor's chat stays under 150K tokens.
- `plan-advisor` runs at stage 2, the stage where p1 adds a second area.
- No high-severity security finding in Max.
- No user data is read, moved or lost.

The harness gives Max twice the task's stage limit, because cost and time do not matter in Max.

## Unchanged

These stay as they are: the reviewer and its rubric (apart from the `n/a` rule for docs and config), the enforcement hooks for Balanced, notes, REPORTs, the advisors, skill search, the h7 and p1 tasks and their hidden sets, and the user's CLAUDE.md rules.

## Risks

- **Cost.** Handing every job to a section adds a head per job; Balanced's 5× cap allows for that.
- **Max's real-world speed.** Max may still exceed 120 minutes on large stages. Real use has no time limit, but the benchmark does.
- **Weak evidence.** Two runs and one judge model are weak evidence, as before.

## Out of scope

- A new mode, or best-of-two builds.
- Per-mode model changes.
- Merging, tagging or releasing without the user's yes.
