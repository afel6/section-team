# section-team Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A global Claude Code plugin that makes every session a supervisor which wakes 12 Opus 5.5 section heads by need, saves their reports to `.team/reports/`, blocks advisors from changing project files, and shows a live Team Board pane.

**Architecture:** One plugin folder (`C:\Users\Asus\claude-team`) loaded through `CLAUDE_CODE_PLUGIN_DIRS`. File-touching logic runs as classic command hooks written in plain Node (`session-start.mjs`, `subagent-stop.mjs`, `pre-tool-use.mjs`) sharing pure helpers in `hooks/lib/`. The Team Board is a mod (`hooks/register.tsx`, mods runtime, `$` API) that reads `$.agent.list()` and today's report files once a second. Section agent files are generated from one roster so their shared text never drifts.

**Tech Stack:** Node 26 (built-in `node:test`, no npm dependencies), Claude Code 2.1.295 plugin + mods API (TSX hooks module, `claude plugin validate`, `claude plugin test`), git ≥ 2.31.

**Spec:** `docs/specs/2026-10-12-claude-team-design.md` (v3, approved 2026-10-12)

## Global Constraints

- Platform: native Windows 11, Claude desktop app Code tab; not WSL.
- Claude Code: CLI ≥ 2.1.295 here; desktop app bundled copy ≥ 2.1.289.
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` stays unset.
- Plugin name `section-team`; agent types `section-team:<id>`; section id = agent type with `section-team:` stripped (a bare id is accepted too).
- Builder ids: `frontend backend database testing security devops uiux docs ai-llm mobile`. Advisor ids: `ai-engineer data-scientist`.
- Every section file: `model: claude-opus-5-5`, `memory: user`, `color` ∈ red, blue, green, yellow, purple, orange, pink, cyan.
- Reports: `.team/reports/<YYYY-MM-DD>/<HHMMSS>-<id>.md`, local time, never overwrite (`-2`, `-3`…), project root = main checkout of the git repo, else `cwd`.
- `.team/` is added to the repo's `info/exclude` at session start unless `.team/keep-in-git` exists.
- Supervisor brief < 10,000 characters and starts with the marker line `[section-team supervisor]`.
- Hook scripts never fail a session: errors go to stderr, exit code 0. Only the advisor guard emits a deny.
- No new npm dependencies. Commits are local only; never push.

## Review Focus

1. **Project paths with spaces** (the user has `...\ChatGPT\facebook events`): every hook must work when `cwd` and the plugin root contain spaces → `paths.test.mjs` runs in a temp folder named `with space`, and hook commands quote `${CLAUDE_PLUGIN_ROOT}` (Tasks 3, 4).
2. **Project is not a git repo** (or git fails): no exclude, reports go under `cwd`, nothing throws → `paths.test.mjs` "non-repo" cases (Task 3).
3. **Messy REPORT formatting** from a model (CRLF, `**Status:**` bold labels, a ```` ```markdown ```` fence, prose before the block) → `report.test.mjs` cases (Task 3).
4. **Non-ASCII report text** (the user may write Arabic) is saved byte-exact as UTF-8 → `paths.test.mjs` "utf-8" case (Task 3).
5. **Empty or malformed hook stdin** → each script exits 0 with no stdout → one test per script (Tasks 4, 6, 7).

---

### Task 1: Skeleton plugin and repo

**Files:**
- Create: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.tsx`, `package.json`, `.gitignore`
- Existing: `docs/specs/2026-10-12-claude-team-design.md`, this plan

**Interfaces:**
- Consumes: nothing.
- Produces: a plugin folder `claude plugin validate --strict` accepts; `npm test` runs `node --test`; `npm run test:board` runs `claude plugin test`.

- [ ] **Step 1: Check tool versions**

Run: `node --version && git --version && claude --version`
Expected: Node ≥ v22.18, git ≥ 2.31, Claude Code ≥ 2.1.295. Stop and report if lower.

- [ ] **Step 2: Write the manifest**

`.claude-plugin/plugin.json`:
```json
{
  "name": "section-team",
  "version": "0.1.0",
  "description": "Supervisor plus 12 specialist sections with saved reports and a Team Board",
  "author": { "name": "Asus" }
}
```

- [ ] **Step 3: Write the hooks registration and an empty module**

`hooks/hooks.json`:
```json
{
  "modules": ["./register.tsx"]
}
```

`hooks/register.tsx`:
```tsx
import type { Register } from 'claude-code'

