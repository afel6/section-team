# Raw data — held-out round

The data behind [docs/benchmark-heldout-2026-11.md](../../../docs/benchmark-heldout-2026-11.md): 18 runs (3 held-out tasks × 2 setups × 3 runs) and 18 blind judges, frozen at commit `c988fce` (tag `heldout-freeze`).

| File | What it holds |
|---|---|
| `summary.json` | One row per run: cost, tokens, wall time, agents spawned, hidden-test and own-test results, code size, `isError`. |
| `judge-ho.json` | Every blind judge's scores (1–10 on correctness, code quality, tests, robustness/security, docs/usability and overall), ranking and notes; two judges per pair. Rows with `swapped: true` come from the second judge, who saw the two solutions under swapped labels; its scores and ranking are already mapped back to the real labels, but its notes name the folders it saw. |
| `blind-key-ho.json` | Which setup was X and which Y in each pair. |
| `gate-stats-ho.json` | Per team run: every reviewer-gate call's grade, first-try passes, fix rounds, partial/blocked REPORTs, hidden tests that failed after a passing gate, and the judges' code-quality score. |

Setup names: `solo-ho` is plain Claude Code (plugin off), `team-ho` is section-team `v0.1.1`.

## Recompute

From the repo root (this overwrites anything in the local, git-ignored `bench/results/`):

```bash
mkdir -p bench/results && cp bench/data/heldout/*.json bench/results/ && node bench/aggregate.mjs --round=ho
```

The `all` rows give the headline numbers: judge quality 8.80 (team-ho) and 8.16 (solo-ho); 16 first places of 18 for team-ho; 100% hidden tests for both. The Grade /100 column scores cost and speed against the cheapest and fastest run of each task among these 18 runs.
