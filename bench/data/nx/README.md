# Round nx: raw data

Derived data for round nx: v0.6.0-rc.1 (`team`) against v0.5.1 (`base`) and plain Claude Code (`solo`), on h8 to h10, judged blind by Codex. The results are in [docs/benchmark-nx-2026-11.md](../../../docs/benchmark-nx-2026-11.md). Run ids read `<task>-<setup>-nx-r<rep>`.

| File | What it holds |
|---|---|
| `summary.json` | One row per run: cost, tokens, wall time, agents spawned and their models, hidden-test and own-test results, code size and mainPeak. It holds the 27 round runs and 8 pilot runs (ids ending `-pnx-r1`, run before the freeze to check the harness); the recompute script and the bars read only the round runs. |
| `judge-nxcx.json` | Codex's 18 verdicts (9 groups × 2 mirrored orders): scores 1–10 on correctness, code quality, tests, robustness/security and docs/usability, the ranking and Codex's notes. Solutions are labelled X, Y and Z. |
| `blind-key-nxcx.json` | Which setup was X, Y and Z in each group. |
| `test-strength-nx.json` | Per run: which of its own test files pass alone against the reference solution, and which of the task's frozen near-miss versions they catch. |
| `cost-by-role-nx.json` | Per task and setup: mean cost per run, split by role (main and each section). |
| `mode-check-nx.json` | Per run: whether it followed its mode's rules (and the flags if not), its tier, the agents it spawned, its plugin commit, the models it used and whether it timed out. |
| `bars-nx.json` | The output of `bench/bars.mjs` for the round: each bar met or missed with its reading, the keep decision and the reported h9 and h10 checks. The frozen bar definitions are `bench/bars-nx.json` in the tag `nx-freeze`. |
| `recompute.mjs` | Prints the results doc's tables from the first five files above. It only reads. |

## Recompute

From the repository root:

```
node bench/data/nx/recompute.mjs
```

It prints cost, wall time, Codex's five-dimension means, hidden tests, near-misses caught, mainPeak and cost by role per task and setup. `node bench/data/nx/recompute.mjs <folder>` reads another folder with the same files.

Not published: the run transcripts and solutions, and the preflight's pin file (`preflight-nx.json`), which holds a local home path.
