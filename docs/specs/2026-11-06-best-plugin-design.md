# Each mode keeps its promise: design

Date: 2026-11-06. Branch: `fix/fresh-section-per-job` (PR 16 stays open and unmerged until this is done; no new PR).

## Goal

The user's goal is for section-team to be the best Claude Code plugin for building real platforms. The supervisor writes every section's prompt and hands it its tools and skills, and fetches a skill it lacks. An advisor checks the supervisor's plan. Harsh reviewer grading keeps the code clean. Team talk stays out of the user's chat. For a platform (dashboard, security, AI and more) the user explains it once; a plan is made, checked and approved, and the sections are prompted and equipped from it.

Each mode owns one priority, and the user picks the mode per project:

- **Lean:** the lowest cost.
- **Balanced:** quality at a sensible cost.
- **Max:** the best quality at any cost.

## What the evidence says today

These facts shape the design. Where they differ from the goal as stated, the design follows the evidence:

- **Context, not credits.** Team talk keeps the user's chat small, because the work happens in the sections' own contexts. It does not save credits: every section head starts at about 33K tokens, and the team measured 4.5× (Lean), 7× (Balanced) and 13× (Max) one agent's cost on the mode round, and 9× on h7. A team can be made cheaper, but never cheaper than one agent doing the same work.
- **Better code is not yet shown.** On h7, one agent passed all 148 hidden tests for $3.32. The Balanced team passed all 58 stage-1 tests and timed out at $29.43, before stage 2. The only evidence of better code is the mode round's blind judges, who scored Balanced 8.83, Lean 8.37 and solo 6.80.
- **h7 is too small to measure it.** One agent already gets h7 perfect, even with its hardened hidden tests.

## Definition of done

These are measured on the new platform benchmark (below), taking the mean of 2 runs per setup, against one agent alone (solo):

| Mode | Cost | Hidden tests | Judged code quality |
|---|---|---|---|
| Lean | at most 2× solo | at least solo's pass count | at least solo + 1.0 out of 10 |
| Balanced | at most 3.5× solo | at least Lean's | at least solo + 1.5 |
| Max | no cap, reported | at least Balanced's | at least Balanced's, and no high-severity security finding |

Every mode must also meet these:

- It finishes every stage within the stage's time limit.
- The supervisor's chat stays under 150K tokens across the whole build.
- On platform work, the plan check runs before the user's OK.
- No user data is read, moved or lost.

If a mode misses its target, the result is reported with its numbers, and the user decides whether the target or the mode changes.

## Approach: measure first, in stages

1. **Build the benchmark.** This costs no API money. Calibrate it with a reference version and broken versions, then run solo on it once (about $10–15).
2. **Cut costs per mode.** Each cut is checked on the benchmark's first stage. A cut is kept only if cost falls and judged quality does not.
3. **Build the plan check and the skill search.**
4. **Run the proof round:** solo, Lean, Balanced and Max, 2 runs each, roughly $250–400, spread across weekly resets. Each paid step needs the user's yes with its figure.

## The platform benchmark: task p1, a help-desk platform

p1 runs on Node built-ins only, with SQLite through `node:sqlite` and no npm install, like h7. It has three stages in one session (`--resume`), as a real multi-day build would.

1. **API and accounts.** Users, login sessions with salted password hashes (`node:crypto` scrypt), and the roles admin and member. Tickets with comments, and an audit log. Security rules the task text states exactly:
   - a role check on every route;
   - a login rate limit;
   - no password or session token in any log or reply;
   - exact error replies.
2. **Dashboard.** A page with ticket counts by status, filters and a simple SVG chart, fed by a reporting API. A member sees only their own tickets; an admin sees all.
3. **AI feature.** "Summarise this ticket" and "suggest a category", calling a model at `MODEL_URL`. The behaviour the task text states:
   - a time limit on every model call;
   - output checks on what the model returns;
   - a ticket whose text tries to make the model reveal other users' data must not succeed.

   In the hidden tests, `MODEL_URL` points at a fake model server the tests run, so no paid API is called and results repeat exactly.

