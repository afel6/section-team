# Raw benchmark data

The data behind [docs/benchmark-2026-10-24.md](../../docs/benchmark-2026-10-24.md), rounds 1–17. Later rounds have their own folders: [`heldout/`](heldout/) (the held-out round), [`modes/`](modes/) (the mode round), [`p1/`](p1/) (the p1 rounds and their recompute script), [`ph/`](ph/) and [`py/`](py/) (two more p1 rounds in p1's layout), [`hq/`](hq/) and [`fx/`](fx/). [`hq/README.md`](hq/README.md) explains hq, fx, ph and py and how to recompute them.

| File | What it holds |
|---|---|
| `summary.json` | One row per run (126 runs: 21 setups × 3 tasks × 2 runs): cost, tokens, wall time, agents spawned, hidden-test and own-test results, code size. |
| `judge.json`, `judge-v2.json` … `judge-v17.json` | Every blind judge's scores (1–10 on correctness, code quality, tests, robustness and docs), ranking and notes, one file per round. Solutions are labelled X, Y and Z. |
| `blind-key.json`, `blind-key-v2.json` … `blind-key-v17.json` | Which setup was X, Y and Z in each round. |

Setup names: `solo` is Claude Code with the author's setup (plugin off; their CLAUDE.md and other plugins on), `team` is the plugin, and `-vN` is the version tested in round N. The final round compares `solo-v3`, `team-v3` and `team-v17`; the `solo-v3` and `team-v3` runs were built once in round 3 and judged again in later rounds.

In a judge's `ranking`, the first label is ranked 1st and the last is ranked last; the "Wins–losses" columns in the benchmark doc count those 1st and last places.

## Recompute a round

From the repo root, in a temp folder (`bench/aggregate.mjs` writes its report into the folder `BENCH_RESULTS` names, so the local `bench/results/` is never touched):

```bash
tmp=$(mktemp -d) && cp bench/data/*.json "$tmp"/ && BENCH_RESULTS="$tmp" node bench/aggregate.mjs --round=v17
```

The `all` rows give the headline numbers: judge quality 8.58 (team-v17), 7.72 (team-v3) and 7.12 (solo-v3); 12 first places for team-v17; 9 last places for solo-v3 and 3 for team-v3; 100% hidden tests for all three. The Grade /100 column scores cost and speed against the cheapest and fastest run of each task across all 126 runs, so it changes if you drop rows.
