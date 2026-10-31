import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assembleBrief, modeRules } from '../hooks/lib/brief.mjs'
import { GATES } from '../hooks/lib/mode.mjs'

const BRIEF_DIR = fileURLToPath(new URL('../brief/', import.meta.url))
const FIXTURE = fileURLToPath(new URL('./fixtures/supervisor-v0.1.1.md', import.meta.url))
const MODES = ['lean', 'balanced', 'max']
const JOB_GATE = "Every job message states this mode's gate"
const NEAR_MISS_RULE = '- The gate also fails while a near-miss copy passes the tests; testing adds tests until each fails.'
const LITERAL = "- costs $& and $1 and $$ and $'"
const temps = []

const part = name => readFileSync(join(BRIEF_DIR, `${name}.md`), 'utf8')
const lines = text => text.split('\n').filter(line => line !== '')
const rounds = n => `${n} fix round${n === 1 ? '' : 's'}`
const briefCopy = () => {
  const parent = mkdtempSync(join(tmpdir(), 'ct-brief-'))
  temps.push(parent)
  const dir = join(parent, 'brief')
  cpSync(BRIEF_DIR, dir, { recursive: true })
  return dir
}
const editCore = edit => {
  const dir = briefCopy()
  const file = join(dir, 'core.md')
  const before = readFileSync(file, 'utf8')
  const after = edit(before)
  assert.notEqual(after, before, 'the edit must change core.md')
  writeFileSync(file, after)
  return dir
}
const coreMessage = marker => new RegExp(`^brief part core\\.md must hold \\{\\{${marker}\\}\\} once, on its own line under a heading$`)
const readFailure = (dir, message) => err => {
  assert.ok(err instanceof Error)
  assert.equal(err.message, message)
  assert.ok(!err.message.includes(dir), 'the message must not show the folder')
  return true
}

after(() => temps.forEach(dir => rmSync(dir, { recursive: true, force: true })))

test('balanced brief is the v0.1.1 supervisor brief, character for character', () => {
  assert.equal(assembleBrief('balanced'), readFileSync(FIXTURE, 'utf8').trim())
})

test('balanced brief leaves out the job-message gate sentence that only lean and max carry', () => {
  assert.ok(!assembleBrief('balanced').includes(JOB_GATE))
})

test('max brief stays within 90 lines', () => {
  assert.ok(assembleBrief('max').split('\n').length <= 90)
})

// Claude Code cuts hook context at 10,000 characters and session start appends up to about 1,000 more:
// the skill note, the mode section and the last summary.
test('every mode brief is under 9000 characters', () => {
  for (const mode of MODES) {
    const { length } = assembleBrief(mode)
    assert.ok(length < 9000, `${mode} brief is ${length} chars`)
  }
})

test('lean brief: sonnet reviewer, 1 fix round, a test per spec line, no testing section for a single area', () => {
  const brief = assembleBrief('lean')
  assert.ok(brief.includes('model: "sonnet"'))
  assert.ok(brief.includes('1 fix round'))
  assert.ok(brief.includes('give each spec line a test a plausible wrong implementation fails'))
  assert.ok(!brief.includes('wake only the testing section'))
})

test('max brief: pass mark 9, no item under 7, 3 fix rounds, near-miss copies', () => {
  const brief = assembleBrief('max')
  for (const text of ['overall at least 9', 'no item under 7', '3 fix rounds', 'near-miss']) {
    assert.ok(brief.includes(text), `max brief lacks "${text}"`)
  }
})