Scoring:

- **Hidden tests.** Each stage has its own set (`s1`, `s2`, `s3`), plus regression sets (`reg2`, `reg3`) that rerun earlier stages' cases on later code. Every case comes from the task text alone, in the way h7's were hardened.
- **Blind judges.** They grade code quality as in the mode round (`bench/judge.mjs`, `bench/codex-judge.mjs`).
- **Calibration** (`bench/calibrate.mjs`). A reference version for each stage passes every hidden case, and at least 3 broken versions per stage each fail one or more.
- **Time limits.** Each stage gets a limit set from solo's calibration run, with room for the team.

A coverage table, `docs/plans/p1-hidden-coverage.md`, maps each line of the task text to its cases, as `docs/plans/h7-hidden-coverage.md` does.

## Plugin changes

### Plan check

A new read-only advisor, `section-team:plan-advisor`, runs on Opus. It uses the advisor rules the other advisors have: it never changes project files and runs no shell commands.

- **When it runs.** The foundation skill wakes it after the supervisor writes `.team/notes/foundation.md` and before the user sees it. It runs once per platform, and again when the frozen note changes.
- **What it checks.** Missing parts; the order of the slices; security, AI and data risks; which sections and skills each slice needs; and whether each quality target is a number or a check.
- **What it returns.** At most 8 fixes, each with its reason.
- **What the user sees.** The supervisor revises the note, then shows it together with the advice it took and the advice it did not, and why.
- **Modes.** All three, because it runs once per platform, about $1.

### Skill search

- **When it happens.** A job needs a skill that is not installed, or a section's REPORT names a missing skill.
- **How.** The supervisor searches the skills.sh catalog and GitHub (as the `find-skills` skill does), then runs `section-team:add-skill`'s safety review on the best match.
- **What installs on its own.** Only a skill from a trusted source whose review finds no red flag. The trusted list sits in one file in the plugin: `anthropics`, `vercel-labs` and `microsoft`, plus any org the user adds. Anything else is shown to the user, and nothing installs until they say yes.
- **Where the rules live.** The details go in the add-skill skill; the brief gets one line. Max's brief is at 8,989 of its 9,000-character cap, so that line replaces words that are already there.

### Cost cuts, kept only when measured

Already on the branch, from the h7 smoke run, but not yet measured:

- After a pass, only fixes of a few lines, with no new grade. Larger fixes go to Next.
- The reviewer lists at most 5 fixes, and on a pass only what breaks a stated requirement or crashes.
- Balanced runs one testing job, after the builders report.

Candidates to measure on stage 1:

- **Test volume.** One test per requirement line plus one per bug found. h7's team wrote 4,589 test lines for 1,094 lines of code.
- **Grades in Lean.** One reviewer grade per job.
- **Waiting heads.** A head that waits long on its helpers pays to rewrite its cache. The rule would keep helper waits short, or hand back and resume.

Each cut is kept only if the stage-1 cost falls and judged quality does not drop.

### Unchanged

These stay as they are: the gates and their enforcement hooks, notes, REPORTs, the ai-engineer and data-scientist advisors, and the user's own rules in CLAUDE.md, including never passing `model` for section-team agents.

## Risks

- **Cost.** The proof round may cost more than estimated, as the h7 smoke did. Each paid step is quoted with a range and has a time limit, and the stop at 90% of the weekly limit still applies.
- **The task's fit.** p1 is still one task. A result on p1 is evidence for platforms like it, not for every platform.
- **Judging.** Judges disagree, so the rubric and the judge setup are those of the mode round, unchanged, and judges are blind to the setup.
- **Supply chain.** Search results are where look-alike skills hide, which is why only trusted sources install automatically.
- **The brief's size.** New lines must replace old ones. The 9,000-character cap stays.

## Out of scope

- A new mode, a new builder section, or per-mode model changes.
- Measuring growth over many days or sessions.
- Real paid model APIs in the benchmark.
- Merging, tagging or releasing without the user's yes.
