import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ROSTER, RELAY, render, renderAll, renderHelper, HELPER_AGENTS, RUBRIC_ITEMS, PASS_RULE } from '../scripts/gen-agents.mjs'
import { BUILDER_IDS, ADVISOR_IDS, ADVISOR_HELPERS } from '../hooks/lib/report.mjs'

const GEN = fileURLToPath(new URL('../scripts/gen-agents.mjs', import.meta.url))
const AGENTS = new URL('../agents/', import.meta.url)
const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan']
const agentFile = id => readFileSync(new URL(`${id}.md`, AGENTS), 'utf8')
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
    // Every section head runs on Opus: benchmark rounds 4–6 showed Sonnet heads land at solo quality even with the Opus gate.
    assert.equal(fm.model, 'claude-opus-5-5', `${file} model`)
    assert.equal(fm.memory, 'local', `${file} memory`)
    assert.ok(COLORS.includes(fm.color), `${file} colour ${fm.color}`)
    assert.ok(text.includes('## REPORT · '), `${file} has no REPORT template`)
    assert.ok(text.includes('pass `model` explicitly'), `${file} has no model routing`)
  }
})

test('advisors cannot use shell tools, and their allowlist is unchanged', () => {
  for (const id of ADVISOR_IDS) {
    const { tools } = front(agentFile(id))
    assert.equal(tools, 'Read, Grep, Glob, WebSearch, WebFetch, Skill, SendMessage, Agent, Write, Edit', id)
    for (const banned of ['Bash', 'PowerShell', 'NotebookEdit']) assert.ok(!tools.includes(banned), `${id} has ${banned}`)
  }
})

const BUILDER_TOOLS = 'Read, Write, Edit, Grep, Glob, Bash, PowerShell, Skill, Agent, SendMessage, ToolSearch, Monitor, TaskStop, WebFetch, WebSearch'
const BROWSER_TOOLS = 'mcp__Claude_Browser__*, mcp__chrome-devtools__*, mcp__claude-in-chrome__*, mcp__playwright__*'
const BROWSER_HEADS = ['frontend', 'testing', 'uiux', 'ai-llm']

test('every builder has the base tool list, and only four have browser entries', () => {
  for (const id of BUILDER_IDS) {
    const { tools } = front(agentFile(id))
    assert.equal(tools, BROWSER_HEADS.includes(id) ? `${BUILDER_TOOLS}, ${BROWSER_TOOLS}` : BUILDER_TOOLS, id)
  }
})

test('helpers keep their tools', () => {
  assert.equal(front(agentFile('scout')).tools, 'Read, Grep, Glob, Skill')
  assert.equal(front(agentFile('coder')).tools, 'Read, Write, Edit, Bash, PowerShell, Grep, Glob, Skill')
  assert.equal(front(agentFile('reviewer')).tools, 'Read, Grep, Glob, Bash')
})

const SHORT_OUTPUT = 'Keep tool output short: use a quiet test reporter, pipe long output through `tail`, and never print a whole log. Everything you read is re-sent on every later turn.'

test('builders and the coder keep tool output short; advisors, scout and reviewer do not carry the line', () => {
  for (const id of [...BUILDER_IDS, 'coder']) assert.ok(agentFile(id).includes(SHORT_OUTPUT), id)
  for (const id of [...ADVISOR_IDS, 'scout', 'reviewer']) assert.ok(!agentFile(id).includes(SHORT_OUTPUT), id)
})

test('sections ask a sibling only while it works, ask main once it has handed back, and never wake a section', () => {
  const sentence = 'Ask a sibling a question only while it is working; if it has handed back, ask `main`. Never wake a section yourself.'
  assert.ok(RELAY.includes(sentence))
  for (const s of ROSTER) assert.ok(agentFile(s.id).includes(sentence), s.id)
})

test('no builder keeps the old sibling sentence, and only the security section has the review exception', () => {
  const exception = "do not review other sections' work. The security pass the job assigns is the exception. You still run your own reviewer gate before you finish."
  for (const id of BUILDER_IDS) {
    assert.ok(!agentFile(id).includes('Message a sibling only while it is working'), id)
    assert.equal(agentFile(id).includes(exception), id === 'security', id)
  }
})

test('testing goes through the supervisor only when a direct fix list is refused or fails', () => {
  const testing = agentFile('testing')
  assert.ok(testing.includes('(by agent id; if that is refused or fails, through the supervisor)'))
  assert.ok(!testing.includes('(by agent id, else through the supervisor)'))
})

test('builders learn they have no project MCP tools, right after the short-output line; nobody else carries it', () => {
  const line = 'Your tools include no project MCP servers (a database console, a cloud API): for one of those, use its CLI through Bash, or ask `main` to run the call.'
  for (const id of BUILDER_IDS) assert.ok(agentFile(id).includes(`${SHORT_OUTPUT}\n${line}`), id)
  for (const id of [...ADVISOR_IDS, 'scout', 'coder', 'reviewer']) assert.ok(!agentFile(id).includes(line), id)
})