test('each gate part states its mode\'s GATES values', () => {
  for (const mode of MODES) {
    const { passOverall, minItem, fixRounds, reviewerModel, nearMiss } = GATES[mode]
    const gate = lines(part(`gate-${mode}`))
    const pass = `Pass: overall at least ${passOverall}${minItem === null ? '' : ` and no item under ${minItem}`}.`
    assert.ok(gate[0].endsWith(pass), `${mode}: the first line must end with "${pass}"`)
    const reviewer = reviewerModel === null ? '(Opus; do not pass `model`)' : `with \`model: "${reviewerModel}"\` (the one Agent call where you pass \`model\`)`
    assert.ok(gate[0].includes(reviewer), `${mode}: the first line must include ${reviewer}`)
    const failing = gate.filter(line => line.startsWith('- If it fails'))
    assert.equal(failing.length, 1, `${mode}: expected exactly one "- If it fails" line`)
    assert.ok(failing[0].includes(`at most ${rounds(fixRounds)}.`), `${mode}: the "- If it fails" line must say at most ${rounds(fixRounds)}`)
    const sections = `- Sections get ${rounds(fixRounds)} here, not the 2 under Failures.`
    assert.equal(gate.includes(sections), fixRounds !== GATES.balanced.fixRounds, `${mode}: the "Sections get" line is wrong`)
    assert.equal(part(`gate-${mode}`).includes('near-miss'), nearMiss, `${mode}: near-miss must appear only when GATES says so`)
    assert.equal(gate.includes(NEAR_MISS_RULE), nearMiss, `${mode}: the near-miss gate rule is wrong`)
    if (mode === 'balanced') continue // Balanced stays the v0.1.1 brief word for word, so it has no job-message rule
    const job = gate.find(line => line.startsWith(`- ${JOB_GATE}`))
    assert.ok(job !== undefined, `${mode}: the gate lacks the job-message rule`)
    assert.ok(job.includes('the near-miss check') === nearMiss, `${mode}: the job-message rule must name the near-miss check only when GATES says so`)
    assert.ok(job.includes(`\`model: "${reviewerModel}"\``) === (reviewerModel !== null), `${mode}: the job-message rule must name the reviewer model only when GATES sets one`)
  }
})

test('max tiers add probing, near-miss copies, security and docs always', () => {
  const tiers = part('tiers-max')
  for (const text of [
    'have the testing section probe it',
    'near-miss copies of the key functions (one plausible bug each)',
    'user input or touches files or the network also gets a security section review',
    'the security section for a security pass',
    '(the one cross-review you ask for)',
    'near-miss copies and final verification',
    'the docs section always',
    'the security pass and advisors not counted',
  ]) {
    assert.ok(tiers.includes(text), `tiers-max lacks "${text}"`)
  }
  assert.ok(!tiers.includes('Wake nobody'), 'tiers-max must not tell the supervisor to wake nobody')
})

test('lean tiers keep tests with the supervisor and builders, and testing for the final check only', () => {
  const tiers = part('tiers-lean')
  for (const text of [
    'Wake no section.',
    'try to break it with bad input',
    'each writes the tests for its own code',
    'the testing section only for the final check',
  ]) {
    assert.ok(tiers.includes(text), `tiers-lean lacks "${text}"`)
  }
  for (const text of ['near-miss', 'security']) {
    assert.ok(!tiers.includes(text), `tiers-lean must not mention "${text}"`)
  }
})

// Lean and Max differ from Balanced only in the mode table's rules, so Balanced's other tier rules must stay in both.
test('lean and max tiers keep the balanced tier rules that do not depend on the mode', () => {
  const balanced = lines(part('tiers-balanced'))
  const advisor = balanced.find(line => line.startsWith('- An AI or data decision'))
  const plan = balanced.find(line => line.startsWith('- 3 or more distinct builders'))
  assert.ok(advisor !== undefined && plan !== undefined, 'tiers-balanced lacks the advisor or the plan rule')
  const maxPlan = plan.replace('docs and advisors', 'docs, the security pass and advisors')
  assert.notEqual(maxPlan, plan, 'the plan rule in tiers-balanced no longer says "docs and advisors"')
  const shared = [
    'one kind of work (a CLI, an API, a library, a page, a schema)',
    'up to about 600 lines of new code',
    'run the reviewer gate on your changed files',
    'When unsure between this and waking sections for one area, do this.',
    'Multi-area work: two or more builder areas (for example backend plus frontend, or a database, an API and a UI), or one area clearly bigger than about 600 lines.',
    'Wake each needed builder',
    'Do not build multi-area work yourself, even when the plan is pre-approved.',
    'Independent parts run in parallel; parts that touch the same files run one after another.',
  ]
  for (const text of shared) assert.ok(balanced.some(line => line.includes(text)), `tiers-balanced lacks "${text.slice(0, 60)}"`)
  const own = {
    lean: {
      wholeLines: [advisor, plan],
      phrases: ['add the docs section when the task asks for docs or a README'],
    },
    max: {
      wholeLines: [advisor, maxPlan],
      phrases: [
        'about 50 lines of new code or less',
        'build it and its tests yourself',
        'Give each spec requirement a test that a plausible wrong implementation would fail (NFD instead of NFKD, trim instead of trimEnd, < instead of <=), not only the spec examples.',
        'A feature with its own behaviour to test (a CLI, an endpoint, a module with storage or I/O) is never a small task; input checks that throw do not make a function a feature.',
        'build the code yourself (and any README it asks for)',
        "(give it the files, the behaviour to cover and the spec's edge cases, and ask it to probe every spec line)",
        'run the reviewer gate on your own changed files before you call it done; testing gates its own test files.',
        'Wake no other builder section.',
      ],
    },
  }
  for (const mode of ['lean', 'max']) {
    const tiers = part(`tiers-${mode}`)
    const tierLines = lines(tiers)
    for (const line of own[mode].wholeLines) assert.ok(tierLines.includes(line), `tiers-${mode} lacks the whole line "${line.slice(0, 60)}"`)
    for (const text of [...shared, ...own[mode].phrases]) assert.ok(tiers.includes(text), `tiers-${mode} lacks "${text.slice(0, 60)}"`)
  }
})

