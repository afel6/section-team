# p1 benchmark rounds: raw data

Summaries, blind keys and judge verdicts for the p1 task rounds. Setups: solo (Claude Code with the author's setup (plugin off; their CLAUDE.md and other plugins on); 16 of its 20 runs here spawned the author's code-reviewer or security-reviewer agent), lean (pr only), team (= Balanced), max. Costs are per-run means at API rate. Judges are outside models (Codex; Fable from round tf on) that did not build the solutions and saw them under shuffled letters. Fable also planned and reviewed some of the fixes these rounds measured.

| Round | Date | Plugin commit | Judges | Files in the folder |
|---|---|---|---|---|
| pr | 2026-11-07 | 98338a6 | Codex | summary, blind key, external key, judge-pr-codex |
| tm | 2026-11-09 | 5b9ba51 | Codex | same |
| tc | 2026-11-10 | 29af0bb | Codex | same |
| tf | 2026-11-11 | 874ad3f | Codex, Fable | same, plus judge-tf-fable |
| tg | 2026-11-11 | 80ab45a | Codex, Fable | same as tf |
| th | 2026-11-12 | 72389bf | Codex, Fable | same as tf |
| ti | 2026-11-12 | 2512825 | Codex, Fable | same as tf |
| tj | 2026-11-15 | 6b61dce | Codex, Fable | same as tf |
| tl | 2026-11-17 | 70969f0 | Codex, Fable | same as tf |
| to | 2026-11-17 | 051f957 | Codex, Fable | same as tf |

Round tk was void and unjudged, so it is not here. Rounds ph (2026-11-18, 8713aa3, Codex and Fable) and py (2026-11-18, d98c418, not judged) ran on a second test machine, whose solo setup was not recorded; they have this layout in [`../ph/`](../ph/) and [`../py/`](../py/).

Files per round `<r>/`:
- `summary.json`: one row per run (cost, tokens, time, hidden-test counts). No code or transcripts.
- `blind-key-<r>.json`: which setup each solution letter was in the group the judges saw.
- `external-key-<r>.json`: which case showed which letters (case to group map).
- `judge-<r>-codex.json`, `judge-<r>-fable.json`: each case's verdict mapped back to setups, as `bench/external-judge.mjs import` writes them (`judge-<as>.json`, renamed per judge).

## Recompute a round

From the repository root. The script only reads these folders and writes nothing, so `bench/results/` is not touched and no temp copy is needed:

```
node bench/data/p1/recompute.mjs        # all rounds
node bench/data/p1/recompute.mjs tf     # one round
node bench/data/p1/recompute.mjs ph py  # the two rounds beside p1/
```

It uses the harness's `judgeScores` (`bench/aggregate.mjs`) and prints, per setup: cost per run, hidden tests passed (of 264), and each judge's mean overall score over the runs of that setup. Expected output (cost, hidden, Codex, Fable):

| Round | solo | team (Balanced) | max |
|---|---|---|---|
| pr | $4.22, 264, 7.5 | $18.78, 263, 8.75 (lean: $9.81, 264, 7.75) | $25.78, 210, 7 |
| tm | $3.89, 264, 7.25 | $15.96, 261.5, 8.25 | $36.19, 262, 8.5 |
| tc | $3.53, 264, 7 | $17.45, 262.5, 8 | $37.37, 261, 8.75 |
| tf | $4.03, 264, 7, 7 | $18.95, 264, 8.5, 9 | $32.96, 264, 8.5, 8.25 |
| tg | $4.43, 264, 7.5, 6 | $16.28, 264, 8.75, 8.5 | $38.21, 264, 9, 9 |
| th | $4.11, 264, 7.5, 6.25 | $21.56, 264, 8.5, 8.75 | $48.54, 264, 9.25, 8.75 |
| ti | $3.87, 264, 7, 6.25 | $21.67, 264, 8.75, 8.75 | $36.14, 264, 9, 9 |
| tj | $5.20, 264, 7, 6.5 | $17.71, 184, 8.5, 8.5 | $43.60, 264, 8.5, 9 |
| tl | $3.80, 264, 7.25, 6.25 | $18.59, 264, 8.5, 8.5 | $49.41, 264, 8.75, 9 |
| to | $4.81, 264, 7, 6.75 | $20.39, 264, 8.5, 8.5 | $43.52, 264, 8.5, 8.75 |
| ph | $3.62, 264, 7.25, 6.75 | $17.13, 264, 8.75, 8.75 | $36.94, 264, 9.25, 8.75 |
| py | $3.59, 264 | $21.53, 264 | $43.83, 264 |

One number differs from the results doc: round tj's team hidden mean prints 184 because this summary keeps the first scoring, in which one Balanced run's hidden suites were cut short under machine load; a quiet rescore passed 264 (a reported rescore, not published).

Cost as a multiple of solo (team, max): tg 3.7x, 8.6x; th 5.2x, 11.8x; ti 5.6x, 9.3x; tj 3.4x, 8.4x; tl 4.9x, 13.0x; to 4.2x, 9.1x; ph 4.7x, 10.2x; py 6.0x, 12.2x.

To rebuild the judge files from raw `verdict.json` files instead, the harness command is `node bench/external-judge.mjs import` (needs the round's own judge file and a results folder; point `BENCH_RESULTS` at a temp folder, never at `bench/results/`). The raw verdict folders are not published.
