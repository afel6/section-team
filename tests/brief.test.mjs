import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assembleBrief, modeRules } from '../hooks/lib/brief.mjs'
import { GATES } from '../hooks/lib/mode.mjs'

const BRIEF_DIR = fileURLToPath(new URL('../brief/', import.meta.url))
const FIXTURE = fileURLToPath(new URL('./fixtures/supervisor-balanced.md', import.meta.url))
const MODES = ['balanced', 'max']
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

test('balanced brief matches its fixture, character for character', () => {
  assert.equal(assembleBrief('balanced'), readFileSync(FIXTURE, 'utf8').trim())
})

// Measured on local transcripts, 2026-10-24 to 2026-11-04: 59% of the spend on section heads went on rewriting an expired prompt cache.
test('every mode gives a new job a fresh section and keeps SendMessage for the same job', () => {
  for (const mode of MODES) {
    const brief = assembleBrief(mode)
    assert.ok(brief.includes('- One agent id per job: a section on two jobs has two ids, so keep both. A new job gets a fresh Agent call (long-lived sections cost more). SendMessage only continues that job: a fix list, a question, a resume.'), mode)
    assert.ok(brief.length < 9000, `${mode} brief is ${brief.length} chars`)
    assert.ok(!brief.includes("Keep each job's agent id"), mode)
    assert.ok(brief.includes('start a fresh one on the final-review job'), mode)
    assert.ok(brief.includes('(wake it if it has no id)'), mode)
    assert.ok(!brief.includes('Wake each section once per session'), mode)
    assert.ok(!brief.includes('so it keeps its context'), mode)
  }
})

test('every mode drops the advisor aside and the new skills section, and keeps add-skill for a suggested skill', () => {
  for (const mode of MODES) {
    const brief = assembleBrief(mode)
    assert.ok(!brief.includes('ai-engineer advises on AI decisions'), mode)
    assert.ok(!brief.includes('## New skills'), mode)
    assert.ok(!brief.includes('When the user pastes a GitHub link'), mode)
    assert.ok(brief.includes('with the `section-team:add-skill` skill'), mode)
  }
})

test('every mode tells the supervisor to run project MCP calls for sections, under How to wake a section', () => {
  const rule = '- Sections have no project MCP tools: when one asks, run the call yourself and reply to its agent id.'
  for (const mode of MODES) {
    const section = assembleBrief(mode).split('## How to wake a section\n')[1].split('\n## ')[0]
    assert.ok(section.split('\n').includes(rule), mode)
  }
})

test('balanced brief leaves out the job-message gate sentence that only max carries', () => {
  assert.ok(!assembleBrief('balanced').includes(JOB_GATE))
})

test('max brief stays within 90 lines', () => {
  assert.ok(assembleBrief('max').split('\n').length <= 90)
})

// Claude Code cuts hook context at 10,000 characters and session start appends up to about 1,000 more:
// the skill note, the last summary, the plan line and the mode section.
test('every mode brief is under 9000 characters', () => {
  for (const mode of MODES) {
    const { length } = assembleBrief(mode)
    assert.ok(length < 9000, `${mode} brief is ${length} chars`)
  }
})

test('max brief: pass mark 9, no item under 7, 2 fix rounds, no near-miss copies', () => {
  const brief = assembleBrief('max')
  for (const text of ['overall at least 9', 'no item under 7', '2 fix rounds']) {
    assert.ok(brief.includes(text), `max brief lacks "${text}"`)
  }
  for (const text of ['near-miss', '3 fix rounds']) assert.ok(!brief.includes(text), `max brief still has "${text}"`)
})

test('max brief holds the three proof steps', () => {
  const brief = assembleBrief('max')
  for (const text of [
    'the security section for a security pass before the final review',
    "run two final reviews, one after the other, each by a fresh testing section; never show the second the first's REPORT",
    'Before you say done, run yourself the one command a testing section hands back (ask every testing job for it: it starts the app, prints one PASS or FAIL line per critical flow named in the foundation note or the task, then stops the app), and report each flow; read no source file for this check.',
    'Every hand-back with a changed file needs a reviewer grade, docs too.',
  ]) assert.ok(brief.includes(text), `max brief lacks "${text}"`)
})

test('the balanced brief does not mention .team/near-miss', () => {
  assert.ok(!assembleBrief('balanced').includes('.team/near-miss'))
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
    if (mode === 'balanced') continue // Balanced jobs use the sections' default gate, so it has no job-message rule
    const job = gate.find(line => line.startsWith(`- ${JOB_GATE}`))
    assert.ok(job !== undefined, `${mode}: the gate lacks the job-message rule`)
    assert.ok(job.includes('the near-miss check') === nearMiss, `${mode}: the job-message rule must name the near-miss check only when GATES says so`)
    assert.ok(job.includes(`\`model: "${reviewerModel}"\``) === (reviewerModel !== null), `${mode}: the job-message rule must name the reviewer model only when GATES sets one`)
  }
})