test('lean and max briefs end the gate with the job-message rule', () => {
  for (const mode of ['lean', 'max']) {
    assert.ok(assembleBrief(mode).includes(JOB_GATE), `${mode} brief lacks the rule`)
    assert.ok(modeRules(mode).split('\n').at(-1).startsWith(`- ${JOB_GATE}`), `${mode} gate does not end with the rule`)
  }
})

test('max mode rules are the two mode-specific blocks and nothing else', () => {
  const rules = modeRules('max')
  assert.ok(rules.startsWith('## When to wake sections\n'))
  assert.ok(rules.includes('\n\n## Your own code\n'))
  for (const text of ['near-miss', 'overall at least 9', 'no item under 7', '3 fix rounds']) {
    assert.ok(rules.includes(text), `max rules lack "${text}"`)
  }
  assert.ok(!rules.includes('## Sections'))
  assert.ok(!rules.includes('## How to wake a section'))
})

test('every line of the mode rules is a line of the assembled brief', () => {
  for (const mode of MODES) {
    const assembled = new Set(assembleBrief(mode).split('\n'))
    for (const line of lines(modeRules(mode))) {
      assert.ok(assembled.has(line), `${mode}: line missing from the brief: ${line.slice(0, 60)}`)
    }
  }
})

test('lean and max gates keep the balanced gate rules that do not depend on the mode', () => {
  const shared = lines(part('gate-balanced')).filter(line => !line.includes('Pass:') && !line.includes('fix round'))
  assert.ok(shared.length > 0)
  for (const mode of ['lean', 'max']) {
    const own = new Set(lines(part(`gate-${mode}`)))
    for (const line of shared) assert.ok(own.has(line), `gate-${mode} lacks: ${line.slice(0, 60)}`)
  }
})

test('an unknown mode is refused with one friendly line', () => {
  const unknown = { message: /^unknown mode "turbo": pick lean, balanced or max$/ }
  assert.throws(() => assembleBrief('turbo'), unknown)
  assert.throws(() => modeRules('turbo'), unknown)
  assert.throws(() => assembleBrief(undefined), { message: /^unknown mode \(not shown\)/ })
})

test('a missing part file is named without the folder, and other modes still build', () => {
  const dir = briefCopy()
  rmSync(join(dir, 'tiers-max.md'))
  const message = 'brief part tiers-max.md could not be read (ENOENT)'
  assert.throws(() => assembleBrief('max', dir), readFailure(dir, message))
  assert.throws(() => modeRules('max', dir), readFailure(dir, message))
  assert.equal(assembleBrief('balanced', dir), readFileSync(FIXTURE, 'utf8').trim())
})

test('a core.md with a marker missing, doubled or not under a heading is refused', () => {
  const missing = editCore(core => core.replace('{{GATE}}\n', ''))
  assert.throws(() => assembleBrief('lean', missing), { message: coreMessage('GATE') })
  assert.throws(() => modeRules('lean', missing), { message: coreMessage('GATE') })
  const doubled = editCore(core => `${core}\n{{TIERS}}\n`)
  assert.throws(() => assembleBrief('lean', doubled), { message: coreMessage('TIERS') })
  assert.throws(() => modeRules('lean', doubled), { message: coreMessage('TIERS') })
  const headless = editCore(core => core.replace('## When to wake sections\n', 'When to wake sections\n'))
  assert.throws(() => assembleBrief('lean', headless), { message: coreMessage('TIERS') })
  assert.throws(() => modeRules('lean', headless), { message: coreMessage('TIERS') })
})

test('part text is put in literally, so $&, $1, $$ and $\' survive', () => {
  const dir = briefCopy()
  writeFileSync(join(dir, 'tiers-lean.md'), `${LITERAL}\n`)
  assert.ok(assembleBrief('lean', dir).includes(LITERAL))
})
