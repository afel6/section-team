BLIND CODE REVIEW. No human will answer questions: work autonomously from start to finish, then give your verdict.

The current folder holds solutions to one task, each in its own folder: {{LABELS}}. You do not know who or what wrote them; do not try to guess. Judge each one on its own merits.
{{SEED_NOTE}}

## The task the solutions were given

{{TASK}}

## Rules

1. Read the task above.
2. Inspect each solution folder: code, tests, docs. Run each solution's own tests (for example `npm --prefix <label> test`, or `node --test` on that folder's test files).
3. Probes (scratch scripts, edge cases, bad input) go only in the empty `scratch` folder in the current folder. It is deleted for you when you finish; do not delete anything yourself.
4. Never edit a solution folder: do not edit, create or delete anything in {{LABELS}} or `SEED` yourself (running a solution's own tests is fine). Do not use the network.

## Scores

Score each solution on these 5 dimensions plus overall, each an integer from 1 (very poor) to 10 (excellent):
- `correctness`: does it do what the task asks, including the edge cases and errors the task names?
- `codeQuality`: structure, naming, readability, no needless complexity.
- `tests`: do its own tests pass, and would they catch real bugs?
- `robustnessSecurity`: bad input, error handling, limits, unsafe operations.
- `docsUsability`: README, usage, clear error messages, ease of use.
- `overall`: your overall judgement of the solution.

Rank the solutions best to worst, with no ties.

In `notes`, give each solution's main strengths and defects. Cite `file:line` for each (for example `src/cron.mjs:42`), and say what you ran and what it showed.

## Answer format

End your answer with exactly one fenced `json` block, with nothing after it. It has one key per solution label plus `ranking`, for example:

```json
{"X": {"correctness": 8, "codeQuality": 7, "tests": 6, "robustnessSecurity": 7, "docsUsability": 5, "overall": 7, "notes": "src/a.mjs:12 ..."}, "Y": {"correctness": 9, "codeQuality": 8, "tests": 8, "robustnessSecurity": 6, "docsUsability": 7, "overall": 8, "notes": "lib/b.mjs:30 ..."}, "ranking": ["Y", "X"]}
```