test('builders treat the approved foundation note as frozen; advisors write no notes', () => {
  const line = '   - `.team/notes/foundation.md` is frozen once the user has approved it: build to it and never edit it. If it must change, ask `main`.'
  for (const id of BUILDER_IDS) assert.ok(agentFile(id).split('\n').includes(line), id)
  for (const id of ADVISOR_IDS) assert.ok(!agentFile(id).includes(line), id)
})

test('committed files match the generator', () => {
  const result = spawnSync(process.execPath, [GEN, '--check'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const all = renderAll()
  for (const file of ['scout.md', 'coder.md', 'reviewer.md']) assert.ok(file in all, `${file} is not generated`)
  for (const [file, text] of Object.entries(all)) assert.equal(readFileSync(new URL(file, AGENTS), 'utf8'), text)
})

test('advisor helpers are the read-only types, and no advisor file names Explore or Plan', () => {
  assert.deepEqual(ADVISOR_HELPERS, ['section-team:scout', 'architect', 'planner', 'code-explorer'])
  for (const s of ROSTER.filter(r => r.kind === 'advisor')) {
    for (const helper of s.helpers) assert.ok(ADVISOR_HELPERS.includes(helper), `${s.id} helper ${helper} is not read-only`)
    const file = readFileSync(new URL(`${s.id}.md`, AGENTS), 'utf8')
    assert.doesNotMatch(file, /\b(Explore|Plan)\b/, `${s.id}.md names a shell-capable helper`)
  }
})

test('no section preloads council, whose untyped subagents the advisor guard denies', () => {
  for (const s of ROSTER) {
    assert.ok(!s.skills.includes('council'), `${s.id} preloads council`)
    assert.doesNotMatch(readFileSync(new URL(`${s.id}.md`, AGENTS), 'utf8'), /^\s*- council\s*$/m, `${s.id}.md preloads council`)
  }
})

test('testing owns the final review; other builders keep the separate-review line', () => {
  const testing = readFileSync(new URL('testing.md', AGENTS), 'utf8')
  assert.ok(testing.includes('you own the final review'), 'testing.md does not own the final review')
  assert.ok(!testing.includes('skip a separate full review pass'), 'testing.md still tells testing to skip its review')
  const frontend = readFileSync(new URL('frontend.md', AGENTS), 'utf8')
  assert.ok(frontend.includes("do not review other sections' work; you still run your own reviewer gate before you finish"), 'frontend.md lost the review-split line')
  assert.ok(!frontend.includes('skip a separate full review pass'), 'frontend.md still has the ambiguous skip line')
})

test('every section head skips the global CLAUDE.md, carries the house rules and knows the scout; builders also know the coder', () => {
  for (const s of ROSTER) {
    const text = agentFile(s.id)
    assert.equal(front(text).omitClaudeMd, 'true', `${s.id} omitClaudeMd`)
    assert.ok(text.includes('Project rules: read and follow whichever of these exist in the project: CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md, AGENTS.md, .claude/rules/*.md, plus any files they @-import; in a monorepo also the CLAUDE.md/AGENTS.md of parent folders up to the repo root.'), `${s.id} project rules`)
    assert.ok(text.includes("House rules (the user's standards):"), `${s.id} house rules`)
    assert.ok(text.includes('section-team:scout'), `${s.id} scout`)
    if (s.kind === 'builder') assert.ok(text.includes('section-team:coder'), `${s.id} coder`)
    else assert.ok(!text.includes('section-team:coder'), `${s.id} must not get the coder`)
  }
})

const frontSkills = text => {
  const lines = text.split('---')[1].split('\n')
  const at = lines.findIndex(l => l.startsWith('skills:'))
  if (at < 0) return []
  return lines.slice(at + 1).filter(l => l.startsWith('  - ')).map(l => l.slice(4).trim())
}

test('every builder gets the solo-builder job flow: notes, plan, parallel helpers, reviewer gate, owner-only notes', () => {
  const sentences = [
    'Read `.team/notes/INDEX.md` first, then only the notes your job needs.',
    'Plan your part (tasks, files, order) before you hand anything out.',
    'Hand out independent tasks in parallel, one helper per task, as many as the job needs; skip a helper for anything under about 20 lines.',
    'If your job touches more than 2 files or needs tests, use at least one helper; skip a helper only for a single piece under about 20 lines.',
    'Agent `section-team:reviewer`',
    PASS_RULE,
    'at most 2 fix rounds',
    'If it still fails, finish with `Status: partial` and the grade; never call it done.',
    'To grade again, start a new foreground reviewer call. Never SendMessage a helper: that resumes it in the background, and a section waiting on it is made to hand back unfinished.',
    'A pass ends the gate: apply its fixes of a few lines if you like (a doc sentence the code contradicts is always corrected), rerun the tests, and do not grade again. List every larger fix under Next in your REPORT instead of doing it: larger work is a new job, and the supervisor decides.',
    "Before your first grade, walk your code once: every call that can fail handles the error, every outside input is validated (replies from the project's own server only as far as the spec states; no input the spec accepts is refused), every stored value and every wait on something outside follows the house rules, every spec line has a test. A fix after the gate costs far more than care now.",
    'If the job says another section writes the tests (the testing section in multi-area work), tell the reviewer so: it then scores tests as n/a and leaves them out of the overall.',
    "Never edit another section's note.",
    'Helpers never spawn agents.',
    "Once all the code is in (yours and your helpers'), send your changed files to Agent `section-team:reviewer`",
    'If another section will depend on a contract you decide here (an API, a schema, design tokens), write its note now, before you hand out work; update it at step 7 if it changed.',
  ]
  for (const id of BUILDER_IDS) {
    const text = agentFile(id)
    for (const sentence of sentences) assert.ok(text.includes(sentence), `${id} lacks: ${sentence}`)
    assert.ok(text.includes('\n7. Write notes for anything other sections depend on'), `${id}: step 7 is no longer the notes step the plan step points to`)
    assert.ok(!text.includes("Once your helpers' code is in"), `${id} still gates only the helpers' code`)
    assert.ok(!text.includes('A later job that changes code gets its own grade.'), `${id} keeps the old after-a-pass line`)
    assert.ok(text.indexOf('Before your first grade') < text.indexOf("send your changed files to Agent `section-team:reviewer`"), `${id} walks its code after the grade`)
  }
  for (const id of ADVISOR_IDS) assert.ok(!agentFile(id).includes('write its note now'), `${id} is read-only and writes no notes`)
  for (const id of [...ADVISOR_IDS, 'scout', 'coder', 'reviewer']) assert.ok(!agentFile(id).includes('Before your first grade'), `${id} has no gate to run`)
})

test('house rules carry the friendly-errors rule; the reviewer fails a user-triggerable stack trace; testing probes I/O and startup failures', () => {
  for (const id of [...BUILDER_IDS, ...ADVISOR_IDS, 'coder']) assert.ok(agentFile(id).includes('handle errors explicitly and never swallow them; user-facing errors stay friendly and leak nothing (one line, no stack trace);'), `${id} friendly errors`)
  const reviewer = agentFile('reviewer')
  assert.ok(reviewer.includes('List at most 5 fixes, most important first. On a pass, list only what breaks a stated requirement or crashes, and any doc sentence the code does not keep (correct the sentence unless the spec states it).\n\nEnd your answer with exactly this block, filled in:'), 'reviewer fix-list cap')
  assert.ok(reviewer.includes('user-facing errors stay friendly and leak nothing'), 'reviewer errors item')
  assert.ok(reviewer.includes('Rethrowing to the runtime is not handling: a stack trace a user can trigger (a bad env value, a data path that is a directory, a missing parent folder, a port in use) scores errors under 6.'), 'reviewer stack-trace threshold')
  assert.ok(agentFile('testing').includes('Also probe filesystem and startup failures: the data path is a directory, its parent folder is missing, the port is already in use. For each, assert the exact exit code and a single stderr line with no stack trace.'), 'testing I/O probes')
})

test('every section may search the skills directory read-only and suggest, never install', () => {
  for (const id of [...BUILDER_IDS, ...ADVISOR_IDS]) {
    const text = agentFile(id)
    assert.ok(text.includes('search the open skills directory read-only: WebFetch `https://skills.sh/api/search?q=<words>`'), `${id} search`)
    assert.ok(text.includes('Never run `npx skills` and never install anything.'), `${id} no install`)
    assert.ok(text.includes('`Suggested skill: <id> (<installs> installs) — <why>`'), `${id} suggestion format`)
  }
})

test('step 2 loads only the skills the job names; go-to skills are listed by name, only for when the list lacks one', () => {
  for (const s of ROSTER) {
    const text = agentFile(s.id)
    const step = text.split('\n').find(l => l.startsWith('2. '))
    assert.ok(step.startsWith('2. Read the goal, files, skills to use, definition of done, who to coordinate with and the ids of the awake sections. Load the skills the job names with the Skill tool'), `${s.id} step 2: ${step}`)
    assert.ok(!text.includes('plus your go-to ones'), `${s.id} still says "plus your go-to ones"`)
    const goTo = [...s.skills.filter(k => !s.core.includes(k)), ...s.goto] // roster-extra.json assignments (add-skill) follow these
    if (goTo.length === 0) continue
    const list = step.slice(step.indexOf('Go-to skills'))
    assert.ok(list.startsWith(`Go-to skills, only when the job needs one its list lacks: ${goTo.join(', ')}`), `${s.id} go-to list: ${step}`)
    assert.ok(list.endsWith('.'), `${s.id} go-to list is the last sentence of step 2`)
    assert.ok(!/(^|[ ,])\/[\w-]/.test(list), `${s.id} go-to entry still has a leading slash: ${step}`)
    if (s.core.length > 0) assert.ok(step.includes(`(${s.core[0]} is already loaded)`), `${s.id} core note`)
  }
})

test('helper hand-out keeps the model rules and tells helpers which skills to load', () => {
  for (const id of BUILDER_IDS) {
    const text = agentFile(id)
    assert.ok(text.includes('(Haiku; do not pass `model`)'), `${id} scout model`)
    assert.ok(text.includes('(Sonnet; do not pass `model`)'), `${id} coder model`)
    assert.ok(text.includes('(Opus; do not pass `model`)'), `${id} reviewer model`)
    assert.ok(text.includes('If a helper cannot load a named skill, put the few rules that matter into its brief.'), `${id} skill fallback`)
  }
  for (const id of [...BUILDER_IDS, ...ADVISOR_IDS]) {
    const text = agentFile(id)
    assert.ok(text.includes('with `run_in_background: false`'), `${id} foreground helpers`)
    assert.ok(text.includes('Never end your turn while a helper runs'), `${id} no idle turn`)
    assert.ok(text.includes('If your Agent tool has no such option, helpers run in the background: keep working while they run, and hand back only after all their results are in.'), `${id} no-option fallback`)
    if (BUILDER_IDS.includes(id)) assert.ok(text.includes('Agent `section-team:reviewer` with `run_in_background: false`') || text.includes('Agent `section-team:reviewer`, with `run_in_background: false`'), `${id} foreground reviewer`)
  }
})

test('S2 direct: builders message a sibling by agent id and keep the supervisor as fallback', () => {
  for (const id of BUILDER_IDS) {
    const text = agentFile(id)
    assert.ok(text.includes('SendMessage its agent id (the job lists the ids of awake sections)'), `${id} direct message`)
    assert.ok(text.includes('SendMessage the supervisor (`main`)'), `${id} main fallback`)
    assert.ok(text.includes('finish with `Status: blocked`'), `${id} blocked fallback`)
    assert.ok(text.includes('Waiting on unfinished work from another section is also `Status: blocked`, not `partial`.'), `${id} waiting is blocked`)
  }
})

test('a forwarded question is answered to the asker directly, not back through the supervisor', () => {
  for (const id of BUILDER_IDS) {
    const text = agentFile(id)
    assert.ok(text.includes("reply to the asker's agent id"), `${id} replies to the asker`)
    assert.ok(text.includes("reply with the note's name"), `${id} answers a contract with its note`)
    assert.ok(!text.includes('reply to the sender'), `${id} still replies to the sender`)
  }
  for (const s of ROSTER) assert.ok(!agentFile(s.id).includes('passes the answer back'), `${s.id} still relays the answer`)
})

test('each section preloads at most one core skill and the rest become go-to mentions', () => {
  const CORE = { frontend: ['frontend-design:frontend-design'], testing: ['tdd-workflow'], 'ai-llm': ['claude-api'], 'ai-engineer': ['claude-api'], uiux: ['web-design-guidelines'] }
  for (const s of ROSTER) {
    assert.ok(s.core.length <= 1, `${s.id} preloads more than one skill`)
    assert.deepEqual(s.core, CORE[s.id] ?? [], `${s.id} core`)
    const text = agentFile(s.id)
    assert.deepEqual(frontSkills(text), s.core, `${s.id} frontmatter skills`)
    for (const skill of s.skills.filter(k => !s.core.includes(k))) assert.ok(text.includes(skill), `${s.id} lost go-to ${skill}`)
  }
})

// The CLI's bundled security-review runs `git log origin/HEAD...` as it loads, so a preload kills the section's start
// in a project with no origin remote (both Max runs of the 2026-11-09 p1 round).
test('no section preloads a skill that needs a git origin remote; security loads it only when one exists', () => {
  const NEEDS_REMOTE = ['security-review']
  for (const s of ROSTER) {
    for (const skill of NEEDS_REMOTE) assert.ok(!frontSkills(agentFile(s.id)).includes(skill), `${s.id} preloads ${skill}`)
  }
  for (const id of BUILDER_IDS) assert.ok(agentFile(id).includes('load security-review, or name it to a helper, only when `git merge-base HEAD origin/HEAD` succeeds, because it fails to load otherwise.'), `${id} guards security-review`)
  assert.ok(agentFile('security').includes('When security-review cannot load (step 2), review the changed files directly.'))
})

// The 2026-11-09 p1 round: builders and the reviewer cited "validate input at boundaries" for a type check on the
// project's own server replies that the spec never asked for, and lost a hidden test.
test('the boundary rule is bounded by the spec in the house rules, the coder and the reviewer', () => {
  const HOUSE = "validate outside input at boundaries (never replies from the project's own server beyond what the spec states; never refuse input the spec accepts, and add no step the spec does not state, such as stripping a BOM, trimming or case-folding, that lets through input its steps reject)"
  for (const id of [...BUILDER_IDS, 'coder']) assert.ok(agentFile(id).includes(HOUSE), `${id} bounded boundary rule`)
  const reviewer = agentFile('reviewer')
  assert.ok(reviewer.includes("outside input (requests, files, env, outside services) validated at boundaries, including every check the spec states; a type check on the project's own server's replies beyond what the spec states, or a refusal of input the spec accepts, is a fix to remove, and so is a step the spec does not state (a stripped BOM, a trim, a case-fold) that lets through input its steps reject; so is a size cap that adds a failure where the spec lists when something fails; a stored value its store allows that makes a read fail is a fix; user-facing errors stay friendly"))
  assert.ok(agentFile('testing').includes('When a job asks for it, hand back one command that starts the app, prints one PASS or FAIL line per critical flow, then stops the app and exits non-zero on any FAIL.'))
  for (const id of [...BUILDER_IDS, 'coder', 'reviewer']) assert.ok(!/(?<!outside )input (is )?validated at boundaries|validate input at boundaries/.test(agentFile(id)), `${id} keeps an unbounded boundary rule`)
})

// The 2026-11-09 p1 round: ids above 2^53 failed reads, and requests trusted data read before an outside wait.
test('the house rules cover data other tools write and data read before an outside wait, in every section and the coder', () => {
  const STORED = " data other tools can write (a shared database, a file) may hold any value its store allows: read and reply with every such value without failing or dropping it (in JavaScript, read integer columns that can pass 2^53, such as ids, as BigInt); a request that reads data, waits on an outside call that changes nothing outside (a model, a lookup) and then writes or replies from that data reads the data and the user's access again in the transaction that writes: if it is gone, it replies as the spec says for a missing one; if what it sent changed and the request writes, the old answer is not used (its write would land after the change, so no one-at-a-time order fits): that attempt counts as failed and the next one sends the fresh data, within the spec's attempt limit (else a small fixed bound), and when attempts run out the reply is the spec's reply for a failed call; a call with its own effect (a payment, an email) is never repeated; a time limit the spec sets on an outside call is enforced twice: a timer that aborts the call, and the elapsed time (performance.now() since the attempt began) checked again when the reply completes;"
  for (const id of [...BUILDER_IDS, ...ADVISOR_IDS, 'coder']) assert.ok(agentFile(id).includes(`lets through input its steps reject);${STORED} handle errors explicitly`), `${id} stored values and outside waits`)
})

test('the reviewer rubric fails an unstated size cap, a failing read of a stored value, a test against the spec and trust across an outside wait', () => {
  const reviewer = agentFile('reviewer')
  assert.ok(reviewer.includes('\n- tests: new behaviour has tests, written first, and coverage is about 80% or better; each requirement has a test that a plausible wrong implementation would fail (NFD instead of NFKD, trim instead of trimEnd, < instead of <=), not only the spec examples. A test that asserts behaviour a spec line contradicts is a fix, and so is a test that needs git history or .team/ (a source export or a shallow clone has neither): keep what it needs, such as a data file an older version made, as a fixture file in the test folder.\n'), 'tests item')
  assert.ok(reviewer.includes('\n- security: no hardcoded secrets, no injection or unsafe handling of user input, and nothing checked before an outside wait (a model or network call) and trusted after it: the code that writes or replies reads it again.\n'), 'security item')
})

test('builders keep at most 5 short lines above the REPORT and put long output in a details file; advisors keep the plain last step', () => {
  for (const id of BUILDER_IDS) {
    const step = `Above the block write at most 5 short lines. Put longer output (probe logs, spec readings, flow output) in \`.team/reports/<YYYY-MM-DD>/<HHMMSS>-${id}-details.md\` and name it on the Next line; it is not a changed file, so keep it off the Changed line. Keep the verdict, a command the job asked for and one short line per optional finding in the block. Finish with exactly this block, filled in, and nothing after it:\n\n## REPORT · ${id} · `
    assert.ok(agentFile(id).includes(`. ${step}`), `${id} short hand-back`)
  }
  for (const id of ADVISOR_IDS) {
    const text = agentFile(id)
    assert.ok(text.includes(`. Finish with exactly this block, filled in, and nothing after it:\n\n## REPORT · ${id} · `), `${id} plain last step`)
    assert.ok(!text.includes('Above the block write'), `${id} has no details-file step`)
  }
})

test('every REPORT has a Quality line between Tests and Coordination', () => {
  for (const s of ROSTER) {
    const text = agentFile(s.id)
    assert.match(text, /^Tests: .*\nQuality:      <overall>\/10 \(reviewer, <n> fix rounds\) \| n\/a \(no code\)\nCoordination: /m, `${s.id} Quality line`)
  }
})

test('every REPORT template offers the ungraded status', () => {
  // The Job line pins the template's column alignment: an edit to the Status line once shifted it.
  for (const s of ROSTER) assert.ok(agentFile(s.id).includes('\nStatus:       done | partial | blocked | ungraded\nJob:          <one line>\n'), `${s.id} ungraded status`)
})

test('sections keep memory per project: memory: local everywhere, memory: user nowhere, and the memory step says so', () => {
  const MEMORY_STEP = "Use your memory folder to remember this project's conventions and the user's preferences for your area."
  for (const s of ROSTER) {
    const text = agentFile(s.id)
    assert.equal(front(text).memory, 'local', `${s.id} memory`)
    assert.ok(text.includes(MEMORY_STEP), `${s.id} memory step`)
    assert.ok(!text.includes('across projects'), `${s.id} still says "across projects"`)
  }
  for (const file of readdirSync(AGENTS).filter(f => f.endsWith('.md'))) {
    assert.doesNotMatch(readFileSync(new URL(file, AGENTS), 'utf8'), /^memory: user$/m, file)
  }
})

test('every builder lets a stated mode gate replace its numbers and reviewer model, and reports ungraded without an Agent tool', () => {
  const MODE_GATE = 'If the job states a mode gate, it replaces the numbers here and the reviewer\'s model: when it names a model (for example `model: "sonnet"`), pass that to the reviewer; if you have no Agent tool to run the gate, finish with `Status: ungraded` and say why.'
  for (const id of BUILDER_IDS) {
    const text = agentFile(id)
    assert.ok(text.includes('If the job states a mode gate, it replaces the numbers here'), `${id} mode gate`)
    assert.ok(text.includes('Status: ungraded'), `${id} ungraded status`)
    assert.ok(text.includes(MODE_GATE), `${id} full mode-gate sentence`)
    assert.ok(text.indexOf(MODE_GATE) > text.indexOf('Quality gate (skip it when') && text.indexOf(MODE_GATE) < text.indexOf('\n7. Write notes'), `${id} mode gate is outside the quality-gate step`)
  }
  for (const id of ADVISOR_IDS) assert.ok(!agentFile(id).includes('If the job states a mode gate'), `${id} is read-only and has no gate`)
})

test('a builder is not told to skip the gate for config files, which the handback hook counts as code', () => {
  for (const id of BUILDER_IDS) {
    const text = agentFile(id)
    assert.ok(!text.includes('config values'), id)
    assert.ok(text.includes('Quality gate (skip it when the job changed no code, for example docs only; a config file on your Changed line still needs a grade):'), id)
  }
})

test('advisors read the notes but get neither the reviewer nor the coder', () => {
  for (const id of ADVISOR_IDS) {
    const text = agentFile(id)
    assert.ok(text.includes('.team/notes/INDEX.md'), `${id} notes`)
    assert.ok(!text.includes('section-team:reviewer'), `${id} reviewer`)
    assert.ok(!text.includes('section-team:coder'), `${id} coder`)
  }
})

test('testing runs the final reviewer pass and sends fix lists to the owning sections', () => {
  assert.ok(agentFile('testing').includes('Give each spec requirement a test that a plausible wrong implementation would fail (NFD instead of NFKD, trim instead of trimEnd, < instead of <=), not only the spec examples.'))
  assert.ok(agentFile('testing').includes('Assert every value the spec names with exact equality, never a prefix or a pattern, so an extended or normalized value fails.'))
  for (const id of BUILDER_IDS) assert.ok(agentFile(id).includes("Treat every value the spec names as exact (a header value, status code, field, path or format): send exactly that value, never extend it (no `; charset=utf-8` after `application/json`) or normalize it (redirect to the stored URL as given; send a configured URL as given, path and query byte for byte and user:password included: new URL(), fetch and http.request(urlString) drop dot segments, so pass `{ ...urlToHttpOptions(url), path: <raw path and query> }` to http.request or https.request, which keeps the user:password as auth (if its decoding throws on a bad escape, send them undecoded)), and add no rule the spec does not state (no extra reserved path, no accepted null, no size cap where the spec lists when something fails, no type check on replies from the project's own server beyond what the spec states, no refusal where the spec says to decode or replace); where it decodes bytes as UTF-8 and then parses them, keep a leading BOM: buffer.toString('utf8') or new TextDecoder('utf-8', { ignoreBOM: true }), adding fatal: true only where the spec refuses bad bytes, because a default TextDecoder and fetch's text() and json() drop the BOM."), `${id} literal spec values`)
  assert.ok(agentFile('testing').includes("Probe the code against the spec line by line before you grade it: for each line try its boundaries, empty and null values, non-ASCII and control characters (CR or LF in anything that reaches a header, a leading BOM in a body the spec decodes as UTF-8 before parsing), and missing, empty or invalid environment values. Also probe filesystem and startup failures: the data path is a directory, its parent folder is missing, the port is already in use. For each, assert the exact exit code and a single stderr line with no stack trace. For the routes and outside calls this job's changes touch, also probe shared state and the runtime: from a second database connection insert rows holding each column's extremes the store allows (the largest integer, empty and longest text) and read them through every route that returns them; hold each outside call open with a stand-in you release by hand (in a page, resolve fetch() and its json() separately), and meanwhile edit, delete and log out what it read, then check that the reply and the stored data match some one-at-a-time order; send a request with each method (CONNECT included: fetch refuses it, and http.request gives its reply only to req.on('connect')) and with an unknown Expect header and check it gets the reply the spec's check order gives; where the spec lists when an outside call fails, send a large valid reply (a few MB); probe a configured URL with dot segments and with user:password (check the exact Authorization header it sends), because a library's normalization is the plausible wrong implementation. Every probe that breaks the spec becomes a test and goes on its owner's failing fix list, also in code older than this job when a spec line you were given still requires the behaviour (a line that keeps everything else working keeps the earlier lines): never mark such a test todo or skip, and never file it as optional."))
  assert.ok(agentFile('testing').includes('Changed files are where to start, not the limit. In a final review, judge each reading logged in `.team/notes/decisions.md` against the spec text again, and never loosen a test or probe to fit the code. Report what you found.'), 'testing re-judges logged readings')
  for (const id of BUILDER_IDS) assert.ok(agentFile(id).includes('Where a spec line can be read two ways, build or test the stricter reading of what your code must do and log the choice in `.team/notes/decisions.md`: the stricter reading refuses no input the spec accepts and lets through no input its stated steps reject. When a reply\'s body cannot be parsed, the spec\'s rule for an unparsable body wins over its rule for that status; test that case.'), `${id} stricter reading`)
  assert.ok(agentFile('testing').includes('Message a builder only with a failing fix list it must act on. A failing fix list is the one message that may wake a builder. A passing verdict and optional findings (nits, suggestions) go in your REPORT, not to the builders: a message wakes a section that has already handed back.'))
  const testing = agentFile('testing')
  assert.ok(testing.includes("run the reviewer over every section's changed files"))
  assert.ok(testing.includes('send each owning section its part of the fix list'))
  assert.ok(testing.includes('let the owner fix it with its own coders, and grade again, at most 2 fix rounds; if the job states a mode gate, its fix-round count replaces this cap. If it still fails, finish with `Status: partial` and the grade.'), 'testing final review takes the mode gate fix rounds')
})

test('no agent file mentions near-miss copies', () => {
  for (const id of [...BUILDER_IDS, 'reviewer']) assert.ok(!agentFile(id).includes('near-miss'), `${id} still mentions near-miss`)
})

test('scout is a cheap read-only helper, not a section', () => {
  const text = agentFile('scout')
  const fm = front(text)
  assert.equal(fm.name, 'scout')
  assert.equal(fm.model, 'haiku')
  assert.equal(fm.color, 'cyan')
  assert.equal(fm.omitClaudeMd, 'true')
  assert.equal(fm.tools, 'Read, Grep, Glob, Skill')
  assert.equal(fm.memory, undefined)
  assert.equal(fm.skills, undefined)
  assert.ok(!ROSTER.some(s => s.id === 'scout'))
  for (const banned of ['Agent', 'Write', 'Edit', 'Bash', 'PowerShell']) assert.ok(!fm.tools.split(', ').includes(banned), `scout has ${banned}`)
})

test('coder is a Sonnet routine-coding helper that cannot spawn agents', () => {
  const text = agentFile('coder')
  const fm = front(text)
  assert.equal(fm.name, 'coder')
  assert.equal(fm.model, 'sonnet')
  assert.equal(fm.color, 'green')
  assert.equal(fm.omitClaudeMd, 'true')
  assert.equal(fm.memory, undefined)
  assert.equal(fm.skills, undefined)
  assert.ok(!ROSTER.some(s => s.id === 'coder'))
  for (const tool of ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob']) assert.ok(fm.tools.split(', ').includes(tool), `coder lacks ${tool}`)
  assert.ok(!fm.tools.split(', ').includes('Agent'), 'coder has Agent')
  assert.ok(fm.tools.split(', ').includes('Skill'), 'coder lacks Skill')
  assert.ok(text.includes('House rules'))
  assert.ok(text.includes('CLAUDE.local.md'), 'coder needs the full project-rules list')
  assert.ok(text.includes('Project rules: read and follow whichever of these exist in the project: CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md, AGENTS.md, .claude/rules/*.md, plus any files they @-import; in a monorepo also the CLAUDE.md/AGENTS.md of parent folders up to the repo root.'), 'coder project rules')
})

test('reviewer is an Opus read-only grader, not a section', () => {
  const text = agentFile('reviewer')
  const fm = front(text)
  assert.equal(fm.model, 'opus')
  assert.equal(fm.omitClaudeMd, 'true')
  assert.equal(fm.tools, 'Read, Grep, Glob, Bash')
  assert.ok(!ROSTER.some(s => s.id === 'reviewer'))
  for (const item of RUBRIC_ITEMS) assert.ok(text.includes(`${item}:`), `rubric item ${item}`)
  assert.ok(text.includes("each requirement has a test that a plausible wrong implementation would fail (NFD instead of NFKD, trim instead of trimEnd, < instead of <=), not only the spec examples"), 'reviewer grades near-miss tests')
  assert.ok(text.includes('If the request says another section writes the tests, score tests as n/a and leave it out of the overall.'), 'reviewer n/a tests')
  assert.ok(text.includes('For docs or config, score only the items that apply and write n/a for the rest.'), 'reviewer n/a for docs and config')
  assert.ok(text.includes(PASS_RULE))
  assert.ok(text.includes('## GRADE'))
  assert.ok(text.includes('Grade only the changed lines and the functions around them.'))
  assert.ok(text.includes('Never edit files and never spawn agents.'))
  assert.ok(text.includes('Project rules: read and follow whichever of these exist in the project: CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md, AGENTS.md, .claude/rules/*.md, plus any files they @-import; in a monorepo also the CLAUDE.md/AGENTS.md of parent folders up to the repo root.'), 'reviewer project rules')
  assert.ok(text.includes("Where the project's own rules differ from the house rules, the project's rules win."))
  assert.ok(text.includes('Score each item 1–10:'))
  assert.ok(!text.includes('0–10'))
})


test('plan-advisor is a read-only advisor that returns at most 8 fixes with reasons', () => {
  const text = agentFile('plan-advisor')
  assert.equal(front(text).tools, 'Read, Grep, Glob, WebSearch, WebFetch, Skill, SendMessage, Agent, Write, Edit')
  assert.ok(ADVISOR_IDS.includes('plan-advisor'))
  assert.match(text, /at most 8 fixes/)
  assert.match(text, /with its reason/)
  // The spec's "What it checks" list.
  for (const check of ['a wrong build order', 'security, AI and data risks', 'which sections and skills each slice needs', 'whether each quality target is a number or a check']) {
    assert.ok(text.includes(check), `plan-advisor lacks: ${check}`)
  }
})

// Round fix 3 (p1 confirm round): new pins, one assert per edit, plus the old texts gone.
test('round fix 3 text is in the agents that carry it and the old text is gone', () => {
  const ALL = [...BUILDER_IDS, ...ADVISOR_IDS, 'coder']
  for (const id of ALL) {
    const f = agentFile(id)
    assert.ok(f.includes('add no step the spec does not state, such as stripping a BOM, trimming or case-folding, that lets through input its steps reject'), id + ' H1')
    assert.ok(f.includes("that attempt counts as failed and the next one sends the fresh data, within the spec's attempt limit (else a small fixed bound)"), id + ' H2')
    assert.ok(f.includes('a timer that aborts the call, and the elapsed time (performance.now() since the attempt began) checked again when the reply completes'), id + ' H2 timer')
    assert.ok(!f.includes('a bounded number of times'), id + ' old re-call text')
  }
  for (const id of BUILDER_IDS) {
    const f = agentFile(id)
    assert.ok(f.includes('the stricter reading refuses no input the spec accepts and lets through no input its stated steps reject'), id + ' S1')
    assert.ok(f.includes('pass `{ ...urlToHttpOptions(url), path: <raw path and query> }` to http.request or https.request'), id + ' L1')
    assert.ok(f.includes('send a configured URL as given, path and query byte for byte and user:password included'), id + ' L1 head')
    assert.ok(!f.includes('pass host, port and the raw path'), id + ' old L1')
    assert.ok(f.includes("keep a leading BOM: buffer.toString('utf8') or new TextDecoder('utf-8', { ignoreBOM: true })"), id + ' L2')
    assert.ok(f.includes('(a doc sentence the code contradicts is always corrected)'), id + ' Q1')
    assert.equal(f.includes('checkExpectation'), id === 'backend', id + ' B1 only in backend')
    assert.equal(f.includes('before applying an outcome'), id === 'frontend', id + ' F1 only in frontend')
  }
  assert.ok(agentFile('backend').includes("server.on('checkExpectation', handler); on 'connect', give a new http.ServerResponse(req) the socket with res.assignSocket(socket) and run the handler on it)."), 'B1')
  assert.ok(agentFile('frontend').includes('test with a fake fetch whose json() you resolve separately.'), 'F1')
  const rv = agentFile('reviewer')
  assert.ok(rv.includes('and so is a step the spec does not state (a stripped BOM, a trim, a case-fold) that lets through input its steps reject'), 'R1')
  assert.ok(rv.includes("When the spec orders steps and two of them fail, the message of the step it puts first wins: running a later step's check earlier is a fix."), 'R2')
  assert.ok(rv.includes('and so is a test that needs git history or .team/ (a source export or a shallow clone has neither)'), 'R3')
  assert.ok(rv.includes('and any doc sentence the code does not keep (correct the sentence unless the spec states it)'), 'R4')
  const te = agentFile('testing')
  assert.ok(te.includes('a leading BOM in a body the spec decodes as UTF-8 before parsing)'), 'T1')
  assert.ok(te.includes('(in a page, resolve fetch() and its json() separately)'), 'T2')
  assert.ok(te.includes("(CONNECT included: fetch refuses it, and http.request gives its reply only to req.on('connect'))"), 'T3')
  assert.ok(te.includes('with user:password (check the exact Authorization header it sends)'), 'T4')
  assert.ok(te.includes("goes on its owner's failing fix list, also in code older than this job when a spec line you were given still requires the behaviour"), 'T5')
  assert.ok(te.includes('never mark such a test todo or skip, and never file it as optional.'), 'T5 tail')
})

test('no benchmark words in any agent text', () => {
  const BAD = /\bticket|\baudit\b|MODEL_URL|ADMIN_PASSWORD|database busy|model call failed/
  for (const s of ROSTER) assert.ok(!BAD.test(render(s, {})), s.id)
  for (const h of HELPER_AGENTS) assert.ok(!BAD.test(renderHelper(h)), h.id)
})
