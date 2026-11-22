import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_NAMES, namesFile, parseNames, cleanName, applyName, listNames, serializeNames, NO_HOME_LINE, UNREADABLE_LINE } from '../hooks/lib/names.mjs'

const D = { ...DEFAULT_NAMES }
const BAD = 'Names are 1 to 12 letters, digits, spaces or dashes, starting with a letter or digit.'

test('defaults come from the crew and the file lives under the home folder', () => {
  assert.equal(D.frontend, 'Iris')
  assert.equal(D.backend, 'Moss')
  assert.equal(namesFile('/h'), '/h/.claude/section-team/names.json')
  assert.equal(NO_HOME_LINE, 'Names need USERPROFILE or HOME to be set.')
  assert.equal(UNREADABLE_LINE, 'names.json could not be read, so the default names are shown; the next rename rewrites it.')
})

test('cleanName trims, composes and collapses spaces', () => {
  assert.equal(cleanName('  Nova   Star '), 'Nova Star')
  assert.equal(cleanName('No\u0308va'), 'Növa')
})

for (const [raw, stored] of [['Nova', 'Nova'], ['R2-D2', 'R2-D2'], ['Növa', 'Növa'], ['No\u0308va', 'Növa'], ['نور', 'نور'], ['नोवा', 'नोवा'], ['ABCDEFGHIJKL', 'ABCDEFGHIJKL'], ['ABCDEFGHIJK' + 'e\u0301', 'ABCDEFGHIJKé']]) {
  test(`accepts ${JSON.stringify(raw)}`, () => {
    assert.equal(applyName(D, 'backend', raw).next.backend, stored)
  })
}

for (const raw of ['', '   ', 'ABCDEFGHIJKLM', ' -Nova', '-Nova', '<b>', 'Nova😀']) {
  test(`refuses ${JSON.stringify(raw)}`, () => {
    assert.deepEqual(applyName(D, 'backend', raw), { line: BAD })
  })
}

test('another builder default or current name is taken, ignoring case', () => {
  assert.deepEqual(applyName(D, 'backend', 'iris'), { line: 'iris is taken by frontend; pick another name.' })
  const cur = applyName(D, 'frontend', 'Nova').next
  assert.deepEqual(applyName(cur, 'backend', 'NOVA'), { line: 'NOVA is taken by frontend; pick another name.' })
})

test('naming a builder its own default is a reset', () => {
  const r = applyName({ ...D, backend: 'Nova' }, 'backend', 'Moss')
  assert.equal(r.line, 'Nova is back to Moss (backend).')
  assert.equal(r.next.backend, 'Moss')
})

test('set returns the line and the new names without mutating', () => {
  const r = applyName(D, 'Backend', '  Nova   Star ')
  assert.equal(r.line, 'Moss is now Nova Star (backend).')
  assert.equal(r.next.backend, 'Nova Star')
  assert.equal(D.backend, 'Moss')
})

test('reset', () => {
  const r = applyName({ ...D, backend: 'Nova' }, 'backend')
  assert.equal(r.line, 'Nova is back to Moss (backend).')
  assert.equal(r.next.backend, 'Moss')
  assert.deepEqual(applyName(D, 'backend'), { line: 'Moss already has its own name (backend).' })
})

test('advisors and unknown sections', () => {
  assert.deepEqual(applyName(D, 'ai-engineer', 'Ada'), { line: 'Advisors have no desk to name.' })
  assert.deepEqual(applyName(D, 'chef', 'Ada'), { line: 'No builder called chef. Builders: frontend, backend, database, testing, security, devops, uiux, docs, ai-llm, mobile.' })
})

test('serialize keeps only the renamed builders', () => {
  assert.equal(serializeNames({ ...D, backend: 'Nova' }), '{"v":1,"names":{"backend":"Nova"}}')
  assert.equal(serializeNames(D), '{"v":1,"names":{}}')
})

test('parse', () => {
  assert.deepEqual(parseNames(null), { names: D, problem: null })
  assert.deepEqual(parseNames('{"v":1,"names":{"backend":"Nova"'), { names: D, problem: 'names.json is not valid' })
  assert.deepEqual(parseNames('{"v":2,"names":{}}'), { names: D, problem: 'names.json is not valid' })
  assert.deepEqual(parseNames('{"v":1,"names":[]}'), { names: D, problem: 'names.json is not valid' })
  const r = parseNames('{"v":1,"names":{"backend":"Nova","chef":"X","docs":"nova"}}')
  assert.deepEqual(r.names, { ...D, backend: 'Nova' })
  assert.equal(r.problem, 'names.json had 2 bad entries, left out')
  assert.equal(parseNames('{"v":1,"names":{"docs":"Iris"}}').problem, 'names.json had 1 bad entry, left out')
})

test('list', () => {
  const lines = listNames(D).split('\n')
  assert.equal(lines.length, 10)
  assert.equal(lines[0], 'frontend Iris')
  assert.equal(lines[9], 'mobile Zip')
})