export const register: Register = () => {}
```

- [ ] **Step 4: Write package.json and .gitignore**

`package.json`:
```json
{
  "name": "section-team",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/*.test.mjs",
    "test:board": "claude plugin test .",
    "validate": "claude plugin validate --strict ."
  }
}
```

`.gitignore`:
```
node_modules/
.spike/
.team/
.claude-plugin/types/
```

- [ ] **Step 5: Validate**

Run: `claude plugin validate --strict .`
Expected: no errors, no warnings; lists module `./register.tsx`.

- [ ] **Step 6: Init git and commit**

```bash
git init
git add -A
git commit -m "chore: plugin skeleton, spec and plan"
```

---

### Task 2: Phase 0 spike (throwaway, CLI)

Verifies the platform behaviour the design rests on, headless, with `claude -p --plugin-dir`. Desktop-only checks (env loading, `/clear`/compact, Fable consent prompt, board auto-open) move to Task 9. **Cost note:** this run makes one Opus 5.5 head, one Haiku helper, one Fable helper (in `-p` Fable bills without a consent prompt).

**Files:**
- Create (temporary): `agents/spike-a.md`, `agents/spike-b.md`, `hooks/spike-dump.mjs`, `scripts/spike-check.mjs`
- Modify (temporary): `hooks/hooks.json`, `hooks/register.tsx`
- Create (kept): `docs/phase0-results.md`

**Interfaces:**
- Consumes: Task 1 skeleton.
- Produces: `docs/phase0-results.md` with decisions D1–D6 that later tasks read:
  - D1 `agentTypeForm`: exact `agent_type` string for a plugin agent (e.g. `section-team:spike-a`).
  - D2 `messaging`: `direct` or `relay`.
  - D3 `reuse`: `message` or `respawn`.
  - D4 `skillsPreload`: `works` or `drop`.
  - D5 `memoryDir`: actual folder name under `~/.claude/agent-memory/`.
  - D6 `hooksLayout`: `mixed` (classic hooks + modules in hooks.json) or `split` (classic hooks inline in plugin.json).

- [ ] **Step 1: Write the spike agents**

`agents/spike-a.md`:
```markdown
---
name: spike-a
description: Phase 0 spike agent A. Only used by the section-team spike test.
model: claude-opus-5-5
memory: user
skills:
  - tdd-workflow
---
You are spike agent A in an automated test. Follow the job message exactly, step by step. Do not invoke skills unless the job says so. End your final message with the line DONE-A.
```

`agents/spike-b.md`:
```markdown
---
name: spike-b
description: Phase 0 spike agent B. Only used by the section-team spike test.
model: haiku
---
You are spike agent B in an automated test. Follow the job message exactly. End your final message with the line DONE-B.
```

- [ ] **Step 2: Write the dump hook**

`hooks/spike-dump.mjs`:
```js
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

let raw = ''
for await (const chunk of process.stdin) raw += chunk
const e = JSON.parse(raw)
const dir = join(e.cwd, '.spike')
mkdirSync(dir, { recursive: true })
appendFileSync(join(dir, 'events.jsonl'), JSON.stringify(e) + '\n')
if (e.hook_event_name === 'SessionStart') {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '[spike-marker-7731]' },
  }))
}
```

- [ ] **Step 3: Register classic hooks next to the module**

`hooks/hooks.json`:
```json
{
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/spike-dump.mjs\"" }] }],
    "SubagentStop": [{ "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/spike-dump.mjs\"" }] }],
    "PreToolUse": [{ "matcher": "Agent|SendMessage", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/spike-dump.mjs\"" }] }]
  },
  "modules": ["./register.tsx"]
}
```

Run: `claude plugin validate --strict .`
Expected: valid → D6 = `mixed`. If it refuses mixing, move the `"hooks"` object into `.claude-plugin/plugin.json` as `"hooks": { ... }` (same content), keep `hooks/hooks.json` as `{ "modules": ["./register.tsx"] }`, re-validate → D6 = `split`.

- [ ] **Step 4: Make the module dump the agent list**

`hooks/register.tsx`:
```tsx
import type { Register } from 'claude-code'

export const register: Register = on => {
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    const agents = await $.agent.list()
    const cwd = await $.session.cwd()
    const file = `${cwd}/.spike/agents.jsonl`
    const previous = await $.fs.read(file).catch(() => '')
    const row = { spawn: e.subagentType, name: e.name, model: e.model, agents }
    await $.fs.write(file, previous + JSON.stringify(row) + '\n')
    return result
  })
}
```

Run: `claude plugin validate --strict .`
Expected: valid.

- [ ] **Step 5: Create a throwaway git repo and run the spike**

```bash
SPIKE="$(mktemp -d)/section-team spike"
mkdir -p "$SPIKE" && cd "$SPIKE" && git init -q && git commit -q --allow-empty -m init
claude -p --plugin-dir "C:/Users/Asus/claude-team" \
  --allowedTools "Agent,SendMessage,Read,Write,Bash(sleep *)" \
  --output-format json \
  "AUTOMATED TEST. Do exactly these steps. Do not invoke skills, do not plan, do not use other agents.
1. Write on line 1 of your answer every bracketed marker in your context that starts with [spike-marker.
2. In ONE message, make two Agent calls in parallel:
   (a) subagent_type section-team:spike-b, name beta, prompt: 'Run Bash sleep 45. Then print verbatim every message you received from other agents. End with DONE-B.'
   (b) subagent_type section-team:spike-a, name alpha, prompt: '(1) Use SendMessage to beta with text PING-RUNNING-123 and say whether it was delivered. (2) Spawn a general-purpose helper with model haiku and prompt Reply OK-HAIKU. (3) Spawn a general-purpose helper with model fable and prompt Reply OK-FABLE. (4) List the names of skills whose full instructions are already in your context, and the folder of your persistent memory if you have one. End with DONE-A.'
3. When both have finished, use SendMessage to alpha with text: 'Use SendMessage to beta with text PING-COMPLETED-456 and report its reply. Then write SECOND-JOB-789. End with DONE-A.' Wait for the answer.
4. Print every result you received, verbatim." > spike-output.json
echo "SPIKE=$SPIKE"
```
Expected: command exits 0; `$SPIKE/.spike/events.jsonl` and `$SPIKE/.spike/agents.jsonl` exist.

- [ ] **Step 6: Write the result checker**

`scripts/spike-check.mjs`:
```js
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const spike = process.argv[2]
const lines = f => readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
const events = lines(join(spike, '.spike', 'events.jsonl'))
const spawns = existsSync(join(spike, '.spike', 'agents.jsonl')) ? lines(join(spike, '.spike', 'agents.jsonl')) : []
const output = readFileSync(join(spike, 'spike-output.json'), 'utf8')
const stops = events.filter(e => e.hook_event_name === 'SubagentStop')
const pre = events.filter(e => e.hook_event_name === 'PreToolUse')
const transcript = p => (p && existsSync(p) ? readFileSync(p, 'utf8') : '')
const modelsIn = p => [...new Set([...transcript(p).matchAll(/"model":"([^"]+)"/g)].map(m => m[1]))]
const alphaStops = stops.filter(e => String(e.agent_type).includes('spike-a'))
const betaStops = stops.filter(e => String(e.agent_type).includes('spike-b'))
const betaText = betaStops.map(e => (e.last_assistant_message ?? '') + transcript(e.agent_transcript_path)).join('\n')
const report = {
  C1_markerInContext: output.includes('[spike-marker-7731]'),
  C2_agentTypes: [...new Set(stops.map(e => e.agent_type))],
  C2_lastMessagePresent: alphaStops.every(e => typeof e.last_assistant_message === 'string' && e.last_assistant_message.length > 0),
  C3_alphaModels: modelsIn(alphaStops[0]?.agent_transcript_path),
  C3_helperModelsRequested: pre.filter(e => e.tool_name === 'Agent' && String(e.agent_type).includes('spike-a')).map(e => e.tool_input?.model),
  C4a_directWhileRunning: betaText.includes('PING-RUNNING-123'),
  C4b_directToCompleted: betaText.includes('PING-COMPLETED-456'),
  C5_alphaStopCount: alphaStops.length,
  C5_secondJobReported: alphaStops.some(e => (e.last_assistant_message ?? '').includes('SECOND-JOB-789')),
  C6_skillsMentioned: alphaStops.map(e => e.last_assistant_message ?? '').join('\n').includes('tdd-workflow'),
  C6_memoryDirs: existsSync(join(homedir(), '.claude', 'agent-memory')) ? readdirSync(join(homedir(), '.claude', 'agent-memory')).filter(n => n.includes('spike')) : [],
  C7_agentListSample: spawns.at(-1)?.agents ?? [],
  C8_moduleAndClassicBothRan: spawns.length > 0 && events.length > 0,
}
console.log(JSON.stringify(report, null, 2))
```

Run: `node scripts/spike-check.mjs "$SPIKE"`
Expected: a JSON report. Read helper models from the transcripts as well: `grep -o '"model":"[^"]*"' "$(dirname <alpha transcript>)"/agent-*.jsonl | sort -u` and confirm a Haiku id and a Fable id appear.

- [ ] **Step 7: Record decisions**

`docs/phase0-results.md` — fill every row from the check output (this file is the source later tasks read):
```markdown
# Phase 0 results (2026-10-12)

| Check | Observed | Decision |
|---|---|---|
| C1 SessionStart additionalContext reaches the model | true/false | if false: stop, report to user |
| C2 agent_type form | e.g. section-team:spike-a | D1 agentTypeForm = <observed> |
| C2 last_assistant_message present | true/false | if false: saver relies on transcript fallback (already built in Task 6) |
| C3 head model | e.g. claude-opus-5-5 | if not Opus 5.5: check CLAUDE_CODE_SUBAGENT_MODEL / ANTHROPIC_DEFAULT_OPUS_MODEL, report to user |
| C3 helper models | haiku id, fable id | if fable missing: Task 5 adds agents/fable-consultant.md (model: fable) |
| C4a direct message to running sibling | true/false | D2 messaging = direct if C4a and C4b, else relay |
| C4b direct message to completed sibling | true/false | (see D2) |
| C5 reuse fires 2nd SubagentStop with new REPORT | true/false | D3 reuse = message if true, else respawn |
| C6 preloaded skill in context | true/false | D4 skillsPreload = works / drop |
| C6 memory folder name | e.g. spike-a | D5 memoryDir = <observed> |
| C7 $.agent.list() entry shape | fields seen | board keys on `type` (Task 8) |
| C8 classic hooks + module in one hooks.json | mixed/split | D6 hooksLayout = <observed> |
```

- [ ] **Step 8: Remove spike files and commit the results**

```bash
rm -f agents/spike-a.md agents/spike-b.md hooks/spike-dump.mjs scripts/spike-check.mjs
git checkout -- hooks/hooks.json hooks/register.tsx .claude-plugin/plugin.json
ls -d "$HOME/.claude/agent-memory/"*spike* 2>/dev/null   # look first: only folders this spike created
rm -rf "$HOME/.claude/agent-memory/"*spike-a*
rm -rf "$SPIKE"
claude plugin validate --strict .
git add docs/phase0-results.md
git commit -m "docs: phase 0 spike results"
```
Expected: validate passes on the restored skeleton; only `docs/phase0-results.md` is committed.

---

### Task 3: Shared helpers (`hooks/lib`)

**Files:**
- Create: `hooks/lib/report.mjs` (pure: no Node imports — the mod imports it), `hooks/lib/paths.mjs` (Node), `tests/report.test.mjs`, `tests/paths.test.mjs`

**Interfaces:**
- Consumes: D1 (bare or prefixed agent types are both accepted, so no code change either way).
- Produces:
  - `report.mjs`: `PREFIX: string`, `BUILDER_IDS: string[]`, `ADVISOR_IDS: string[]`, `SECTION_IDS: string[]`, `sectionIdFromType(type: unknown): string | null`, `extractReport(text: unknown): string | null`, `parseReport(block: unknown): { status, job, changed, tests, coordination, helpers, problems, next }` (all strings; `status` lower-case first word).
  - `paths.mjs`: `projectRoot(cwd: string): string`, `excludeFile(cwd: string): string | null`, `ensureExcluded(cwd: string, root: string): boolean`, `stamp(now: Date): { date: string, time: string }`, `writeReport(root: string, id: string, text: string, now?: Date): string` (file path), `latestSummary(root: string): string | null`, `readStdinJson(): Promise<object | null>`.

- [ ] **Step 1: Write the failing report tests**

`tests/report.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sectionIdFromType, extractReport, parseReport, SECTION_IDS } from '../hooks/lib/report.mjs'

const CLEAN = `Some work notes first.

## REPORT · backend · 2026-10-12 14:32
Status:       done
Job:          Build /api/login
Changed:      src/api/login.ts
Tests:        8 ran, 8 passed
Coordination: frontend → agreed {token, user}
Helpers used: sonnet ×2 (tests)
Problems:     none
Next:         rate limiting
`

test('section id from prefixed and bare types', () => {
  assert.equal(sectionIdFromType('section-team:frontend'), 'frontend')
  assert.equal(sectionIdFromType('ai-llm'), 'ai-llm')
  assert.equal(sectionIdFromType('section-team:data-scientist'), 'data-scientist')
  assert.equal(sectionIdFromType('general-purpose'), null)
  assert.equal(sectionIdFromType(''), null)
  assert.equal(sectionIdFromType(undefined), null)
  assert.equal(SECTION_IDS.length, 12)
})

test('extracts the block from the heading to the end', () => {
  const block = extractReport(CLEAN)
  assert.ok(block.startsWith('## REPORT · backend'))
  assert.ok(!block.includes('work notes'))
  assert.ok(block.endsWith('Next:         rate limiting\n'))
})

test('no REPORT heading gives null', () => {
  assert.equal(extractReport('all done, no report'), null)
  assert.equal(extractReport(undefined), null)
})

test('handles CRLF, bold labels and a markdown fence', () => {
  const messy = '```markdown\r\n### REPORT · testing\r\n**Status:** Partial — 2 failing\r\n- **Job:** auth tests\r\n**Helpers used:** haiku ×1\r\n```\r\nthanks'
  const block = extractReport(messy)
  assert.ok(block.startsWith('### REPORT · testing'))
  assert.ok(!block.includes('```'))
  assert.ok(!block.includes('thanks'))
  assert.ok(!block.includes('\r'))
  const r = parseReport(block)
  assert.equal(r.status, 'partial')
  assert.equal(r.job, 'auth tests')
  assert.equal(r.helpers, 'haiku ×1')
})

test('parses every field and normalises status', () => {
  const r = parseReport(extractReport(CLEAN))
  assert.deepEqual(r, {
    status: 'done', job: 'Build /api/login', changed: 'src/api/login.ts', tests: '8 ran, 8 passed',
    coordination: 'frontend → agreed {token, user}', helpers: 'sonnet ×2 (tests)', problems: 'none', next: 'rate limiting',
  })
})

test('missing fields stay empty strings', () => {
  const r = parseReport('## REPORT · docs\nStatus: blocked | waiting on backend\n')
  assert.equal(r.status, 'blocked')
  assert.equal(r.job, '')
  assert.equal(parseReport(undefined).status, '')
})
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/report.test.mjs`
Expected: FAIL — `Cannot find module ... hooks/lib/report.mjs`.

- [ ] **Step 3: Implement `report.mjs`**

`hooks/lib/report.mjs`:
```js
export const PREFIX = 'section-team:'
export const BUILDER_IDS = ['frontend', 'backend', 'database', 'testing', 'security', 'devops', 'uiux', 'docs', 'ai-llm', 'mobile']
export const ADVISOR_IDS = ['ai-engineer', 'data-scientist']
export const SECTION_IDS = [...BUILDER_IDS, ...ADVISOR_IDS]

export function sectionIdFromType(type) {
  if (typeof type !== 'string') return null
  const id = type.startsWith(PREFIX) ? type.slice(PREFIX.length) : type
  return SECTION_IDS.includes(id) ? id : null
}

export function extractReport(text) {
  if (typeof text !== 'string') return null
  const lf = text.replace(/\r\n?/g, '\n')
  const heading = /^[ \t]*#{1,6}[ \t]*REPORT\b.*$/m.exec(lf)
  if (!heading) return null
  const block = lf.slice(heading.index).replace(/^[ \t]+/, '').replace(/\n[ \t]*```[\s\S]*$/, '')
  return block.trimEnd() + '\n'
}

const FIELDS = {
  status: 'status', job: 'job', changed: 'changed', tests: 'tests', coordination: 'coordination',
  'helpers used': 'helpers', helpers: 'helpers', problems: 'problems', next: 'next',
}

export function parseReport(block) {
  const out = { status: '', job: '', changed: '', tests: '', coordination: '', helpers: '', problems: '', next: '' }
  if (typeof block !== 'string') return out
  for (const raw of block.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\*\*/g, '').replace(/^\s*[-*]\s+/, '').trim()
    const match = /^([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/.exec(line)
    if (!match) continue
    const key = FIELDS[match[1].toLowerCase()]
    if (key && out[key] === '') out[key] = match[2].trim()
  }
  out.status = (out.status.split(/[\s|·,—-]+/)[0] ?? '').toLowerCase()
  return out
}
```

- [ ] **Step 4: Run report tests**

Run: `node --test tests/report.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing paths tests**

