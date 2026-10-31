import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { failingTests, formatTable, gateMisses, gateRow, gateSequences, gateStats, judgeCodeQuality, parseGrade, summarize } from './gate-stats.mjs'

const grade = (overall, verdict) => `## GRADE\nOverall: ${overall}/10\nVerdict: ${verdict}\nstructure: 8 — ok\nFixes:\n- none\n`
const pass = { overall: 9, verdict: 'pass' }
const fail = { overall: 6, verdict: 'fail' }
const text = body => ({ type: 'assistant', message: { content: [{ type: 'text', text: body }] } })
const toolUse = () => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: {} }] } })
const reviewer = (agentId, parentId, start, ...messages) => ({ role: 'section-team:reviewer', agentId, parentId, start, messages })

test('parseGrade reads Overall and Verdict from a GRADE block at the end of a reviewer answer', () => {
  assert.deepEqual(parseGrade(`Looked at score.mjs.\n\n${grade(7, 'fail')}`), { overall: 7, verdict: 'fail' })
  assert.deepEqual(parseGrade(`Done.\r\n\r\n${grade(8.5, 'pass').replace(/\n/g, '\r\n')}`), { overall: 8.5, verdict: 'pass' })
})

test('parseGrade uses the last GRADE block when there are two', () => {
  assert.deepEqual(parseGrade(`${grade(5, 'fail')}\nAfter the fixes:\n${grade(9, 'pass')}`), pass)
})

test('parseGrade: no block, or a block cut off before its verdict, is no grade (null), never a pass or a fail', () => {
  assert.equal(parseGrade('Reviewing the diff now, then I will grade it.'), null)
  assert.equal(parseGrade('## GRADE\nOverall: 9/10\nstruct'), null)
  assert.equal(parseGrade('## GRADE\n'), null)
  assert.equal(parseGrade('Overall: 9/10\nVerdict: pass\n'), null, 'lines without the heading are not a GRADE block')
  assert.equal(parseGrade(undefined), null)
})

test('gateSequences groups reviewer calls by caller, orders them by start and grades the last assistant message', () => {
  const roles = [
    { role: 'main', messages: [text(grade(2, 'fail'))] },
    reviewer('r3', 'p1', '2026-10-30T10:30:00.000Z', text(grade(9, 'pass'))),
    { role: 'section-team:coder', agentId: 'c1', parentId: 'p1', start: '2026-10-30T10:10:00.000Z', messages: [text(grade(3, 'fail'))] },
    reviewer('r2', 'p1', '2026-10-30T10:05:00.000Z', text('Starting.'), toolUse(), text(grade(6, 'fail'))),
    reviewer('r1', null, '2026-10-30T10:00:00.000Z', text(grade(9, 'pass'))),
    reviewer('r4', 'p2', '2026-10-30T10:40:00.000Z', text(grade(9, 'pass')), toolUse()),
  ]
  assert.deepEqual(gateSequences(roles), { main: [pass], p1: [fail, pass], p2: [null] })
})

test('summarize counts calls, verdicts, first-try passes and fix rounds per caller', () => {
  assert.deepEqual(summarize({ main: [pass], p1: [fail, pass], p2: [fail] }), {
    calls: 4, graded: 4, passes: 2, fails: 2, ungraded: 0, callers: 3, firstTryPasses: 1, fixRounds: 1,
  })
  assert.deepEqual(summarize({ p1: [fail, null, fail, pass], p2: [null] }), {
    calls: 5, graded: 3, passes: 1, fails: 2, ungraded: 2, callers: 2, firstTryPasses: 0, fixRounds: 2,
  })
  assert.deepEqual(summarize({}), { calls: 0, graded: 0, passes: 0, fails: 0, ungraded: 0, callers: 0, firstTryPasses: 0, fixRounds: 0 })
})

test('failingTests lists the names on "not ok N - <name>" lines, nested ones too, with TAP escapes undone', () => {
  const tap = 'TAP version 13\r\nok 1 - fine\r\nnot ok 2 - parse: rejects 5-\\#7\r\n    not ok 1 - inner\r\n# fail 2\r\n'
  assert.deepEqual(failingTests(tap), ['parse: rejects 5-#7', 'inner'])
  assert.deepEqual(failingTests('ok 1 - fine\n'), [])
})

