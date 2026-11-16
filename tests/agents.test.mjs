import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
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

const SHORT_OUTPUT = 'Keep tool output short: run tests with a reporter that ends with pass and fail totals (never a dots-only one, also in the test script you give the project) and read its last lines through `tail`; run the full suite once per change and take totals and coverage from that one run, coverage from the project\'s own coverage setup or the test runner\'s own option: where neither sees part of the code (code that runs only in a process the tests start), report what it does measure with the line `coverage of started processes not measured`, and write no tool of your own to measure it; pipe other long output through `tail`, and never print a whole log. Everything you read is re-sent on every later turn.'

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

// Round tg: a dots-only reporter gave no totals (about 93 full-suite runs), probe scripts stayed outside the project, and two sections tried to stop every process of one name.
test('round tg: test output ends with totals, scratch files stay in .team/tmp, and only own processes are stopped', () => {
  const MCP = 'Your tools include no project MCP servers (a database console, a cloud API): for one of those, use its CLI through Bash, or ask `main` to run the call.'
  const TIDY = 'Scratch files (probe scripts, logs) go in `.team/tmp/<section id>/` under your working folder (your own id, or your head\'s when you are a helper). The plugin makes that folder before each tool call of a section, so do not make or remove it; if a write there ever fails because it is missing, add `mkdir -p` to that same command. Copies of the project go in the system temp folder, never beside the project or in the home folder. Before you hand back, remove your scratch files and your copies by their paths in one command; never search the temp folder for what other runs left, and make every test remove the temp files and folders it makes. Stop only the processes you started, by their PID, never by name (`taskkill /IM`, `pkill`, `killall`): other work runs on this machine. Other sections run tests on these same files, so never change a product file in place only to watch a test fail (a mutation check): make that change in a copy of the project in the system temp folder, or reason it through without running it. Give every test run a limit that stops it from outside: run it through Bash as `timeout <seconds> <command>` where the system has that command (in PowerShell `timeout` only pauses), set to a few times its usual run time, or a few minutes for a file you have not run yet. The per-test timeout of a test runner cannot stop a loop that never yields. A run that dies with no error of its own may have been stopped for its memory use: if `.team/tmp/memory-guard.log` exists it names the run, and you find the cause before you run it again.'
  for (const id of BUILDER_IDS) assert.ok(agentFile(id).includes(`${SHORT_OUTPUT}\n${MCP}\n${TIDY}\n`), `${id} tidy`)
  assert.ok(agentFile('coder').includes(`${SHORT_OUTPUT}\n${TIDY}\n`), 'coder tidy')
  for (const id of [...ADVISOR_IDS, 'scout', 'reviewer']) assert.ok(!agentFile(id).includes('Scratch files (probe scripts'), `${id} runs no commands`)
  for (const id of [...BUILDER_IDS, 'coder']) assert.ok(!agentFile(id).includes('quiet test reporter'), `${id} old reporter line`)
  for (const id of [...BUILDER_IDS, 'coder']) assert.ok(!agentFile(id).includes('each folder you made once it is empty'), `${id} old scratch folder rule`)
})

// Real use, 2026-11-11: sections changed product files in place to watch a test fail and ran DOM tests with no time limit; one process took all the memory of the machine three times.
test('builders and the coder keep runs bounded: no mutation check in place, a limit from outside on every test run', () => {
  const BOUNDED = ' other work runs on this machine. Other sections run tests on these same files, so never change a product file in place only to watch a test fail (a mutation check): make that change in a copy of the project in the system temp folder, or reason it through without running it. Give every test run a limit that stops it from outside: run it through Bash as `timeout <seconds> <command>` where the system has that command (in PowerShell `timeout` only pauses), set to a few times its usual run time, or a few minutes for a file you have not run yet. The per-test timeout of a test runner cannot stop a loop that never yields.'
  for (const id of [...BUILDER_IDS, 'coder']) assert.ok(agentFile(id).includes(BOUNDED), `${id} bounded runs`)
  const STOPPED = ' cannot stop a loop that never yields. A run that dies with no error of its own may have been stopped for its memory use: if `.team/tmp/memory-guard.log` exists it names the run, and you find the cause before you run it again.\n'
  for (const id of [...BUILDER_IDS, 'coder']) assert.ok(agentFile(id).includes(STOPPED), `${id} stopped run`)
  for (const id of [...ADVISOR_IDS, 'scout', 'reviewer']) assert.ok(!agentFile(id).includes('a mutation check'), `${id} has no run rule`)
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
    'To grade again, start a new foreground reviewer call and put the earlier GRADE block and what you changed for each fix into its request, so it checks those fixes and does not start over. Never SendMessage a helper: that resumes it in the background, and a section waiting on it is made to hand back unfinished.',
    'A pass ends the gate: apply its fixes of a few lines if you like (never left: code that breaks a stated requirement or crashes, where you fix the code; a doc sentence the code contradicts, where you fix the sentence, or the code when the spec states that sentence; a test a busy machine can fail, or a test of an outside wait that a second reading of a value the spec fixes once for a request would pass, where you fix the test; and, only when the job states a mode gate, a spec line whose tests a named wrong implementation would pass, where the test is added as the walk above says, unless another section writes the tests: with no mode gate, a test gap a pass still lists goes under Next as optional), rerun the tests once, and do not grade again. List every larger fix under Next in your REPORT instead of doing it: larger work is a new job, and the supervisor decides.',
    "Before your first grade, walk your code once: every call that can fail handles the error, every outside input is validated (replies from the project's own server only as far as the spec states; no input the spec accepts is refused), every stored value and every wait on something outside follows the house rules, every spec line has a test that a wrong implementation you can name would fail, every doc sentence about what you changed still holds (for tests a coder wrote, the gate checks the test clause, not this walk). A test that this walk or a grade finds missing in a test file you have not read goes to a coder, all of them in one brief with their spec lines: reading that file into your context costs more than the coder's whole run. A fix after the gate costs far more than care now.",
    'If the job says another section writes the tests (the testing section in multi-area work), tell the reviewer so: it then scores tests as n/a and leaves them out of the overall.',
    "Never edit another section's note.",
    'Helpers never spawn agents.',
    "Once all the code is in (yours and your helpers'), send your changed files and the spec (its file, or the job's goal and what done means) to Agent `section-team:reviewer`",
    'If another section will depend on a contract you decide here (an API, a schema, design tokens), write its note now, before you hand out work; update it at step 7 if it changed.',
  ]
  for (const id of BUILDER_IDS) {
    const text = agentFile(id)
    for (const sentence of sentences) assert.ok(text.includes(sentence), `${id} lacks: ${sentence}`)
    assert.ok(text.includes('\n7. Write notes for anything other sections depend on'), `${id}: step 7 is no longer the notes step the plan step points to`)
    assert.ok(!text.includes("Once your helpers' code is in"), `${id} still gates only the helpers' code`)
    assert.ok(!text.includes('A later job that changes code gets its own grade.'), `${id} keeps the old after-a-pass line`)
    assert.ok(text.indexOf('Before your first grade') < text.indexOf("send your changed files and the spec"), `${id} walks its code after the grade`)
  }
  for (const id of ADVISOR_IDS) assert.ok(!agentFile(id).includes('write its note now'), `${id} is read-only and writes no notes`)
  for (const id of [...ADVISOR_IDS, 'scout', 'coder', 'reviewer']) assert.ok(!agentFile(id).includes('Before your first grade'), `${id} has no gate to run`)
})

