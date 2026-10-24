# section-team v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make section heads work like solo builders. They read and write shared notes, take per-job skills from the supervisor, hand the bulk of the work to cheap helpers, and pass an Opus clean-code gate. The auto-opening Team Board is replaced by a one-line team strip plus a `/chats` dashboard of every open chat.

**Architecture:**
- Agent behaviour lives in generated agent files (`scripts/gen-agents.mjs` → `agents/*.md`) and the supervisor brief (`brief/supervisor.md`).
- UI lives in the Mods module `hooks/register.tsx`, which draws from pure models: `hooks/board-model.mjs` and the new `hooks/sessions-model.mjs`.
- Cross-session status is shared through JSON files under `~/.claude/section-team/sessions/`.

**Tech Stack:**
- Node 26 ESM and `node:test`, with no npm dependencies.
- The Claude Code Mods runtime: `ui.render` on `AbovePrompt` and `Pane`, `turn.start`, `turn.complete`, `$.fs`, `$.env`, `$.session.id()`.
- Tests: `npm test`, `npm run test:board` (`claude plugin test .`), `npm run validate`, `node scripts/gen-agents.mjs --check`.

**Spec:** `docs/specs/2026-10-24-solo-builder-sections-design.md` (mockups: `docs/specs/2026-10-24-mockups.html`)

## Global Constraints
- Windows 11, Git Bash, Node 26, Claude Code 2.1.308. No npm dependencies. The plugin is live in every new session, so every commit must leave all tests green.
- `agents/*.md` are generated: edit `scripts/gen-agents.mjs`, then run `node scripts/gen-agents.mjs`. Never hand-edit `agents/`.
- `brief/supervisor.md` stays under 10,000 characters, and its first line stays `[section-team supervisor]`.
- Section heads keep `model: claude-opus-5-5`. Helpers never pass `model` for section-team agents.
- Quality bar: **overall at least 8 and no item under 6, at most 2 fix rounds**, then `Status: partial`. Clean code wins over cost.
- At most **4** skills per job and at most **1** preloaded core skill per section.
- Notes: `.team/notes/`, owner-written, about 80 lines max each, with `INDEX.md` lines in the form `<file> — <owner section> — <one-line summary> — <date>`.
- No pane opens unless the user asks: `/team`, `/chats`, or the strip's button.
- Status files: `<home>/.claude/section-team/sessions/<session-id>.json`. Local only; they never hold more of the request than its first line, cut to 80 characters.
- Dashboard states: `working` (the main turn is running or any section-team agent is active), `needs-you` (the turn has ended and nothing is running), `idle` (30 minutes with no update). Ended files, and files older than 24 hours, are hidden.
- Conventional commits on `main`, local only, never pushed.

## Review Focus
1. **A corrupt or half-written status file** (another session writing it at that moment): the `/chats` pane skips it and still draws the others. Test in Task 9.
2. **`/clear` mid-session:** the session id changes. The old file must be marked `ended`, and later writes must use the new id. Test in Task 8.
3. **Many awake sections in a narrow window:** the strip names at most 4 sections, then `+N more`, so it fits one line. Test in Task 7.
4. **Two chats in the same project:** both get their own card, told apart by session, with neither overwriting the other. Test in Task 9.
5. **No `USERPROFILE` or `HOME` in the environment:** status writing is skipped silently, and `/chats` explains why instead of failing. Tests in Tasks 8 and 9.

---

### Task 1: Runtime spikes S2 (sibling messages by id) and S3 (Skill tool in helpers)

**Files:**
- Create: `docs/v3-spikes.md`
- Temporary (not committed): a fresh `mktemp -d` git repo with `.claude/agents/spike-*.md`

**Interfaces:**
- Produces: `docs/v3-spikes.md` with two decision lines that later tasks read verbatim:
  - `S2: direct`, or `S2: relay`
  - `S3: skill-tool`, or `S3: inline-rules`