test('max tiers add probing, security and docs always', () => {
  const tiers = part('tiers-max')
  for (const text of [
    'have the testing section probe it',
    'ask it to probe every spec line). Code that takes user input',
    'user input or touches files or the network also gets a security section review',
    'the security section for a security pass',
    '(the one cross-review you ask for)',
    'testing for tests, the security section',
    'and the docs section always, after the builders report',
    'the security pass and advisors not counted',
  ]) {
    assert.ok(tiers.includes(text), `tiers-max lacks "${text}"`)
  }
  assert.ok(!tiers.includes('Wake nobody'), 'tiers-max must not tell the supervisor to wake nobody')
})

const BUILDER_LINE = 'Wake the matching builder section; it writes the code, its tests and any README asked for, and runs its own gate.'

test('every mode sends small and single-area jobs to a builder section, and nothing tells the supervisor to build', () => {
  for (const mode of MODES) {
    const tiers = lines(part(`tiers-${mode}`))
    for (const label of ['Small task', 'Single-area task']) {
      const line = tiers.find(l => l.includes(`${label}:`))
      assert.ok(line !== undefined && line.startsWith(`- ${BUILDER_LINE}`), `${mode}: the ${label} line must open with the builder sentence`)
    }
    const brief = assembleBrief(mode)
    assert.ok(brief.includes(BUILDER_LINE), mode)
    assert.ok(!/(?<!not )\bbuild\b/i.test(brief), `${mode}: a sentence still tells the supervisor to build`)
    for (const old of ['Wake nobody', 'doing small work yourself', 'Wake no builder section']) assert.ok(!brief.includes(old), `${mode}: still says "${old}"`)
    assert.ok(brief.length < 9000, `${mode} brief is ${brief.length} chars`)
  }
})

test('every mode counts only builders toward the plan rule, and balanced runs security before the one cross-review', () => {
  for (const mode of MODES) {
    const plan = lines(part(`tiers-${mode}`)).find(line => line.startsWith('- 3 or more distinct builders'))
    assert.ok(plan.includes('(testing, docs, the security pass and advisors not counted)'), mode)
  }
  for (const mode of ['balanced']) {
    const multi = lines(part(`tiers-${mode}`)).find(line => line.startsWith('- Multi-area work'))
    assert.ok(multi.endsWith(' Run it before the final review; it is the one cross-review you ask for.'), mode)
  }
})

// Max differs from Balanced only in the mode table's rules, so Balanced's other tier rules must stay in it.
test('max tiers keep the balanced tier rules that do not depend on the mode', () => {
  const balanced = lines(part('tiers-balanced'))
  const advisor = balanced.find(line => line.startsWith('- An AI or data decision'))
  const plan = balanced.find(line => line.startsWith('- 3 or more distinct builders'))
  assert.ok(advisor !== undefined && plan !== undefined, 'tiers-balanced lacks the advisor or the plan rule')
  assert.ok(plan.includes('(testing, docs, the security pass and advisors not counted)'), 'the plan rule must exclude testing, docs, the security pass and advisors')
  const shared = [
    'one kind of work (a CLI, an API, a library, a page, a schema)',
    'up to about 600 lines of new code',
    'runs its own gate',
    'When unsure between this and multi-area work, do this.',
    'Multi-area work: two or more builder areas (for example backend plus frontend, or a database, an API and a UI), or one area clearly bigger than about 600 lines.',
    'Wake each needed builder',
    'Do not build multi-area work yourself, even when the plan is pre-approved.',
    'Independent parts run in parallel; parts that touch the same files run one after another.',
  ]
  for (const text of shared) assert.ok(balanced.some(line => line.includes(text)), `tiers-balanced lacks "${text.slice(0, 60)}"`)
  const own = {
    max: {
      wholeLines: [advisor, plan],
      phrases: [
        'about 50 lines of new code or less',
        'Tell it to give each spec requirement a test that a plausible wrong implementation would fail (NFD instead of NFKD, trim instead of trimEnd, < instead of <=), not only the spec examples.',
        'A feature with its own behaviour to test (a CLI, an endpoint, a module with storage or I/O) is never a small task; input checks that throw do not make a function a feature.',
        "(give it the files, the behaviour to cover and the spec's edge cases, and ask it to probe every spec line)",
        'Wake no other builder section.',
      ],
    },
  }
  for (const mode of ['max']) {
    const tiers = part(`tiers-${mode}`)
    const tierLines = lines(tiers)
    for (const line of own[mode].wholeLines) assert.ok(tierLines.includes(line), `tiers-${mode} lacks the whole line "${line.slice(0, 60)}"`)
    for (const text of [...shared, ...own[mode].phrases]) assert.ok(tiers.includes(text), `tiers-${mode} lacks "${text.slice(0, 60)}"`)
  }
})