test('house rules carry the friendly-errors rule; the reviewer fails a user-triggerable stack trace; testing probes I/O and startup failures', () => {
  for (const id of [...BUILDER_IDS, ...ADVISOR_IDS, 'coder']) assert.ok(agentFile(id).includes('handle errors explicitly and never swallow them; user-facing errors stay friendly and leak nothing (one line, no stack trace);'), `${id} friendly errors`)
  const reviewer = agentFile('reviewer')
  assert.ok(reviewer.includes('List fixes most important first: on a fail, every fix a failing score depends on and everything a pass would list; on a pass, at most 5, and only what breaks a stated requirement or crashes, and any doc sentence the code does not keep (the fix is the sentence, or the code when the spec states that sentence), and any test a busy machine can fail, or that a second reading of a value the spec fixes once for a request would pass after a wait (the fix is the test), and, unless another section writes the tests or the request says a pass lists no test gaps, any spec line whose tests a wrong implementation you can name would still pass (the fix is the test).\n\nEnd your answer with exactly this block, filled in:'), 'reviewer fix-list cap')
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
  const CORE = { frontend: ['frontend-design:frontend-design'], testing: ['tdd-workflow'], 'ai-engineer': ['claude-api'], uiux: ['web-design-guidelines'] }
  for (const s of ROSTER) {
    assert.ok(s.core.length <= 1, `${s.id} preloads more than one skill`)
    assert.deepEqual(s.core, CORE[s.id] ?? [], `${s.id} core`)
    const text = agentFile(s.id)
    assert.deepEqual(frontSkills(text), s.core, `${s.id} frontmatter skills`)
    for (const skill of s.skills.filter(k => !s.core.includes(k))) assert.ok(text.includes(skill), `${s.id} lost go-to ${skill}`)
  }
})

test('ai-llm loads claude-api only when the job calls Claude: no preload, claude-api a go-to skill, the role says when to load it', () => {
  const text = agentFile('ai-llm')
  assert.ok(!text.split('---')[1].split('\n').some(l => l.startsWith('skills:')), 'ai-llm frontmatter has a skills line')
  const goTo = text.split('\n').find(l => l.includes('Go-to skills')) ?? ''
  assert.ok(goTo.includes('claude-api'), 'ai-llm does not name claude-api among its go-to skills')
  const role = 'The claude-api skill is large, and a loaded skill is re-sent on every later turn: load it before you design or write a call to Claude or the Anthropic SDK (your memory of that API is out of date), and leave it unloaded on a job that calls another provider or a model behind a plain HTTP endpoint, also when the job names it for prompt-writing guidance only: that is the one exception to loading the skills a job names.'
  assert.ok(text.includes(role), 'ai-llm role lacks the claude-api loading rule')
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
  assert.ok(agentFile('testing').includes('When a job asks for it, hand back one command that starts the app, prints one PASS or FAIL line per critical flow, then stops the app and exits non-zero on any FAIL. Keep that script small: a few requests a flow and no edge cases, which the tests cover. Its script stays in the project after you hand back, outside `.team/tmp/` and outside the folders the test runner scans: it is no scratch file, and the project\'s script list (package.json or its like) names its command.'))
  for (const id of [...BUILDER_IDS, 'coder', 'reviewer']) assert.ok(!/(?<!outside )input (is )?validated at boundaries|validate input at boundaries/.test(agentFile(id)), `${id} keeps an unbounded boundary rule`)
})

// The 2026-11-09 p1 round: ids above 2^53 failed reads, and requests trusted data read before an outside wait.
test('the house rules cover data other tools write and data read before an outside wait, in every section and the coder', () => {
  const STORED = " data other tools can write (a shared database, a file) may hold any value its store allows: read and reply with every such value without failing or dropping it (in JavaScript, read integer columns that can pass 2^53, such as ids, as BigInt), a row that points at a row that does not exist included: where the spec says what an id of no existing row gives (it matches nothing, it is not found), that holds even when other rows still carry that id; a request that reads data, waits on an outside call that changes nothing outside (a model, a lookup) and then writes or replies from that data checks again, in the transaction that writes, that the user still has access and the data still exists: if not, it writes nothing and replies as the spec says for a missing one, because access is decided when the write happens and a write for something deleted fits no one-at-a-time order; that call is made once (its attempts as the spec counts them), with no transaction open, and if what it sent has changed in the store meanwhile and the spec names no reply for that, the request ends as the spec says for a good answer, with that answer (the change is no error, and no reason to call again unless the spec says so), the docs say the answer is for the data as read, and where the write stores the answer itself beside that data, you name that in your hand-back as a question for the user; a value the spec fixes once for a request (its time, an id, a token) is taken once and passed on: the re-check after a wait, the write and each retry use it, never a fresh one (elapsed-time checks on a monotonic clock are separate); a time limit the spec sets on an outside call is enforced twice: a timer that aborts the call and stays set until the whole reply body is read, and the elapsed time on a monotonic clock (performance.now() in JavaScript) since the attempt began, checked again when the reply completes;"
  for (const id of [...BUILDER_IDS, ...ADVISOR_IDS, 'coder']) assert.ok(agentFile(id).includes(`lets through input its steps reject);${STORED} handle errors explicitly`), `${id} stored values and outside waits`)
})