- [ ] **Step 1: Write the spike agents** in the temp repo's `.claude/agents/`:
  - `spike-peer`: Sonnet, tools Read and SendMessage. It replies to whatever it receives with `PEER-GOT:<text>`, then stops.
  - `spike-lead`: Sonnet, tools Agent, SendMessage and Skill. Its job prompt:
    1. SendMessage the agent id it is given with the text `PING-S2`.
    2. Spawn `spike-helper`.
    3. Report both outcomes verbatim.
  - `spike-helper`: Sonnet, tools Read and Skill. It loads the skill `tdd-workflow` with the Skill tool and returns the first heading of the skill text, or the exact error.

- [ ] **Step 2: Run the spike headless.** From the temp repo:

  ```bash
  MSYS_NO_PATHCONV=1 timeout 600 claude -p "<prompt>" --output-format json --allowedTools "Agent,SendMessage,Skill,Read" > spike.json
  ```

  `<prompt>` tells the main session to:
  1. Spawn `spike-peer` in the background and note the agent id it returns.
  2. Spawn `spike-lead` with that id in its prompt.
  3. Print both agents' final texts.

- [ ] **Step 3: Read the results.**
  - S2 passes only if the peer's final text or transcript contains `PEER-GOT:PING-S2` from the lead. A pass from the main session doesn't count.
  - S3 passes only if the helper returned a heading from the `tdd-workflow` SKILL.md.
  - Record the evidence (quoted lines) and the decision lines in `docs/v3-spikes.md`.

- [ ] **Step 4: Commit**

```bash
git add docs/v3-spikes.md
git commit -m "docs: v3 spikes S2 (sibling messages) and S3 (Skill in helpers)"
```

---

### Task 2: Reviewer agent, and the Skill tool for helpers

**Files:**
- Modify: `scripts/gen-agents.mjs` (`HELPER_AGENTS`, new exported `RUBRIC_ITEMS`, `PASS_RULE`)
- Regenerate: `agents/reviewer.md`, `agents/coder.md`, `agents/scout.md`
- Test: `tests/agents.test.mjs`, `tests/report.test.mjs`

**Interfaces:**
- Consumes: the `S3:` line from `docs/v3-spikes.md`.
- Produces:
  - `export const RUBRIC_ITEMS = ['structure', 'naming', 'duplication', 'size', 'errors', 'tests', 'security', 'leftovers']`
  - `export const PASS_RULE = 'Pass: overall at least 8 and no item under 6.'`
  - Agent type `section-team:reviewer`, which ends its answer with a `## GRADE` block:

    ```text
    ## GRADE
    Overall: <n>/10
    Verdict: pass | fail
    <item>: <n> — <one-line reason>   (one line per RUBRIC_ITEMS entry)
    Fixes:
    - <file>:<line> <what to change>   (or "none")
    ```

- [ ] **Step 1: Write the failing tests** in `tests/agents.test.mjs`:

```js
test('reviewer is an Opus read-only grader, not a section', () => {
  const text = agentFile('reviewer')
  const fm = front(text)
  assert.equal(fm.model, 'opus')
  assert.equal(fm.omitClaudeMd, 'true')
  assert.equal(fm.tools, 'Read, Grep, Glob, Bash')
  assert.ok(!ROSTER.some(s => s.id === 'reviewer'))
  for (const item of RUBRIC_ITEMS) assert.ok(text.includes(`${item}:`), `rubric item ${item}`)
  assert.ok(text.includes(PASS_RULE))
  assert.ok(text.includes('## GRADE'))
  assert.ok(text.includes('Grade only the changed lines and the functions around them.'))
  assert.ok(text.includes('Never edit files and never spawn agents.'))
})
```

  Also:
  - Extend `committed files match the generator` to require `reviewer.md`.
  - Add a test in `tests/report.test.mjs` that `sectionIdFromType('section-team:reviewer')` is `null`.
  - If S3 is `skill-tool`, assert that the `scout` and `coder` tools lists include `Skill`. Otherwise assert that they don't.

- [ ] **Step 2: Run them to see them fail**
  - Run: `node --test tests/agents.test.mjs tests/report.test.mjs`
  - Expected: FAIL. `agents/reviewer.md` is missing and `RUBRIC_ITEMS` isn't exported.

