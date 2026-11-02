# Mode Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build plugin v0.2.1 and everything the mode round needs (harness, three held-out tasks, analysis scripts), freeze it, then run, judge and publish the round, with every paid step behind the user's yes.

**Architecture:**
- v0.2.1 changes only Max's brief, the testing section's generated instructions and the README.
- Harness work stays in `bench/` and `docs/`. The shared run hygiene sits in one new module, `bench/clean-run.mjs`: the pinned CLI, the child environment, the clean settings, output parsing and the init checks. `run.mjs`, `preflight.mjs` and `judge.mjs` all use it.
- Attempt bookkeeping and evidence copying live in `bench/run-attempts.mjs`.
- Analysis is split into focused scripts: `mode-check`, `bars`, `bars-outside`, `test-strength` and `leak-scan`.
- The paid steps come last, as runbook tasks.

**Tech Stack:** Node.js 26 built-ins only (`node:test`, `node:child_process`, `node:fs`, `node:crypto`), headless `claude -p` 2.1.296, `codex exec` (codex-cli 0.166).

**Spec:** `docs/specs/2026-11-01-mode-round-design.md`.

## Global Constraints
- **The spec:** `docs/specs/2026-11-01-mode-round-design.md`. A task restates every spec rule it needs; where a task and the spec differ, the spec wins and the difference is reported.
- **Where:** work in the worktree `C:\Users\Asus\claude-team-moderound` on branch `bench/mode-round`. Part E uses its own worktree (see Part E). Commit at the end of each task (this plan authorizes those commits), staging only that task's paths. Never push, push a tag or open a PR without asking the user.
- **Plugin paths:** `agents hooks skills brief .claude-plugin scripts types package.json tests` change only in Task 1. After Task 1, `git diff --stat v0.2.1 HEAD -- agents hooks skills brief .claude-plugin scripts types package.json tests` prints nothing, at every later commit.
- **Round values:**
  - round tag `mo`; tasks `h4`, `h5`, `h6`; `--conds=solo,lean,team,max`; 3 reps;
  - model `claude-opus-5-5`, effort `medium`;
  - time limits h4 120, h5 60, h6 60 minutes;
  - plugin version `0.2.1`, loaded from the worktree `C:/Users/Asus/section-team-v0.2.1` in every setup (section-team is turned off in solo and judges).
- **Bars (verbatim from the spec):**
  - Lean: at least **+0.30** over solo, and at most **1.50×** solo's usage on h5 and h6.
  - Balanced: at least **+0.50** over solo.
  - Max: at least **+0.30** over Balanced; "not measurable (scale ceiling)" when Balanced is above **8.60**.
  - Outside confirmation: **⌈0.75 n⌉ of n** groups (7 of 9). Fewer than **6** groups: "not measured".
  - Gaps, means and ratios are rounded to 2 decimals before comparison; hidden-test rates to 4.
- **No spending without a yes:** no paid `claude -p`, no `codex exec` and no push without the user's explicit yes. Unit tests never spawn `claude` or `codex`; spawning is injected.
- **Suites:** bench tests run with `node --test bench/*.test.mjs`. Plugin checks: `npm test`, `npm run test:board`, `claude plugin validate --strict .`, `node scripts/gen-agents.mjs --check`.
- **House rules:** files 200–400 lines (800 max); functions under 50 lines; no mutation of inputs; explicit, friendly errors. CLI output only from `main()`, in bench style.
- **Implementers:** Parts A–D and F go to section-team sections (never pass `model` for them). Part E uses fresh general-purpose agents, with the roles given there.

## Review Focus
1. **A run that times out:** raw.json holds the streamed lines up to the kill (an init, no result, no `total_cost_usd`). The run is not void when its init passes. `session.json` names the session, evidence is copied, cost comes from transcripts, and `mode-check` and `gate-stats` give a row without throwing. Tests in Tasks 3, 5, 6, 8 and 14.
2. **A usage limit hit mid-batch:** `finishAttempt` gives a batch stop with no `run.json` and no cap use, and a resume reruns only that run. Test in Task 5.
3. **A verdict with tied or missing labels:** it is re-asked at most twice. After that, an Opus judgment is left out (its group keeps its other judge, and a resume does not ask again), and an outside judge with an unusable case does not count. Tests in Tasks 10, 12 and 16.
4. **A near-miss copy left in the solution's source:** `mode-check` marks the Max run unfaithful, and the leak scan lists the file as a tell. Tests in Tasks 13 and 14.
5. **A comparison with fewer than 6 usable groups, a sensitivity check with 0 or 1 faithful groups, or a group with one usable Opus judgment:** each reports without throwing ("not measured (n groups)", "too few faithful groups (n)", or a marked single-judge group). Tests in Tasks 15 and 16.

---

## Part A — Plugin v0.2.1

### Task 1: Max keeps near-miss copies in `.team/near-miss/` (v0.2.1)

**Files:**
- Modify: `brief/gate-max.md`, `brief/tiers-max.md`
- Modify: `scripts/gen-agents.mjs` (`finalStep`, testing string), then regenerate `agents/*.md`
- Modify: `README.md:60`, `package.json:11`, `.claude-plugin/plugin.json:3`
- Test: `tests/brief.test.mjs`, `tests/agents.test.mjs`

**Interfaces:** Produces tag `v0.2.1` (local only) on this task's commit.

- [ ] **Step 1: Write the failing tests.**
  - In `tests/brief.test.mjs`:
```js
test('max gate keeps near-miss copies in .team/near-miss, swapped in after builders and always restored', () => {
  const gate = readFileSync(join(BRIEF_DIR, 'gate-max.md'), 'utf8')
  for (const s of ['.team/near-miss/', 'after every builder has reported', 'always restore the original']) assert.ok(gate.includes(s), s)
})
test('lean and balanced briefs do not mention .team/near-miss', () => {
  for (const m of ['lean', 'balanced']) assert.ok(!assembleBrief(m).includes('.team/near-miss'))
})
```
  - In `tests/agents.test.mjs`, next to `'testing runs the final reviewer pass'` (line 253): `agentFile('testing')` includes `.team/near-miss/<n>-<original file name>`, `near-miss: <the one bug>` and `also when a test run fails`.
- [ ] **Step 2: Run them and see them fail**: `node --test tests/brief.test.mjs tests/agents.test.mjs`.
- [ ] **Step 3: Brief.** In `brief/gate-max.md`, add directly after the line `- The gate also fails while a near-miss copy passes the tests; testing adds tests until each fails.`:
  `- Near-miss copies live only in \`.team/near-miss/\` and stay there; swap one in only after every builder has reported, and always restore the original.`
  Then make exactly these cuts, and no others:
  - **`gate-max.md`:**
    - (a) delete ` It ends with a GRADE block.` from line 1;
    - (b) replace ` Then tell the user the grade and what is left.` with ` Then report the grade and what is left.`;
    - (c) in the last line (the job-message rule, which stays last), replace ` so the section applies it.` with `.`.
  - **`tiers-max.md`:**
    - (d) delete ` (one or two small functions)`;
    - (e) replace ` over the builders' code before the final review` with ` before the final review`;
    - (f) replace `then wake the testing section to write and run the tests` with `then wake testing to write and run the tests`;
    - (g) replace `, the testing section for tests, ` with `, testing for tests, `.

  Check with `node -e` before testing: `assembleBrief('max')` is 8999 characters and 66 lines; the worst-case SessionStart context for max (`tests/session-start.test.mjs:468` inputs) is ≤ 10,000; Lean (8179) and Balanced (8381) are unchanged.
- [ ] **Step 4: Testing instructions.** In `scripts/gen-agents.mjs` `finalStep`, in the string returned for `s.id === 'testing'`, after `... a message wakes a section that has already handed back.`, add:
  `When a job asks for near-miss copies, write each as \`.team/near-miss/<n>-<original file name>\` whose first line is a comment \`near-miss: <the one bug>\`; swap a copy into place only to run the tests and restore the original also when a test run fails; leave the copies in \`.team/near-miss/\` and never anywhere else.`
  Then run `node scripts/gen-agents.mjs`.
- [ ] **Step 5: README and version.** README.md:60 (Max row) adds: "Near-miss copies stay in `.team/near-miss/`, out of the project's own files." Set the version to `0.2.1` in `package.json` and `.claude-plugin/plugin.json`.
- [ ] **Step 6: Verify**: `npm test`, `npm run test:board`, `claude plugin validate --strict .` and `node scripts/gen-agents.mjs --check` all pass.
- [ ] **Step 7: Run the reviewer gate, commit and tag:** `git add brief scripts agents README.md package.json .claude-plugin tests && git commit -m "feat: Max keeps near-miss copies in .team/near-miss (0.2.1)" && git tag v0.2.1`.

## Part B — Run hygiene

### Task 2: Merge the outside-judge branch
- [ ] **Merge**: `git merge --no-ff bench/external-judge -m "merge: outside judge (c5ba259)"` (a real merge that keeps c5ba259; no file changed on both sides).
- [ ] **Test**: `node --test bench/*.test.mjs` passes, and the Global plugin-path guard prints nothing.

### Task 3: `bench/clean-run.mjs`

**Files:** Create `bench/clean-run.mjs`, `bench/clean-run.test.mjs`. Modify `bench/run.mjs:28` to `export { PLUGIN_KEY } from './clean-run.mjs'` (the definition moves here, which avoids an import cycle).