test('the reviewer rubric fails an unstated size cap, a failing read of a stored value, a test against the spec and trust across an outside wait', () => {
  const reviewer = agentFile('reviewer')
  assert.ok(reviewer.includes('\n- tests: new behaviour has tests, written first, and coverage is about 80% or better where the project\'s coverage setup or the test runner\'s own option measures it (code that runs only in a process the tests start is no fail for that); each requirement has a test that a plausible wrong implementation would fail (NFD instead of NFKD, trim instead of trimEnd, < instead of <=), not only the spec examples. A test that asserts behaviour a spec line contradicts is a fix, and so is a test that needs this checkout\'s own git history or .team/ contents (a source export or a shallow clone has neither): keep what it needs, such as a data file an older version made, as a fixture file in the test folder; a test that builds its own temporary repo or state is fine. A test a busy machine can fail is a fix too: a start or a wait limited near its usual time, a fixed delay in place of the event, a duration asserted where the spec names no time (the order of two replies is no duration), a time another process stored held against the test\'s own clock with no margin.\n'), 'tests item')
  assert.ok(reviewer.includes('\n- security: no hardcoded secrets, no injection or unsafe handling of user input, and no access or existence check made before an outside wait (a model or network call) and trusted after it: the code that writes or replies makes it again (content that changed meanwhile is by itself no error and no reason to call again, unless the spec says so: the answer is used, and an error reply for a change alone is a fix, so is a second call made for it, so is a call made while a transaction is open, and so is a test that expects any of these). A result the server worked out itself between a read and the write (a hash, anything awaited that is no outside call) and used after the rows it came from have changed is a fix, a last fallback after retries included. A value the spec fixes once for a request (its time, an id, a token) that is taken again after a wait is a fix (an elapsed-time check on a monotonic clock is not that value), and so is a test of that wait that a second reading would pass. A check of a secret that does less work for an unknown name than for a wrong secret is a fix.\n'), 'security item')
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
  for (const id of BUILDER_IDS) assert.ok(agentFile(id).includes("Treat every value the spec names as exact (a header value, status code, field, path or format): send exactly that value, never extend it (no `; charset=utf-8` after `application/json`) or normalize it (redirect to the stored URL as given; send a configured URL as given, path and query byte for byte and user:password included: new URL(), fetch and http.request(urlString) drop dot segments, and fetch refuses a URL with user:password, so pass `{ ...urlToHttpOptions(url), path: <raw path and query> }` to http.request or https.request, which keeps the user:password as auth (if its decoding throws on a bad escape, send them undecoded); in that raw path percent-encode as UTF-8 only what a request line cannot carry (a space, a control character, anything outside ASCII), because http.request throws on some of those and the call is never sent), and add no rule the spec does not state (no extra reserved path, no accepted null, no size cap where the spec lists when something fails, no type check on replies from the project's own server beyond what the spec states, no refusal where the spec says to decode or replace); where the spec itself says to decode bytes as UTF-8 and then parse them, keep a leading BOM: buffer.toString('utf8') or new TextDecoder('utf-8', { ignoreBOM: true }), adding fatal: true only where the spec refuses bad bytes, because a default TextDecoder and fetch's text() and json() drop the BOM (with fetch, decode await res.arrayBuffer() that way)."), `${id} literal spec values`)
  assert.ok(agentFile('testing').includes("Probe the code against the spec line by line before you grade it: for each line try its boundaries, empty and null values, non-ASCII and control characters (CR or LF in anything that reaches a header, a leading BOM in a body the spec decodes as UTF-8 before parsing), and missing, empty or invalid environment values. Also probe filesystem and startup failures: the data path is a directory, its parent folder is missing, the port is already in use. For each, assert the exact exit code and a single stderr line with no stack trace. For the routes and outside calls this job's changes touch, also probe shared state and the runtime: from a second database connection insert rows holding each column's extremes the store allows (the largest integer, empty and longest text) and rows that point at a row that does not exist, and read them through every route that returns, counts or filters by them (a filter by an id of no existing row gives what the spec says for a missing one, even when such rows carry that id); lock the store from a second connection and time the replies (a request that does not need what is locked gets its reply while a request that waits on the lock is still waiting: check that order, the free reply first, not a duration, also for a request refused for its header or body on a route where no check before that one reads the store; a wait the spec bounds ends at its limit, not later, allowing a margin that is a fraction of the limit); hold each outside call open with a stand-in you release by hand (in a page, resolve fetch() and its json() separately), and meanwhile, one at a time, delete the data it read, delete the user and end the session (each time the reply is the spec's for a missing one, nothing is written or shown for what is gone and nothing crashes), then change what it sent (unless the spec names a reply for that, the request ends as the spec says for a good answer, with the answer of its one call: no error for the change and no further call at the stand-in), and check that a write from a second connection commits while the call waits; where the code does slow work of its own between a read and the write (a secret hashed off the thread), change the rows that work read while parallel requests run it, in a loop, and check every reply against the stored rows: none succeeds on a secret or a role the store no longer holds, and nothing a change ended (a session) is alive after it; send a request with each method and with a made-up one (CONNECT included: fetch refuses it, and http.request gives its reply only to req.on('connect'), the body in head and then on the socket; also reset a CONNECT connection before its reply and check the server stays up) and with an unknown Expect header and check it gets the reply the spec's check order gives; where the spec has the body read before any reply, send the made-up method and CONNECT each with a body whose end you hold back, once counted by Content-Length and once chunked, and check that no reply comes before that end; where the spec lists when an outside call fails, send a large valid reply (a few MB); probe a configured URL with dot segments and with user:password (check the exact Authorization header it sends), because a library's normalization is the plausible wrong implementation, and with a space and a non-ASCII character in its path (the call still arrives, with only those characters percent-encoded). Every probe that breaks the spec becomes a test and goes on its owner's failing fix list, also in code older than this job when a spec line you were given still requires the behaviour (a line such as 'everything else keeps working' carries every earlier requirement forward): never mark such a test todo or skip, and never file it as optional."))
  assert.ok(agentFile('testing').includes('Changed files are where to start, not the limit. In a final review, judge each reading logged in `.team/notes/decisions.md` against the spec text again, and never loosen a test or probe to fit the code. Report what you found.'), 'testing re-judges logged readings')
  for (const id of BUILDER_IDS) assert.ok(agentFile(id).includes('Where a spec line can be read two ways, build or test the stricter reading of what your code must do and log the choice in `.team/notes/decisions.md`. The stricter reading refuses no input the spec accepts and lets through no input its stated steps reject. When a reply\'s body cannot be parsed, the spec\'s rule for an unparsable body wins over its rule for that status, a status it treats as a normal outcome included: test it with every status the spec gives a rule of its own.'), `${id} stricter reading`)
  assert.ok(agentFile('testing').includes('Message a builder only with a failing fix list it must act on. A failing fix list is the one message that may wake a builder. A passing verdict and optional findings (nits, suggestions) go in your REPORT, not to the builders: a message wakes a section that has already handed back.'))
  const testing = agentFile('testing')
  assert.ok(testing.includes("run the reviewer in one call over every section's changed files, yours included, with the spec you were given, and ask it for a whole-product review"))
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
  assert.ok(text.includes('Run the full suite at most once in a grade, and not at all when only docs changed; run it a second time only when that run fails, to tell a test a busy machine fails from a broken one;'))
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
    assert.ok(f.includes('a timer that aborts the call and stays set until the whole reply body is read, and the elapsed time on a monotonic clock (performance.now() in JavaScript) since the attempt began, checked again when the reply completes'), id + ' H2 timer')
    assert.ok(!f.includes('a bounded number of times'), id + ' old re-call text')
  }
  for (const id of BUILDER_IDS) {
    const f = agentFile(id)
    assert.ok(f.includes('The stricter reading refuses no input the spec accepts and lets through no input its stated steps reject'), id + ' S1')
    assert.ok(f.includes('pass `{ ...urlToHttpOptions(url), path: <raw path and query> }` to http.request or https.request'), id + ' L1')
    assert.ok(f.includes('send a configured URL as given, path and query byte for byte and user:password included'), id + ' L1 head')
    assert.ok(!f.includes('pass host, port and the raw path'), id + ' old L1')
    assert.ok(f.includes("keep a leading BOM: buffer.toString('utf8') or new TextDecoder('utf-8', { ignoreBOM: true })"), id + ' L2')
    assert.ok(f.includes('(never left: code that breaks a stated requirement or crashes, where you fix the code; a doc sentence the code contradicts, where you fix the sentence, or the code when the spec states that sentence; a test a busy machine can fail, or a test of an outside wait that a second reading of a value the spec fixes once for a request would pass, where you fix the test; and, only when the job states a mode gate, a spec line whose tests a named wrong implementation would pass, where the test is added as the walk above says, unless another section writes the tests: with no mode gate, a test gap a pass still lists goes under Next as optional)'), id + ' Q1')
    assert.equal(f.includes('checkExpectation'), id === 'backend', id + ' B1 only in backend')
    assert.equal(f.includes('before applying an outcome'), id === 'frontend', id + ' F1 only in frontend')
  }
  assert.ok(agentFile('backend').includes("server.on('checkExpectation', handler); on 'connect' when the spec answers CONNECT as an ordinary request rather than opening a tunnel, run the handler on a new http.ServerResponse(req) given the socket by res.assignSocket(socket), with res.shouldKeepAlive = false, socket.on('error', () => socket.destroy()) and socket.end() on the reply's 'finish', else a client reset crashes the process and the socket never closes)."), 'B1')
  assert.ok(agentFile('frontend').includes('test with a fake fetch whose json() you resolve separately.'), 'F1')
  const rv = agentFile('reviewer')
  assert.ok(rv.includes('and so is a step the spec does not state (a stripped BOM, a trim, a case-fold) that lets through input its steps reject'), 'R1')
  assert.ok(rv.includes("When the spec orders steps and two of them fail, the message of the step it puts first wins: running a later step's check earlier, so that its message wins, is a fix."), 'R2')
  assert.ok(rv.includes('and so is a test that needs this checkout\'s own git history or .team/ contents (a source export or a shallow clone has neither)'), 'R3')
  assert.ok(rv.includes('and any doc sentence the code does not keep (the fix is the sentence, or the code when the spec states that sentence)'), 'R4')
  const te = agentFile('testing')
  assert.ok(te.includes('a leading BOM in a body the spec decodes as UTF-8 before parsing)'), 'T1')
  assert.ok(te.includes('(in a page, resolve fetch() and its json() separately)'), 'T2')
  assert.ok(te.includes("(CONNECT included: fetch refuses it, and http.request gives its reply only to req.on('connect'), the body in head and then on the socket; also reset a CONNECT connection before its reply and check the server stays up)"), 'T3')
  assert.ok(te.includes('with user:password (check the exact Authorization header it sends)'), 'T4')
  assert.ok(te.includes("goes on its owner's failing fix list, also in code older than this job when a spec line you were given still requires the behaviour"), 'T5')
  assert.ok(te.includes('never mark such a test todo or skip, and never file it as optional.'), 'T5 tail')
})