- [ ] **Step 3: Implement.** Add the reviewer entry to `HELPER_AGENTS`:
  - `id 'reviewer'`, `model 'opus'`, `color 'red'`, `tools 'Read, Grep, Glob, Bash'`.
  - Description: `"Clean-code grader for section-team: grades changed code against the user's standards and returns a score with a file:line fix list. Never edits."`
  - Body: what to grade (one line per rubric item, carrying the size limits from the house rules); `PASS_RULE`; that Bash only runs tests, linters and coverage; the two sentences the test asserts; and the `## GRADE` template above.

  If S3 is `skill-tool`, append `, Skill` to the `scout` and `coder` tools. Then run `node scripts/gen-agents.mjs`.

- [ ] **Step 4: Run the tests to see them pass**
  - Run: `npm test && node scripts/gen-agents.mjs --check`
  - Expected: all pass, and `--check` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-agents.mjs agents tests/agents.test.mjs tests/report.test.mjs
git commit -m "feat: Opus reviewer agent with clean-code rubric; Skill tool for helpers"
```

---

### Task 3: Section heads become solo builders (notes, parallel helpers, quality gate, core skill)

**Files:**
- Modify: `scripts/gen-agents.mjs` (`ROSTER` gets `core`, a new section body, a new `RELAY` per S2, and the REPORT template)
- Regenerate: `agents/*.md` for all 12 sections
- Test: `tests/agents.test.mjs`

**Interfaces:**
- Consumes:
  - `PASS_RULE` and `section-team:reviewer` (Task 2);
  - the `S2:` line (Task 1).
- Produces:
  - `ROSTER[i].core: string[]` (length ≤ 1). Values:
    - frontend `['frontend-design:frontend-design']`
    - testing `['tdd-workflow']`
    - security `['security-review']`
    - ai-llm `['claude-api']`
    - ai-engineer `['claude-api']`
    - every other section `[]`
  - The frontmatter `skills:` list equals `core`. The former `skills` entries join the go-to mentions.
  - The REPORT template gains this line, between `Tests:` and `Coordination:`:

    ```text
    Quality:      <overall>/10 (reviewer, <n> fix rounds) | n/a (no code)
    ```

- [ ] **Step 1: Write the failing tests.**
  - Replace the old `every builder gets the firm helper rule...` test with one asserting that every builder file contains each of these exact sentences:
    - `` Read `.team/notes/INDEX.md` first, then only the notes your job needs. ``
    - `Plan your part (tasks, files, order) before you hand anything out.`
    - `Hand out independent tasks in parallel, one helper per task, as many as the job needs; skip a helper for anything under about 20 lines.`
    - `` Agent `section-team:reviewer` ``
    - `PASS_RULE`
    - `at most 2 fix rounds`
    - `` If it still fails, finish with `Status: partial` and the grade; never call it done. ``
    - `` Never edit another section's note. ``
    - `Helpers never spawn agents.`
  - Also assert:
    - every section's frontmatter `skills` equals `core`, with at most 1 entry;
    - every REPORT contains `Quality:`;
    - advisors contain `.team/notes/INDEX.md` but not `section-team:reviewer` and not `section-team:coder`;
    - `testing.md` contains `` run the reviewer over every section's changed files `` and `send each owning section its part of the fix list`.
  - If S2 is `direct`:
    - every builder contains `` SendMessage its agent id (the job lists the ids of awake sections) ``;
    - the `main` fallback sentence is still present.

- [ ] **Step 2: Run them to see them fail**
  - Run: `node --test tests/agents.test.mjs`
  - Expected: FAIL on the new sentences.

- [ ] **Step 3: Implement** `render(s, extra)`. Rewrite the numbered job flow as:
  1. Read the notes.
  2. Load the job's skills.
  3. Plan.
  4. Hand out the work: coder and scout rules as today, plus parallel use and the 20-line rule.
  5. Keep for yourself.
  6. Quality gate: the reviewer, `PASS_RULE`, 2 fix rounds, `partial`. Builders only.
  7. Write notes, using the INDEX format from Global Constraints. Builders only.
  8. Coordination: direct or relay, per S2.
  9. The testing final pass, or the skip line, as today.
  10. Memory.
  11. REPORT.

  Advisors keep their read-only step and helper list. Then run `node scripts/gen-agents.mjs`.

- [ ] **Step 4: Run the tests to see them pass**
  - Run: `npm test && node scripts/gen-agents.mjs --check && npm run validate`
  - Expected: all pass, and validate is clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-agents.mjs agents tests/agents.test.mjs
git commit -m "feat: sections work as solo builders with notes, parallel helpers and a clean-code gate"
```

---

### Task 4: REPORT quality grade reaches the board

**Files:**
- Modify: `hooks/lib/report.mjs` (`parseReport`) and `hooks/board-model.mjs` (`cardLine`)
- Test: `tests/report.test.mjs`, `tests/board-model.test.mjs`

**Interfaces:**
- Produces:
  - `parseReport(text)` additionally returns `quality: number | null`, parsed from `Quality:` by the first `\d+(\.\d+)?` before `/10`. `n/a` and a missing line give `null`.
  - `cardLine('done', agent, report)` returns `Done · <job> · <q>/10` when `report.quality !== null`.

- [ ] **Step 1: Write the failing tests:**

```js
test('parseReport reads the reviewer grade', () => {
  assert.equal(parseReport('## REPORT · backend\nStatus: done\nQuality:      8.5/10 (reviewer, 1 fix rounds)\n').quality, 8.5)
  assert.equal(parseReport('## REPORT · docs\nStatus: done\nQuality: n/a (no code)\n').quality, null)
  assert.equal(parseReport('## REPORT · docs\nStatus: done\n').quality, null)
})
```

  Add to `board-model.test.mjs`: `cardLine('done', undefined, { job: 'api', quality: 9 })` equals `'Done · api · 9/10'`.

- [ ] **Step 2: Run them to see them fail**
  - Run: `node --test tests/report.test.mjs tests/board-model.test.mjs`
  - Expected: FAIL (`quality` is undefined).

- [ ] **Step 3: Implement** the two changes above.

- [ ] **Step 4: Run** `npm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hooks/lib/report.mjs hooks/board-model.mjs tests/report.test.mjs tests/board-model.test.mjs
git commit -m "feat: board shows each section's reviewer grade"
```

---

### Task 5: `.team/notes/` exists in every project

**Files:**
- Modify: `hooks/lib/paths.mjs` (new `ensureNotes`), `hooks/session-start.mjs` (call it inside the existing `attempt()` wrapper)
- Test: `tests/paths.test.mjs`, `tests/session-start.test.mjs`

**Interfaces:**
- Produces:
  - `export function ensureNotes(root: string): boolean`. It creates `<root>/.team/notes/INDEX.md` only when missing, and returns `true` when it created the file.
  - The file content is exactly:

    ```text
    # Team notes — one line per note: <file> — <owner section> — <one-line summary> — <date>
    ```

    followed by a newline.

- [ ] **Step 1: Write the failing tests** in `tests/paths.test.mjs`, in a `mkdtemp` root:
  - `ensureNotes` creates the file with the exact header and returns `true`.
  - A second call returns `false` and leaves an edited file untouched.

  In `tests/session-start.test.mjs`, the hook run in a temp git repo leaves `.team/notes/INDEX.md` behind, and still prints the brief when the notes folder can't be created. To force that, make `.team/notes` a regular file first.

- [ ] **Step 2: Run them to see them fail**
  - Run: `node --test tests/paths.test.mjs tests/session-start.test.mjs`
  - Expected: FAIL (`ensureNotes` isn't exported).

- [ ] **Step 3: Implement** `ensureNotes` with `mkdirSync({ recursive: true })`, and `writeFileSync` with flag `wx`, treating `EEXIST` as `false`. Call it from `session-start.mjs` through `attempt()`, next to `ensureExcluded`.

- [ ] **Step 4: Run** `npm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hooks/lib/paths.mjs hooks/session-start.mjs tests/paths.test.mjs tests/session-start.test.mjs
git commit -m "feat: every project gets .team/notes/INDEX.md for section notes"
```

---

### Task 6: Supervisor brief v3

**Files:**
- Modify: `brief/supervisor.md`
- Test: `tests/session-start.test.mjs`

**Interfaces:**
- Consumes: the `S2:` line (Task 1).

- [ ] **Step 1: Write the failing tests.** The injected brief:
  - starts with `[section-team supervisor]`;
  - is under 10,000 characters;
  - contains:
    - `Skills for this job:`
    - `at most 4`
    - `` `.team/notes/` ``
    - `Do not relay anything that belongs in a note.`
    - `` `section-team:reviewer` ``
    - `PASS_RULE` (imported from `scripts/gen-agents.mjs`)
    - `/chats`
    - `/team`
  - does **not** contain `opens automatically`.
  - If S2 is `direct`, it also contains `the agent ids of the sections that are awake`.

- [ ] **Step 2: Run them to see them fail**
  - Run: `node --test tests/session-start.test.mjs`
  - Expected: FAIL.

- [ ] **Step 3: Rewrite the brief:**
  - **Job messages:** each one carries the line `Skills for this job: …`, with at most 4 skills, picked from installed skills and plugins that fit that section and task (read-only skills for advisors). With S2 `direct`, it also lists the agent ids of the sections that are awake.
  - **Notes:**
    - sections read and write `.team/notes/`;
    - `Do not relay anything that belongs in a note.`;
    - relay stays only for wake-ups, `blocked`, and the S2 fallback.
  - **The supervisor's own code:** before saying done, run Agent `section-team:reviewer` on the changed files, apply `PASS_RULE`, and allow at most 2 fix rounds. Docs-only and config-value edits skip this.
  - **Rules that win:** the existing line stays. The reviewer is the one helper type the supervisor may spawn itself.
  - **Team Board section:** the strip above the prompt shows the team; `/team` opens the board; `/chats` opens the dashboard of all chats. Nothing opens by itself.

- [ ] **Step 4: Run** `npm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add brief/supervisor.md tests/session-start.test.mjs
git commit -m "feat: supervisor hands per-job skills, uses notes, gates its own code"
```

---

### Task 7: Team strip replaces the auto-opening board

**Files:**
- Modify: `hooks/board-model.mjs` (new `stripLine`), `hooks/register.tsx`
- Test: `tests/board-model.test.mjs`, `tests/board.test.tsx`

**Interfaces:**
- Consumes: `BoardData` from `boardModel()`.
- Produces: `export function stripLine(data: BoardData): string`, defined by these examples:
  - Nobody awake and `teamLine` empty → `'Team · idle'`.
  - Otherwise: `'Team · '` + up to 4 `'● <id> <state>'` parts for cards whose state isn't `asleep`, joined by `' · '`. Then, when there are more than 4, `' · +N more'`. Then the team tokens and helper count when `teamLine` is set (`' · 48k tokens · 3 helpers'`). Then `' · N asleep'`.

- [ ] **Step 1: Write the failing tests.** In `tests/board-model.test.mjs`:
  - `stripLine(emptyBoard())` equals `'Team · idle'`.
  - With frontend `running` and testing `waiting`, plus usage, the result starts with `'Team · ● frontend running · ● testing waiting'` and ends with `'10 asleep'`.
  - With 6 sections running it contains `'+2 more'` (Review Focus 3).

  In `tests/board.test.tsx`:
  - After `session.start` and a section `agent.spawn`, `seen.opened` equals `[]`.
  - `/team` still opens `team-board`.
  - Mounting `AbovePrompt` (props `{ hasSurvey: false, isWorking: true, maxRows: 10 }` plus what the type requires) finds key `strip` with text `Team ·`.
  - Pressing the button with key `open-board` opens `team-board`.
  - The board pane shows the card for `frontend` (running), has **no** `card-mobile`, and has key `asleep` with text matching `/\d+ asleep/`.
  - Update the existing tests that expected the pane to open by itself. In `board draws every section on <surface>`, replace the `card-mobile` and `card-ai-engineer` "Asleep" expectations with the `asleep` line.

- [ ] **Step 2: Run them to see them fail**
  - Run: `node --test tests/board-model.test.mjs && npm run test:board`
  - Expected: FAIL.

- [ ] **Step 3: Implement.**
  - In `register.tsx`, remove the `ui.open` calls from `session.start` and `agent.spawn`, along with `hasOpened`.
  - Add `on('ui.render', { component: 'AbovePrompt' }, …)`. It returns `next(e)` when `e.props.hasSurvey`, and otherwise renders `<Box key="strip"><Text wrap="truncate-end">{stripLine(data)}</Text><Button key="open-board" label="Board" onPress={() => $.ui.open({ id: PANE, title: TITLE })} /></Box>`.
  - In the Pane render, draw only cards whose state isn't `asleep`, plus `<Text key="asleep" dimColor>{n} asleep</Text>`.

- [ ] **Step 4: Run** `npm test && npm run test:board && npm run validate`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hooks/board-model.mjs hooks/register.tsx tests/board-model.test.mjs tests/board.test.tsx
git commit -m "feat: team strip above the prompt; board opens only on request and folds asleep sections"
```

---

### Task 8: Every session writes its status file

**Files:**
- Create: `hooks/sessions-model.mjs`, `tests/sessions-model.test.mjs`
- Modify: `hooks/register.tsx`, `types/index.d.ts` (export `SessionStatus`)
- Test: `tests/board.test.tsx`

**Interfaces:**
- Produces (in `hooks/sessions-model.mjs`):
  - `export const IDLE_MS = 30 * 60 * 1000`
  - `export const HIDE_MS = 24 * 60 * 60 * 1000`
  - `export function statusDir(home: string): string` returns `<home>/.claude/section-team/sessions`, joined with `/`.
  - `export function sessionState({ turnActive, anyRunning, updatedAt, now }): 'working' | 'needs-you' | 'idle'`. It returns `working` if `turnActive || anyRunning`, else `idle` if `now - updatedAt > IDLE_MS`, else `needs-you`.
  - `export function statusRecord({ sessionId, cwd, request, board, turnActive, startedAt, now, ended = false }): SessionStatus`. The record carries:
    - `sessionId`, `cwd`;
    - `project`: the last path segment of `cwd`;
    - `request`: first line, at most 80 characters;
    - `state`;
    - `sections`: `[{ id, state }]` for cards that aren't asleep;
    - `helpers`;
    - `tokens`: the team total, in raw tokens;
    - `startedAt`, `updatedAt: now`, `ended`.

    `anyRunning` is true when any card is `running` or `waiting`.
- `SessionStatus` is added to `types/index.d.ts` with exactly those fields.
- The module tracks the main turn: `turn.start` with no `agentId` sets `mainTurnId` and `turnActive = true`; `turn.complete` with that `turnId` sets `turnActive = false`.
- Writes:
  - The poll writes the record when its JSON (ignoring `updatedAt`) changes, or 60 s after the last write while the state isn't `idle`.
  - `session.end` writes the record with `ended: true` for `e.sessionId`.
  - After `/clear`, the next write uses the new `$.session.id()`.
- Home is `await $.env.get('USERPROFILE') ?? await $.env.get('HOME')`. With neither set, nothing is written (Review Focus 5).

- [ ] **Step 1: Write the failing tests.** In `tests/sessions-model.test.mjs`:
  - the three `sessionState` cases plus the boundary `now - updatedAt === IDLE_MS` → `needs-you`;
  - `statusRecord` cuts a 200-character, two-line request to the first line and 80 characters;
  - `sections` excludes asleep cards;
  - `project` of `'C:/x/shop-app'` is `'shop-app'`.

  In `tests/board.test.tsx`, add an `fs.write` responder to `world()` recording `{ path, text }` and an `env.get` responder, then check:
  - after `prompt.submit` and `turn.start` with no `agentId`, plus a 1 s tick, a write lands at `C:/Users/u/.claude/section-team/sessions/<id>.json` with `state: 'working'`;
  - after `turn.complete` for that turn and a tick: `state: 'needs-you'`;
  - `session.end` with reason `clear` writes `ended: true` for the old id, and the next write uses the new id (Review Focus 2);
  - with `env.get` answering `undefined`, there are no writes.

- [ ] **Step 2: Run them to see them fail**
  - Run: `node --test tests/sessions-model.test.mjs && npm run test:board`
  - Expected: FAIL.

- [ ] **Step 3: Implement** the model and the `register.tsx` wiring above. Status writing goes in its own function, called from `refresh`, and its failures go to the debug log like other refresh failures.

- [ ] **Step 4: Run** `npm test && npm run test:board && npm run validate`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hooks/sessions-model.mjs hooks/register.tsx types/index.d.ts tests/sessions-model.test.mjs tests/board.test.tsx
git commit -m "feat: each session writes a local status file for the chats dashboard"
```

---

### Task 9: `/chats` dashboard pane

**Files:**
- Modify: `hooks/sessions-model.mjs` (new `dashboardCards`), `hooks/register.tsx`, `types/index.d.ts` (a `chats` atom value)
- Test: `tests/sessions-model.test.mjs`, `tests/board.test.tsx`

**Interfaces:**
- Consumes: `SessionStatus`, `statusDir`, `sessionState`, `HIDE_MS` (Task 8).
- Produces:
  - `export function dashboardCards(records: SessionStatus[], now: number): SessionStatus[]`. It drops `ended` records and those with `now - updatedAt > HIDE_MS`. It recomputes `idle` for records older than `IDLE_MS` whose state is `needs-you`. It sorts `needs-you`, then `working`, then `idle`, each by `updatedAt` descending.
  - Command `chats`, which opens pane id `team-chats` with title `Chats`. The pane draws one Box per record with key `chat-<sessionId>`. The lines are:
    1. `<project>` and a pill reading `needs you`, `working` or `idle`.
    2. The request, or `No request yet`.
    3. The sections as `<id> <state>`, or `no sections awake`, then `· <helpers> helpers`.
    4. `<minutes> min · <formatTokens(tokens)> tokens`.
  - The poll reads the status folder only while the chats pane has been opened in this session. It skips any file whose JSON doesn't parse (Review Focus 1). With no home, the pane shows one line: `Chats need USERPROFILE or HOME to be set.`

- [ ] **Step 1: Write the failing tests.** In `tests/sessions-model.test.mjs`:
  - the sort order across all three states;
  - `ended` and 25-hour-old records are hidden;
  - two records with the same `project` and different `sessionId` both stay (Review Focus 4).

  In `tests/board.test.tsx`:
  - `/chats` opens `team-chats` and returns `{ text: 'Chats opened.' }`;
  - with `fs.list` returning two good files and one containing `{"sessionId":` (cut off), the mounted pane has two `chat-*` keys, with the `needs-you` card first;
  - with no home, the pane text is the exact line above.

- [ ] **Step 2: Run them to see them fail**
  - Run: `node --test tests/sessions-model.test.mjs && npm run test:board`
  - Expected: FAIL.

- [ ] **Step 3: Implement** `dashboardCards`, the `chats` command, the atom, and the Pane render with the colours from `COLOR`: `needs-you` uses `warning`, `working` uses `suggestion`, and `idle` uses `inactive`.

- [ ] **Step 4: Run** `npm test && npm run test:board && npm run validate`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hooks/sessions-model.mjs hooks/register.tsx types/index.d.ts tests/sessions-model.test.mjs tests/board.test.tsx
git commit -m "feat: /chats dashboard with one card per open chat"
```

---

### Task 10: Benchmark per-agent model split

**Files:**
- Modify: `bench/score.mjs` (new export `agentModelSplit`; summary rows gain `split`), `bench/aggregate.mjs` (table column `opusSharePct`)
- Create: `bench/score.test.mjs`

**Interfaces:**
- Produces:
  - `export function agentModelSplit(messages: object[]): Record<string, Record<string, { input: number, output: number }>>`. The keys are a role (`main`, or the `subagent_type` of the `Agent`/`Task` tool_use whose id equals the message's `parent_tool_use_id`, or `unknown`) and then the short model name (`shortModel` from `hooks/board-model.mjs`).
  - Input counts `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` from `message.usage`.
  - `opusSharePct` in the aggregate table is the opus `costUSD` from `modelUsage` divided by the run's total `costUSD`, averaged and rounded to 0.1.

- [ ] **Step 1: Write the failing test** in `bench/score.test.mjs`. It uses a 4-message fixture:
  - a main Opus assistant message with a `tool_use` Agent call, `subagent_type: 'section-team:backend'`, id `t1`;
  - a nested message with `parent_tool_use_id: 't1'`, model `claude-sonnet-5-5`, and usage `{ input_tokens: 10, output_tokens: 5 }`.

  The test asserts `split['section-team:backend'].sonnet` deep-equals `{ input: 10, output: 5 }`, and that `split.main.opus` exists.

- [ ] **Step 2: Run it to see it fail**
  - Run: `node --test bench/score.test.mjs`
  - Expected: FAIL (`agentModelSplit` isn't exported).

- [ ] **Step 3: Implement.** Call `agentModelSplit` from `parseTranscript`, add `split` to `summary.json`, and add `opusSharePct` to `aggregate.mjs`'s `cols` and table.

- [ ] **Step 4: Run** `node --test bench/*.test.mjs`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add bench/score.mjs bench/aggregate.mjs bench/score.test.mjs
git commit -m "bench: per-agent model split and Opus share in the report"
```

---

### Task 11: Docs, live check, and benchmark round 3

**Files:**
- Modify: `README.md`, `docs/specs/2026-10-24-solo-builder-sections-design.md` (Status: implemented), `docs/benchmark-2026-10-24.md` (Round 3 section)

- [ ] **Step 1: Docs.**
  - README: the Sections paragraph explains the solo-builder flow, notes, per-job skills and the reviewer gate. The Team Board paragraph covers the strip, `/team` and `/chats`.
  - Set the design's Status line to `implemented (see docs/plans/2026-10-24-section-team-v3-plan.md)`.

- [ ] **Step 2: Full verification.**
  - Run: `npm test && npm run test:board && npm run validate && node scripts/gen-agents.mjs --check && node --test bench/*.test.mjs`
  - Expected: all green.

- [ ] **Step 3: Live check** in a fresh desktop session, in `C:\Users\Asus\Downloads\team-test`. Confirm by screenshot or by the user:
  - the strip shows `Team · idle`;
  - no pane opens;
  - the `Board` button and `/team` open the board;
  - `/chats` shows this chat's card.

  If the band doesn't draw on the desktop surface, add the fallback: `$.ui.status(stripLine(data))` on each board change. Then repeat Steps 2–3.

- [ ] **Step 4: Round 3.** Run, in order:

  ```bash
  node bench/run.mjs --tag=v3 --conds=team
  node bench/score.mjs
  node bench/anonymize.mjs --round=v3 --conds=solo,team-v2,team-v3
  ```

  Then the blind-judging workflow, using the same script as round 2 with `bench-judge-v3`, saving `results/judge-v3.json`. Then:

  ```bash
  node bench/aggregate.mjs --round=v3
  ```

  Pass rules from the spec's Done means:
  - judge quality at least team-v2's, within 0.5;
  - cost reported, with the gate's share explained;
  - Opus share reported;
  - every REPORT carries `Quality:`.

  On a miss, make one tuning change and one rerun at most.

- [ ] **Step 5: Write the round-3 section** in `docs/benchmark-2026-10-24.md` (same tables as round 2, plus `opusSharePct` and the per-agent split), then commit:

```bash
git add README.md docs/specs/2026-10-24-solo-builder-sections-design.md docs/benchmark-2026-10-24.md
git commit -m "docs: v3 README, design status and benchmark round 3"
```