`tests/paths.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { projectRoot, excludeFile, ensureExcluded, stamp, writeReport, latestSummary } from '../hooks/lib/paths.mjs'

const tempDir = () => {
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'ct-'))), 'with space')
  mkdirSync(dir, { recursive: true })
  return dir
}
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' })
const repo = () => {
  const dir = tempDir()
  git(dir, 'init', '-q')
  git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
  return dir
}
const same = (a, b) => assert.equal(resolve(a).toLowerCase(), resolve(b).toLowerCase())
const NOW = new Date(2026, 9, 12, 14, 32, 5)

test('non-repo: root is cwd, no exclude', () => {
  const dir = tempDir()
  same(projectRoot(dir), dir)
  assert.equal(excludeFile(dir), null)
  assert.equal(ensureExcluded(dir, dir), false)
})

test('repo: root is the checkout and exclude is added once', () => {
  const dir = repo()
  const sub = join(dir, 'src', 'deep')
  mkdirSync(sub, { recursive: true })
  same(projectRoot(sub), dir)
  assert.equal(ensureExcluded(sub, dir), true)
  assert.equal(ensureExcluded(sub, dir), false)
  const lines = readFileSync(excludeFile(dir), 'utf8').split(/\r?\n/).filter(l => l.trim() === '.team/')
  assert.equal(lines.length, 1)
})

test('keep-in-git marker skips the exclude', () => {
  const dir = repo()
  mkdirSync(join(dir, '.team'), { recursive: true })
  writeFileSync(join(dir, '.team', 'keep-in-git'), '')
  assert.equal(ensureExcluded(dir, dir), false)
  assert.ok(!readFileSync(excludeFile(dir), 'utf8').includes('.team/'))
})

test('worktree: root and exclude point at the main checkout', () => {
  const dir = repo()
  const wt = join(dir, '..', 'wt')
  git(dir, 'worktree', 'add', '-q', wt)
  same(projectRoot(wt), dir)
  same(excludeFile(wt), excludeFile(dir))
})

test('stamp uses local time', () => {
  assert.deepEqual(stamp(NOW), { date: '2026-10-12', time: '143205' })
})

test('writeReport never overwrites', () => {
  const dir = tempDir()
  const a = writeReport(dir, 'backend', 'one', NOW)
  const b = writeReport(dir, 'backend', 'two', NOW)
  const c = writeReport(dir, 'backend', 'three', NOW)
  assert.ok(a.endsWith(join('2026-10-12', '143205-backend.md')))
  assert.ok(b.endsWith('143205-backend-2.md'))
  assert.ok(c.endsWith('143205-backend-3.md'))
  assert.equal(readFileSync(a, 'utf8'), 'one\n')
})

test('utf-8 report text is saved byte-exact', () => {
  const dir = tempDir()
  const text = '## REPORT · docs\nJob: توثيق واجهة الدخول ✓\n'
  assert.equal(readFileSync(writeReport(dir, 'docs', text, NOW), 'utf8'), text)
})

test('latestSummary picks the newest summary across days', () => {
  const dir = tempDir()
  assert.equal(latestSummary(dir), null)
  writeReport(dir, 'supervisor-summary', 'old', new Date(2026, 9, 11, 9, 0, 0))
  const newest = writeReport(dir, 'supervisor-summary', 'new', new Date(2026, 9, 12, 8, 0, 0))
  writeReport(dir, 'backend', 'not a summary', new Date(2026, 9, 12, 23, 0, 0))
  same(latestSummary(dir), newest)
  assert.ok(existsSync(newest))
})
```

- [ ] **Step 6: Run to see it fail**

Run: `node --test tests/paths.test.mjs`
Expected: FAIL — `Cannot find module ... hooks/lib/paths.mjs`.

- [ ] **Step 7: Implement `paths.mjs`**

`hooks/lib/paths.mjs`:
```js
import { execFileSync } from 'node:child_process'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

function git(cwd, args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim() || null
  } catch {
    return null
  }
}

export function projectRoot(cwd) {
  const common = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  return common && /[\\/]\.git$/.test(common) ? resolve(dirname(common)) : resolve(cwd)
}

export function excludeFile(cwd) {
  return git(cwd, ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'])
}

export function ensureExcluded(cwd, root) {
  if (existsSync(join(root, '.team', 'keep-in-git'))) return false
  const file = excludeFile(cwd)
  if (!file) return false
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (current.split(/\r?\n/).some(line => line.trim() === '.team/')) return false
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, (current === '' || current.endsWith('\n') ? '' : '\n') + '.team/\n')
  return true
}

const pad = n => String(n).padStart(2, '0')

export function stamp(now) {
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
  }
}

export function writeReport(root, id, text, now = new Date()) {
  const { date, time } = stamp(now)
  const dir = join(root, '.team', 'reports', date)
  mkdirSync(dir, { recursive: true })
  const body = text.endsWith('\n') ? text : text + '\n'
  for (let n = 1; n < 1000; n++) {
    const file = join(dir, `${time}-${id}${n === 1 ? '' : `-${n}`}.md`)
    try {
      const fd = openSync(file, 'wx')
      writeSync(fd, body)
      closeSync(fd)
      return file
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
    }
  }
  throw new Error(`section-team: over 999 reports for ${id} in one second`)
}

export function latestSummary(root) {
  const base = join(root, '.team', 'reports')
  if (!existsSync(base)) return null
  const days = readdirSync(base).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse()
  for (const day of days) {
    const file = readdirSync(join(base, day)).filter(n => n.endsWith('-supervisor-summary.md')).sort().reverse()[0]
    if (file) return join(base, day, file)
  }
  return null
}

export async function readStdinJson() {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
```

- [ ] **Step 8: Run all tests**

Run: `npm test`
Expected: PASS (14 tests across both files).

- [ ] **Step 9: Commit**

```bash
git add hooks/lib tests/report.test.mjs tests/paths.test.mjs
git commit -m "feat: report parsing and project path helpers"
```

---

### Task 4: Supervisor brief and SessionStart hook

**Files:**
- Create: `brief/supervisor.md`, `hooks/session-start.mjs`, `tests/session-start.test.mjs`
- Modify: `hooks/hooks.json` (or `.claude-plugin/plugin.json` if D6 = `split`)

**Interfaces:**
- Consumes: `projectRoot`, `ensureExcluded`, `latestSummary`, `readStdinJson` from Task 3; Phase 0 results (`docs/phase0-results.md`): the Agent tool has no `name`, sections are addressed by the agent id their spawn returned, messaging between sections is relayed by the supervisor, reuse by SendMessage works.
- Produces: `buildContext(cwd: string): string` exported from `hooks/session-start.mjs`; the hook prints `{ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }`.

- [ ] **Step 1: Write the failing test**

`tests/session-start.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildContext } from '../hooks/session-start.mjs'
import { writeReport, excludeFile } from '../hooks/lib/paths.mjs'

const SCRIPT = fileURLToPath(new URL('../hooks/session-start.mjs', import.meta.url))
const BRIEF = fileURLToPath(new URL('../brief/supervisor.md', import.meta.url))
const repo = () => {
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'ct-'))), 'with space')
  mkdirSync(dir, { recursive: true })
  execFileSync('git', ['-C', dir, 'init', '-q'])
  return dir
}
const run = input => spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8' })

test('brief starts with the marker and fits the limit', () => {
  const brief = readFileSync(BRIEF, 'utf8')
  assert.ok(brief.startsWith('[section-team supervisor]'))
  assert.ok(brief.length < 10000, `brief is ${brief.length} chars`)
})

test('context names the latest summary and excludes .team/', () => {
  const dir = repo()
  const summary = writeReport(dir, 'supervisor-summary', 'x', new Date(2026, 9, 12, 9, 0, 0))
  const context = buildContext(dir)
  assert.ok(context.startsWith('[section-team supervisor]'))
  assert.ok(context.includes(summary))
  assert.ok(readFileSync(excludeFile(dir), 'utf8').includes('.team/'))
})

test('hook prints SessionStart additionalContext', () => {
  const dir = repo()
  const result = run(JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', cwd: dir }))
  assert.equal(result.status, 0)
  const out = JSON.parse(result.stdout)
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart')
  assert.ok(out.hookSpecificOutput.additionalContext.startsWith('[section-team supervisor]'))
})

test('empty or malformed stdin: exit 0, no output', () => {
  for (const input of ['', 'not json', '{}']) {
    const result = run(input)
    assert.equal(result.status, 0)
    assert.equal(result.stdout, '')
  }
})
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/session-start.test.mjs`
Expected: FAIL — module or brief not found.

- [ ] **Step 3: Write the brief**