// Round tf: both judges marked the retry on a changed input down, and both Max supervisors spent a fix round removing it.
// Round tj: both judges read a second call for changed data as behaviour the spec does not state, and a login used a result worked out from rows that had changed.
test('rounds tf, ti and tj: after an outside wait a request re-checks access and existence and makes its call once; work of its own is never used from rows that changed', () => {
  for (const id of [...BUILDER_IDS, ...ADVISOR_IDS, 'coder']) {
    const f = agentFile(id)
    assert.ok(f.includes('checks again, in the transaction that writes, that the user still has access and the data still exists: if not, it writes nothing and replies as the spec says for a missing one'), id + ' re-check')
    assert.ok(f.includes("that call is made once (its attempts as the spec counts them), with no transaction open, and if what it sent has changed in the store meanwhile and the spec names no reply for that, the request ends as the spec says for a good answer, with that answer (the change is no error, and no reason to call again unless the spec says so), the docs say the answer is for the data as read, and where the write stores the answer itself beside that data, you name that in your hand-back as a question for the user;"), id + ' changed input')
    assert.ok(f.includes('that call is made once (its attempts as the spec counts them), with no transaction open, and if what it sent has changed'), id + ' one call, no transaction during it')
    assert.ok(!/counts as failed|is never repeated|the old answer is not used/.test(f), id + ' old retry text')
  }
  const te = agentFile('testing')
  assert.ok(te.includes("delete the data it read, delete the user and end the session (each time the reply is the spec's for a missing one, nothing is written or shown for what is gone and nothing crashes), then change what it sent (unless the spec names a reply for that, the request ends as the spec says for a good answer, with the answer of its one call: no error for the change and no further call at the stand-in), and check that a write from a second connection commits while the call waits; where the code does slow work of its own between a read and the write (a secret hashed off the thread), change the rows that work read while parallel requests run it, in a loop, and check every reply against the stored rows: none succeeds on a secret or a role the store no longer holds, and nothing a change ended (a session) is alive after it;"), 'testing probe')
  assert.ok(!te.includes('match some one-at-a-time order'), 'old probe text')
  assert.ok(agentFile('reviewer').includes('(content that changed meanwhile is by itself no error and no reason to call again, unless the spec says so: the answer is used, and an error reply for a change alone is a fix, so is a second call made for it, so is a call made while a transaction is open, and so is a test that expects any of these)'), 'reviewer')
  assert.ok(agentFile('reviewer').includes('so is a second call made for it, so is a call made while a transaction is open'), 'reviewer second call')
  assert.ok(te.includes('and check that a write from a second connection commits while the call waits;'), 'testing second connection write')
  assert.ok(!te.includes('the stand-in gets one new call') && !te.includes('commits while that new call waits'), 'testing asks for no second call')
  for (const id of [...BUILDER_IDS, ...ADVISOR_IDS, 'coder', 'reviewer']) {
    const f = agentFile(id)
    assert.ok(!f.includes('the answer is still used: a change is not a failed call') && !f.includes('it adds no attempt and no failure'), id + ' old answer-kept text')
    for (const old of ['makes the call again with the stored data', 'at most 2 such new calls', 'at most 2 new calls']) assert.ok(!f.includes(old), `${id} asks for no second call: ${old}`)
  }
  for (const id of BUILDER_IDS) assert.equal(agentFile(id).includes('Work the server does itself between a read and the write that uses it'), id === 'backend', id + ' own work only in backend')
  assert.ok(agentFile('backend').includes('does the work again where those rows cannot change (in its blocking form inside that transaction on one synchronous connection, or with the rows locked, on a connection only that request uses, where the store locks rows; with neither, again from the new rows, and a request whose rows changed in each of a few such rounds is answered as a server error), never using an earlier result once its rows have changed, not as a last fallback either; a test changes those rows while the work runs.'), 'backend own work')
  assert.ok(agentFile('reviewer').includes('and used after the rows it came from have changed is a fix, a last fallback after retries included.'), 'reviewer own work')
})