**Interfaces (produces):**
- **Constants:** `PLUGIN_KEY = 'section-team@inline'`, `BENCH_MODEL = 'claude-opus-5-5'`, `BENCH_EFFORT = 'medium'`, `SECTION_TEAM_VERSION = '0.2.1'`, `LIVE_CHECKOUT = 'C:/Users/Asus/claude-team'`.
- `childEnv(parent, { pluginDir }) -> object`. It drops every key matching `/^(CLAUDECODE$|CLAUDE_|ANTHROPIC_|DISABLE_|SECTION_TEAM_)/`, then adds `SECTION_TEAM_AUTO_INSTALL_SKILLS:'0'`, `ENABLE_CLAUDEAI_MCP_SERVERS:'false'`, `DISABLE_AUTOUPDATER:'1'` and `CLAUDE_CODE_PLUGIN_DIRS: pluginDir` (required).
- `envNames(env) -> string[]`: the sorted keys matching `/^(CLAUDE|ANTHROPIC|DISABLE_|SECTION_TEAM_|ENABLE_CLAUDEAI)/`.
- `installedPluginKeys(home = homedir()) -> string[]`: the keys of `<home>/.claude/plugins/installed_plugins.json` `.plugins`. Throws `cannot read installed plugins: <path> (<code>)`.
- `cleanSettings({ installedKeys, sectionTeam, pluginDir }) -> object`:
  ```
  { syncClaudeAiPlugins: false, syncClaudeAiSkills: false,
    enabledPlugins: { ...each key: false, 'cc-plugin-plugin-authoring@builtin': false, [PLUGIN_KEY]: sectionTeam },
    env: { SECTION_TEAM_AUTO_INSTALL_SKILLS: '0', DISABLE_AUTOUPDATER: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false', CLAUDE_CODE_PLUGIN_DIRS: pluginDir } }
  ```
- `commonArgs({ sessionId }) -> string[]` = `['--model', BENCH_MODEL, '--effort', BENCH_EFFORT, '--verbose', '--strict-mcp-config', '--session-id', sessionId]`.
- `outputMessages(stdout) -> object[]`: when the whole text parses, the array, or `[obj]`. Otherwise it splits on `/\r?\n/` and keeps, in order, each non-empty line that parses as a JSON object (stream-json); a line cut off by a kill is skipped. `[]` when nothing parses.
- `initOf(messages)`: the first `type==='system' && subtype==='init'`, or null. `resultOf(messages)`: the last `type==='result'`, or null.
- `isUnder(p, folder) -> boolean`. False unless `path.isAbsolute(p)`, so built-ins with `path: 'builtin'` are never under anything. Otherwise `rel = path.relative(path.resolve(folder).toLowerCase(), path.resolve(p).toLowerCase())`, true when `rel === ''` or (`!rel.startsWith('..')` and `!path.isAbsolute(rel)`). Never use a string prefix.
- `initProblems(init, { setup, pin, pluginDir }) -> string[]`, with `setup` one of `solo|lean|team|max|judge`. One line per failed rule:
  1. no init → `no init message` (stop there);
  2. section-team entries (`source === PLUGIN_KEY`):
     - for lean, team and max: exactly one, with `isUnder(path, pluginDir)` and `rel === ''`, and `version === SECTION_TEAM_VERSION`;
     - for solo and judge: none;
     - and in every setup: no entry with `isUnder(path, LIVE_CHECKOUT)`;
  3. the other sources:
     - when `pin.builtins` exists, they equal it as a set;
     - otherwise (preflight) each ends in `@builtin` and none is `cc-plugin-plugin-authoring@builtin`;
  4. `mcp_servers` is empty;
  5. when `pin.setups` exists: `agents` and `skills` equal `pin.setups[setup === 'judge' ? 'solo' : setup]` as sets;
  6. `model === BENCH_MODEL` always; `claude_code_version === pin.version` and `apiKeySource === pin.apiKeySource` when the pin has them.
- `effortProblems(jsonlTexts, effort = BENCH_EFFORT) -> string[]`: one line per distinct other `effort` value on `type:'assistant'` lines.
- `compacted(jsonlText) -> boolean`: any line parses to `{ type: 'system', subtype: 'compact_boundary' }`.
- `readPin(results, round) -> Pin`: reads `results/preflight-<round>.json`. Throws `missing <path>: run node bench/preflight.mjs --round=<round> first`.

- [ ] **Step 1: Write the failing tests:**
  - `'childEnv strips session, model and key variables and sets the round switches and plugin dir'`, with input `{ PATH, CLAUDECODE, CLAUDE_CODE_ENTRYPOINT, ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, DISABLE_MICROCOMPACT, SECTION_TEAM_AUTO_INSTALL_SKILLS:'1', CLAUDE_CODE_PLUGIN_DIRS:'live' }` and `pluginDir 'C:/w'`, expecting exactly `{ PATH, SECTION_TEAM_AUTO_INSTALL_SKILLS:'0', ENABLE_CLAUDEAI_MCP_SERVERS:'false', DISABLE_AUTOUPDATER:'1', CLAUDE_CODE_PLUGIN_DIRS:'C:/w' }`;
  - `'cleanSettings: every installed key and plugin-authoring off, synced off, section-team per setup, plugin dir always set'`;
  - `'outputMessages reads a json array, one object, and stream-json cut off mid-line, and finds the init'`;
  - `'isUnder: builtin and C:/Users/Asus/claude-team-moderound/x are not under the live checkout; C:/Users/Asus/Claude-Team/hooks is'`;
  - `'initProblems accepts a team init (built-ins with path builtin) and names each mismatch'`, covering stray plugin, wrong path, wrong version, MCP server, other version, other model, other apiKeySource and skills differ;
  - `'initProblems in preflight mode accepts only @builtin sources and refuses plugin-authoring'`;
  - `'effortProblems flags a high-effort assistant line'`;
  - `'compacted finds a compact_boundary line'`;
  - `'installedPluginKeys fails with the path on a bad file'`.
- [ ] **Step 2: Run them and see them fail.** **Step 3: Implement.** **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit**: `feat(bench): clean-run module for pinned, plugin-free runs`.

### Task 4: `run.mjs` uses the clean run

**Files:** Modify `bench/run.mjs`, `bench/run.test.mjs`.

**Interfaces:**
- Consumes: Task 3 (`bench/clean-run.mjs`).
- Produces:
  - `TIMEOUT_MIN` gains `h4:120, h5:60, h6:60`.
  - `parseArgs(argv)` also returns `plugin` (`--plugin=`, else `''`), `rerun` (`--rerun=a,b`, else `[]`) and `reason` (`--reason=`, else `''`).
  - `checkRoundTag({ round, tag })` throws `--round=<r> and --tag=<t> must match` when both are set and differ.
  - `builderArgs(base, prompt, { sessionId, installedKeys, pluginDir }) -> string[]` = `['-p', prompt, '--output-format', 'stream-json', '--allowedTools', ALLOWED, ...commonArgs({ sessionId }), '--settings', JSON.stringify(cleanSettings({ installedKeys, sectionTeam: base !== 'solo', pluginDir }))]`. Stream-json writes the init as the first line of raw.json, so a killed run keeps it.
  - `builderEnv(env, { pluginDir }) -> object` = `childEnv(env, { pluginDir })`.
  - `runOne(run, outDir, ctx)`, where `ctx = { pin, installedKeys, pluginDir, pluginCommit }`.
- **What `main` does:**
  - it refuses to start without an absolute `--plugin=`;
  - it reads `pluginCommit = git -C <plugin> rev-parse HEAD` and refuses unless that equals `git rev-parse v0.2.1^{commit}`;
  - it builds `ctx` once (with `readPin(RESULTS, tag)` and `installedPluginKeys()`) and binds `runAll(todo, { runOne: (r, o) => runOne(r, o, ctx) })`;
  - it spawns `ctx.pin.binary`, never `'claude'`.

  In this task `runOne` picks `randomUUID()` for the session id; Task 5 moves that into its step 2.

- [ ] **Step 1: Write the failing tests:**
  - `'TIMEOUT_MIN has h4 120, h5 60, h6 60'`;
  - `'checkRoundTag refuses --round=mo with --tag=ho and accepts either alone'`;
  - `'builderArgs uses stream-json, model, effort medium, verbose, strict MCP, the session id and clean settings; solo turns section-team off and still sets the worktree'`;
  - `'parseArgs reads --plugin, --rerun and --reason'`.
  Update the existing builderArgs and builderEnv tests.
