import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ROSTER, render, renderAll, RUBRIC_ITEMS, PASS_RULE } from '../scripts/gen-agents.mjs'
import { BUILDER_IDS, ADVISOR_IDS, ADVISOR_HELPERS } from '../hooks/lib/report.mjs'

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
    // Every section head runs on Opus: benchmark rounds 4–6 showed Sonnet heads land at solo quality even with the Opus gate.
    assert.equal(fm.model, 'claude-opus-5-5', `${file} model`)
    assert.equal(fm.memory, 'user')
    assert.ok(COLORS.includes(fm.color), `${file} colour ${fm.color}`)
    assert.ok(text.includes('## REPORT · '), `${file} has no REPORT template`)
    assert.ok(text.includes('pass `model` explicitly'), `${file} has no model routing`)
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

const agentFile = id => readFileSync(new URL(`${id}.md`, AGENTS), 'utf8')

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
  }
  for (const id of ADVISOR_IDS) assert.ok(!agentFile(id).includes('write its note now'), `${id} is read-only and writes no notes`)
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
    if (BUILDER_IDS.includes(id)) assert.ok(text.includes('Agent `section-team:reviewer` with `run_in_background: false`') || text.includes('Agent `section-team:reviewer`, with `run_in_background: false`'), `${id} foreground reviewer`)
  }
})

test('S2 direct: builders message a sibling by agent id and keep the supervisor as fallback', () => {
  for (const id of BUILDER_IDS) {
    const text = agentFile(id)
    assert.ok(text.includes('SendMessage its agent id (the job lists the ids of awake sections)'), `${id} direct message`)
    assert.ok(text.includes('SendMessage the supervisor (`main`)'), `${id} main fallback`)
    assert.ok(text.includes('finish with `Status: blocked`'), `${id} blocked fallback`)
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
  const CORE = { frontend: ['frontend-design:frontend-design'], testing: ['tdd-workflow'], security: ['security-review'], 'ai-llm': ['claude-api'], 'ai-engineer': ['claude-api'] }
  for (const s of ROSTER) {
    assert.ok(s.core.length <= 1, `${s.id} preloads more than one skill`)
    assert.deepEqual(s.core, CORE[s.id] ?? [], `${s.id} core`)
    const text = agentFile(s.id)
    assert.deepEqual(frontSkills(text), s.core, `${s.id} frontmatter skills`)
    for (const skill of s.skills.filter(k => !s.core.includes(k))) assert.ok(text.includes(skill), `${s.id} lost go-to ${skill}`)
  }
})

test('every REPORT has a Quality line between Tests and Coordination', () => {
  for (const s of ROSTER) {
    const text = agentFile(s.id)
    assert.match(text, /^Tests: .*\nQuality:      <overall>\/10 \(reviewer, <n> fix rounds\) \| n\/a \(no code\)\nCoordination: /m, `${s.id} Quality line`)
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
  assert.ok(agentFile('testing').includes("Probe the code against the spec line by line before you grade it: for each line try its boundaries, empty and null values, non-ASCII and control characters (CR or LF in anything that reaches a header), and missing, empty or invalid environment values. Every probe that breaks the spec becomes a test and goes on its owner's fix list."))
  for (const id of BUILDER_IDS) assert.ok(agentFile(id).includes('Where a spec line can be read two ways, build or test the stricter reading and log the choice in `.team/notes/decisions.md`.'), `${id} stricter reading`)
  assert.ok(agentFile('testing').includes('Message a builder only with a failing fix list it must act on. A passing verdict and optional findings (nits, suggestions) go in your REPORT, not to the builders: a message wakes a section that has already handed back.'))
  const testing = agentFile('testing')
  assert.ok(testing.includes("run the reviewer over every section's changed files"))
  assert.ok(testing.includes('send each owning section its part of the fix list'))
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
  assert.ok(text.includes(PASS_RULE))
  assert.ok(text.includes('## GRADE'))
  assert.ok(text.includes('Grade only the changed lines and the functions around them.'))
  assert.ok(text.includes('Never edit files and never spawn agents.'))
  assert.ok(text.includes('Project rules: read and follow whichever of these exist in the project: CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md, AGENTS.md, .claude/rules/*.md, plus any files they @-import; in a monorepo also the CLAUDE.md/AGENTS.md of parent folders up to the repo root.'), 'reviewer project rules')
  assert.ok(text.includes("Where the project's own rules differ from the house rules, the project's rules win."))
  assert.ok(text.includes('Score each item 1–10:'))
  assert.ok(!text.includes('0–10'))
})