// Round tg: an advisor's design took a fresh clock for the re-check and the supervisor told the builder to follow it; a builder handed back a spec line as impossible.
test('round tg: one clock reading per request; the spec and the rules outrank advice; advisors keep the spec', () => {
  const CLOCK = 'you name that in your hand-back as a question for the user; a value the spec fixes once for a request (its time, an id, a token) is taken once and passed on: the re-check after a wait, the write and each retry use it, never a fresh one (elapsed-time checks on a monotonic clock are separate); a time limit the spec sets on an outside call is enforced twice'
  for (const id of [...BUILDER_IDS, ...ADVISOR_IDS, 'coder']) assert.ok(agentFile(id).includes(CLOCK), `${id} clock reading`)
  const OUTRANK = 'test it with every status the spec gives a rule of its own. The spec and the rules in this file outrank advice, an advisor\'s design and a job message\'s own rewording of a spec line or rule: where one of those differs, build to the spec and the rules unless the message says the user decided it, and log the difference in `.team/notes/decisions.md`. The frozen foundation note and what the job asks you to build (its goal, what it calls done) stay as given, except a line there that rewords a spec line or a rule here.'
  const LIMIT = "Never hand back a spec line as impossible from memory: look the limit up in the platform's documentation (the event, option or lower-level API that covers the case) and try it; if the limit stands, say what you tried and finish with `Status: partial`, not `done`. Treat every value the spec names as exact"
  for (const id of BUILDER_IDS) {
    assert.ok(agentFile(id).includes(OUTRANK), `${id} spec outranks advice`)
    assert.ok(agentFile(id).includes(LIMIT), `${id} no limit from memory`)
  }
  const ADVICE = "Your REPORT's Quality line is always `n/a (no code)`. Your advice keeps the spec and the house rules above: every value, step and order the spec names stays exactly as given (a URL sent as configured, a value the spec fixes once for a request taken once), you name the spec line behind each choice, and you leave the choice of library call to the builder unless you have checked that call against that line."
  for (const id of ADVISOR_IDS) {
    assert.ok(agentFile(id).includes(ADVICE), `${id} advice keeps the spec`)
    assert.ok(!agentFile(id).includes('outrank advice'), `${id} has no builder rule`)
  }
  for (const id of BUILDER_IDS) assert.ok(!agentFile(id).includes('Your advice keeps the spec'), `${id} is no advisor`)
})

// Round tf: shipped test files carried '(testing section)' and 'Final review probes', and names such as probes-*, final-*, final2-*.
test('shipped files carry no process words: house rules, the reviewer and the testing section say so', () => {
  const HOUSE = 'names, comments and docs in shipped files say what the product does, never how the work was done: no word for a team section, a review, a probe or a fix round, and nothing that points into `.team/`;'
  for (const id of [...BUILDER_IDS, ...ADVISOR_IDS, 'coder']) assert.ok(agentFile(id).includes(`no console.log in shipped code; ${HOUSE} write tests first`), `${id} no process words`)
  assert.ok(agentFile('reviewer').includes('\n- leftovers: no console.log, debug code, commented-out code or stray TODOs in shipped code, and no name, comment or doc line that tells how the work was done instead of what the code does (a team section, a review, a probe, a fix round, a `.team/` path; a test file named for the step that wrote it). No flag, hook or branch in shipped code that exists only to change behaviour under test (a dependency passed in, such as a clock, a client or a store, is design, not a leftover), no doc list or count (test files, totals) the folder no longer matches, and no scratch file or empty folder left in the project outside `.team/`.\n'), 'leftovers item')
  assert.ok(agentFile('testing').includes('never file it as optional. Put each test in a test file named for the feature it covers; no file name, test name or comment says it came from a probe, a review or a section. Give each spec requirement a test'), 'testing names tests by feature')
})

// Round tj: a page dropped the reply to its first request when another kind of request was sent, although the spec gives that reply a result.
test('round tj: the frontend drops an outcome for a newer read of the same data, and for anything else only where the spec says so', () => {
  const f = agentFile('frontend')
  assert.ok(f.includes('run each step at the moment the spec names, check again right before applying an outcome whether it is still used (a newer read of the same data replaces an older one; a logout drops what would show the session it ended; anything else, such as another kind of request, drops it only where the spec says so), and test with a fake fetch whose json() you resolve separately.'), 'frontend outcome')
  assert.ok(!f.includes('still used (a newer request, a logout)'), 'old wording')
})

test('no benchmark words in any agent text', () => {
  const BAD = /\bticket|\baudit\b|MODEL_URL|ADMIN_PASSWORD|database busy|model call failed/
  for (const s of ROSTER) assert.ok(!BAD.test(render(s, {})), s.id)
  for (const h of HELPER_AGENTS) assert.ok(!BAD.test(renderHelper(h)), h.id)
})

// Round tf: a synchronous driver timeout blocked the event loop in three of four team runs; a filter counted rows that point at a missing row in both Balanced runs.
test('backend and database keep a bounded wait off the serving thread; testing times a locked store and inserts dangling rows', () => {
  const WAIT = 'A wait the spec bounds (a locked store, a busy resource) never blocks the thread that answers other requests: give a synchronous driver a timeout of 0 and retry the refused step on a timer (the whole transaction when it had already read), with the values the request already took (its clock reading), until the limit on a monotonic clock, so other requests are answered meanwhile and the reply comes at the limit, not later; a request that only reads takes no write lock.'
  for (const id of BUILDER_IDS) assert.equal(agentFile(id).includes(WAIT), id === 'backend' || id === 'database', `${id} bounded wait`)
  const te = agentFile('testing')
  assert.ok(te.includes('and rows that point at a row that does not exist, and read them through every route that returns, counts or filters by them (a filter by an id of no existing row gives what the spec says for a missing one, even when such rows carry that id);'), 'dangling rows')
  assert.ok(te.includes('lock the store from a second connection and time the replies (a request that does not need what is locked gets its reply while a request that waits on the lock is still waiting: check that order, the free reply first, not a duration, also for a request refused for its header or body on a route where no check before that one reads the store; a wait the spec bounds ends at its limit, not later, allowing a margin that is a fraction of the limit);'), 'lock probe')
})

// Round tf: Balanced stage 1 is a single-area job with no security pass, and both Balanced runs skipped the hash for an unknown user.
test('backend checks a secret in equal time and logs unexpected errors; the reviewer fails an unequal check', () => {
  const backend = agentFile('backend')
  assert.ok(backend.includes('A check of a secret does the same work for an unknown name as for a wrong secret (verify against a fixed dummy hash), so timing does not tell which names exist.'), 'equal-time check')
  assert.ok(backend.includes('An unexpected error a server turns into a reply also goes to stderr as one line with no user data or secret, unless the spec limits what is written there.'), 'stderr line')
  assert.ok(agentFile('reviewer').includes(' A check of a secret that does less work for an unknown name than for a wrong secret is a fix.\n'), 'reviewer')
})

