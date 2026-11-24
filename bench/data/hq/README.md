# Rounds hq, fx, py and ph: raw data

Summaries, blind keys and judge verdicts for four rounds run on the second test machine, in the same layout as [`../p1/`](../p1/README.md). The results are in [docs/benchmark-p1-hq-fx-2026-11.md](../../../docs/benchmark-p1-hq-fx-2026-11.md).

| Round | Folder | Tasks | Setups | Judges | Files |
|---|---|---|---|---|---|
| hq | `hq/` | h5, h6, h7 | solo-hq, team-hq (Balanced), max-hq | Codex, Fable | summary, blind key, external key, judge-hq-codex, judge-hq-fable |
| fx | `../fx/` | f1, f2, f3 | solo-fx, team-fx (Balanced, v0.4.0), team-fy (Balanced with 4b07ff0) | Codex, Fable | same as hq, plus `tasks/` (the three task specs and f1's seed) |
| ph | `../ph/` | p1 | solo-ph, team-ph, max-ph | Codex, Fable | same as hq |
| py | `../py/` | p1 | solo-py, team-py, max-py | none (not judged) | summary, blind key, external key |

The judge files hold each case's verdict mapped back to setups, built from the judges' raw `verdict.json` files with the harness's own `importVerdicts` (`bench/external-judge.mjs`), the same rows `external-judge.mjs import` writes. The raw verdict folders, transcripts and workspaces are not published. fx's task specs and hidden tests are published in `bench/tasks/f1-f3.md` and `bench/hidden/f1-f3.test.mjs`.

## Recompute

From the repository root; the scripts only read these folders:

```
node bench/data/hq/recompute.mjs
node bench/data/fx/recompute.mjs
node bench/data/p1/recompute.mjs ph py
```

Each prints, per setup and then per task: total cost over its runs, cost as a multiple of solo, hidden tests passed per task (mean), and each judge's mean overall score with the number of cases that ranked the setup first. Rounds ph and py have p1's layout, so p1's per-run means apply to them (the third command prints them; py has no judges, so only cost and hidden tests).

Known differences from the results doc: the printed values are the authority, and the doc now prints them. Before 0.6.0 the doc had four values that differed. Three were rounding (the printed value is the correctly rounded one; the doc was off by 0.01): hq solo's total prints $11.20 (the doc had $11.19; the unrounded sum is $11.197), fx's fix setup prints 2.93x solo (the doc had 2.94x; unrounded 2.933), and ph solo's mean cost is $3.62 per run where the doc had $3.63. The fourth was not rounding: Balanced cost on h6 prints 3.24x (5.34065 / 1.64805 = 3.2406), where the doc had 3.3x because it averaged the two per-run ratios (3.74 and 2.86) instead of using the ratio of totals, as the table and the recompute do.