test('max brief ends the gate with the job-message rule', () => {
  for (const mode of ['max']) {
    assert.ok(assembleBrief(mode).includes(JOB_GATE), `${mode} brief lacks the rule`)
    assert.ok(modeRules(mode).split('\n').at(-1).startsWith(`- ${JOB_GATE}`), `${mode} gate does not end with the rule`)
  }
})

test('max mode rules are the two mode-specific blocks and nothing else', () => {
  const rules = modeRules('max')
  assert.ok(rules.startsWith('## When to wake sections\n'))
  assert.ok(rules.includes('\n\n## Reviewer gate\n'))
  for (const text of ['overall at least 9', 'no item under 7', '2 fix rounds', 'two final reviews']) {
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

test('max gates keep the balanced gate rules that do not depend on the mode', () => {
  // Max grades every changed file, so Balanced's docs-only skip is not one of them.
  const shared = lines(part('gate-balanced')).filter(line => !line.includes('Pass:') && !line.includes('fix round') && !line.startsWith('- Docs-only'))
  assert.ok(shared.length > 0)
  for (const mode of ['max']) {
    const own = new Set(lines(part(`gate-${mode}`)))
    for (const line of shared) assert.ok(own.has(line), `gate-${mode} lacks: ${line.slice(0, 60)}`)
  }
})

// p1 round: the supervisor building code itself drove its chat to 189K-205K. Its gate is the one it gives sections and runs on ungraded work.
test('every mode tells the supervisor it writes no product code, tests or docs, and its gate is for sections', () => {
  for (const mode of MODES) {
    const brief = assembleBrief(mode)
    assert.ok(brief.split('\n')[1].endsWith(' You write no product code, tests or docs yourself.'), mode)
    assert.ok(brief.includes('\n## Reviewer gate\n- On a `Status: ungraded` REPORT, run Agent `section-team:reviewer` on its changed files'), mode)
    assert.ok(brief.includes('- If it fails, send the fix list to the section and grade again: at most 2 fix rounds.'), mode)
    assert.ok(brief.includes('- Tell each code builder to map every OS error its code can hit'), mode)
    for (const old of ['Your own code', 'your own code', 'wrote yourself', 'fix the listed items', 'Map every OS error']) {
      assert.ok(!brief.includes(old), `${mode}: still says "${old}"`)
    }
  }
  assert.ok(!assembleBrief('max').includes('Docs-only'), 'max grades docs too, so it has no docs-only skip')
  assert.ok(lines(part('gate-balanced')).includes('- Docs-only work skips this gate.'))
})

test('an unknown mode is refused with one friendly line', () => {
  const unknown = { message: /^unknown mode "turbo": pick balanced or max$/ }
  assert.throws(() => assembleBrief('turbo'), unknown)
  assert.throws(() => modeRules('turbo'), unknown)
  assert.throws(() => assembleBrief('lean'), { message: 'unknown mode "lean": Lean was removed in 0.3.0, pick balanced or max' })
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
  assert.throws(() => assembleBrief('max', missing), { message: coreMessage('GATE') })
  assert.throws(() => modeRules('max', missing), { message: coreMessage('GATE') })
  const doubled = editCore(core => `${core}\n{{TIERS}}\n`)
  assert.throws(() => assembleBrief('max', doubled), { message: coreMessage('TIERS') })
  assert.throws(() => modeRules('max', doubled), { message: coreMessage('TIERS') })
  const headless = editCore(core => core.replace('## When to wake sections\n', 'When to wake sections\n'))
  assert.throws(() => assembleBrief('max', headless), { message: coreMessage('TIERS') })
  assert.throws(() => modeRules('max', headless), { message: coreMessage('TIERS') })
})

test('part text is put in literally, so $&, $1, $$ and $\' survive', () => {
  const dir = briefCopy()
  writeFileSync(join(dir, 'tiers-max.md'), `${LITERAL}\n`)
  assert.ok(assembleBrief('max', dir).includes(LITERAL))
})

test('no lean brief part is left', () => {
  for (const name of ['tiers-lean.md', 'gate-lean.md']) assert.equal(existsSync(join(BRIEF_DIR, name)), false, name)
})