// Round tg: a later grade failed code for doing what an earlier grade asked, a reviewer asked for a test-only parameter, and test gaps the reviewer named shipped as optional.
test('round tg: the reviewer keeps re-grades consistent, asks for nothing the spec does not state, and reads a whole product when asked', () => {
  const rv = agentFile('reviewer')
  assert.ok(rv.includes('For docs or config, score only the items that apply and write n/a for the rest.\nEvery fix you list names the spec line or the rule above that it serves. What breaks a spec line or a security rule above is a fix however rare the moment it needs (two requests at the same time, replies in an order a user cannot cause by hand), never `(optional)` (a case a rule above settles, such as content that changed during an outside call, is settled by that rule). Never ask for a check, a refusal or behaviour that neither the spec, a rule above nor the request asks for, and never for a flag, hook or branch in shipped code that exists only to change behaviour under test: ask for a test through the real interface, or of a smaller unit the product itself imports.\nWhen the request carries an earlier GRADE block, this is a re-grade: check each fix on that list and every line changed since that grade, and nothing else. Keep an earlier score only for code unchanged since that grade, grade changed lines in full, and never fail code for doing what an earlier fix asked. A new point about unchanged code that breaks no spec line, crashes nothing and breaks no security rule above is listed as `(optional)` and lowers no score.\nWhen the request asks for a whole-product review, read the named files as one codebase instead of changed lines: logic written twice across files, one name used for two things, a number with no name, a refusal, a failure, a startup step or a file the product writes that neither the spec, a rule above nor the request asks for, a doc sentence, list or count the code does not keep, a test case or test helper written twice. Score each under its item with its file:line; on a pass, list as fixes only what the rule below allows, and the rest as `(optional)`.\n\nBash is only for'), 'reviewer rules')
  assert.ok(rv.includes('\n- duplication: no copy-pasted logic that should be one shared function, in tests too: a case another test already covers, or a second copy of a helper or stand-in the test folder has, is a fix.\n'), 'duplication item')
  assert.ok(rv.includes('a test file named for the step that wrote it). No flag, hook or branch in shipped code that exists only to change behaviour under test (a dependency passed in, such as a clock, a client or a store, is design, not a leftover), no doc list or count (test files, totals) the folder no longer matches, and no scratch file or empty folder left in the project outside `.team/`.\n'), 'leftovers item')
  assert.ok(rv.includes(', and any test a busy machine can fail, or that a second reading of a value the spec fixes once for a request would pass after a wait (the fix is the test), and, unless another section writes the tests or the request says a pass lists no test gaps, any spec line whose tests a wrong implementation you can name would still pass (the fix is the test).\n\nEnd your answer'), 'pass list')
  for (const id of BUILDER_IDS) {
    const f = agentFile(id)
    assert.ok(f.includes('   - To grade again, start a new foreground reviewer call and put the earlier GRADE block and what you changed for each fix into its request, so it checks those fixes and does not start over. Never SendMessage'), `${id} re-grade request`)
    assert.ok(f.includes('and, only when the job states a mode gate, a spec line whose tests a named wrong implementation would pass, where the test is added as the walk above says, unless another section writes the tests: with no mode gate, a test gap a pass still lists goes under Next as optional), rerun the tests once, and do not grade again.'), `${id} test gap never left`)
    assert.ok(f.includes('every spec line has a test that a wrong implementation you can name would fail, every doc sentence about what you changed still holds (for tests a coder wrote, the gate checks the test clause, not this walk). A test that this walk or a grade finds missing'), `${id} walk`)
  }
})

// Round tg: four leftovers a reading finds passed two final reviews as optional, and the second review repeated the first one's flows.
test('round tg: testing reads the code for what probes miss, asks for one whole-product review, and a second final review does not probe again', () => {
  const te = agentFile('testing')
  const READ = "(with fetch, decode await res.arrayBuffer() that way). Probes miss what does not show from outside, so also read the code this job covers once against the spec and the house rules, and put each of these on its owner's failing fix list with its file:line, never among the optional findings: a value the spec fixes once for a request (its time, an id, a token) that is taken again; a spec line the code breaks only at a rare moment (two requests at the same time, replies in an order a user cannot cause by hand), which is no smaller for that (a case a rule in this file settles, such as content that changed during an outside call, is settled by that rule); a refusal, a failure, a startup step or a file the product writes that neither the spec, a rule in this file nor the job asks for; a doc sentence, list or count the code does not keep; a flag, hook or branch in shipped code that exists only to change behaviour under test (a dependency passed in, such as a clock, a client or a store, is design); a scratch file or empty folder left in the project outside `.team/`. For multi-section tasks you own the final review"
  assert.ok(te.includes(READ), 'read-through')
  assert.ok(te.includes("run the reviewer in one call over every section's changed files, yours included, with the spec you were given, and ask it for a whole-product review (Agent `section-team:reviewer`, with `run_in_background: false`): each section's own gate graded its lines, and this call reads the product as one codebase. The final review runs the whole test suite"), 'whole-product review')
  assert.ok(te.includes("Report what you found. When the job says it is the second final review, write no new probes and add a test only for a spec break you find: run the suite and the project's flow command once (write one only if none exists), then spend the job reading all the product code and docs yourself, not through a scout, against the spec as above, and on the whole-product review; read no earlier final review's files in `.team/reports/`. The section that wrote a file owns it: if the final pass fails or your reading found failing items, send each owning section its part of the fix list"), 'second final review')
  assert.ok(te.includes('send a request with each method and with a made-up one (CONNECT included:'), 'made-up method')
  for (const id of BUILDER_IDS.filter(id => id !== 'testing')) assert.ok(!agentFile(id).includes('Probes miss what does not show'), `${id} has no read-through`)
})

