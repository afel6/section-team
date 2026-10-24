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
    assert.equal(fm.model, 'claude-opus-5-5')
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
  assert.ok(frontend.includes('skip a separate full review pass'), 'frontend.md lost the separate-review line')
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

test('every builder gets the firm helper rule: delegate the bulk, never override the helper model, pass project rules to the coder', () => {
  for (const id of BUILDER_IDS) {
    const text = agentFile(id)
    assert.ok(text.includes('you run on Opus, the most expensive model, so delegate the bulk'), `${id} delegate the bulk`)
    assert.ok(text.includes('Keep for yourself'), `${id} keep for yourself`)
    assert.ok(text.includes('do not pass `model`'), `${id} do not pass model`)
    assert.ok(text.includes('(Haiku; do not pass `model`)'), `${id} scout model`)
    assert.ok(text.includes('(Sonnet; do not pass `model`). Include in its prompt the project rules that apply to the task. Review its diff before accepting it.'), `${id} coder rule`)
    assert.ok(text.includes('If your job touches more than 2 files or needs tests, use at least one helper.'), `${id} at least one helper`)
  }
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
})
