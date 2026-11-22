# Rounds hq, fx, py and ph: raw data

Summaries, blind keys and judge verdicts for four rounds run on the second test machine, in the same layout as [`../p1/`](../p1/README.md). The results are in [docs/benchmark-p1-hq-fx-2026-11.md](../../../docs/benchmark-p1-hq-fx-2026-11.md).

| Round | Folder | Tasks | Setups | Judges | Files |
|---|---|---|---|---|---|
| hq | `hq/` | h5, h6, h7 | solo-hq, team-hq (Balanced), max-hq | Codex, Fable | summary, blind key, external key, judge-hq-codex, judge-hq-fable |
| fx | `../fx/` | f1, f2, f3 | solo-fx, team-fx (Balanced, v0.4.0), team-fy (Balanced with 4b07ff0) | Codex, Fable | same as hq, plus `tasks/` (the three task specs and f1's seed) |
| ph | `../ph/` | p1 | solo-ph, team-ph, max-ph | Codex, Fable | same as hq |
| py | `../py/` | p1 | solo-py, team-py, max-py | none (not judged) | summary, blind key, external key |

The judge files hold each case's verdict mapped back to setups, built from the judges' raw `verdict.json` files with the harness's own `importVerdicts` (`bench/external-judge.mjs`), the same rows `external-judge.mjs import` writes. The raw verdict folders, transcripts and workspaces are not published, and neither are fx's hidden tests.

## Recompute

From the repository root; the scripts only read these folders:

```
node bench/data/hq/recompute.mjs
node bench/data/fx/recompute.mjs
```

Each prints, per setup and then per task: total cost over its runs, cost as a multiple of solo, hidden tests passed per task (mean), and each judge's mean overall score with the number of cases that ranked the setup first. Rounds ph and py have p1's layout, so p1's per-run means apply to them.

Known differences from the results doc, all rounding: hq solo's total prints $11.20 (the doc says $11.19; the unrounded sum is $11.197), fx's fix setup prints 2.93x solo (the doc says 2.94x; unrounded 2.933), and ph solo's mean cost is $3.62 per run where the doc says $3.63.