// Round tg: every builder wrote the code before its tests, the same reply cases were tested in 3 to 4 files, and the security pass wrote a test file in every stage.
test('round tg: tests come first, reuse what exists, and a security pass adds a test only for a fix', () => {
  const TESTS = 'write tests first for new behaviour and aim for 80% coverage; a time limit in a test (a process start, an awaited event, the test\'s own timeout) only catches a hang and never measures speed: set it far above the usual time (a minute costs nothing when the test passes) and wait for the event itself, never for a fixed delay; assert a duration only against a time the spec names, with a margin that is a fraction of that time, and show that something is answered meanwhile by order (its reply comes before the reply of the request that waits), never by a duration; a time another process stored (a server the test starts) is never held against the test\'s own clock without a margin of about a second, because clocks read in two processes can differ by a few milliseconds: compare it with another value that process stored, or allow that margin; before you add a test, look at the tests that exist: reuse their helpers and stand-ins, put the case in the file that covers that feature, and write no case another test already covers; conventional commit messages if you commit.'
  for (const id of [...BUILDER_IDS, ...ADVISOR_IDS, 'coder']) assert.ok(agentFile(id).includes(TESTS), `${id} reuses tests`)
  for (const id of [...BUILDER_IDS, ...ADVISOR_IDS, 'coder']) assert.ok(agentFile(id).includes('no hardcoded secrets; a number with a meaning has a name; no console.log in shipped code;'), `${id} named numbers`)
  assert.ok(agentFile('reviewer').includes('\n- naming: descriptive names that say what a thing is or does, consistent with the surrounding code; a number with a meaning has a name.\n'), 'naming item')
  const FIRST = '   - Tests (not when the job says another section writes the tests): when you build new behaviour, a coder writes its tests from the spec lines and your interfaces (file names, signatures): every expected value comes from the spec, never from what the code does. Its brief names the spec file and lines to cover instead of copying them (with no spec file, the requirements themselves) and asks for each a test that a wrong implementation the coder can name would fail. When the job states no mode gate (no pass mark other than your quality gate\'s own), the code comes first (the tests-first order of the house rules, and of any skill you load or the job names, gives way here; the same holds for a standing instruction that asks for tests first (a CLAUDE.md or AGENTS.md rule), since the user chose this order for this mode; only a job message that asks for tests first in words still holds; the tests still come from the spec): once it is in, launch the test coders together in one message; each runs its own tests against the code, decides every failure from the spec line, corrects a test only where it contradicts a spec line it can quote, and hands back its file names, its pass and fail totals and the code\'s failures, each with its spec line; you fix the code and make one full run. When the job states a mode gate, the tests come first: a test coder starts before the code exists. Where helpers run in the foreground, it blocks you, so you cannot work meanwhile: launch it in the same message as the coders that write the code, or, when you write the code yourself, launch it first and write the code after it returns; where they run in the background, write the code while it runs. While the code is missing it runs only a syntax check, and it hands back only its file names. Make the first full run yourself once the code is in. When more than a couple of tests fail, do not work through them in your own context: a coder takes the failing names and the spec, decides from the spec line whether each test or the code is wrong, corrects only the tests that contradict a spec line it can quote, and hands you the code\'s failures, each with its spec line. Never brief the tests of code you are about to build as checks of code already written. In both orders a test coder\'s tests are the one exception to reviewing a helper\'s diff: the reviewer judges them at your gate, so read only the tests a failing run points you to.'
  for (const id of BUILDER_IDS) assert.ok(agentFile(id).split('\n').includes(FIRST), `${id} tests first`)
  for (const id of ADVISOR_IDS) assert.ok(!agentFile(id).includes('Tests (not when the job says another section writes the tests)'), `${id} hands out no code`)
  for (const id of BUILDER_IDS) {
    for (const s of ["When the job states no mode gate (no pass mark other than your quality gate's own), the code comes first (the tests-first order of the house rules, and of any skill you load or the job names, gives way here; the same holds for a standing instruction that asks for tests first (a CLAUDE.md or AGENTS.md rule), since the user chose this order for this mode; only a job message that asks for tests first in words still holds; the tests still come from the spec): once it is in, launch the test coders together in one message;", 'When the job states a mode gate, the tests come first: a test coder starts before the code exists.', 'every expected value comes from the spec, never from what the code does.']) assert.ok(agentFile(id).includes(s), `${id} test order: ${s.slice(0, 40)}`)
  }
  for (const id of [...BUILDER_IDS, ...ADVISOR_IDS, 'coder', 'reviewer']) for (const s of ['   - Tests first (not when', 'your planned interfaces']) assert.ok(!agentFile(id).includes(s), `${id} drops ${s}`)
  const PASS = "review the changed files directly. In a security pass or review of other sections' code, report what you checked and what you found. A finding that breaks a spec line, or lets a request act on a secret, a role or a session that has changed or ended, is a failing item however rare the moment it needs (two requests at the same time), never a low or optional one (a case a rule in this file settles, such as content that changed during an outside call, is settled by that rule). Fix a finding of a few lines yourself, test first: the test fails before the fix and goes in the test file that covers that feature. A larger fix goes on your REPORT's Problems line as a failing fix list for the owning section, and you finish with `Status: partial`. Write no other tests: covering the spec belongs to the builders and the testing section. A pass that changes no file needs no grade."
  for (const id of BUILDER_IDS) assert.equal(agentFile(id).includes(PASS), id === 'security', `${id} security pass`)
})

// Round tg: a builder handed back "the spec's reply cannot be given" for a method node:http refuses itself.
test('round tg: backend answers a request node:http would refuse itself', () => {
  const backend = agentFile('backend')
  assert.ok(backend.includes("(an unknown Expect: a bare 417; CONNECT: the socket closes with no reply; a method it does not know or a broken request line: a bare 400): where the spec says how every request is answered, send those through your handler too (on 'clientError' a handler given (err, socket) answers the last: err.code, such as HPE_INVALID_METHOD, and err.rawPacket say what was sent, and it writes the reply to the socket by hand and ends it; with a listener set, Node answers no client error itself, so answer each code: the spec's reply where the spec covers it, else the one Node would have sent (400; 431 for HPE_HEADER_OVERFLOW; 408 for ERR_HTTP_REQUEST_TIMEOUT), and when socket.writable is false or the code is ECONNRESET write nothing and call socket.destroy(); server.on('checkExpectation', handler);"), 'clientError')
  for (const id of BUILDER_IDS) assert.equal(agentFile(id).includes('clientError'), id === 'backend', `${id} clientError only in backend`)
})

// Round tg (judges): a second clock reading passed a single-area gate at 8/10, and in three of four team runs a filter by an id of no user counted rows that still carried it.
test('round tg: the reviewer names a value taken twice, a requirement break is never left on a pass, and a missing row decides over rows that point at it', () => {
  const rv = agentFile('reviewer')
  assert.ok(rv.includes('and so is a test that expects any of these). A result the server worked out itself between a read and the write (a hash, anything awaited that is no outside call) and used after the rows it came from have changed is a fix, a last fallback after retries included. A value the spec fixes once for a request (its time, an id, a token) that is taken again after a wait is a fix (an elapsed-time check on a monotonic clock is not that value), and so is a test of that wait that a second reading would pass. A check of a secret that does less work for an unknown name than for a wrong secret is a fix.\n'), 'reviewer one-time value')
  assert.ok(rv.includes('or the request says a pass lists no test gaps'), 'reviewer no-gap request')
  assert.ok(rv.includes('or that a second reading of a value the spec fixes once for a request would pass after a wait (the fix is the test)'), 'reviewer second reading test')
  for (const id of ADVISOR_IDS) assert.ok(!agentFile(id).includes('a pass lists no test gaps, so tests are read by search'), `${id} no-gap request is the builder's`)
  const NEVER_LEFT = 'apply its fixes of a few lines if you like (never left: code that breaks a stated requirement or crashes, where you fix the code; a doc sentence the code contradicts, where you fix the sentence, or the code when the spec states that sentence; a test a busy machine can fail, or a test of an outside wait that a second reading of a value the spec fixes once for a request would pass, where you fix the test; and, only when the job states a mode gate, a spec line whose tests a named wrong implementation would pass, where the test is added as the walk above says, unless another section writes the tests: with no mode gate, a test gap a pass still lists goes under Next as optional), rerun the tests once, and do not grade again.'
  for (const id of BUILDER_IDS) {
    assert.ok(agentFile(id).includes(NEVER_LEFT), `${id} requirement break never left`)
    assert.ok(!agentFile(id).includes('two kinds are never left'), `${id} old gate text`)
    assert.ok(!agentFile(id).includes('three kinds are never left'), `${id} older gate text`)
    assert.ok(agentFile(id).includes('or a test of an outside wait that a second reading of a value the spec fixes once for a request would pass, where you fix the test'), `${id} second reading test never left`)
    assert.ok(agentFile(id).includes('It grades the changed lines and ends with a GRADE block. When the job states no mode gate, say in the request that a pass lists no test gaps, so tests are read by search and only a spec line in doubt has its tests opened.'), `${id} no-gap request`)
  }
  const MISSING = 'such as ids, as BigInt), a row that points at a row that does not exist included: where the spec says what an id of no existing row gives (it matches nothing, it is not found), that holds even when other rows still carry that id; a request that reads data, waits on an outside call'
  for (const id of [...BUILDER_IDS, ...ADVISOR_IDS, 'coder']) assert.ok(agentFile(id).includes(MISSING), `${id} missing row`)
  assert.ok(agentFile('testing').includes('and rows that point at a row that does not exist, and read them through every route that returns, counts or filters by them (a filter by an id of no existing row gives what the spec says for a missing one, even when such rows carry that id); lock the store from a second connection'), 'dangling filter probe')
  assert.ok(!agentFile('testing').includes('returns or counts them;'), 'old probe text')
})

