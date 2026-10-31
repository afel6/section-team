# Quality modes for section-team — design (2026-11-01)

## Why

The held-out round showed what section-team buys today: +0.64 blind judge quality over plain Claude Code (8.80 vs 8.16), almost all of it in tests (+1.94) and docs (+0.67), at about 2.2 times the usage. Some projects want that; some want most of it for less; some want more and will pay for it. The user wants to pick, per project, the way they pick a model: one tap, any time.

The same round exposed reliability gaps that hit every user: section memory carried notes between projects, the reviewer gate silently did not run inside workflows, and a settings override silently lost. Those are fixed in every mode.

## Goals

- Three modes, **Lean**, **Balanced** and **Max**, chosen per project with one tap in the team strip or `/team mode <name>`, switchable mid-session.
- **Balanced is today's behaviour, unchanged**, and the default, so existing users see no difference until they choose.
- Each mode measured on new held-out tasks by Opus and by a non-Claude judge; the picker shows measured numbers, not promises.
- The reliability fixes below, in every mode.

## Non-goals

- Picking a mode automatically per task.
- A gate-off mode, other languages, or new sections.
- Changing which model each section runs on, except Lean's reviewer (below).

## The modes

Balanced is the current `brief/supervisor.md`. Lean and Max differ only in the rules below; all three use the same agents.

| | Lean (target ~1.3×) | Balanced (today, ~2.2×) | Max (target ~3–4×) |
|---|---|---|---|
| Small task (≤ ~50 lines) | supervisor builds it and its tests | same | same, plus the testing section probes it |
| Single-area (≤ ~600 lines) | supervisor builds it **and writes the tests itself**, with the checklist "give each spec line a test a plausible wrong implementation fails; try to break it with bad input"; no testing section | supervisor builds it; the testing section writes and runs the tests | supervisor builds it; the testing section writes the tests **and near-miss copies** of the key functions (one plausible bug each), and every copy must fail at least one test; the security section reviews code that takes user input, touches files or the network |
| Multi-area | builders woken; the testing section only for the final check | builders + testing + docs when asked (today) | as Balanced, plus a security pass, and docs always |
| Reviewer gate | one `section-team:reviewer` call with `model: sonnet`; pass at overall ≥ 8; at most 1 fix round | Opus reviewer; pass at overall ≥ 8 and no item < 6; at most 2 fix rounds (today) | Opus reviewer; pass at overall ≥ 9 and no item < 7; at most 3 fix rounds; the gate also fails while any near-miss copy passes the tests |
| Supervisor brief | shorter: only the rules Lean uses | today's brief | today's brief plus the Max rules |

Lean doubles as the open experiment: if a single testing checklist in the supervisor gets most of Balanced's gain, Lean will show it.

## Picking and switching

- **Mode file:** `.team/mode.json` in the project root, for example `{"mode": "max"}`. A missing file or an unknown value means Balanced; an unknown value is reported once in the session brief, not silently ignored.
- **Strip chip:** the team strip shows `● <Mode> ▾`. A tap opens a three-item menu (each item: the mode name and its cost, "target" or "measured"); picking one writes the mode file. If the Mods API cannot open a menu or write files from the strip, the chip shows the mode and runs `/team mode`, which lists the three choices.
- **Command:** `/team mode <lean|balanced|max>` writes the mode file; `/team mode` alone shows the current mode and the choices. The chip and the command use one function, so they cannot disagree.
- **Brief by parts:** the supervisor brief is assembled at session start from `brief/core.md` (shared rules), `brief/tiers-<mode>.md` (when to wake sections) and `brief/gate-<mode>.md` (the gate). Assembled Balanced must equal today's brief, word for word.
- **Mid-session switch:** a new `UserPromptSubmit` hook compares the mode file with the mode this session started in (kept in the session's status file). On a change it adds the new mode's tier and gate rules to the context once, starting "Mode is now <Mode>:", and records the new mode.
- **Sections follow the mode:** every job message the supervisor sends states the mode's gate (pass threshold, fix rounds, and in Max the near-miss check). The hook that refuses an ungraded section report reads the same mode file for its threshold.
- **Benchmark support:** `bench/run.mjs` accepts setups `team-lean` and `team-max`, which write the mode file into each fresh run folder before the run.

## Reliability fixes (every mode)

1. **Per-project section memory.** Section agents move from user-wide memory to per-project memory, so one project's notes never reach another and every benchmark run starts empty. The exact frontmatter value is taken from current Claude Code docs during planning. Existing user-wide notes are left where they are; the README says how to copy chosen notes into a project.
2. **No silent missing gate.** A section that cannot call its reviewer (no Agent tool, as inside a workflow) ends with `Status: ungraded`. The report hook and the supervisor treat it as work that must be reviewed from outside, and the brief tells the supervisor to run `section-team:reviewer` on it.
3. **Settings that state their effect.** `.team/mode.json` may hold `"autoInstallSkills": true|false`, which overrides the environment variable for that project; the session brief states which value is in effect and where it came from.
4. **No silent hook failures.** The three hooks (SessionStart, PreToolUse, SubagentStop) and the new UserPromptSubmit hook are audited; wherever a hook skips its job (unreadable file, missing folder, bad JSON), it says so in one line instead.

## Measurement

1. **Outside check of the held-out round (no Claude usage):** Antigravity judges the 9 held-out pairs blind (`bench/external-judge.mjs`, fresh A/B labels, both orders). Confirmed when its team-minus-solo quality gap is at least +0.5 and it picks the same pair winner as the Opus judges in at least 7 of 9 pairs; reported either way.
2. **Mode round (paid, after the build, only with the user's yes):**
   - Three new held-out tasks: one multi-area (an API plus a UI), one on an existing codebase, one with a tricky spec; built with the same rigor as H1–H3 (ambiguity review, separate test and reference authors, calibration, a freeze commit pushed before any run).
   - Setups: solo, Lean, Balanced, Max; 3 tasks × 4 setups × 3 runs = 36 runs (about $65 of usage at measured rates).
   - Judging: every judge sees all four solutions of a task and rep at once, labelled A–D with positions rotated; 9 groups × 2 Opus judges, plus Antigravity on the same groups. `anonymize.mjs` grows from 3 to 4 labels.
   - **Bars, fixed in the freeze commit:** Lean pays off at ≥ +0.3 quality over solo and ≤ 1.5× solo's usage; Balanced holds at ≥ +0.5 over solo; Max pays off at ≥ +0.3 over Balanced. A mode's gain counts as confirmed only when, between that mode and the setup it is compared with, Antigravity ranks the same one higher as the Opus judges do in at least 6 of the 9 groups.
3. **Picker labels:** each menu item shows its target until its mode is measured, then the measured quality and cost with the round's date. A mode that misses its bar keeps its name and shows its honest number.

## Compatibility

- Default Balanced keeps today's behaviour; plugin version 0.2.0.
- The memory change is the one behaviour change for existing users; the release notes and README state it.
- The plugin freeze for benchmarks moves to the 0.2.0 tag.

## Risks and checks first

- **Mods API:** whether a strip chip can open a menu and write a file. A short probe is the plan's first step; the fallback above keeps it one tap plus one key.
- **Memory scope:** the per-project value and where it stores notes, from current docs.
- **Lean's Sonnet reviewer:** that `model: sonnet` on the Agent call overrides the reviewer's own `model: opus`.
- **Brief size:** Max adds rules; the assembled Max brief should stay under about 90 lines.