`brief/supervisor.md` (already reflects Phase 0: no agent names, agent-id map, relay messaging):
```markdown
[section-team supervisor]
You are the SUPERVISOR of section-team. The user talks only to you. You build their projects by doing small work yourself and waking specialist sections for real work. Sections sleep until you wake them.

## Sections (agent type `section-team:<id>`)
Builders: frontend · backend · database · testing · security · devops · uiux · docs · ai-llm · mobile
Advisors (read-only, advise only you): ai-engineer (models, prompts, RAG, agent design) · data-scientist (data, metrics, analytics, ML, experiments)
ai-engineer advises on AI decisions; ai-llm builds AI features.

## When to wake sections
- Small task (touches at most 1 file and needs no new tests): do it yourself, wake nobody.
- One area of real work: wake that one builder.
- Several areas: wake each needed builder. Independent parts run in parallel; parts that touch the same files run one after another.
- An AI or data decision: ask the matching advisor first, then decide. Only you consult advisors.
- 3 or more distinct builders needed (advisors not counted), or a task grows to need a 3rd: first show the user a short plan (which sections, what each does, in what order) and wake nobody until the user says OK.

## How to wake a section
- Agent call: `subagent_type: "section-team:<id>"`. Never pass `model` (sections run on Opus 5.5 from their own files) and never `name` (not available).
- Keep a list of awake sections and the agent id each spawn returned. Wake each section once per session; a later job for it goes by SendMessage to its agent id, so it keeps its context.
- Sections cannot message each other. When a section sends you (`main`) a request for another section, forward it with SendMessage to that section's agent id (wake it first if asleep) and pass the answer back.
- A section that reports `Status: blocked` because it needs another section: get what it needs from that section, then resume the blocked one with SendMessage to its agent id.
- Every job message contains: the goal; relevant files and decisions so far; the skills or commands to use; what "done" means; which sections are awake and which ones to coordinate with (their requests go through you); "End with your REPORT block."

## Reports
- Every section ends with a `## REPORT` block. A hook saves it to `.team/reports/<date>/`. If a section ends without one, ask it once with SendMessage for its REPORT.
- After a task, give the user one summary: one line per section (✅ done / ⚠ partial / ❌ blocked + what it did), agreements between sections, next steps. Then save the same summary with the Write tool to `.team/reports/<YYYY-MM-DD>/<HHMMSS>-supervisor-summary.md` in the project root (local time; run Bash `date +%Y-%m-%d/%H%M%S` to get it).

## Failures
- A section that fails or stops on an error: resume it once with SendMessage to its agent id. If it fails again, tell the user what failed and the error text.

## Rules that win inside section-team
- For delegated work, wake sections. Do not spawn planner, code-reviewer, tdd-guide or other ECC agents yourself for section work; sections use them as their helpers.
- For a multi-section task the testing section owns final review and verification; tell the other sections to skip a separate full review pass.
- Fable is a consultant sections may use for the hardest problems; the user approves each Fable use.

## Team Board
- `/team` opens the Team Board pane: one box per section with live state and its last report.
```

- [ ] **Step 4: Implement the hook**

`hooks/session-start.mjs`:
```js
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ensureExcluded, latestSummary, projectRoot, readStdinJson } from './lib/paths.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

export function buildContext(cwd) {
  const brief = readFileSync(join(HERE, '..', 'brief', 'supervisor.md'), 'utf8').trim()
  const root = projectRoot(cwd)
  ensureExcluded(cwd, root)
  const summary = latestSummary(root)
  return summary ? `${brief}\n\nLast team summary for this project: ${summary}. Read it before new team work.` : brief
}