- [ ] **Step 2: Run them and see them fail.** **Step 3: Implement.** **Step 4: Run them and see them pass**: `node --test bench/run.test.mjs` (preflight's call sites are rewritten in Task 7; until then keep `bench/preflight.test.mjs` passing with the minimal signature update).
- [ ] **Step 5: Commit**: `feat(bench): runs use the pinned CLI, clean settings and stream-json`.

### Task 5: Attempts, API failures, reruns, void runs and evidence (`bench/run-attempts.mjs`)

**Files:** Create `bench/run-attempts.mjs`, `bench/run-attempts.test.mjs`. Modify `bench/run.mjs` (`runOne`, `main`).

**Interfaces:**
- Consumes: `bench/clean-run.mjs`, plus `renameRetry` and `stashRunMemory` (`bench/section-memory.mjs`).
- Produces:
  - `projectDirFor(runDir, home = homedir()) -> string` = `join(home, '.claude', 'projects', runDir.replace(/[^a-zA-Z0-9]/g, '-'))`.
  - `archiveAttempt(outDir, projectDir) -> string|null`: moves `outDir`'s entries (except `attempt-*` folders and `attempts.json`), and `projectDir` when it exists, into `outDir/attempt-<n>/` (n = existing attempt folders + 1).
  - `LIMIT = /usage limit|rate limit|rate_limit_error|hit your (?:[a-z]+ )*limit|out of (?:extra usage|usage credits)/i`.
  - `API_FAILURE = /API Error|overloaded|overloaded_error|api_error/i`.
  - `classifyEnd({ messages, timedOut, exitCode }) -> kind`:
    - `timedOut` → `'timeout'`;
    - no result: `exitCode !== 0` → `'crash'`, else `'no-result'`;
    - `is_error` with LIMIT text or `api_error_status === 429` → `'api-limit'`;
    - `is_error` with `api_error_status != null` or API_FAILURE text → `'api-other'`;
    - other `is_error` → `'error'`;
    - else `'ok'`.
  - `recordAttempt(outDir, entry) -> { capped, history }`: appends to `outDir/attempts.json`. `capped` counts `'api-other'` and `'void'` entries after the last `'harness-bug'` entry.
  - `copyEvidence({ runDir, sessionId, outDir, base, home = homedir(), bestEffort = false }) -> string[]`. It copies:
    - `<project>/<sid>.jsonl` → `outDir/evidence/<sid>.jsonl`;
    - `<project>/<sid>/` → `outDir/evidence/<sid>/`;
    - `<home>/.claude/section-team/modes/<sid>.json` → `outDir/evidence/.claude/section-team/modes/<sid>.json`.

    So `collectRolesFrom(join(outDir,'evidence'), sid)` and `readRecord(join(outDir,'evidence'), sid)` read it. Unless `bestEffort`, it throws `evidence missing for <sid>: <path>` when the session file is missing, or when the mode record is missing and `base !== 'solo'`.
  - `finishAttempt({ run, outDir, dir, sessionId, attempt, info, messages, pin, ctx, evidenceTexts, write = writeFileSync }) -> { kind, wrote }`. It throws `BatchStop` or `RoundStop` (classes with a one-line `reason`; exit codes 2 and 3):
    - `'api-limit'` → `BatchStop`; nothing recorded, no `run.json`;
    - `'api-other'` → `recordAttempt`, then `RoundStop` if `capped > 2`, else `BatchStop`;
    - a version or model mismatch (initProblems rule 6) → write `void.json` and record `'harness-bug'`, then `BatchStop('harness bug: version or model mismatch')`;
    - other non-empty `initProblems(initOf(messages), { setup: base, pin, pluginDir })` or `effortProblems(evidenceTexts)` → write `void.json` `{ reasons }` and record `'void'`, then `RoundStop`/`BatchStop` as for `'api-other'`;
    - otherwise write `run.json`: `{ ...run, dir, ...info, sessionId, attempt, end: kind, subtype, resultText (first 500 chars), pluginCommit, sectionTeam: { path, version } | null, init: { plugins, mcp_servers, agents, skills, claude_code_version, model, apiKeySource }, envNames }`.
  - `pendingRuns(runs, { results, rerun, reason, at }) -> run[]`: the runs without `run.json`, plus the `rerun` ids, for which it first records `{ kind: 'harness-bug', reason, at }`.
- **`runOne` flow:**
  1. `archiveAttempt`.
  2. Pick a fresh `randomUUID()`; write `session.json` `{ sessionId, attempt }`.
  3. Prepare and spawn; read raw.json with `outputMessages`.
     - 3a. If the setup is not solo, `stashRunMemory({ into: outDir })` (as today).
  4. `copyEvidence`, with `bestEffort` when `classifyEnd` gives `api-limit` or `api-other`.
  5. `finishAttempt`.
- **`main`:** uses `pendingRuns`, prints a `BatchStop` or `RoundStop` reason, and sets `process.exitCode` to 2 or 3.

- [ ] **Step 1: Write the failing tests:**
  - **`classifyEnd` table:**
    - `{ is_error:true, subtype:'success', result:'API Error: 529 overloaded' }` → `'api-other'`, and the same with `is_error:false` → `'ok'`;
    - `"You've hit your limit · resets 5pm"` → `'api-limit'`; `api_error_status:429` → `'api-limit'`;
    - timeout, crash, no-result and error rows.
  - **`archiveAttempt`:** `'moves the earlier results and project folder into attempt-1, then attempt-2'`.
  - **`recordAttempt`:** `'counts api-other and void toward the cap, not api-limit; a harness-bug entry resets it'`.
  - **`copyEvidence`:** `'copies only this session in the evidence layout, and stops loudly without the session file or a team setup's mode record'`.
  - **`finishAttempt`:**
    - `'usage limit: no run.json, no cap use'`;
    - `'third api-other: RoundStop'`;
    - `'void writes void.json'`;
    - `'a timed-out run with an init and no result writes run.json with end timeout and is not void'`;
    - `'a crash with an init writes run.json with end crash'`.
  - **`pendingRuns`:** `'a --rerun id with run.json is pending again and its earlier attempt is archived on the next run'`.
- [ ] **Step 2: Run them and see them fail.** **Step 3: Implement**, keeping `run.mjs` under 400 lines. **Step 4: Run them and see them pass**: `node --test bench/run-attempts.test.mjs bench/run.test.mjs`.
- [ ] **Step 5: Before the freeze**, add one `classifyEnd` row per real usage-limit or rate-limit result text found with `grep -rh "\"is_error\":true" ~/.claude/projects --include=*.jsonl | grep -io "\"result\":\"[^\"]*limit[^\"]*\""` (if any).
- [ ] **Step 6: Commit**: `feat(bench): attempt folders, API-failure stops, capped reruns and run evidence`.

### Task 6: Cost from transcripts, and `score.mjs` reads the evidence

**Files:** Create `bench/transcript-cost.mjs`, `bench/transcript-cost.test.mjs`. Modify `bench/score.mjs`, `bench/score.test.mjs`.

**Interfaces:**
- Consumes: `outputMessages` (`bench/clean-run.mjs`), `projectDirFor` (`bench/run-attempts.mjs`), `SEEDS` (`bench/run.mjs`).
- Produces:
  - `RATES`: USD per million tokens for `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-haiku-5-5`, as `{ input, output, cacheRead, cacheWrite5m, cacheWrite1h }`. Copy the values from Anthropic's current price list (use the `claude-api` skill) and write the source and date in a comment.
  - `transcriptCost(jsonlTexts, rates = RATES) -> { costUSD, unknownModels, outputMayBeLow: true }`:
    - for each `message.id`, it takes the largest value seen for each usage field;
    - it prices `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation.ephemeral_5m_input_tokens` and `cache_creation.ephemeral_1h_input_tokens`;
    - it skips `message.model === '<synthetic>'`;
    - an unknown model makes `costUSD` `NaN` and is listed.
  - `costOf({ transcript, evidenceTexts }) -> { costUSD, costComputed }`: `transcript.costUSD` when it is a number, else `transcriptCost`.
  - `parseTranscript(raw)` reads its messages through `outputMessages`.
  - `collectRolesFrom(projectDir, sessionId)`. `collectRoles(runDir, sessionId, home)` stays as `collectRolesFrom(projectDirFor(runDir, home), sessionId)`.
  - `runSession(outDir) -> string|null`: `session.json`'s `sessionId`, else `raw.json`'s.
  - `isTestPath(rel) -> boolean`: today's inline rule, exported.
  - `codeStats(dir, seedDir = null)`, exported: it leaves out files byte-identical to the seed's same path. `main` calls it with `existsSync(join(SEEDS, run.task)) ? join(SEEDS, run.task) : null`.
  - **Summary rows:** `main` reads roles from `outDir/evidence` when it exists. The row gains `costComputed`.

- [ ] **Step 1: Write the failing tests:**
  - `'transcriptCost takes the largest output per message id and prices the cache tiers'`: two lines of one id with output 10 and 600 price 600;
  - `'transcriptCost flags an unknown model and skips <synthetic>'`;
  - `'costOf falls back to transcripts and marks it'`;
  - `'parseTranscript reads a stream-json raw.json, one cut off before its result, and an older array raw.json'`;
  - `'codeStats leaves out unchanged seed files'`;
  - `'runSession prefers session.json'`.
- [ ] **Step 2: Run them and see them fail.** **Step 3: Implement.** **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit**: `feat(bench): transcript cost fallback and evidence-based scoring`.

### Task 7: Preflight for all four setups

**Files:** Modify `bench/preflight.mjs`, `bench/preflight.test.mjs`.

**Interfaces:**
- Consumes: Tasks 3–5; `readRecord` (`hooks/lib/mode-record.mjs`); `prepareRun` (`bench/run.mjs`).
- Produces:
  - **CLI:** `node bench/preflight.mjs --round=mo --plugin=C:/Users/Asus/section-team-v0.2.1`.
  - **Pin file:** it writes `results/preflight-<round>.json`:
    ```
    { version, binary, sha256, apiKeySource, builtins: [source...], pluginDir,
      setups: { solo|lean|team|max: { plugins: [source...], agents: [...], skills: [...] } } }
    ```
  - `versionOf(stdout) -> string`: the first match of `/^(\d+\.\d+\.\d+)/`. `claude --version` prints `2.1.296 (Claude Code)`.
  - `copyBinary({ home, version, run = spawnSync }) -> { binary, sha256 }`: copies `<home>/.local/share/claude/versions/<version>` to `<home>/bench-runs/claude-<version>.exe`, checks the bytes are equal, and checks that running the copy with `--version` prints output starting `<version> `.
  - `syncedListing(home) -> string[]`: sorted relative paths under `<home>/.claude/plugins/synced` and `<home>/.claude/skills/synced`.
  - `preflightProblems({ setup, messages, record, pluginDir, version }) -> string[]`:
    - `initProblems(initOf(messages), { setup, pin: { version }, pluginDir })`;
    - the mode record is `null` for solo, `'balanced'` for team, and `'lean'` / `'max'` for those setups;
    - the result's answer contains `NO` (automatic skill installs are off).
- **Flow:**
  1. `versionOf` of `claude --version`, then `copyBinary`.
  2. For each setup: `prepareRun({ id: 'pf-' + setup, task: 'pf', base: setup, cond: setup })`, then spawn the copied binary with exactly `builderArgs` and `builderEnv` (no Haiku override; the prompt asks for YES or NO about automatic skill installs).
  3. Read the record via `readRecord(home, sid)`, and compare `syncedListing` before and after.
  4. All setups must report the same `@builtin` set.
  5. Write the pin only when there are no problems. Cost: about $1.

- [ ] **Step 1: Write the failing tests** (injected spawner, fake home):
  - `'each setup's expected mode record'`;
  - `'a stray plugin, an MCP server or plugin-authoring fails'`;
  - `'copyBinary refuses differing bytes and a wrong --version'`;
  - `'built-in sets that differ between setups fail'`;
  - `'versionOf reads 2.1.296 from "2.1.296 (Claude Code)"'`.
- [ ] **Step 2: Run them and see them fail.** **Step 3: Implement.** **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit**: `feat(bench): four-setup preflight that pins the CLI and records the round's reference`.

### Task 8: Gate stats for every mode

**Files:** Modify `bench/gate-stats.mjs`, `bench/gate-stats.test.mjs`.

**Interfaces:**
- Consumes: `GATES` (`hooks/lib/mode.mjs`); `collectRolesFrom`, `runSession` (`bench/score.mjs`); `projectDirFor` (`bench/run-attempts.mjs`).
- Produces:
  - `parseGrade(text)` also returns `items`: the numeric score of each of structure, naming, duplication, size, errors, tests, security and leftovers, read from lines matching `^[ \t]*<name>:[ \t]*(\d+(?:\.\d+)?)` in the last GRADE block. An item scored `n/a` (the reviewer does this when another section writes the tests), or absent, is left out. A grade with no item lines has `items: {}`.
  - `modeOfCond(cond) -> 'lean'|'balanced'|'max'|null` (team → balanced).
  - `meetsMark(grade, mode) -> boolean`: a null grade → false. Otherwise `overall >= GATES[mode].passOverall` and, when `minItem` is set, every value in `items` is ≥ `minItem`.
  - `gateStats` counts ids matching `` new RegExp(`-(team|lean|max)-${round}-r\\d+$`) ``. It reads roles from `results/<id>/evidence` with `runSession` when the evidence exists, else from `collectRolesFrom(projectDirFor(run.dir, home), runSession(outDir))`. Rows add `mode`, `firstTryMeetsMark` and `finalMeetsMark: { caller: boolean }`.

- [ ] **Step 1: Write the failing tests** (update the existing `parseGrade` deepEqual tests for `items`):
  - `'parseGrade reads the items and leaves tests: n/a out'`;
  - `'meetsMark: Lean 8; Balanced 8 with items ≥ 6; Max 9 with items ≥ 7; tests n/a ignored; an unreadable grade fails'`;
  - `'gateStats counts lean and max runs from evidence and leaves solo out'`;
  - `'a timed-out run with evidence but no result is a row, not a throw'`;
  - `'held-out runs without evidence still read from ~/.claude/projects'`.
- [ ] **Step 2: Run them and see them fail.** **Step 3: Implement.** **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit**: `feat(bench): gate stats for lean, balanced and max by each mode's mark`.

### Task 9: Calibration also checks the seed's own tests

**Files:** Modify `bench/calibrate.mjs`, `bench/calibrate.test.mjs`.

**Interfaces:**
- **Seed tests:** for a task with a seed, each near-miss variant also runs `node --test` over the seed's own test files (Node's default patterns, inside the variant's temp folder, with `hiddenEnv` and a 300 s limit).
- **New problem:** `calibrationVerdict` adds `near-miss <name> fails the seed's own tests`.
- **Tasks without a seed:** unchanged.

- [ ] **Step 1: Write the failing test**: `'a seeded near-miss that breaks a seed test fails calibration'` (injected runner). **Step 2: See it fail.** **Step 3: Implement.** **Step 4: See it pass.**
- [ ] **Step 5: Commit**: `feat(bench): calibration checks a seeded task's own tests`.

## Part C — Judging

### Task 10: Four-solution Opus judges

**Files:** Modify `bench/judge.mjs`, `bench/judge.test.mjs`, `bench/judge-prompt.md` (the example answer only), `bench/aggregate.mjs:13`, `docs/benchmark-heldout-2026-11.md:22`.

**Interfaces:**
- Consumes: `bench/clean-run.mjs` (all of Task 3); `projectDirFor` (`bench/run-attempts.mjs`).
- Produces:
  - `mirrorSwap(judge, labels) -> Array<[string,string]>|null`: for an even `judge`, the pairs `[labels[i], labels[n-1-i]]` for `i < Math.floor(n/2)`, with `labels` sorted alphabetically; null otherwise. It replaces `labelSwap`. `unswap(row, pairs)` and `withCopy(source, fn, { swap: pairs })` handle any number of pairs (rename through unique temp names). Update the tests at `judge.test.mjs:211, 218, 230, 241` to the `[[a,b],...]` shape.
  - `judgeArgs(prompt, { sessionId, installedKeys, pluginDir }) -> string[]` = `['-p', prompt, '--output-format', 'json', '--allowedTools', ALLOWED, '--permission-mode', 'default', ...commonArgs({ sessionId }), '--settings', JSON.stringify(cleanSettings({ installedKeys, sectionTeam: false, pluginDir }))]`, with `pluginDir = pin.pluginDir`. The spawn uses `pin.binary` and `childEnv(process.env, { pluginDir })`.
  - `call(job, attempt) -> { stdout, transcript, subagentTranscripts }`. Inside `withCopy`'s fn it picks `randomUUID()`, spawns, then reads `<projectDirFor(dir)>/<sid>.jsonl` and writes it to `results/judge-<round>-transcripts/<pair>-<judge>-a<attempt>.jsonl`, and copies the session's subagent folder to `.../<pair>-<judge>-a<attempt>/`.
  - `runJobs(jobs, { rows, call, check, ... })`:
    - for each job it makes up to 3 attempts;
    - `check({ stdout, transcript, subagentTranscripts }) -> reasons[]` is `initProblems(initOf(outputMessages(stdout)), { setup: 'judge', pin, pluginDir: pin.pluginDir })` plus `effortProblems([transcript, ...subagentTranscripts])` plus `judge ran in permission mode <m>` (unless the init shows `default` or `manual`) plus `judge touched a blind key` (a tool call in the main or a subagent transcript matching `BLIND_KEY`), plus any parse error;
    - every re-ask is appended to `results/judge-<round>-reasks.json` `{ pair, judge, attempt, reasons }`;
    - a job still unusable after 3 goes to `results/judge-<round>-left-out.json`, and the run exits 1;
    - judges with `compacted(transcript)` go to `results/judge-<round>-compacted.json` (they still count).
  - `pendingJobs(pairs, rows, perPair, leftOut = [])` also skips left-out jobs.
  - `edgeCounts(key, jobs) -> { [cond]: { first, last } }`: how often each setup was the 1st or 4th folder a judge saw (after `mirrorSwap`). The CLI writes it to `results/judge-<round>-edges.json`.
  - **Prompt:** `judge-prompt.md`'s example answer (line 36) becomes one line with keys `"W"`, `"X"`, `"Y"`, `"Z"` (each with all six scores and notes) and `"ranking": ["Y", "W", "Z", "X"]`. Every other byte stays.
  - **Aggregate:** `aggregate.mjs` `TASK_ORDER` gains `'h4','h5','h6'` before `'all'`.
  - **Write-up fix:** in the held-out write-up, "Judge quality is the mean of those six scores." becomes "Judge quality is the mean of the five dimension scores (overall is reported beside it)."

- [ ] **Step 1: Write the failing tests:**
  - `'mirrorSwap pairs W-Z and X-Y for judge 2 and nothing for judge 1'`;
  - `'withCopy mirrors four folders and unswap maps scores and ranking back'`;
  - `'a void judge session (stray plugin or high effort) is re-asked, listed, then left out after three attempts'`;
  - `'a left-out job is not asked again on resume'`;
  - `'edgeCounts counts first and last folders per setup'`;
  - `'the committed prompt's example answer shows four labels and a full ranking'`.
- [ ] **Step 2: Run them and see them fail.** **Step 3: Implement.** **Step 4: Run them and see them pass**: `node --test bench/judge.test.mjs bench/aggregate.test.mjs`.
- [ ] **Step 5: Commit**: `feat(bench): four-solution judges with mirrored order, clean sessions and capped re-asks`.

### Task 11: Outside judges for four labels, fresh case sets and the held-out check file

**Files:**
- Modify: `bench/external-judge.mjs`, `bench/external-judge.test.mjs`.
- Create (fixtures, later published): `bench/data/heldout/judge-hoag.json`, `bench/data/heldout/blind-key-hoag.json` (copied unchanged from `C:/Users/Asus/claude-team/bench/results`); `bench/data/heldout/judge-prompt-ho.md` (= `git show c5ba259:bench/judge-prompt.md`).

**Interfaces:**
- Consumes: `judgeScores` (`bench/aggregate.mjs`); `parseVerdict`, `fillPrompt` (`bench/judge.mjs`); `judgeDirFor` (`bench/anonymize.mjs`).
- Keep c5ba259's `pairWinners`, `HAND_IN` and the old `relabel` byte for byte; the held-out check uses only them. Change these:
  - `planCases(groups, labels, shuffle) -> [{ case, pair, judge: 1|2, map }]`. `labels` is sorted alphabetically (W, X, Y, Z). Case 1's `map` = `{ A: labels[0], B: labels[1], ... }`; case 2 maps A.. to the reversed list.
  - `caseMap(c)` = `c.map ?? { A: c.A, B: c.B }`, so the old `external-key-ho.json` still works.
  - `checkPairs` accepts 2–4 single-letter labels, the same set in every group.
  - `relabelFour(text, labels)` maps each `"<labels[i]>"` in the example to `"<'ABCD'[i]>"`, then makes the scratch-sentence change `relabel` makes.
  - `prepareCases` copies through `caseMap`, writes `JUDGE.md` with `relabelFour` for the mode round, and writes no root `README.md`.
  - `rowFor(c, verdict)`, with `m = caseMap(c)`: `{ pair, [m[k]]: verdict[k] for k in m, ranking: verdict.ranking.map(k => m[k]), judge, case, ...(c.judge === 2 && { swapped: true }) }`.
  - `importVerdicts` parses each case with `Object.keys(caseMap(c)).sort()`, and `import` also writes `results/outside-usable-<as>.json` `{ usable, total, problems }`, even when it refuses to write rows.
  - `copyCaseSet({ from, to })`: refuses a `to` that is not empty, and a `from` holding any `verdict.json` or a non-empty `scratch/`; it copies the rest.
  - `rebuildHeldOut({ results, judgeDir = judgeDirFor('ho'), out })`:
    - reads `results/external-key-ho.json`;
    - copies A, B and SEED per case;
    - writes `JUDGE.md` = `fillPrompt(relabel(<bench/data/heldout/judge-prompt-ho.md>), { labels: ['A','B'], task, seed }) + HAND_IN` (c5ba259's text);
    - writes an empty `scratch/` and no README;
    - never reads `C:/Users/Asus/ag-judge` or `codex-judge`.
  - `outsideCheck({ results, as }) -> { gap, same, pairs, passed }`:
    - `gap` = round2(the mean over held-out pairs of team-ho quality − solo-ho quality), from `judgeScores(judge-<as>.json, blind-key-<as>.json)` alone, never `summary.json`;
    - `same` comes from c5ba259's `pairWinners` against `judge-ho.json` / `blind-key-ho.json`;
    - `passed = gap >= 0.5 && same >= 7`.
  - **CLI:** `externalOptions` accepts `prepare --round=<r> --out=<d>`, `import --round=<r> --out=<d> --as=<n>`, `copy --from=<d> --to=<d>`, `rebuild-heldout --out=<d>` and `check --as=<n>`. `check` writes `results/outside-check-ho-<as>.json` and refuses to overwrite it.

- [ ] **Step 1: Write the failing tests:**
  - `'planCases maps four labels in order for case 1 and mirrored for case 2'`;
  - `'prepare accepts W, X, Y, Z groups and writes no root README'`;
  - `'a mirrored four-label case imports back under W-Z with swapped true'`;
  - `'old external-key-ho cases still import'`;
  - `'copyCaseSet refuses a set with a verdict or scratch files'`;
  - `'rebuildHeldOut gives c5ba259's JUDGE.md text, the same cases and labels, and empty scratch'`;
  - `'import writes outside-usable even when a case is unusable'`;
  - `'outsideCheck reproduces hoag: gap 0.93, same 8 of 9, passed'` (from the fixtures).
- [ ] **Step 2: Run them and see them fail.** **Step 3: Implement.** **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit**: `feat(bench): four-label outside judging, fresh case sets and a saved held-out check`.

### Task 12: Per-case Codex runner (`bench/codex-judge.mjs`) and the run sheet

**Files:** Create `bench/codex-judge.mjs`, `bench/codex-judge.test.mjs`, `bench/outside-run-sheet.md`.

**Interfaces:**
- Consumes: `parseVerdict` (`bench/judge.mjs`).
- Produces:
  - `CODEX_PROMPT`: a fixed text. You are a blind code reviewer; the current folder is one case; read `JUDGE.md` here and follow it exactly, without asking questions; work only inside this folder; probes only in `scratch/`; never edit, create or delete anything in the solution folders or `SEED`; no network; end with your verdict as one fenced json block.
  - `sheetValues(text) -> { codexBin, model, effort, sandbox }`, from the first fenced `json` block of the run sheet.
  - `codexArgs({ caseDir, model, effort, sandbox, lastMessage }) -> string[]` = `['exec', '--ephemeral', '--ignore-user-config', '-m', model, '-c', 'model_reasoning_effort="<effort>"', '--disable', 'memories', '--skip-git-repo-check', '-C', caseDir, '-s', sandbox, '--json', '-o', lastMessage, CODEX_PROMPT]`.
  - `caseLabels(caseDir) -> string[]`: its single-capital-letter subfolders except `SEED`, sorted.
  - `runCases({ setDir, logDir, values, run = spawnSync, log }) -> [{ case, exitCode, seconds, attempts, verdict }]`:
    - it runs the cases one at a time and skips any case that has a `verdict.json`;
    - it writes `<logDir>/<case>-a<n>.{jsonl,err,cmd.txt}`;
    - when Codex wrote no `verdict.json` but its last message has a fenced json block, it writes `verdict.json` from that;
    - a verdict that fails `parseVerdict(text, case, caseLabels(caseDir))` is moved to `<logDir>/<case>-a<n>.verdict.json` and re-asked in a fresh session, at most 2 more times.
  - **CLI:** `node bench/codex-judge.mjs --set=<folder>`. `values` come from `bench/outside-run-sheet.md`, and `logDir = bench/results/codex-logs/<basename of set>/`. It prints one line per case plus `k of n cases usable`, and exits 1 when any case is unusable.
- **Run sheet:** `bench/outside-run-sheet.md` holds:
  - the procedure for both judges: one new session per case, with only that case's folder as the workspace, memory off; Antigravity by hand, Codex by this runner; a re-ask means a new session on the same case, at most twice;
  - the header `Freeze: tag mo-freeze`;
  - a json block `{ "codexBin": "C:/Users/Asus/AppData/Local/OpenAI/Codex/bin/22cfb1d302613eae/codex.exe", "model": "gpt-6.1-sol", "effort": "ultra", "sandbox": "<set in Task 27>" }`.

- [ ] **Step 1: Write the failing tests** (injected runner):
  - `'codexArgs carries model, effort, no memories, the case folder and the sandbox'`;
  - `'runCases skips judged cases and writes verdict.json from the last message'`;
  - `'an unusable verdict is moved aside and re-asked twice, then the case is reported unusable'`;
  - `'sheetValues reads the json block'`.
- [ ] **Step 2: Run them and see them fail.** **Step 3: Implement.** **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit**: `feat(bench): per-case Codex judge runner and outside-judge run sheet`.

### Task 13: Leak scan (`bench/leak-scan.mjs`)

**Files:** Create `bench/leak-scan.mjs`, `bench/leak-scan.test.mjs`.

**Interfaces:**
- Consumes: `isTestPath` (`bench/score.mjs`).
- `WORDS = ['section-team', 'section', 'supervisor', 'REPORT', 'GRADE', 'reviewer', 'near-miss', 'near miss', 'nearmiss', 'mutant', 'Lean', 'Balanced', 'Max mode', '.team', 'ponytail']`.
- `scanText(text) -> { [word]: count }`: case-insensitive whole-word matches in file contents, where a letter or digit joins a word and `-` or `.` joins one only between two letters or digits ("boolean" and "clean-up" do not match "lean", "Lean." does). Words that contain `-`, `.` or a space match literally.
- `scanSolution(dir) -> { hits, extraPaths, testLines }`:
  - `hits` counts matches in file contents and in relative paths; in relative paths only letters and digits join (`near-miss-1-parse.mjs` matches);
  - `extraPaths` lists every file that is not `package.json`, `*.md`, a code file (`.mjs .js .cjs .html .css .json`) or a test file by `isTestPath`, plus every file whose relative path has a `WORDS` hit.
- `leakScan({ judgeDir, key }) -> { [cond]: { hits, extraPaths, testLines } }`.
- **CLI:** `--round=mo` writes `results/leak-scan-mo.json` plus a table.

- [ ] **Step 1: Write the failing tests:**
  - `'scanText counts "Lean" and "near-miss" but not "boolean" or "clean"'`;
  - `'src/near-miss-1-parse.mjs starting // near-miss: off by one is a hit and an extra path'`;
  - `'leakScan groups by setup through the blind key'`.
- [ ] **Step 2: Run them and see them fail.** **Step 3: Implement.** **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit**: `feat(bench): leak scan of judged solutions`.

## Part D — Analysis

### Task 14: Mode fidelity (`bench/mode-check.mjs`, `bench/mode-gates.mjs`)

**Files:** Create `bench/mode-check.mjs`, `bench/mode-gates.mjs`, `bench/mode-check.test.mjs`.

**Interfaces:**
- Consumes: `collectRolesFrom`, `runSession` (`bench/score.mjs`); `parseGrade`, `meetsMark` (`bench/gate-stats.mjs`); `GATES` (`hooks/lib/mode.mjs`); `readRecord` (`hooks/lib/mode-record.mjs`).
- **Constants:** `HEADS = ['backend','frontend','database','devops','mobile','uiux','ai-llm','testing','security','docs']`; `BUILDERS` = `HEADS` without testing, security and docs; `MODE_OF = { 'lean-mo': 'lean', 'team-mo': 'balanced', 'max-mo': 'max' }`.
- `wakeUps(roles) -> [{ section, at, caller }]`: assistant `tool_use` named `Agent` whose `input.subagent_type` is `section-team:<h>` with h in HEADS. Reviewer, scout, coder, ai-engineer and data-scientist calls are not wake-ups.
- `reviewerCalls(roles) -> [{ caller, start, model, grade }]`:
  - the reviewer calls are the roles with `role === 'section-team:reviewer'`, with `caller = parentId ?? 'main'`, ordered by `Date.parse(start)`;
  - `model` is the first assistant `message.model` in that transcript;
  - `grade` is `parseGrade` of its hand-back (as `gateSequences` reads it).
- `gates(roles, mode) -> [{ caller, reviews, fixRounds, endsEarly, regradeAfterPass }]` (in `mode-gates.mjs`). A caller's first reviewer call starts a gate. A later call starts a new gate when, strictly between the previous call's `start` and its own (compare each line's `timestamp`), the caller's transcript has one of the following:
  - **`main`:** a `tool_use` `Agent` with `input.subagent_type` `section-team:<b>` (b in BUILDERS); or a `tool_use` `SendMessage` whose `input.to` equals the `agentId` of a role whose `role` is `section-team:<b>` (b in BUILDERS).
  - **A section with agentId S:** a line `{ type:'attachment', attachment:{ type:'queued_command', prompt } }` that is not a hand-back from S's own subagents. With OWN = the agentIds of roles whose `parentId === S`, a hand-back starts with `<agent-message from="X">` or is a `<task-notification>` holding `<task-id>X</task-id>`, with X in OWN. A section's `type:'user'` lines are ignored (job prompt, skill loads, reminders).

  Every other call is a re-grade.
  - A review **fails** when `!meetsMark(grade, mode)`.
  - `fixRounds` = the number of re-grades.
  - `endsEarly` = the last review failed, `fixRounds < GATES[mode].fixRounds`, and the caller made no later reviewer call.
  - `regradeAfterPass` = some re-grade's previous review passed.
- `nearMissState(runDir) -> { copies, outside }`:
  - `copies` = the number of non-empty files under `<runDir>/.team/near-miss/` (0 when it is missing);
  - `outside` = runDir-relative paths of files outside `.team/`, `.git/` and `node_modules/` that are byte-identical to a non-empty file under `.team/near-miss/`, have `near-miss`, `nearmiss` or `mutant` (any case) in their path, or have a first line containing `near-miss:`.
- `checkRun({ cond, task, roles, runDir, record }) -> { faithful, broken, tier }`:
  - With `roles === null`, it returns `{ faithful: false, broken: ['no data'], tier: null }` and never throws.
  - Otherwise each failed rule adds one short line to `broken`, and `faithful = broken.length === 0`. A gate's final grade is never a rule.
  - **All three modes:**
    - `record === mode`;
    - `<runDir>/.team/mode.json` exists and names `mode` for lean and max, and is absent for team.
  - **h4, all three:**
    - wake-ups by `main` include backend and frontend;
    - some wake-up is docs;
    - the `main` transcript has no `Write`, `Edit` or `MultiEdit` whose `file_path`, resolved inside `runDir`, is other than `*.md`, `package.json`, `.gitignore` or under `.team/` (paths outside `runDir` are ignored).
  - **lean:**
    - every reviewer `model` contains `sonnet`;
    - no gate ends early, has `fixRounds > 1` or has `regradeAfterPass`;
    - on h4, testing is woken;
    - on h5 and h6, no section is woken.
  - **team:**
    - every reviewer `model` contains `opus`;
    - no gate ends early, has `fixRounds > 2` or has `regradeAfterPass`;
    - on h4, testing is woken;
    - on h5 and h6, testing is woken and no other section is.
  - **max:**
    - every reviewer `model` contains `opus`;
    - no gate ends early, has `fixRounds > 3` or has `regradeAfterPass`;
    - testing and security are woken on every task;
    - on h5 and h6, no other section is woken;
    - at the end, `nearMissState(runDir).copies > 0`, or a testing-section transcript has a `Write` to, or a `Bash` command naming, `.team/near-miss/`;
    - and `nearMissState(runDir).outside` is empty.
  - **`tier`** (reported, never a rule): `'multi'` when any BUILDERS section is woken, else `'single'` when testing is woken, else `'small'`.
- **CLI:** `--round=mo`. For each run, `record = readRecord(join(outDir, 'evidence'), sid)` and `roles = collectRolesFrom(join(outDir, 'evidence'), sid)`. It writes `results/mode-check-mo.json` = `{ [runId]: { cond, task, faithful, broken, tier } }`, where solo rows are `{ faithful: true, broken: [], tier: null }`.

- [ ] **Step 1: Write the failing tests** (fixtures copy the real shapes above):
  - `'reviewer, scout and coder calls are not wake-ups'`;
  - `'lean h5 run that woke testing is unfaithful'`;
  - `'team h6 run that woke only testing is faithful'`;
  - `'max h5 run without a security wake-up is unfaithful'`;
  - `'max gate failing after 3 fix rounds is faithful; after 2 with no later call it ended early'`;
  - `'team gate with 3 fix rounds is unfaithful'`;
  - `'a re-grade after a pass is unfaithful'`;
  - `'a queued_command from main between two section reviewer calls starts a new gate; the section's own reviewer hand-back does not; a skill-load user line does not'`;
  - `'main's SendMessage to a builder's agentId starts a new gate; to testing it does not'`;
  - `'max run with a near-miss copy left in src is unfaithful'`;
  - `'lean run whose mode.json says balanced at the end is unfaithful'`;
  - `'h4 run that never woke docs, or whose supervisor wrote src, is unfaithful'`;
  - `'tier is multi, single or small'`;
  - `'a run with no evidence is a no-data row'`.
- [ ] **Step 2: Run them and see them fail.** **Step 3: Implement.** **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit**: `feat(bench): mode fidelity check`.

### Task 15: Bars, core statistics (`bench/stats.mjs`, `bench/bars.mjs`, `bench/bars-mo.json`)

**Files:** Create `bench/stats.mjs`, `bench/bars.mjs`, `bench/bars-mo.json`, `bench/bars.test.mjs`.

**Interfaces:**
- `bench/bars-mo.json` holds exactly:
```json
{ "round": "mo", "statDecimals": 2, "hiddenDecimals": 4, "minGroups": 6, "confirmShare": 0.75,
  "comparisons": [
    { "name": "lean", "mode": "lean-mo", "vs": "solo-mo", "minGap": 0.30, "usage": { "tasks": ["h5", "h6"], "maxRatio": 1.50, "reportVs": { "task": "h4", "setup": "team-mo" } } },
    { "name": "balanced", "mode": "team-mo", "vs": "solo-mo", "minGap": 0.50 },
    { "name": "max", "mode": "max-mo", "vs": "team-mo", "minGap": 0.30, "ceiling": { "setup": "team-mo", "above": 8.60 } } ],
  "outside": [
    { "name": "Codex", "heldOut": "hocx", "round": "mocx", "set": "C:/Users/Asus/codex-judge-mo" },
    { "name": "Antigravity", "heldOut": "hoag2", "round": "moag", "set": "C:/Users/Asus/ag-judge-mo" } ] }
```
- `stats.mjs`:
  - `tCrit975(df)`: a table for df 1–8 (12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306); throws outside 1–8;
  - `sampleSD(xs)` (divisor n−1);
  - `round(x, d)`;
  - `signTestP(wins, losses)`: exact two-sided, `min(1, 2 × P(X ≤ min(wins, losses)))` with p = 0.5.
- `bars.mjs`:
  - `qualities(judgeRows, key) -> { [group]: { [cond]: { quality, tests, judges } } }`: quality is the 5-dimension mean per judge, averaged over judges; `tests` likewise.
  - `comparison({ cmp, quals, summary, faithful = null }) -> result`:
    - **Groups:** those where both conds have a counted run (a `summary.json` row) and a quality; with `faithful` given, both runs must also be faithful (solo is always faithful).
    - **Statistics:** gap = mean of the group gaps; sd = `sampleSD`; range = gap ± `tCrit975(n−1)` × sd / √n, unrounded; `includesZero` = the lower end ≤ 0.
    - **`testsGap`:** the same comparison on the tests dimension, reported.
    - **`hiddenOk`:** the mean hidden rate over the same groups, rounded to 4 decimals, is not below the comparator's.
    - **`usage`:** the ratio of mean cost (`costUSD`, computed or not) over the groups' runs on `usage.tasks`, rounded to 2 decimals, and `usageOk` = ratio ≤ `maxRatio`; `reportVs` gives Lean's h4 ratio against Balanced (reported only).
    - **`ceiling`:** decided once on all counted runs of `ceiling.setup` (mean quality, rounded to 2 decimals, > `above`), and it also applies in the sensitivity check.
    - **`status`:**
      - `'not measured (<n> groups)'` when n < `minGroups` in the headline (no range computed);
      - `'not measurable (scale ceiling)'` when the ceiling hits;
      - `'met'` when round2(gap) ≥ `minGap`, `hiddenOk` and (when usage applies) `usageOk`;
      - else `'missed'`.
    - **Sensitivity (`faithful` given):** no `minGroups` floor. n = 1 gives the gap with `sd`, `lo`, `hi`, `includesZero` null; n = 0 gives `{ n: 0, status: 'too few faithful groups (0)' }`. It never throws.
  - **CLI:** `--round=mo` reads `results/summary.json`, `judge-mo.json`, `blind-key-mo.json` and `mode-check-mo.json`, and writes `results/bars-mo.json` with `{ headline, sensitivity }` per comparison.

- [ ] **Step 1: Write the failing tests:**
  - `'a gap of exactly 27/90 meets +0.30 after rounding'`;
  - `'range uses t(8)=2.306 with 9 groups, and t(4)=2.776 for a 5-group sensitivity check'`;
  - `'fewer than 6 headline groups is not measured with no range'`;
  - `'sensitivity with 1 or 0 faithful groups reports without throwing'`;
  - `'Balanced at 8.61 makes Max not measurable; at 8.60 it is measured'`;
  - `'hidden-test rule fails a mode with a lower pass rate'`;
  - `'Lean usage 1.50 meets and 1.51 misses'`;
  - `'a group with one usable judge counts with that judge'`;
  - `'sensitivity drops groups with an unfaithful run and leaves the headline unchanged'`;
  - `'signTestP(8,1) === 0.0390625'`.
- [ ] **Step 2: Run them and see them fail.** **Step 3: Implement.** **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit**: `feat(bench): pre-registered bars for the mode round`.

### Task 16: Outside confirmation, labels, rank wins and the size effect (`bench/bars-outside.mjs`)

**Files:** Create `bench/bars-outside.mjs`, `bench/bars-outside.test.mjs`. Modify `bench/bars.mjs` (the CLI adds outside results and labels).

**Interfaces:**
- Consumes: `importVerdicts`, `pairWinners` (`bench/external-judge.mjs`); `qualities` (`bench/bars.mjs`); `signTestP` (`bench/stats.mjs`).
- `outsideJudges({ config, results }) -> [{ name, passedHeldOut, usableCases, total, status, rows, key }]`. For each `config.outside` entry:
  - `passedHeldOut` = `results/outside-check-ho-<heldOut>.json`'s `passed`. A missing file gives false and status `'not used'`.
  - If `results/judge-<round>.json` exists: `rows` and `key` come from it and `blind-key-<round>.json`, and `usableCases = total` (`total = results/external-key-mo.json` length, 18).
  - Else, if `results/outside-usable-<round>.json` exists: its `usable`, with status `'not usable (<usable> of <total>)'`.
  - Else, status `'not used'`.
- `counting(judges)` = the names with `passedHeldOut && usableCases === total`.
- `groupGaps(rows, key, mode, vs) -> { [group]: number }`: the mean over that source's rows for the group of the mode's quality minus the comparator's.
- `confirm({ opus, outside, n, share = 0.75 }) -> { agree, needed, gapsSameSign, confirmed }`:
  - per group, the directions agree only when both are non-zero with the same sign (a zero disagrees);
  - `needed = Math.ceil(share * n)`;
  - `gapsSameSign` = the two overall gaps are both non-zero and share a sign;
  - `confirmed = gapsSameSign && agree >= needed`.
- `labelFor(result, outsideByJudge) -> string`:
  - A met bar reads `"met"`, then `", within noise"` when `includesZero`, then either `", outside-confirmed"` (at least one judge counts and every counting judge confirms) or `", not outside-confirmed (<reason>)"`.
  - The reason is exactly one of:
    - `no outside judge passed its held-out check`;
    - `no passing judge was usable in the mode round (<name>: <status>, ...)`;
    - `<name> disagrees (<agree> of <n> groups, gap <gap>)`.
  - A missed bar gets no confirmation label; its result lists each passing judge's gap. Confirmation is computed for every comparison, including a Max comparison reported as not measurable.
- `rankWins(rows, key, mode, vs) -> { for, against, split, marked, p, judgments }`:
  - a group is `for` when every usable Opus judgment in it ranks the mode above the comparator, `against` when every one ranks it below, and `split` otherwise;
  - a group with one usable judgment counts by that judgment and is listed in `marked`;
  - `p = signTestP(for, against)`;
  - `judgments` is the 18-judgment count, with no p.
- `sizeEffect(summary, groups, mode, vs, opusGaps) -> { agree, n }`: per group, the setup with more `code.testLines` (seed files are already excluded by Task 6) is the prediction. It agrees when it matches the sign of the Opus group gap; an equal count or a zero gap is a disagreement.
- `sizeEffectHeldOut({ summary, judgeRows, key }) -> { agree, pairs }`: the same "more test lines" prediction, matched against c5ba259's `pairWinners`, for round `ho`.

- [ ] **Step 1: Write the failing tests:**
  - `'7 of 9 with same-sign gaps confirms; opposite gap signs does not; a zero disagrees'`;
  - `'with 8 groups the threshold is 6'`;
  - `'label: met, within noise, not outside-confirmed (no outside judge passed its held-out check)'`;
  - `'a missed bar shows outside gaps and no confirmation label'`;
  - `'a held-out pass with no mode-round import is "not used"; one with 17 usable is "not usable (17 of 18)" and does not count'`;
  - `'rankWins: both above is for, split is split, one usable judgment is marked'`;
  - `'sizeEffect counts equal test lines as disagreement'`;
  - `'sizeEffectHeldOut gives 8 of 9'` (from `bench/data/heldout`).
- [ ] **Step 2: Run them and see them fail.** **Step 3: Implement.** **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit**: `feat(bench): outside confirmation, labels and secondary measures`.

### Task 17: Test strength (`bench/test-strength.mjs`)

**Files:** Create `bench/test-strength.mjs`, `bench/test-strength.test.mjs`.

**Interfaces:**
- Consumes: `CALIBRATION` (`bench/calibrate.mjs`); `SEEDS` (`bench/run.mjs`); `hiddenEnv`, `isTestPath` (`bench/score.mjs`).
- `solutionTestFiles(dir, seedDir = null) -> string[]`: files matching Node's `--test` default patterns, minus files byte-identical to the seed's.
- `strength({ task, solutionDir, root = CALIBRATION, seeds = SEEDS, run }) -> { valid, caught, total, share }`:
  1. Build one temp folder: the seed (h5 only), then `<root>/<task>/reference` with its own test files removed, then all of the solution's test files, at their relative paths.
  2. Run `node --test <file>` once per test file there (`hiddenEnv`, 300 s); a file that passes is valid.
  3. For each near-miss under `<root>/<task>/near-miss/`, rebuild the folder with the near-miss laid on top of the reference before the solution's test files, and rerun the valid files. It is caught when any of them fails or times out.
  4. `share` = caught ÷ total, or null ("n/a") when no file is valid.
- **CLI:** `--round=mo` runs it over the h5 and h6 runs and writes `results/test-strength-mo.json`.

- [ ] **Step 1: Write the failing tests** (injected `run`):
  - `'a test file that fails on the reference is not valid'`;
  - `'a shared test helper is laid in, so a file importing it can be valid'`;
  - `'a near-miss is caught when any valid file fails'`;
  - `'no valid file gives n/a'`;
  - `'seed test files are left out'`.
- [ ] **Step 2: Run them and see them fail.** **Step 3: Implement.** **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit**: `feat(bench): test strength against frozen near-miss versions`.

## Part E — Tasks h4–h6

- **Where:** Part E runs in its own worktree, `git worktree add C:/Users/Asus/claude-team-modetasks -b bench/mode-tasks bench/mode-round`. It may run while Parts B–D run. Each commit stages only its task's paths (`bench/tasks/<t>.md`, `bench/hidden/<t>.test.mjs`, `bench/seeds/<t>/`, `bench/heldout-calibration/<t>/`). Part E is merged into `bench/mode-round` before Task 27; calibration runs after that merge, once Task 9 is in.
- **Roles per task:** four fresh general-purpose agents (not section-team sections):
  - the **task writer** (who also writes the h5 seed);
  - **author A**, the hidden tests;
  - **author B**, the reference and the near-miss versions;
  - **author C**, the size count (and, for h4, the two-areas check).

  None reads `brief/`, `agents/`, `docs/specs/2026-11-01-quality-modes-design.md` or another author's files.
- **Order within a task:** text, then the ambiguity review, then A and B (in parallel), then C.
- **Disagreements:** when calibration shows one, the orchestrator compares the failing test with the task text. It sends the fix to A when the test departs from the text and to B when the reference does, quoting only the test name and the task line.

### Task 18: H6 text (task writer) and ambiguity review
- [ ] **Write `bench/tasks/h6.md`:**
  - a tricky-spec library (150–400 reference lines) with exact errors, and a CLI that reads a file or stdin;
  - it fixes the module path, its exports, the CLI entry path and the exit codes;
  - like h1–h3, it asks for `node:test` tests, a `package.json` with a `test` script and a README with usage, using Node built-ins only.
- [ ] **Ambiguity review** by a separate fresh agent: every line has one reading. Fix the findings.
- [ ] **Commit**: `feat(bench): h6 task text`.

### Task 19: H6 hidden tests (author A)
- [ ] **Write `bench/hidden/h6.test.mjs`** from `h6.md` alone, with at least one test per requirement line. It reads `TARGET_DIR` as h1–h3's hidden tests do. **Commit**: `test(bench): h6 hidden tests`.

### Task 20: H6 reference and near-miss versions (author B); size count (author C)
- [ ] **Reference**: `bench/heldout-calibration/h6/reference/`, from `h6.md` alone.
- [ ] **Near-misses**: at least 3 under `.../near-miss/<name>/`: an off-by-one, a symptom-only fix and a dropped edge case.
- [ ] **Size count**: author C counts the reference's new lines without tests. Reject the task at 80 lines or fewer.
- [ ] **Commit**: `feat(bench): h6 reference and near-miss versions`.

### Tasks 21–23: H5 — the same three tasks, plus the seed
- **Seed:** `bench/seeds/h5/`, written by the task writer first. It is a Node.js HTTP JSON service of about 500 lines with its own passing `node:test` suite and two shared-function bugs.
- **Text:**
  - two bug reports, each a symptom rather than a cause;
  - one endpoint that validates a JSON body against several named rules with exact error responses and changes stored data;
  - the endpoint takes at least 150 new lines without tests, in a module whose path is fixed.
- **Commits:** `feat(bench): h5 seed and task text`, `test(bench): h5 hidden tests`, `feat(bench): h5 reference and near-miss versions`.

### Tasks 24–26: H4 — the same three tasks
- **Text:**
  - an HTTP JSON API plus a browser page served by the same server, with data in one JSON file;
  - its own page section: a form that calls the API, a list that updates after a change, and the API's error messages shown;
  - the entry file, port variable and data file path are fixed.
- **Hidden tests:** they drive the server over HTTP: API status codes, bodies and error cases, and the served HTML checked for the spec's element ids and text. The served script is also run in a Node vm against a DOM and fetch stand-in that offers only the browser APIs the task text lists, and the tests check the page's behaviour there.
- **Size:** the reference is about 500–800 new lines, of which browser code is at least about 200. As built: 464 new source lines without tests and docs (blank and comment lines counted), 171 of them browser code (HTML 41 + script 130); accepted, ruling 2026-11-02. Author C also confirms from the text alone that it reads as two areas.
- **Commits:** as for h6.

## Part F — Freeze

### Task 27: Freeze commit
- [ ] **Merge Part E**: `git merge --no-ff bench/mode-tasks`. Then `node bench/calibrate.mjs h4`, `h5` and `h6` must each print `calibration ok`; disagreements are routed as in Part E.
- [ ] **Codex sandbox probe** (the user's yes; no Claude usage):
  - build a throwaway set with `rebuild-heldout --out=<scratchpad>/codex-probe` (Task 28's first step copies the held-out inputs in; do it now), and use only `case-01`;
  - for each sandbox in order, `read-only`, then `workspace-write`, then `danger-full-access` (that last only after its own explicit yes), run the run sheet's `codexBin` with `codexArgs` and save the `--json` stream;
  - stop at the first sandbox where Codex can run `node --version` and edits nothing outside `scratch/`;
  - show from that stream that no plugin, MCP server or memory loads;
  - write the sandbox and the exact command line into `bench/outside-run-sheet.md` (with the approval date for full access), then run `node --test bench/codex-judge.test.mjs`;
  - delete the probe folder. Its verdict is never imported.
- [ ] **Check the tasks register**: `taskProblems(['h4','h5','h6'])` is `[]` (add a test).
- [ ] **Plugin guard**: the Global plugin-path guard prints nothing.
- [ ] **Every suite**: `node --test bench/*.test.mjs`, `npm test`, `npm run test:board`, `claude plugin validate --strict .`, `node scripts/gen-agents.mjs --check`. Show the output.
- [ ] **Whole-branch review**: run the final review and fix CRITICAL and HIGH findings. Rerun every suite and the three calibrations after the fixes.
- [ ] **Commit and tag**: `git commit -m "chore(bench): freeze the mode round"`, then `git tag mo-freeze`. Show `git rev-parse mo-freeze`; the write-up cites it.
- [ ] **Ask the user's yes to push** the branch and the tags `v0.2.1` and `mo-freeze`. Do not push without it.

## Part G — Runbook (each step waits for the user's yes; no code changes except under the spec's harness-bug rule)

### Task 28: Pin and check the held-out inputs
- [ ] **Plugin worktree**: `git worktree add C:/Users/Asus/section-team-v0.2.1 v0.2.1`, then `git -C C:/Users/Asus/section-team-v0.2.1 status --porcelain` prints nothing.
- [ ] **Held-out inputs**: copy them into this checkout's `bench/results`, unchanged: `external-key-ho.json` from `C:/Users/Asus/claude-team/bench/results`, and `judge-ho.json`, `blind-key-ho.json`, `judge-hoag.json` and `blind-key-hoag.json` from `bench/data/heldout`. Print their SHA-256 hashes.

### Task 29: Outside held-out checks (no Claude usage)
- [ ] **Fresh sets**: `node bench/external-judge.mjs rebuild-heldout --out=C:/Users/Asus/codex-judge-ho2`, then `copy --from=C:/Users/Asus/codex-judge-ho2 --to=C:/Users/Asus/ag-judge-ho2`.
- [ ] **Codex** (yes): `node bench/codex-judge.mjs --set=C:/Users/Asus/codex-judge-ho2`, then `import --round=ho --out=C:/Users/Asus/codex-judge-ho2 --as=hocx`, then `check --as=hocx`.
- [ ] **Antigravity**: the user judges `ag-judge-ho2` by hand, one new conversation per case, from the run sheet. Then `import --as=hoag2` and `check --as=hoag2`, or record "not used".
- [ ] **Context only**: report `hocx1` (the earlier one-session Codex run in `C:/Users/Asus/codex-judge`) over the cases it finished. Give its gap and same-winner count over those pairs beside "k of 18", plus `sizeEffectHeldOut`.

### Task 30: Preflight (yes; about $1)
- [ ] **Check the push**: `git ls-remote origin refs/tags/v0.2.1 refs/tags/mo-freeze` lists both at the local hashes; if not, stop and ask.
- [ ] **Before the preflight:** From the preflight until the round ends, do not install or remove anything in ~/.claude/skills or ~/.claude/agents (outside synced/). Run the preflight and every batch from one plain terminal and note which shell.
- [ ] **Run it from one shell**: `node bench/preflight.mjs --round=mo --plugin=C:/Users/Asus/section-team-v0.2.1` → `results/preflight-mo.json`. Show the pin.

### Task 31: Runs (yes, with the estimate: about $114 of runs, $89–137)
- [ ] **Before the first batch:** Task 30's rules still hold.
- [ ] **Before each batch:** `git -C C:/Users/Asus/section-team-v0.2.1 status --porcelain`, `git -C C:/Users/Asus/section-team-v0.2.1 diff --stat v0.2.1` and `git diff --stat v0.2.1 mo-freeze -- agents hooks skills brief .claude-plugin scripts types package.json tests` all print nothing. Any output stops the round.
- [ ] **One batch per usage window**: `node bench/run.mjs --tag=mo --conds=solo,lean,team,max --tasks=h4,h5,h6 --reps=3 --plugin=C:/Users/Asus/section-team-v0.2.1 mo-r1` (then `mo-r2`, `mo-r3`).
  - Exit 1: harness or evidence error; stop and report, do not resume.
  - Exit 2: the batch stopped. If the stop message says 'void' or names changed skills or agents, read the reasons, and restore `~/.claude` to the pinned lists before resuming; never re-pin. A 'harness bug' stop: stop and report. Otherwise resume in the next window.
  - Exit 3: stop and report.
- [ ] **After each batch**: run `node bench/score.mjs`, and list void runs, API failures and reruns.

### Task 32: Opus judging
- [ ] **Prepare**: `node bench/anonymize.mjs --round=mo --conds=solo-mo,lean-mo,team-mo,max-mo --tasks=h4,h5,h6 --reps=3`, then `node bench/leak-scan.mjs --round=mo`.
- [ ] **Trial judge** (its own yes): `node bench/judge.mjs --round=mo --per-pair=2 --limit=1`. Report the measured cost. Watch its first attempt: if it fails on init, effort, permission mode or a blind-key touch, stop (Ctrl+C) and treat it as a harness bug before re-asks spend two more sessions.
- [ ] **Remaining judges** (yes, with the measured estimate): `node bench/judge.mjs --round=mo --per-pair=2`.
- [ ] **If judging stops:** after an auth or API error, log in again (or wait out the outage), then resume judging.

### Task 33: Outside judges, mode round
- [ ] **Order:** the held-out set is judged, imported and checked before any mode-round set is imported; the importer refuses otherwise.
- [ ] **Sets**: `prepare --round=mo --out=C:/Users/Asus/codex-judge-mo`, then immediately `copy --from=C:/Users/Asus/codex-judge-mo --to=C:/Users/Asus/ag-judge-mo`.
- [ ] **Codex** (yes): `node bench/codex-judge.mjs --set=C:/Users/Asus/codex-judge-mo`, then `import --round=mo --out=... --as=mocx`.
- [ ] **Antigravity**: the user judges per case, then `import --as=moag`. When an import refuses, its `outside-usable-<as>.json` stays.

### Task 34: Analysis and write-up
- [ ] **Guard again**: rerun Task 31's checks before this step; any output stops the round.
- [ ] **Analysis**: `node bench/mode-check.mjs --round=mo`, `node bench/gate-stats.mjs --round=mo`, `node bench/test-strength.mjs --round=mo` and `node bench/bars.mjs --round=mo`.
- [ ] **Write `docs/benchmark-modes-2026-11.md`** with every section the spec's Publishing lists, including the Limits section verbatim from the spec. Task table: reference sizes counted as raw source lines without tests, docs and package.json (blank and comment lines included): h4 464 (171 browser), h5 about 151 (about 122 code-only), h6 340. Put the raw data in `bench/data/modes/` with the recompute command, and update the README's Modes table.
- [ ] **Commit**: `docs: publish the mode round`.
- [ ] **Hand the picker-label change** (`hooks/lib/mode.mjs` `MODE_LABELS`, next plugin version) to the user as a follow-up task. It is a plugin change after the freeze.