test('failingTests reads the TAP that node --test really prints', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-tap-'))
  try {
    const file = join(dir, 'x.test.mjs')
    writeFileSync(file, "import { test } from 'node:test'\ntest('ok one', () => {})\ntest('breaks #2', () => { throw new Error('x') })\n")
    const { NODE_TEST_CONTEXT, ...env } = process.env // set inside node --test, it makes the child skip its files
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { env, encoding: 'utf8', windowsHide: true })
    assert.deepEqual(failingTests(r.stdout), ['breaks #2'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('gateMisses returns the failing tests only when every caller ended on a pass', () => {
  const tap = 'ok 1 - a\nnot ok 2 - b\n'
  assert.deepEqual(gateMisses({ main: [pass], p1: [fail, pass] }, tap), ['b'])
  assert.deepEqual(gateMisses({ main: [pass], p1: [pass, fail] }, tap), [])
  assert.deepEqual(gateMisses({ main: [pass], p1: [fail, null] }, tap), [])
  assert.deepEqual(gateMisses({}, tap), [], 'a run with no gate call has no last pass')
})

test('gate stats for a run with no transcript (roles === null) is a no-data row and does not throw', () => {
  const row = gateRow({ id: 'h2-team-ho-r1', roles: null, tap: 'not ok 1 - x\n', reports: ['Status: partial\n'], codeQuality: null })
  assert.equal(row.noData, true)
  assert.equal(row.partial, 1)
  assert.match(formatTable([row]), /\| h2-team-ho-r1 \| no data \|/)
})

test('gateRow puts the summary, sequences, final grades, partial/blocked counts and gate misses on one row', () => {
  const roles = [{ role: 'main', messages: [] }, reviewer('r1', 'p1', 't1', text(grade(6, 'fail'))), reviewer('r2', 'p1', 't2', text(grade(9, 'pass')))]
  const reports = ['## REPORT · backend\nStatus: done\nQuality: 9/10\n', '## REPORT · testing\nStatus: blocked — no API\n', '## REPORT · docs\nStatus: partial\n']
  const row = gateRow({ id: 'h1-team-ho-r1', roles, tap: 'not ok 1 - a | b\n', reports, codeQuality: 7.25 })
  assert.deepEqual(row, {
    id: 'h1-team-ho-r1', partial: 1, blocked: 1, judgeCodeQuality: 7.25, noData: false,
    calls: 2, graded: 2, passes: 1, fails: 1, ungraded: 0, callers: 1, firstTryPasses: 0, fixRounds: 1,
    sequences: { p1: [fail, pass] }, finalGrades: { p1: pass }, gateMisses: ['a | b'],
  })
  assert.equal(gateRow({ id: 'x', roles, tap: null, reports: [], codeQuality: null }).gateMisses, null, 'no hidden.tap is unknown, not zero misses')
  const table = formatTable([row]).split('\n')
  assert.equal(table[0], '| id | calls | first-try passes/callers | fix rounds | final grades | partial/blocked | gate misses | judge code quality |')
  assert.equal(table[2], '| h1-team-ho-r1 | 2 | 0/1 | 1 | 9 pass | 1/1 | a \\| b | 7.25 |')
})

test('judgeCodeQuality means each run\'s codeQuality over its judges through the blind key', () => {
  const rows = [
    { pair: 'h1-r1', judge: 1, X: { codeQuality: 7 }, Y: { codeQuality: 5 } },
    { pair: 'h1-r1', judge: 2, X: { codeQuality: 8 }, Y: { codeQuality: 6 } },
    { pair: 'h2-r9', X: { codeQuality: 1 }, Y: { codeQuality: 1 } },
  ]
  const key = { 'h1-r1': { X: 'team-ho', Y: 'solo-ho' } }
  assert.deepEqual(judgeCodeQuality(rows, key), { 'h1-team-ho-r1': 7.5, 'h1-solo-ho-r1': 5.5 })
})

const jsonl = (...rows) => rows.map(r => JSON.stringify(r)).join('\n') + '\n'
const write = (path, body) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, body) }

function fakeRound(root) {
  const results = join(root, 'results')
  const home = join(root, 'home')
  const runDir = join(root, 'runs', 'h1-team-ho-r1').replaceAll('\\', '/')
  const run = (id, extra) => write(join(results, id, 'run.json'), JSON.stringify({ id, dir: join(root, 'runs', id).replaceAll('\\', '/'), timedOut: false, ...extra }))
  run('h1-team-ho-r1')
  write(join(results, 'h1-team-ho-r1', 'raw.json'), JSON.stringify([{ type: 'result', session_id: 's1' }]))
  write(join(results, 'h1-team-ho-r1', 'hidden.tap'), 'ok 1 - a\nnot ok 2 - edge case\n')
  const project = join(home, '.claude', 'projects', runDir.replace(/[^a-zA-Z0-9]/g, '-'))
  write(join(project, 's1.jsonl'), jsonl({ type: 'user', timestamp: 't0' }))
  write(join(project, 's1', 'subagents', 'agent-r1.jsonl'), jsonl({ type: 'user', timestamp: '2026-10-30T10:00:00.000Z' }, text(grade(9, 'pass'))))
  write(join(project, 's1', 'subagents', 'agent-r1.meta.json'), JSON.stringify({ agentType: 'section-team:reviewer', spawnDepth: 1 }))
  write(join(runDir, '.team', 'reports', '2026-10-30', '101500-backend.md'), '## REPORT · backend\nStatus: partial\n')
  write(join(runDir, '.team', 'reports', '2026-10-30', '101600-supervisor-summary.md'), 'Status: blocked\n')
  run('h2-team-ho-r1', { timedOut: true })
  write(join(results, 'h2-team-ho-r1', 'raw.json'), '')
  mkdirSync(join(results, 'h3-team-ho-r2'), { recursive: true })
  run('h1-solo-ho-r1')
  run('h1-team-v17-r1')
  write(join(results, 'report-data-ho.json'), '{}')
  write(join(results, 'judge-ho.json'), JSON.stringify([{ pair: 'h1-r1', X: { codeQuality: 7 } }, { pair: 'h1-r1', X: { codeQuality: 8 } }]))
  write(join(results, 'blind-key-ho.json'), JSON.stringify({ 'h1-r1': { X: 'team-ho', Y: 'solo-ho' } }))
  return { results, home }
}

test('gateStats reads every team run of the round; a timed-out or unfinished run is a no-data row', () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-gate-'))
  try {
    const { results, home } = fakeRound(root)
    const rows = gateStats({ results, round: 'ho', home })
    assert.deepEqual(rows.map(r => [r.id, r.noData]), [['h1-team-ho-r1', false], ['h2-team-ho-r1', true], ['h3-team-ho-r2', true]])
    const [h1] = rows
    assert.deepEqual([h1.calls, h1.firstTryPasses, h1.gateMisses, h1.partial, h1.blocked, h1.judgeCodeQuality], [1, 1, ['edge case'], 1, 0, 7.5])
    rmSync(join(results, 'report-data-ho.json'))
    assert.equal(gateStats({ results, round: 'ho', home })[0].judgeCodeQuality, null, 'no report-data file, no join')
    write(join(results, 'report-data-ho.json'), '{}')
    rmSync(join(results, 'blind-key-ho.json'))
    assert.throws(() => gateStats({ results, round: 'ho', home }), /blind-key-ho\.json/, 'judged without a key is an error, not a blank column')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('gateStats names the file when a run.json is not valid', () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-gate-bad-'))
  try {
    write(join(root, 'h1-team-ho-r1', 'run.json'), '{ not json')
    assert.throws(() => gateStats({ results: root, round: 'ho', home: root }), /h1-team-ho-r1[\\/]run\.json/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// A background section agent ends with a SubagentHandback tool call whose `message` is its answer (seen in the
// 2026-10-31 held-out runs); the GRADE block lives there, not in a text part.
test('gateSequences reads the GRADE from a background reviewer\'s SubagentHandback message', () => {
  const handback = body => ({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: '' }, { type: 'tool_use', name: 'SubagentHandback', input: { message: body } }] } })
  const roles = [
    reviewer('r1', null, '2026-10-31T20:00:00Z', text('Reading the diff.'), toolUse(), handback(`Done.\n\n${grade(9, 'pass')}`)),
    reviewer('r2', 'b1', '2026-10-31T20:01:00Z', handback(`Fixes needed.\n${grade(6, 'fail')}`), text('ok')),
  ]
  assert.deepEqual(gateSequences(roles), { main: [pass], b1: [fail] })
})

test('the last handback is the answer, even when a plain-text message with another GRADE follows it', () => {
  const handback = body => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message: body } }] } })
  const roles = [reviewer('r1', null, '2026-10-31T20:00:00Z', handback(grade(6, 'fail')), handback(grade(9, 'pass')), text(grade(5, 'fail')))]
  assert.deepEqual(gateSequences(roles), { main: [pass] })
})
