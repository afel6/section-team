# Raw data — mode round

The data behind [docs/benchmark-modes-2026-11.md](../../../docs/benchmark-modes-2026-11.md): 36 runs (3 tasks × 4 setups × 3 runs), 18 Opus judgments and 18 Codex verdicts, frozen at tag `mo-freeze-cloud` (`3fb14ef`) with the plugin at `v0.2.1` (`404b934`).

| File | What it holds |
|---|---|
| `summary.json` | One row per run: cost, tokens, wall time, agents spawned, hidden-test and own-test results, code size. |
| `judge-mo.json`, `blind-key-mo.json` | Every Opus judgment (labels W, X, Y, Z), and which setup each label was in each group. |
| `judge-mo-edges.json`, `judge-mo-reasks.json` | How often each setup was a judge's first or last folder, and every re-ask. |
| `judge-mocx.json`, `blind-key-mocx.json`, `external-key-mo.json` | Codex's mode-round verdicts as imported, the label map, and the case → group map. |
| `outside-usable-mocx.json` | How many of Codex's 18 cases were usable. |
| `judge-hocx.json`, `blind-key-hocx.json`, `outside-check-ho-hocx.json`, `outside-usable-hocx.json` | Codex's fresh-session held-out verdicts and its recorded check. |
| `bars-mo.json` | Every bar: headline, sensitivity check, outside confirmation and secondary measures. |
| `mode-check-mo.json` | Mode fidelity per run: faithful or not, what broke, the tier chosen. |
| `gate-stats-mo.json` | Per team-setup run: every reviewer call's grade, first-try passes and final grades. |
| `test-strength-mo.json` | Per h5 and h6 solution: its test files, which were valid, and which near-miss versions they caught. |
| `leak-scan-mo.json` | Frozen-word hits, extra files and test lines per setup. |
| `report-data-mo.json` | The table `bench/aggregate.mjs` prints, and its per-run rows. |
| `preflight-mo.json` | The pinned CLI, the recorded built-in plugins, and each setup's agents and skills. |

Setup names: `solo-mo` is Claude Code with every plugin off; `lean-mo`, `team-mo` (Balanced) and `max-mo` are section-team `v0.2.1` in that mode.

## Recompute

From the repo root (this overwrites anything in the local, git-ignored `bench/results/`):

```bash
mkdir -p bench/results && cp bench/data/modes/*.json bench/results/ && node bench/bars.mjs --round=mo && node bench/aggregate.mjs --round=mo
```

`bars.mjs` rewrites `bench/results/bars-mo.json`, byte-identical to the copy here (checked on Windows with Node 26.2.0 and on Ubuntu with Node 26.10.0). The `all` rows of the aggregate table give the headline quality and cost.

`mode-check.mjs`, `gate-stats.mjs` and `test-strength.mjs` read each run's transcripts and solution folder, which live on the branch `bench/mode-round-cloud-results` at commit `f37b48c` (`results/` and `runs/`). `run.json` names each run folder as `/root/bench-runs/<name>`, so run them on Linux with the folders at that path: `node bench/mode-check.mjs --round=mo`, `node bench/gate-stats.mjs --round=mo`, `node bench/test-strength.mjs --round=mo`.