async function main() {
  const input = await readStdinJson()
  if (typeof input?.cwd !== 'string') return
  const additionalContext = buildContext(input.cwd)
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => process.stderr.write(`section-team session-start: ${err.message}\n`))
}
```

- [ ] **Step 5: Register the hook**

`hooks/hooks.json` (D6 = `mixed`; for `split` put the same `"hooks"` object in `.claude-plugin/plugin.json`):
```json
{
  "hooks": {
    "SessionStart": [
      { "matcher": "startup|resume|clear|compact", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.mjs\"" }] }
    ]
  },
  "modules": ["./register.tsx"]
}
```

- [ ] **Step 6: Run tests and validate**

Run: `npm test && claude plugin validate --strict .`
Expected: all tests PASS; validate clean.

- [ ] **Step 7: Commit**

```bash
git add brief hooks/session-start.mjs hooks/hooks.json .claude-plugin/plugin.json tests/session-start.test.mjs
git commit -m "feat: supervisor brief injected at session start"
```

---

### Task 5: The 12 section agent files (generated)

**Files:**
- Create: `scripts/gen-agents.mjs`, `agents/*.md` (12 generated), `tests/agents.test.mjs`
- Conditional (C3 fable missing): `agents/fable-consultant.md` via the generator's `CONSULTANT` flag.

**Interfaces:**
- Consumes: `BUILDER_IDS`, `ADVISOR_IDS` from `hooks/lib/report.mjs`; Phase 0: relay messaging, D4 `skillsPreload` = works, Fable helpers work.
- Produces: `ROSTER`, `render(section): string`, `renderAll(): Record<string, string>` from `scripts/gen-agents.mjs`; files `agents/<id>.md` with `name: <id>`.

- [ ] **Step 1: Write the failing test**

`tests/agents.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ROSTER, render, renderAll } from '../scripts/gen-agents.mjs'
import { BUILDER_IDS, ADVISOR_IDS } from '../hooks/lib/report.mjs'

const GEN = fileURLToPath(new URL('../scripts/gen-agents.mjs', import.meta.url))
const AGENTS = new URL('../agents/', import.meta.url)
const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan']
const front = text => Object.fromEntries(text.split('---')[1].trim().split('\n').filter(l => /^\w/.test(l)).map(l => [l.split(':')[0], l.slice(l.indexOf(':') + 1).trim()]))

test('roster matches the section ids', () => {
  assert.deepEqual(ROSTER.map(s => s.id), [...BUILDER_IDS, ...ADVISOR_IDS])
})

test('every section file has the pinned model, memory, a valid colour and a REPORT template', () => {
  for (const s of ROSTER) {
    const file = `${s.id}.md`
    const text = render(s)
    const fm = front(text)
    assert.equal(fm.name, s.id)
    assert.equal(fm.model, 'claude-opus-5-5')
    assert.equal(fm.memory, 'user')
    assert.ok(COLORS.includes(fm.color), `${file} colour ${fm.color}`)
    assert.ok(text.includes('## REPORT · '), `${file} has no REPORT template`)
    assert.ok(text.includes('ALWAYS pass `model`'), `${file} has no model routing`)
  }
})

test('advisors cannot use shell tools; builders have no tools allowlist', () => {
  for (const s of ROSTER) {
    const fm = front(render(s))
    const id = s.id
    if (ADVISOR_IDS.includes(id)) {
      assert.ok(fm.tools, `${id} needs a tools allowlist`)
      for (const banned of ['Bash', 'PowerShell', 'NotebookEdit']) assert.ok(!fm.tools.includes(banned), `${id} has ${banned}`)
    } else {
      assert.equal(fm.tools, undefined, `${id} should inherit tools`)
    }
  }
})

test('committed files match the generator', () => {
  const result = spawnSync(process.execPath, [GEN, '--check'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  for (const [file, text] of Object.entries(renderAll())) assert.equal(readFileSync(new URL(file, AGENTS), 'utf8'), text)
})
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/agents.test.mjs`
Expected: FAIL — `Cannot find module ... scripts/gen-agents.mjs`.

- [ ] **Step 3: Write the generator**

`scripts/gen-agents.mjs` (Phase 0: D4 = works → `PRELOAD = true`; Fable helpers ran → `CONSULTANT = false`):
```js
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const MODEL = 'claude-opus-5-5'
export const RELAY = 'To reach another section, SendMessage the supervisor (`main`) with the section name and your request; the supervisor forwards it and passes the answer back. If you cannot reach the supervisor, finish with `Status: blocked` and say what you need from which section.'
export const PRELOAD = true // Phase 0 D4: preloaded skills load
export const CONSULTANT = false // Phase 0 C3: helpers run on fable directly

const ADVISOR_TOOLS = 'Read, Grep, Glob, WebSearch, WebFetch, Skill, SendMessage, Agent, Write, Edit'

export const ROSTER = [
  { id: 'frontend', kind: 'builder', color: 'blue', description: 'Frontend section head: UI pages, components, styling, client state. Use for any user-facing screen work.', role: 'You own everything the user sees in a browser: pages, components, styling, client-side state and accessibility of the UI you build.', skills: ['frontend-design:frontend-design', 'modern-web-guidance:modern-web-guidance'], goto: ['/react-review'], helpers: ['react-reviewer', 'typescript-reviewer', 'a11y-architect'] },
  { id: 'backend', kind: 'builder', color: 'green', description: 'Backend section head: APIs, server logic, auth, integrations.', role: 'You own server code: APIs, business logic, authentication, background jobs and integrations.', skills: ['anthropic-skills:backend-patterns', 'error-handling'], goto: [], helpers: ['code-reviewer', 'fastapi-reviewer', 'python-reviewer'] },
  { id: 'database', kind: 'builder', color: 'yellow', description: 'Database section head: schema design, migrations, queries, indexes.', role: 'You own data storage: schemas, migrations, queries, indexes and data integrity.', skills: ['data:sql-queries'], goto: [], helpers: ['database-reviewer'] },
  { id: 'testing', kind: 'builder', color: 'cyan', description: 'Testing section head: unit, integration and e2e tests; owns final review and verification for multi-section tasks.', role: 'You own tests and, for multi-section tasks, the final review and verification of everyone\'s changes.', skills: ['tdd-workflow', 'e2e-testing', 'verification-loop'], goto: [], helpers: ['tdd-guide', 'e2e-runner', 'pr-test-analyzer', 'code-reviewer'] },
  { id: 'security', kind: 'builder', color: 'red', description: 'Security section head: vulnerability review, secrets, auth hardening, fixes for security findings.', role: 'You own security: finding vulnerabilities, exposed secrets and weak auth, and fixing them.', skills: ['security-review', 'security-scan'], goto: [], helpers: ['security-reviewer', 'silent-failure-hunter'] },
  { id: 'devops', kind: 'builder', color: 'orange', description: 'DevOps section head: builds, CI, Docker, deployment, environment config.', role: 'You own how code is built, packaged, configured and deployed.', skills: ['anthropic-skills:docker-management', 'engineering:deploy-checklist'], goto: ['/build-fix'], helpers: ['build-error-resolver'] },
  { id: 'uiux', kind: 'builder', color: 'pink', description: 'UI/UX section head: layouts, user flows, accessibility, UX copy; designs before code.', role: 'You own how the product looks and flows: layouts, user journeys, accessibility and wording, decided before code is written.', skills: ['design:design-critique', 'design:accessibility-review', 'design:ux-copy'], goto: [], helpers: ['a11y-architect'] },
  { id: 'docs', kind: 'builder', color: 'purple', description: 'Docs section head: READMEs, guides, API docs, changelogs.', role: 'You own documentation: READMEs, guides, API references and changelogs.', skills: ['engineering:documentation'], goto: ['/update-docs'], helpers: ['doc-updater'] },
  { id: 'ai-llm', kind: 'builder', color: 'purple', description: 'AI/LLM section head: builds features that call Claude or other models: prompts, tools, RAG, evals.', role: 'You build AI features: model calls, prompts, tool use, retrieval and evaluations.', skills: ['claude-api', 'eval-harness'], goto: [], helpers: ['rag-pipeline-reviewer'] },
  { id: 'mobile', kind: 'builder', color: 'green', description: 'Mobile section head: iOS, Android, Flutter and React Native app work.', role: 'You own mobile apps: screens, native integration, builds and store readiness.', skills: [], goto: ['/flutter-review', '/kotlin-review'], helpers: ['flutter-reviewer', 'swift-reviewer', 'kotlin-reviewer'] },
  { id: 'ai-engineer', kind: 'advisor', color: 'cyan', description: 'AI engineer ADVISOR (read-only): advises the supervisor on model choice, prompts, RAG and agent design. Never changes project files.', role: 'You advise the supervisor on AI decisions: which model, how to prompt, retrieval design, agent architecture, evaluation.', skills: ['claude-api', 'council', 'architecture-decision-records'], goto: [], helpers: ['architect', 'Explore'] },
  { id: 'data-scientist', kind: 'advisor', color: 'yellow', description: 'Data scientist ADVISOR (read-only): advises the supervisor on data, metrics, analytics, ML and experiments. Never changes project files.', role: 'You advise the supervisor on data decisions: metrics, analysis method, experiments, ML approach.', skills: ['data:statistical-analysis', 'data:explore-data', 'dataviz'], goto: [], helpers: ['Explore'] },
]

const REPORT = (id) => `## REPORT · ${id} · <YYYY-MM-DD HH:MM>
Status:       done | partial | blocked
Job:          <one line>
Changed:      <files, or "none">
Tests:        <what ran, pass/fail, or "none">
Coordination: <who, what was agreed, or "none">
Helpers used: <model ×count (purpose), or "none">
Problems:     <or "none">
Next:         <or "none">`

export function render(s) {
  const isAdvisor = s.kind === 'advisor'
  const lines = ['---', `name: ${s.id}`, `description: ${s.description}`, `model: ${MODEL}`, `color: ${s.color}`, 'memory: user']
  if (isAdvisor) lines.push(`tools: ${ADVISOR_TOOLS}`)
  if (PRELOAD && s.skills.length > 0) lines.push('skills:', ...s.skills.map(k => `  - ${k}`))
  lines.push('---')
  const goTo = [...(PRELOAD ? [] : s.skills), ...s.goto]
  const body = [
    `You are the **${s.id}** ${isAdvisor ? 'advisor' : 'section head'} of section-team. ${s.role}`,
    '',
    'The supervisor sends you jobs. For each job:',
    '1. Read the goal, files, skills to use, definition of done and who to coordinate with.',
    `2. Use the skills and commands the job names${goTo.length > 0 ? `, plus your go-to ones: ${goTo.join(', ')}` : ''}.`,
    `3. Helpers: delegate with the Agent tool and ALWAYS pass \`model\` explicitly — haiku for lookups, file search, formatting and mechanical edits; sonnet for routine code, tests and standard reviews; opus for tricky bugs and design calls; fable${CONSULTANT ? ' (subagent_type `section-team:fable-consultant`)' : ''} as a consultant only for the hardest problems (stuck after 2 attempts, major architecture, security-critical reasoning). If Fable is declined or unavailable, use opus and say so under Problems. Suggested helper types: ${s.helpers.join(', ')}. Tell every helper it must not spawn agents. Check helper output, merge it, and own the result.`,
    `4. ${RELAY} Record every agreement in your REPORT's Coordination line.`,
    isAdvisor
      ? '5. You never change project files and never run shell commands. Write and Edit are only for your memory folder. Your helpers must be read-only types (Explore, Plan, architect).'
      : '5. Follow the project\'s rules. When the job says the testing section owns review, skip a separate full review pass of your own.',
    '6. Use your memory folder to remember this user\'s preferences for your area across projects.',
    '7. Finish with exactly this block, filled in, and nothing after it:',
    '',
    REPORT(s.id),
  ]
  return `${lines.join('\n')}\n${body.join('\n')}\n`
}

const CONSULTANT_FILE = `---
name: fable-consultant
description: Fable consultant for section heads: hardest problems only. Answers questions; does not change files.
model: fable
color: purple
tools: Read, Grep, Glob, WebSearch, WebFetch
---
You are a consultant to a section-team section head. Answer the question you are given as well as you can, with reasoning and a clear recommendation. Do not change files and do not spawn agents.
`

export function renderAll() {
  const files = Object.fromEntries(ROSTER.map(s => [`${s.id}.md`, render(s)]))
  if (CONSULTANT) files['fable-consultant.md'] = CONSULTANT_FILE
  return files
}

function main() {
  const dir = new URL('../agents/', import.meta.url)
  mkdirSync(dir, { recursive: true })
  const isCheck = process.argv.includes('--check')
  let stale = []
  for (const [file, text] of Object.entries(renderAll())) {
    const target = new URL(file, dir)
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null
    if (current === text) continue
    if (isCheck) stale.push(file)
    else writeFileSync(target, text)
  }
  if (isCheck && stale.length > 0) {
    console.log(`stale agent files: ${stale.join(', ')} — run node scripts/gen-agents.mjs`)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
```

- [ ] **Step 4: Generate the files**

Run: `node scripts/gen-agents.mjs && ls agents`
Expected: 12 files (13 with `fable-consultant.md` when `CONSULTANT = true`).

- [ ] **Step 5: Run tests and validate**

Run: `npm test && claude plugin validate --strict .`
Expected: all PASS; validate lists 12 (or 13) agents with no warnings.

- [ ] **Step 6: Commit**

```bash
git add scripts/gen-agents.mjs agents tests/agents.test.mjs
git commit -m "feat: 12 generated section agent files"
```

---

### Task 6: Report saver (SubagentStop)

**Files:**
- Create: `hooks/subagent-stop.mjs`, `tests/subagent-stop.test.mjs`
- Modify: `hooks/hooks.json` (or plugin.json for `split`)

**Interfaces:**
- Consumes: `extractReport`, `sectionIdFromType` (Task 3); `projectRoot`, `writeReport`, `readStdinJson` (Task 3).
- Produces: `finalAgentText(path: string | undefined): string` (the last `SubagentHandback` tool_use `input.message` in the transcript, else the last assistant text), `saveFromEvent(e: object, now?: Date): string | null` (written file path or null). Phase 0: SubagentStop carries no `last_assistant_message` in this build; it is still used first if present.

- [ ] **Step 1: Write the failing test**

`tests/subagent-stop.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { saveFromEvent, finalAgentText } from '../hooks/subagent-stop.mjs'

const SCRIPT = fileURLToPath(new URL('../hooks/subagent-stop.mjs', import.meta.url))
const tempDir = () => {
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'ct-'))), 'with space')
  mkdirSync(dir, { recursive: true })
  return dir
}
const NOW = new Date(2026, 9, 12, 14, 32, 5)
const REPORT = '## REPORT · backend · 2026-10-12 14:32\nStatus: done\nJob: login api\n'

test('saves the REPORT of a team section', () => {
  const dir = tempDir()
  const file = saveFromEvent({ agent_type: 'section-team:backend', cwd: dir, last_assistant_message: `notes\n${REPORT}` }, NOW)
  assert.ok(file.endsWith(join('.team', 'reports', '2026-10-12', '143205-backend.md')))
  assert.equal(readFileSync(file, 'utf8'), REPORT)
})

test('ignores non-team agents, empty types and messages without a REPORT', () => {
  const dir = tempDir()
  assert.equal(saveFromEvent({ agent_type: 'general-purpose', cwd: dir, last_assistant_message: REPORT }, NOW), null)
  assert.equal(saveFromEvent({ agent_type: '', cwd: dir, last_assistant_message: REPORT }, NOW), null)
  assert.equal(saveFromEvent({ agent_type: 'section-team:backend', cwd: dir, last_assistant_message: 'no report here' }, NOW), null)
  assert.equal(existsSync(join(dir, '.team')), false)
})

test('reads the SubagentHandback message from the transcript (no last_assistant_message)', () => {
  const dir = tempDir()
  const transcript = join(dir, 'agent.jsonl')
  writeFileSync(transcript, [
    JSON.stringify({ type: 'user', message: { content: 'job' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'working notes' }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }, { type: 'tool_use', name: 'SubagentHandback', input: { message: `notes\n${REPORT}` } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }),
    '',
  ].join('\n'))
  assert.equal(finalAgentText(transcript), `notes\n${REPORT}`)
  assert.equal(finalAgentText(join(dir, 'missing.jsonl')), '')
  assert.equal(finalAgentText(undefined), '')
  const file = saveFromEvent({ agent_type: 'section-team:backend', cwd: dir, agent_transcript_path: transcript }, NOW)
  assert.equal(readFileSync(file, 'utf8'), REPORT)
})

test('without a handback, the last assistant text is used', () => {
  const dir = tempDir()
  const transcript = join(dir, 'agent.jsonl')
  writeFileSync(transcript, [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: REPORT }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: {} }] } }),
    'not json',
  ].join('\n'))
  assert.equal(finalAgentText(transcript), REPORT)
})

test('hook end to end, and malformed stdin exits 0 silently', () => {
  const dir = tempDir()
  const ok = spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify({ hook_event_name: 'SubagentStop', agent_type: 'section-team:docs', cwd: dir, last_assistant_message: '## REPORT · docs\nStatus: done\n' }), encoding: 'utf8' })
  assert.equal(ok.status, 0)
  assert.equal(ok.stdout, '')
  assert.ok(existsSync(join(dir, '.team', 'reports')))
  for (const input of ['', 'not json', '{}']) {
    const bad = spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8' })
    assert.equal(bad.status, 0)
    assert.equal(bad.stdout, '')
  }
})
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/subagent-stop.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the saver**

`hooks/subagent-stop.mjs`:
```js
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { extractReport, sectionIdFromType } from './lib/report.mjs'
import { projectRoot, readStdinJson, writeReport } from './lib/paths.mjs'

export function finalAgentText(transcriptPath) {
  if (typeof transcriptPath !== 'string' || !existsSync(transcriptPath)) return ''
  const rows = readFileSync(transcriptPath, 'utf8').split(/\r?\n/).filter(Boolean)
  let lastText = ''
  for (let i = rows.length - 1; i >= 0; i--) {
    let row
    try {
      row = JSON.parse(rows[i])
    } catch {
      continue
    }
    if (row.type !== 'assistant' || !Array.isArray(row.message?.content)) continue
    const handback = row.message.content.find(part => part.type === 'tool_use' && part.name === 'SubagentHandback')
    if (typeof handback?.input?.message === 'string') return handback.input.message
    const text = row.message.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    if (lastText === '' && text !== '') lastText = text
  }
  return lastText
}

export function saveFromEvent(e, now = new Date()) {
  const id = sectionIdFromType(e?.agent_type)
  if (!id || typeof e.cwd !== 'string') return null
  const block = extractReport(e.last_assistant_message || finalAgentText(e.agent_transcript_path))
  return block ? writeReport(projectRoot(e.cwd), id, block, now) : null
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  readStdinJson()
    .then(e => saveFromEvent(e))
    .catch(err => process.stderr.write(`section-team subagent-stop: ${err.message}\n`))
}
```

- [ ] **Step 4: Register the hook**

Add to the `"hooks"` object (keep SessionStart):
```json
"SubagentStop": [
  { "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/subagent-stop.mjs\"" }] }
]
```

- [ ] **Step 5: Run tests and validate**

Run: `npm test && claude plugin validate --strict .`
Expected: all PASS; validate clean.

- [ ] **Step 6: Commit**

```bash
git add hooks/subagent-stop.mjs hooks/hooks.json .claude-plugin/plugin.json tests/subagent-stop.test.mjs
git commit -m "feat: save section reports on SubagentStop"
```

---

### Task 7: Advisor read-only guard (PreToolUse)

**Files:**
- Create: `hooks/pre-tool-use.mjs`, `tests/pre-tool-use.test.mjs`
- Modify: `hooks/hooks.json` (or plugin.json for `split`)

**Interfaces:**
- Consumes: `ADVISOR_IDS`, `ADVISOR_HELPERS`, `sectionIdFromType` (Task 3, `ADVISOR_HELPERS` added in Task 5 fix round); D5 `memoryDir` (the guard accepts `<id>`, `*-<id>` and `*:<id>` folder names, which covers every form Phase 0 can observe).
- Produces: `decide(e: object, home?: string): string | null` (deny reason or null), `isInMemory(target, id, cwd, home): boolean`.

- [ ] **Step 1: Write the failing test**

`tests/pre-tool-use.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { decide } from '../hooks/pre-tool-use.mjs'

const SCRIPT = fileURLToPath(new URL('../hooks/pre-tool-use.mjs', import.meta.url))
const HOME = join('C:', 'Users', 'Tester')
const PROJECT = join('C:', 'work', 'my app')
const MEMORY = join(HOME, '.claude', 'agent-memory', 'ai-engineer', 'MEMORY.md')
const ev = (agent_type, tool_name, tool_input = {}) => ({ agent_type, tool_name, tool_input, cwd: PROJECT })

test('builders and the main session are never blocked', () => {
  assert.equal(decide(ev('section-team:backend', 'Bash', { command: 'rm -rf x' }), HOME), null)
  assert.equal(decide(ev(undefined, 'Write', { file_path: 'a.txt' }), HOME), null)
})

test('advisors cannot use shell or notebook tools', () => {
  for (const tool of ['Bash', 'PowerShell', 'NotebookEdit']) assert.match(decide(ev('section-team:ai-engineer', tool), HOME), /read-only/)
})

test('advisors may write only inside their own memory folder', () => {
  assert.equal(decide(ev('section-team:ai-engineer', 'Write', { file_path: MEMORY }), HOME), null)
  assert.equal(decide(ev('section-team:ai-engineer', 'Edit', { file_path: join(HOME, '.claude', 'agent-memory', 'section-team-ai-engineer', 'x.md') }), HOME), null)
  assert.match(decide(ev('section-team:ai-engineer', 'Write', { file_path: join(PROJECT, 'src', 'a.ts') }), HOME), /memory folder/)
  assert.match(decide(ev('section-team:ai-engineer', 'Write', { file_path: join(HOME, '.claude', 'agent-memory', 'data-scientist', 'x.md') }), HOME), /memory folder/)
  assert.match(decide(ev('section-team:data-scientist', 'Edit', { file_path: join(HOME, '.claude', 'agent-memory', '..', 'settings.json') }), HOME), /memory folder/)
  assert.match(decide(ev('section-team:data-scientist', 'Write', {}), HOME), /memory folder/)
})

test('advisors may only spawn read-only helper types', () => {
  assert.equal(decide(ev('section-team:data-scientist', 'Agent', { subagent_type: 'code-explorer' }), HOME), null)
  assert.equal(decide(ev('section-team:data-scientist', 'Agent', { subagent_type: 'planner' }), HOME), null)
  assert.match(decide(ev('section-team:data-scientist', 'Agent', { subagent_type: 'Explore' }), HOME), /read-only helpers/)
  assert.match(decide(ev('section-team:ai-engineer', 'Agent', { subagent_type: 'Plan' }), HOME), /read-only helpers/)
  assert.equal(decide(ev('section-team:ai-engineer', 'Agent', { subagent_type: 'architect' }), HOME), null)
  assert.match(decide(ev('section-team:ai-engineer', 'Agent', { subagent_type: 'general-purpose' }), HOME), /read-only helpers/)
  assert.match(decide(ev('section-team:ai-engineer', 'Agent', {}), HOME), /read-only helpers/)
})

test('hook prints a deny decision, and stays silent otherwise', () => {
  const deny = spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify({ hook_event_name: 'PreToolUse', ...ev('section-team:ai-engineer', 'Bash', { command: 'ls' }) }), encoding: 'utf8' })
  assert.equal(deny.status, 0)
  const out = JSON.parse(deny.stdout)
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse')
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny')
  for (const input of ['', 'not json', JSON.stringify(ev('section-team:backend', 'Bash'))]) {
    const quiet = spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8' })
    assert.equal(quiet.status, 0)
    assert.equal(quiet.stdout, '')
  }
})
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/pre-tool-use.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the guard**

`hooks/pre-tool-use.mjs`:
```js
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ADVISOR_HELPERS, ADVISOR_IDS, sectionIdFromType } from './lib/report.mjs'
import { readStdinJson } from './lib/paths.mjs'

const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'NotebookEdit'])
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit'])
const READ_ONLY_HELPERS = new Set(ADVISOR_HELPERS)

export function isInMemory(target, id, cwd, home) {
  if (typeof target !== 'string' || target === '') return false
  const rel = relative(join(home, '.claude', 'agent-memory'), resolve(cwd ?? '.', target))
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return false
  const folder = rel.split(/[\\/]/)[0]
  return folder === id || folder.endsWith(`-${id}`) || folder.endsWith(`:${id}`)
}

export function decide(e, home = homedir()) {
  const id = sectionIdFromType(e?.agent_type)
  if (!id || !ADVISOR_IDS.includes(id)) return null
  const tool = e.tool_name
  if (SHELL_TOOLS.has(tool)) return `section-team: the ${id} advisor is read-only; ${tool} is not allowed.`
  if (WRITE_TOOLS.has(tool)) {
    return isInMemory(e.tool_input?.file_path, id, e.cwd, home) ? null : `section-team: the ${id} advisor may only write inside its memory folder.`
  }
  if (tool === 'Agent') {
    return READ_ONLY_HELPERS.has(e.tool_input?.subagent_type) ? null : `section-team: the ${id} advisor may only use read-only helpers (${ADVISOR_HELPERS.join(', ')}).`
  }
  return null
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  readStdinJson()
    .then(e => {
      const reason = decide(e)
      if (reason) {
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }))
      }
    })
    .catch(err => process.stderr.write(`section-team pre-tool-use: ${err.message}\n`))
}
```

- [ ] **Step 4: Register the hook**

Add to the `"hooks"` object:
```json
"PreToolUse": [
  { "matcher": "Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell|Agent", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-use.mjs\"" }] }
]
```

- [ ] **Step 5: Run tests and validate**

Run: `npm test && claude plugin validate --strict .`
Expected: all PASS; validate clean.

- [ ] **Step 6: Commit**

```bash
git add hooks/pre-tool-use.mjs hooks/hooks.json .claude-plugin/plugin.json tests/pre-tool-use.test.mjs
git commit -m "feat: read-only guard for advisor sections"
```

---

### Task 8: Team Board (mod pane)

**Files:**
- Create: `hooks/board-model.mjs`, `hooks/board-state.ts`, `types/index.d.ts`, `tests/board-model.test.mjs`, `tests/board.test.tsx`
- Modify: `hooks/register.tsx`, `.claude-plugin/plugin.json` (add `"types"`)

**Interfaces:**
- Consumes: `BUILDER_IDS`, `ADVISOR_IDS`, `sectionIdFromType`, `parseReport` (Task 3); C7 agent-list shape (`id, type, status, description, name?`).
- Produces:
  - `board-model.mjs`: `emptyBoard(): BoardData`, `cardState(agentStatus?: string, reportStatus?: string): CardState`, `cardLine(state, agent?, report?): string`, `boardModel({ agents, reports, request, lastSummary }): BoardData`, `latestReportFiles(entries: { name: string }[]): { byId: Record<string, string>, summary: string | null }`.
  - `board-state.ts`: `board` atom keyed `{ plugin: 'section-team', key: 'board' }`.
  - Pane id `team-board`, command `/team`.

- [ ] **Step 1: Write the failing model test**

`tests/board-model.test.mjs`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boardModel, cardState, latestReportFiles, emptyBoard } from '../hooks/board-model.mjs'

test('agent status and report status map to card states', () => {
  assert.equal(cardState(undefined, undefined), 'asleep')
  assert.equal(cardState('pending'), 'running')
  assert.equal(cardState('running'), 'running')
  assert.equal(cardState('waiting'), 'waiting')
  assert.equal(cardState('idle'), 'waiting')
  assert.equal(cardState('completed', 'done'), 'done')
  assert.equal(cardState('completed', undefined), 'done')
  assert.equal(cardState('completed', 'partial'), 'problem')
  assert.equal(cardState('completed', 'blocked'), 'problem')
  assert.equal(cardState('failed'), 'problem')
  assert.equal(cardState('killed'), 'problem')
})

test('board has 10 builders then 2 advisors and counts states', () => {
  const data = boardModel({
    agents: [
      { id: '1', type: 'section-team:frontend', status: 'running', description: 'login form' },
      { id: '2', type: 'section-team:backend', status: 'completed', description: 'api' },
      { id: '3', type: 'section-team:devops', status: 'failed', description: 'docker' },
      { id: '4', type: 'general-purpose', status: 'running', description: 'helper' },
    ],
    reports: { backend: { status: 'done', job: '/api/login + JWT', helpers: 'sonnet ×2' }, docs: { status: 'done', job: 'readme', helpers: 'none' } },
    request: 'add login',
    lastSummary: '14:02',
  })
  assert.deepEqual(data.cards.map(c => c.kind), [...Array(10).fill('builder'), 'advisor', 'advisor'])
  const card = id => data.cards.find(c => c.id === id)
  assert.equal(card('frontend').line, 'Running · login form')
  assert.equal(card('backend').line, 'Done · /api/login + JWT')
  assert.equal(card('backend').helpers, 'sonnet ×2')
  assert.equal(card('devops').state, 'problem')
  assert.equal(card('docs').line, 'Asleep · last: readme')
  assert.equal(card('docs').helpers, '')
  assert.equal(card('mobile').line, 'Asleep')
  assert.deepEqual(data.counts, { active: 1, done: 1, problem: 1 })
  assert.equal(data.request, 'add login')
})

test('an active agent wins over an older completed one of the same section', () => {
  const data = boardModel({ agents: [
    { id: '1', type: 'section-team:testing', status: 'completed', description: 'old' },
    { id: '2', type: 'section-team:testing', status: 'running', description: 'new' },
  ] })
  assert.equal(data.cards.find(c => c.id === 'testing').line, 'Running · new')
})

test('latest report per section, hyphenated ids and collisions, summary apart', () => {
  const files = latestReportFiles([
    { name: '090000-ai-llm.md' }, { name: '090000-ai-llm-2.md' }, { name: '085959-ai-llm-7.md' },
    { name: '100000-data-scientist.md' }, { name: '110000-supervisor-summary.md' }, { name: '120000-supervisor-summary.md' },
    { name: 'notes.txt' },
  ])
  assert.deepEqual(files.byId, { 'ai-llm': '090000-ai-llm-2.md', 'data-scientist': '100000-data-scientist.md' })
  assert.equal(files.summary, '120000-supervisor-summary.md')
})

test('empty board is all asleep', () => {
  const data = emptyBoard()
  assert.equal(data.cards.length, 12)
  assert.ok(data.cards.every(c => c.state === 'asleep'))
})
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/board-model.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the model**

`hooks/board-model.mjs`:
```js
import { ADVISOR_IDS, BUILDER_IDS, sectionIdFromType } from './lib/report.mjs'

const ACTIVE = new Set(['pending', 'running', 'waiting', 'idle'])

export function cardState(agentStatus, reportStatus) {
  if (agentStatus === 'pending' || agentStatus === 'running') return 'running'
  if (agentStatus === 'waiting' || agentStatus === 'idle') return 'waiting'
  if (agentStatus === 'failed' || agentStatus === 'killed') return 'problem'
  if (agentStatus === 'completed') return reportStatus === 'partial' || reportStatus === 'blocked' ? 'problem' : 'done'
  return 'asleep'
}

export function cardLine(state, agent, report) {
  if (state === 'running') return `Running · ${agent?.description || 'working'}`
  if (state === 'waiting') return `Waiting · ${agent?.description || 'for a reply'}`
  if (state === 'done') return `Done · ${report?.job || 'no report yet'}`
  if (state === 'problem') return `Problem · ${report?.job ? `${report.status}: ${report.job}` : agent?.status ?? 'unknown'}`
  return report?.job ? `Asleep · last: ${report.job}` : 'Asleep'
}

export function boardModel({ agents = [], reports = {}, request = '', lastSummary = '' } = {}) {
  const byId = new Map()
  for (const agent of agents) {
    const id = sectionIdFromType(agent.type)
    if (id) byId.set(id, [...(byId.get(id) ?? []), agent])
  }
  const card = (id, kind) => {
    const list = byId.get(id) ?? []
    const agent = list.find(a => ACTIVE.has(a.status)) ?? list.at(-1)
    const report = reports[id]
    const state = cardState(agent?.status, report?.status)
    const helpers = report?.helpers && report.helpers !== 'none' ? report.helpers : ''
    return { id, kind, state, line: cardLine(state, agent, report), helpers }
  }
  const cards = [...BUILDER_IDS.map(id => card(id, 'builder')), ...ADVISOR_IDS.map(id => card(id, 'advisor'))]
  const count = (...states) => cards.filter(c => states.includes(c.state)).length
  return { request, lastSummary, cards, counts: { active: count('running', 'waiting'), done: count('done'), problem: count('problem') } }
}

export function emptyBoard() {
  return boardModel()
}

export function latestReportFiles(entries) {
  const byId = {}
  const rank = {}
  let summary = null
  for (const { name } of entries) {
    const match = /^(\d{6})-(.+?)(?:-(\d+))?\.md$/.exec(name)
    if (!match) continue
    const [, time, id, n] = match
    if (id === 'supervisor-summary') {
      if (summary === null || name > summary) summary = name
      continue
    }
    const score = Number(time) * 1000 + Number(n ?? 1)
    if (rank[id] === undefined || score > rank[id]) {
      rank[id] = score
      byId[id] = name
    }
  }
  return { byId, summary }
}
```

- [ ] **Step 4: Run the model test**

Run: `node --test tests/board-model.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the state contract and atom**

`types/index.d.ts`:
```ts
export type CardState = 'asleep' | 'running' | 'waiting' | 'done' | 'problem'
export type BoardCard = { id: string; kind: 'builder' | 'advisor'; state: CardState; line: string; helpers: string }
export type BoardData = {
  request: string
  lastSummary: string
  cards: BoardCard[]
  counts: { active: number; done: number; problem: number }
}

declare module 'claude-code' {
  interface PluginState {
    'section-team': { board: BoardData }
  }
}
```

`hooks/board-state.ts`:
```ts
import { atom } from 'claude-code'
import type { BoardData } from '../types'
import { emptyBoard } from './board-model.mjs'

export const board = atom({ plugin: 'section-team', key: 'board' } as const, emptyBoard() as BoardData)
```

Add to `.claude-plugin/plugin.json`: `"types": "./types/index.d.ts"`.

- [ ] **Step 6: Write the failing pane test**

`tests/board.test.tsx`:
```tsx
import { test, expect } from 'claude-code/testing'
import { update } from 'claude-code'
import { board } from '../hooks/board-state.ts'
import { boardModel } from '../hooks/board-model.mjs'

const DATA = boardModel({
  agents: [
    { id: '1', type: 'section-team:frontend', status: 'running', description: 'login form' },
    { id: '2', type: 'section-team:backend', status: 'completed', description: 'api' },
    { id: '3', type: 'section-team:devops', status: 'failed', description: 'docker' },
  ],
  reports: { backend: { status: 'done', job: '/api/login + JWT', helpers: 'sonnet ×2' } },
  request: 'add login',
  lastSummary: '14:02',
})
const PROPS = { title: 'Team Board', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 } }

for (const surface of ['terminal', 'desktop'] as const) {
  test(`board draws every section on ${surface}`, async $ => {
    await update($, board, () => DATA)
    const ui = await $.ui.mount({ plugin: 'section-team', surface, component: 'Pane', requestId: 'team-board', props: PROPS as never })
    expect((await ui.find({ key: 'supervisor' }))?.text).toContain('Task: add login')
    expect((await ui.find({ key: 'card-frontend' }))?.text).toContain('Running · login form')
    expect((await ui.find({ key: 'card-backend' }))?.text).toContain('Done · /api/login + JWT')
    expect((await ui.find({ key: 'card-devops' }))?.text).toContain('Problem')
    expect((await ui.find({ key: 'card-mobile' }))?.text).toContain('Asleep')
    expect((await ui.find({ key: 'card-ai-engineer' }))?.text).toContain('Asleep')
  })
}
```

Run: `claude plugin test .`
Expected: FAIL — no `ui.render` hook for `team-board` yet (mount draws nothing / `find` returns undefined). If `mount` instead rejects on the props shape, copy the exact `Pane: {` props from the types file (`grep -n "Pane: {" .claude-plugin/types/claude-code/index.d.ts`) into `PROPS` and re-run until the failure is the missing hook.

- [ ] **Step 7: Implement the pane, poll, command and auto-open**

`hooks/register.tsx`:
```tsx
import { read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { BoardCard } from '../types'
import { board } from './board-state.ts'
import { boardModel, latestReportFiles } from './board-model.mjs'
import { parseReport, PREFIX } from './lib/report.mjs'

const PANE = 'team-board'
const TITLE = 'Team Board'
const COLOR = { asleep: 'inactive', running: 'suggestion', waiting: 'warning', done: 'success', problem: 'error' } as const
const pad = (n: number) => String(n).padStart(2, '0')
const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

async function findRoot($: EngineInterface): Promise<string> {
  const cwd = await $.session.cwd()
  const result = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd }).catch(() => undefined)
  const common = result?.exitCode === 0 ? result.stdout.trim() : ''
  return /[\\/]\.git$/.test(common) ? common.replace(/[\\/]\.git$/, '') : cwd
}

export const register: Register = on => {
  let stop: (() => void) | undefined
  let root = ''
  let request = ''
  let lastJson = ''
  const cache = new Map<string, { mtimeMs: number; report: ReturnType<typeof parseReport> }>()

  async function readReports($: EngineInterface) {
    const dir = `${root}/.team/reports/${today()}`
    const entries = await $.fs.list(dir).catch(() => [])
    const { byId, summary } = latestReportFiles(entries)
    const reports: Record<string, ReturnType<typeof parseReport>> = {}
    for (const [id, name] of Object.entries(byId)) {
      const entry = entries.find(e => e.name === name)
      const key = `${dir}/${name}`
      const hit = cache.get(key)
      if (hit && hit.mtimeMs === entry?.mtimeMs) {
        reports[id] = hit.report
        continue
      }
      const text = await $.fs.read(key).catch(() => '')
      const report = parseReport(text)
      cache.set(key, { mtimeMs: entry?.mtimeMs ?? 0, report })
      reports[id] = report
    }
    const lastSummary = summary ? `${summary.slice(0, 2)}:${summary.slice(2, 4)}` : ''
    return { reports, lastSummary }
  }

  async function refresh($: EngineInterface) {
    const agents = await $.agent.list()
    const { reports, lastSummary } = await readReports($)
    const next = boardModel({ agents, reports, request, lastSummary })
    const json = JSON.stringify(next)
    if (json === lastJson) return
    lastJson = json
    await update($, board, () => next)
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'team', description: 'Show the section-team Team Board' })
    root = await findRoot($)
    stop?.()
    stop = $.clock.every(1000, () => {
      void refresh($).catch(() => undefined)
    })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    stop?.()
    stop = undefined
    return next(e)
  })

  on('command.run', { command: 'team' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Team Board opened.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (typeof e.subagentType === 'string' && e.subagentType.startsWith(PREFIX)) void $.ui.open({ id: PANE, title: TITLE })
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    const first = e.text.split(/\r?\n/).find(line => line.trim() !== '' && !line.startsWith('/'))
    if (first) request = first.trim().slice(0, 120)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const data = await read($, board)
    const columns = e.props.bodyColumns ?? 80
    const width = Math.max(18, Math.floor(columns / (columns >= 90 ? 3 : 2)) - 1)
    const card = (c: BoardCard) => (
      <Box key={`card-${c.id}`} width={width} flexDirection="column" paddingX={1} borderStyle={c.kind === 'advisor' ? 'dashed' : 'round'} borderColor={COLOR[c.state]}>
        <Text bold color={COLOR[c.state]}>● {c.id}</Text>
        <Text wrap="truncate-end" dimColor={c.state === 'asleep'}>{c.line}</Text>
        {c.helpers !== '' && <Text wrap="truncate-end" dimColor>{c.helpers}</Text>}
      </Box>
    )
    const counts = `${data.counts.active} active · ${data.counts.done} done · ${data.counts.problem} problem`
    return (
      <Box flexDirection="column" gap={1}>
        <Box key="supervisor" flexDirection="column" paddingX={1} borderStyle="double" borderColor="claude">
          <Text bold>Supervisor</Text>
          <Text wrap="truncate-end">{data.request === '' ? 'Waiting for your next request' : `Task: ${data.request}`}</Text>
          <Text dimColor>{data.lastSummary === '' ? counts : `${counts} · last summary ${data.lastSummary}`}</Text>
        </Box>
        <Text dimColor>Sections</Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>{data.cards.filter(c => c.kind === 'builder').map(card)}</Box>
        <Text dimColor>Advisors</Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>{data.cards.filter(c => c.kind === 'advisor').map(card)}</Box>
        <Box key="legend" flexDirection="row" gap={2}>
          <Text color={COLOR.running}>● running</Text>
          <Text color={COLOR.waiting}>● waiting</Text>
          <Text color={COLOR.done}>● done</Text>
          <Text color={COLOR.problem}>● problem</Text>
          <Text color={COLOR.asleep}>● asleep</Text>
        </Box>
      </Box>
    )
  })
}
```

- [ ] **Step 8: Run board test, validate, type-check**

Run: `claude plugin test . && claude plugin validate --strict .`
Expected: 2 board tests PASS; validate clean and lists hooks `session.start, session.end, command.run, agent.spawn, prompt.submit, ui.render` and calls `$.agent.list, $.fs.list, $.fs.read, $.clock.every, $.ui.open, $.command.register, $.process.run, $.session.cwd`. If validate refuses the `.ts`/`.mjs` import specifiers, use the form it names and update `tests/board.test.tsx` the same way.

Then: `tsc -p .` if `.claude-plugin/types/tsconfig.json` exists after a session load; otherwise skip (validate covers loading).

- [ ] **Step 9: Run the whole suite**

Run: `npm test && npm run test:board`
Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add hooks/board-model.mjs hooks/board-state.ts hooks/register.tsx types .claude-plugin/plugin.json tests/board-model.test.mjs tests/board.test.tsx
git commit -m "feat: Team Board pane with live section states"
```

---

### Task 9: Install globally and accept

**Files:**
- Create: `README.md`, `docs/acceptance-2026-10-12.md`
- Modify (outside repo, with the user's approval): `~/.claude/settings.json` (`env.CLAUDE_CODE_PLUGIN_DIRS`)

**Interfaces:**
- Consumes: everything above.
- Produces: the plugin active in every new session; an acceptance record.

- [ ] **Step 1: Ask the user, then add the env entry with a backup**

Ask in chat: "I'll add `CLAUDE_CODE_PLUGIN_DIRS = C:\Users\Asus\claude-team` to your `~/.claude/settings.json` (backup first). OK?" Wait for yes. Then:
```bash
cp ~/.claude/settings.json ~/.claude/settings.json.bak-section-team
node -e '
const fs = require("fs"); const p = require("os").homedir() + "/.claude/settings.json";
const s = JSON.parse(fs.readFileSync(p, "utf8"));
s.env = { ...(s.env ?? {}), CLAUDE_CODE_PLUGIN_DIRS: "C:\\Users\\Asus\\claude-team" };
fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
console.log(JSON.stringify(s.env));'
```
Expected: prints the env object containing `CLAUDE_CODE_PLUGIN_DIRS`.

- [ ] **Step 2: CLI acceptance in a throwaway repo**

```bash
ACC="$(mktemp -d)/section-team acceptance"
mkdir -p "$ACC" && cd "$ACC" && git init -q && git commit -q --allow-empty -m init
claude -p --allowedTools "Agent,SendMessage,Read,Write,Edit,Glob,Grep,Bash(node *),Bash(npm *),Bash(date *),Bash(mkdir *)" \
  "Build a tiny Node project here: an Express-free HTTP server in server.mjs with GET /api/hello returning {msg:'hi'}, a static index.html that fetches it and shows the message, and tests with node:test. Use your sections; the frontend section must get the exact API response shape from the backend section through you. The plan is approved in advance: OK." > acc-output.txt
ls -R .team/reports; cat .git/info/exclude
```
Expected: `.team/reports/<today>/` holds a REPORT file for each woken section (at least backend, frontend, testing) and one `*-supervisor-summary.md`; `.git/info/exclude` contains `.team/`; `git status --porcelain` does not list `.team/`. Relay check: grep the section transcripts for a SendMessage to `main` that the supervisor then forwarded to another section. In `-p` mode sections may run in the foreground and cannot reach `main`; then the expected path is frontend reporting `Status: blocked` and the supervisor resuming it with the answer. Record which path happened. The desktop run (Step 3) must show the relay.

- [ ] **Step 3: Desktop acceptance with the user**

Ask the user to open a **new** Code-tab session in any project folder and walk this checklist with them, recording each result:
1. `/status` → Claude Code ≥ 2.1.289.
2. Ask "Who are you in this session?" → answers as the section-team supervisor (marker loaded). `/context` shows the brief.
3. `/team` → Team Board opens: supervisor card, 10 grey section boxes, 2 dashed advisor boxes.
4. Ask for a change needing 3 builders → a plan appears and no box turns blue before "OK".
5. After "OK" → boxes turn blue within ~2 s, then green with their report line; the summary appears and a summary file exists.
6. If a section uses Fable, a consent prompt appears.
7. `/clear` → ask "Who are you?" again → still supervisor.
8. Disable test: set `"section-team@inline": false` under `enabledPlugins` in `~/.claude/settings.json`, open a new session → normal Claude, no `/team`. Set it back to `true` (or remove the key).

- [ ] **Step 4: Write README and the acceptance record**

`README.md`:
```markdown
# section-team

A personal Claude Code plugin: every session is a **supervisor** that wakes specialist **sections** (Opus 5.5) when a task needs them, saves their reports, and shows a live **Team Board**.

## On / off
- On: `~/.claude/settings.json` → `env.CLAUDE_CODE_PLUGIN_DIRS = C:\Users\Asus\claude-team`. New sessions pick it up.
- Off: set `"section-team@inline": false` under `enabledPlugins`, or remove the env entry. Emergency: `claude --safe-mode`.

## Use
- Just talk to the supervisor. Small tasks it does itself; bigger ones wake sections. 3+ sections → it shows a plan first.
- `/team` opens the Team Board.
- Reports: `.team/reports/<date>/` in each project (kept out of git; create `.team/keep-in-git` to keep them in git).

## Sections
Builders: frontend, backend, database, testing, security, devops, uiux, docs, ai-llm, mobile. Advisors (read-only): ai-engineer, data-scientist.
Edit the roster in `scripts/gen-agents.mjs`, then run `node scripts/gen-agents.mjs`.

## Develop
- `npm test` — hook logic (node:test)
- `npm run test:board` — Team Board (claude plugin test)
- `npm run validate` — plugin validation
- Design: `docs/specs/2026-10-12-claude-team-design.md` · Phase 0: `docs/phase0-results.md`
```

`docs/acceptance-2026-10-12.md`: one row per Step 2 and Step 3 check with pass/fail and notes.

- [ ] **Step 5: Final verification and commit**

Run: `npm test && npm run test:board && npm run validate && git status --short`
Expected: everything PASS; only README and the acceptance record are new.
```bash
git add README.md docs/acceptance-2026-10-12.md
git commit -m "docs: README and acceptance record"
```
