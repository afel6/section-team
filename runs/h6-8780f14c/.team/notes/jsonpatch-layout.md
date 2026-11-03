# jsonpatch layout — owner: supervisor — 2026-11-03

- `jsonpatch.mjs` — library: `parsePointer`, `applyPatch`, `PatchError` (built by supervisor).
- `jsonpatch-cli.mjs` — CLI `node jsonpatch-cli.mjs <patch> [<doc>]`.
- `test/*.test.mjs` — node:test suites; `npm test` runs `node --test test/`.
- `.team/near-miss/` — near-miss copies (testing section); never imported by `test/` by default.
- Node built-ins only, no npm install. Full spec: the task text quoted in the testing job.