// Round tg (judges): two of four team runs sent a configured path with a space or a non-ASCII character raw, so http.request threw and every call failed without being sent.
test('round tg: a configured URL keeps its path, with only what a request line cannot carry percent-encoded', () => {
  const ENCODE = 'which keeps the user:password as auth (if its decoding throws on a bad escape, send them undecoded); in that raw path percent-encode as UTF-8 only what a request line cannot carry (a space, a control character, anything outside ASCII), because http.request throws on some of those and the call is never sent), and add no rule the spec does not state'
  for (const id of BUILDER_IDS) assert.ok(agentFile(id).includes(ENCODE), `${id} unsendable characters`)
  for (const id of [...ADVISOR_IDS, 'coder', 'reviewer']) assert.ok(!agentFile(id).includes('percent-encode as UTF-8'), `${id} has no builder rule`)
  assert.ok(agentFile('testing').includes("because a library's normalization is the plausible wrong implementation, and with a space and a non-ASCII character in its path (the call still arrives, with only those characters percent-encoded). Every probe that breaks the spec becomes a test"), 'probe')
})

// The rule above exists because Node refuses such a path before anything is sent. If a later Node stops doing so, this fails and the sentence can go.
test('http.request refuses a path with a space before sending', () => {
  assert.throws(() => http.request({ path: '/a b' }), { code: 'ERR_UNESCAPED_CHARACTERS' })
})

// Round tg (T6): a client that half-closes after its request still gets its reply.
test('round tg T6: the backend role names httpAllowHalfOpen, no other agent does', () => {
  assert.ok(agentFile('backend').includes('A client that ends its sending side once its request is out (a half-close) gets its reply too: set server.httpAllowHalfOpen = true, or Node closes the connection with no reply whenever the handler waits. A reply you write on these paths'), 'backend sentence')
  for (const f of readdirSync(AGENTS)) if (f !== 'backend.md') assert.ok(!readFileSync(new URL(f, AGENTS), 'utf8').includes('httpAllowHalfOpen'), f + ' has no httpAllowHalfOpen')
})

// httpAllowHalfOpen is a property of node:http's Server that Node's http documentation does not list. This guards the plugin machine's Node, not a user project's; if a later Node drops it, this fails and the sentence can go.
test('http server httpAllowHalfOpen decides whether a half-closing client gets its reply', async () => {
  const run = allow => new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      req.socket.on('end', () => setImmediate(() => { res.end('ok') }))
    })
    server.httpAllowHalfOpen = allow
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      let data = ''
      const c = net.connect({ port: server.address().port, host: '127.0.0.1', allowHalfOpen: true })
      c.setEncoding('utf8')
      c.on('data', d => { data += d })
      c.on('error', reject)
      c.on('close', () => { server.close(); resolve(data) })
      c.end('GET / HTTP/1.1\r\nHost: x\r\n\r\n')
    })
  })
  assert.equal(await run(false), '', 'closed with no reply')
  assert.equal((await run(true)).split('\r\n')[0], 'HTTP/1.1 200 OK')
})

// Round tg (T3): tests come first without the head debugging them; coverage comes from the project's own setup; the reviewer reads tests by search.
test('round tg: the head does not debug a test coder tests, coverage needs no tool of its own, the reviewer reads tests by search', () => {
  const A = 'Where helpers run in the foreground, it blocks you, so you cannot work meanwhile:'
  const A2 = 'where they run in the background, write the code while it runs.'
  const B = 'A test that this walk or a grade finds missing in a test file you have not read goes to a coder'
  const C = 'with no mode gate, a test gap a pass still lists goes under Next as optional), rerun the tests once, and do not grade again.'
  const D = 'coverage of started processes not measured'
  const E = 'is no fail for that'
  const F = 'Read tests by search first: one Grep for the test names'
  const G = 'a fix list that comes after your pass is the exception to not grading again'
  for (const id of BUILDER_IDS) for (const s of [A, A2, B, C, D, G]) assert.ok(agentFile(id).includes(s), id + ' holds ' + s.slice(0, 30))
  assert.ok(agentFile('coder').includes(D), 'coder holds D')
  const rv = agentFile('reviewer')
  assert.ok(rv.includes(E) && rv.includes(F), 'reviewer holds E and F')
  for (const id of ADVISOR_IDS) for (const s of [A, A2, B, C, G]) assert.ok(!agentFile(id).includes(s), id + ' holds none of ' + s.slice(0, 30))
  for (const id of [...BUILDER_IDS, ...ADVISOR_IDS, 'coder', 'reviewer']) for (const s of ['expect those tests to fail until the code lands', 'where you add the test, unless', 'never whole test files', 'It runs in the foreground, so you cannot work meanwhile']) assert.ok(!agentFile(id).includes(s), id + ' lost ' + s)
})

test('round tg T4: body before reply on every path, sharper probes, old wording gone', () => {
  const A = 'A reply you write on these paths keeps every rule the spec gives replies: where the spec has the whole request body read before any reply'
  const C = 'check that order, the free reply first, not a duration'
  const D = 'send the made-up method and CONNECT each with a body whose end you hold back'
  const B = 'a status it treats as a normal outcome included: test it with every status the spec gives a rule of its own.'
  for (const id of [...BUILDER_IDS, ...ADVISOR_IDS, 'coder', 'reviewer']) {
    const f = agentFile(id)
    assert.equal(f.includes(A), id === 'backend', `${id} reply rules`)
    assert.equal(f.includes(C), id === 'testing', `${id} lock order`)
    assert.equal(f.includes(D), id === 'testing', `${id} method probe`)
    assert.equal(f.includes(B), BUILDER_IDS.includes(id), `${id} unparsable body`)
    for (const old of ['allowing a small margin', 'is answered at once', '; test that case.']) assert.ok(!f.includes(old), `${id} lacks ${old}`)
  }
})

test('round tg T4: a final review without a mode gate adds a test only for a broken probe or an untested line', () => {
  const S = 'reporting the commands and results. Unless the job states a mode gate, a final review adds a test only for a probe that broke the spec and for a spec line that has no test at all (a job that asks it to fill test gaps means those spec lines, not tests that could be sharper); for that job this limits the rule above that each spec requirement gets a test a plausible wrong implementation would fail (each builder\'s gate scored its tests on that): it writes no test only to raise a coverage figure, and a test that covers its line but could be sharper is one optional line in your REPORT, not work for a coder. When a job asks for it'
  for (const id of [...BUILDER_IDS, ...ADVISOR_IDS, 'coder', 'reviewer']) {
    const f = agentFile(id)
    assert.equal(f.includes(S), id === 'testing', `${id} final review limit`)
    if (id !== 'testing') assert.ok(!f.includes('a final review adds a test only for'), `${id} lacks limit`)
  }
})
