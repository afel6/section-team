# section-team: final report (2026-10-26)

Everything is finished, committed and tested (155 tests, 36 board tests and plugin validation all pass). No benchmark is running.

## Result
The last round (17) was the best of all:

| | Cost per task | Quality (judges, 1–10) | Judge votes |
|---|---|---|---|
| Solo Claude Code | $0.85 | 7.1 | 0 wins, 9 losses |
| Old team (sections for everything bigger, round 3) | $3.39 | 7.7 | 0 wins, 3 losses |
| **Team now (round 17)** | **$3.10** | **8.6** | **12 wins, 0 losses** |

Compared with the old team on the same judges: cheaper, and better on every score: correctness 9.3 (was 8.2), robustness 9.0 (was 7.2), tests 9.2 (was 7.9).

## What round 17 changed
- Your rule "user-facing errors stay friendly and leak nothing" was missing from every agent's copy of your house rules, so programs crashed with raw stack traces that leaked file paths.
- It is now in every copy. The reviewer fails code where a user can trigger a stack trace, and testing checks those failure cases.
- Result: robustness jumped from 8.1 to 9.0, and from 7.3 to 9.0 on the medium task.

## Also done today
- **Skill search:** when a section needs a skill it doesn't have, it searches skills.sh read-only and suggests one. The supervisor installs it without asking you if add-skill's safety review is clean, and lists every install in its summary. A red flag, or a skill that already exists with that name, stops the install and you're told.
- **web-design-guidelines:** installed with the rules copied in locally (no fetching from the web); uiux loads it every time it wakes; graded 7/10.
- **Desktop board:** confirmed working (you said so).
- **.gitignore:** the benchmark logs and pid.txt are ignored.

## Why I stopped the rounds
- What's left is worth about 0.1–0.3 points each, which is inside the judges' own noise.
- More rounds would tune the team to the three benchmark tasks rather than your real projects.
- Better to improve from real use: section reports, reviewer grades and the Team Board.

Full details: docs/benchmark-2026-10-24.md (final summary at the end).
