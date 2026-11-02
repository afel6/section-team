import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { failingTests, formatTable, gateMisses, gateRow, gateSequences, gateStats, judgeCodeQuality, meetsMark, modeOfCond, parseGrade, summarize } from './gate-stats.mjs'

const grade = (overall, verdict) => `## GRADE\nOverall: ${overall}/10\nVerdict: ${verdict}\nstructure: 8 — ok\nFixes:\n- none\n`
const pass = { overall: 9, verdict: 'pass', items: { structure: 8 } }
const fail = { overall: 6, verdict: 'fail', items: { structure: 8 } }
const text = body => ({ type: 'assistant', message: { content: [{ type: 'text', text: body }] } })
const toolUse = () => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: {} }] } })
const reviewer = (agentId, parentId, start, ...messages) => ({ role: 'section-team:reviewer', agentId, parentId, start, messages })

test('parseGrade reads Overall and Verdict from a GRADE block at the end of a reviewer answer', () => {
  assert.deepEqual(parseGrade(`Looked at score.mjs.\n\n${grade(7, 'fail')}`), { overall: 7, verdict: 'fail', items: { structure: 8 } })
  assert.deepEqual(parseGrade(`Done.\r\n\r\n${grade(8.5, 'pass').replace(/\n/g, '\r\n')}`), { overall: 8.5, verdict: 'pass', items: { structure: 8 } })
})

// The reviewer's real GRADE format (agents/reviewer.md); it writes `tests: n/a` when another section writes the tests.
const realGrade = [
  '## GRADE', 'Overall: 8.5/10', 'Verdict: pass',
  'structure: 9 — clear modules', '**naming:** 8 — ok', 'duplication: 9 — none', '  size: 7.5 — one long function',
  'errors: 8 — explicit', 'tests: n/a — the testing section writes the tests', 'security: 9 — no secrets', 'leftovers: 10 — none',
  'Fixes:', '- size: split parseGrade', '',
].join('\n')

test('parseGrade reads the items and leaves tests: n/a out', () => {
  const items = { structure: 9, naming: 8, duplication: 9, size: 7.5, errors: 8, security: 9, leftovers: 10 }
  assert.deepEqual(parseGrade(realGrade), { overall: 8.5, verdict: 'pass', items })
  const earlier = '## GRADE\nOverall: 5/10\nVerdict: fail\ntests: 3 — thin\nsize: 2 — huge\n'
  assert.deepEqual(parseGrade(`${earlier}\nAfter the fixes:\n${realGrade.replace(/\n/g, '\r\n')}`).items, items, 'only the last block counts')
  assert.deepEqual(parseGrade('## GRADE\nOverall: 9/10\nVerdict: pass\n'), { overall: 9, verdict: 'pass', items: {} })
  assert.deepEqual(parseGrade('## GRADE\nOverall: 9/10\nVerdict: pass\nstyle: 2 — not an item\n').items, {})
})

test('meetsMark: Lean 8; Balanced 8 with items ≥ 6; Max 9 with items ≥ 7; tests n/a ignored; an unreadable grade fails', () => {
  const g = (overall, items = {}) => ({ overall, verdict: 'pass', items })
  assert.equal(meetsMark(g(8, { size: 1 }), 'lean'), true, 'Lean has no item floor')
  assert.equal(meetsMark(g(7.9), 'lean'), false)
  assert.equal(meetsMark(g(8, { size: 6, naming: 10 }), 'balanced'), true)
  assert.equal(meetsMark(g(8, { size: 5.9, naming: 10 }), 'balanced'), false)
  assert.equal(meetsMark(g(7.9, { size: 9 }), 'balanced'), false)
  assert.equal(meetsMark(g(9, { size: 7 }), 'max'), true)
  assert.equal(meetsMark(g(9, { size: 6.9 }), 'max'), false)
  assert.equal(meetsMark(g(8.9, { size: 10 }), 'max'), false)
  const failVerdict = (overall, items) => ({ overall, verdict: 'fail', items })
  assert.equal(meetsMark(failVerdict(8, { size: 5 }), 'lean'), true, "the mode's mark decides, not the reviewer's verdict")
  assert.equal(meetsMark(failVerdict(8, { size: 6 }), 'balanced'), true)
  assert.equal(meetsMark(failVerdict(9, { size: 7 }), 'max'), true)
  const testsNa = parseGrade('## GRADE\nOverall: 9/10\nVerdict: pass\nstructure: 7 — ok\ntests: n/a — testing writes them\n')
  assert.equal(meetsMark(testsNa, 'max'), true, 'tests: n/a is no item, so it is no low item')
  for (const mode of ['lean', 'balanced', 'max']) {
    assert.equal(meetsMark(null, mode), false, mode)
    assert.equal(meetsMark(parseGrade('## GRADE\nOverall: 10/10\nstruct'), mode), false, `${mode}: a cut-off GRADE`)
  }
  assert.throws(() => meetsMark(g(10), 'solo'), /unknown mode/)
  assert.throws(() => meetsMark(g(10), 'constructor'), /unknown mode/)
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
  const reports = ['Status: partial\n', 'Status: ungraded — the reviewer never answered\n']
  const row = gateRow({ id: 'h2-team-ho-r1', mode: 'balanced', roles: null, tap: 'not ok 1 - x\n', reports, codeQuality: null })
  assert.equal(row.noData, true)
  assert.equal(row.mode, 'balanced')
  assert.equal(row.partial, 1)
  assert.equal(row.ungradedReports, 1)
  assert.match(formatTable([row]), /\| h2-team-ho-r1 \| balanced \| no data \| – \| – \| – \| – \| – \| 1\/0\/1 \| – \| – \|$/m)
})

test('gateRow puts the summary, sequences, final grades, partial/blocked/ungraded counts and gate misses on one row', () => {
  const roles = [{ role: 'main', messages: [] }, reviewer('r1', 'p1', 't1', text(grade(6, 'fail'))), reviewer('r2', 'p1', 't2', text(grade(9, 'pass')))]
  const reports = ['## REPORT · backend\nStatus: done\nQuality: 9/10\n', '## REPORT · testing\nStatus: blocked — no API\n', '## REPORT · docs\nStatus: partial\n', '## REPORT · security\nStatus: ungraded\nQuality: n/a\n']
  const row = gateRow({ id: 'h1-team-ho-r1', mode: 'balanced', roles, tap: 'not ok 1 - a | b\n', reports, codeQuality: 7.25 })
  assert.deepEqual(row, {
    id: 'h1-team-ho-r1', mode: 'balanced', partial: 1, blocked: 1, ungradedReports: 1, judgeCodeQuality: 7.25, noData: false,
    calls: 2, graded: 2, passes: 1, fails: 1, ungraded: 0, callers: 1, firstTryPasses: 0, fixRounds: 1,
    sequences: { p1: [fail, pass] }, finalGrades: { p1: pass }, firstTryMeetsMark: 0, finalMeetsMark: { p1: true }, gateMisses: ['a | b'],
  })
  assert.equal(gateRow({ id: 'x', mode: 'balanced', roles, tap: null, reports: [], codeQuality: null }).gateMisses, null, 'no hidden.tap is unknown, not zero misses')
  const table = formatTable([row]).split('\n')
  assert.equal(table[0], '| id | mode | calls | first-try passes/callers | first-try at mark/callers | fails then re-called | final grades | finals at mark/callers | partial/blocked/ungraded | gate misses | judge code quality |')
  assert.equal(table[2], '| h1-team-ho-r1 | balanced | 2 | 0/1 | 0/1 | 1 | 9 pass | 1/1 | 1/1/1 | a \\| b | 7.25 |')
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
  write(join(runDir, '.team', 'reports', '2026-10-30', '101700-security.md'), '## REPORT · security\nStatus: ungraded\n')
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
    assert.deepEqual([h1.calls, h1.firstTryPasses, h1.gateMisses, h1.partial, h1.blocked, h1.ungradedReports, h1.judgeCodeQuality], [1, 1, ['edge case'], 1, 0, 1, 7.5])
    rmSync(join(results, 'report-data-ho.json'))
    assert.equal(gateStats({ results, round: 'ho', home })[0].judgeCodeQuality, null, 'no report-data file, no join')
    write(join(results, 'report-data-ho.json'), '{}')
    rmSync(join(results, 'blind-key-ho.json'))
    assert.throws(() => gateStats({ results, round: 'ho', home }), /blind-key-ho\.json/, 'judged without a key is an error, not a blank column')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// One unreadable run must not stop the table: it is a no-data row naming why, as in mode-check. A bug still stops it.
test('a run whose run.json or session.json is broken is a no-data row with its reason; the other runs still count', () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-gate-bad-'))
  try {
    const { results, home } = fakeRound(root)
    write(join(results, 'h4-team-ho-r1', 'run.json'), '{"id": ')
    write(join(results, 'h5-team-ho-r1', 'run.json'), JSON.stringify({ id: 'h5-team-ho-r1', dir: join(root, 'runs', 'h5') }))
    write(join(results, 'h5-team-ho-r1', 'session.json'), '{"sessionId": "../x"}')
    const rows = gateStats({ results, round: 'ho', home })
    const byId = Object.fromEntries(rows.map(r => [r.id, r]))
    assert.equal(byId['h1-team-ho-r1'].noData, false)
    assert.equal(byId['h4-team-ho-r1'].noData, true)
    assert.match(byId['h4-team-ho-r1'].reason, /h4-team-ho-r1[\\/]run\.json: not valid JSON/)
    assert.match(byId['h5-team-ho-r1'].reason, /session\.json has no plain sessionId$/)
    assert.match(formatTable([byId['h4-team-ho-r1']]), /\| h4-team-ho-r1 \| balanced \| no data \(.*run\.json: not valid JSON.*\) \| – \|/)
    write(join(results, 'h4-team-ho-r1', 'run.json'), JSON.stringify({ id: 'h4-team-ho-r1', dir: 42 }))
    assert.match(gateStats({ results, round: 'ho', home }).find(r => r.id === 'h4-team-ho-r1').reason, /run\.json: no run dir$/)
    // Node 26 quotes the bad text, newlines included: the reason and the table row stay one line.
    write(join(results, 'h4-team-ho-r1', 'run.json'), '{\n  "id": oops\n}')
    const multi = gateStats({ results, round: 'ho', home }).find(r => r.id === 'h4-team-ho-r1')
    assert.match(multi.reason, /run\.json: not valid JSON \(.*oops.*\)$/)
    assert.doesNotMatch(multi.reason, /[\r\n]/)
    assert.equal(formatTable([multi]).split('\n').length, 3, 'header, rule and one row')
    // A file-system error whose message names no file (reading a folder) still says which run's files failed.
    rmSync(join(results, 'h4-team-ho-r1', 'run.json'))
    mkdirSync(join(results, 'h4-team-ho-r1', 'run.json'))
    const folder = gateStats({ results, round: 'ho', home }).find(r => r.id === 'h4-team-ho-r1')
    assert.match(folder.reason, /h4-team-ho-r1[\\/]run\.json or its session evidence: EISDIR/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// Only file failures become rows: a bug in a reader (a TypeError, or an error no reader throws) stops gate-stats.
test('gateStats lets an error that is not a file failure stop it', () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-gate-bug-'))
  try {
    const { results, home } = fakeRound(root)
    assert.throws(() => gateStats({ results, round: 'ho', home, read: () => { throw new TypeError('bug') } }), { name: 'TypeError', message: 'bug' })
    assert.throws(() => gateStats({ results, round: 'ho', home, read: () => { throw new Error('no reader says this') } }), { message: 'no reader says this' })
    assert.equal(gateStats({ results, round: 'ho', home, read: () => { throw new Error('x/run.json: no run dir') } })[0].reason, 'x/run.json: no run dir')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('held-out runs without evidence still read from ~/.claude/projects', () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-gate-ho-'))
  try {
    const { results, home } = fakeRound(root)
    const [h1] = gateStats({ results, round: 'ho', home })
    assert.equal(existsSync(join(results, 'h1-team-ho-r1', 'evidence')), false)
    assert.deepEqual([h1.id, h1.mode, h1.noData, h1.calls, h1.firstTryMeetsMark, h1.finalMeetsMark], ['h1-team-ho-r1', 'balanced', false, 1, 1, { main: true }])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// results/<id>/ as run.mjs leaves it in round mo: run.json, session.json, and evidence/<sid>.jsonl + <sid>/subagents/.
function evidenceRun(results, root, id, sid, reviews, extra = {}) {
  write(join(results, id, 'run.json'), JSON.stringify({ id, dir: join(root, 'runs', id).replaceAll('\\', '/'), timedOut: false, ...extra }))
  write(join(results, id, 'session.json'), JSON.stringify({ sessionId: sid, attempt: 1 }))
  write(join(results, id, 'raw.json'), jsonl({ type: 'system', subtype: 'init', session_id: 'not-the-session' }))
  const evidence = join(results, id, 'evidence')
  write(join(evidence, `${sid}.jsonl`), jsonl({ type: 'user', timestamp: 't0' }))
  reviews.forEach(({ parent, start, messages }, i) => {
    write(join(evidence, sid, 'subagents', `agent-r${i}.jsonl`), jsonl({ type: 'user', timestamp: start }, ...messages))
    write(join(evidence, sid, 'subagents', `agent-r${i}.meta.json`), JSON.stringify({ agentType: 'section-team:reviewer', ...(parent ? { parentAgentId: parent } : {}) }))
  })
}
const review = (start, body, parent = null) => ({ parent, start, messages: [text(body)] })
const itemGrade = (overall, items, verdict = 'pass') => `## GRADE\nOverall: ${overall}/10\nVerdict: ${verdict}\n${Object.entries(items).map(([k, v]) => `${k}: ${v} — why`).join('\n')}\n`

test('gateStats counts lean and max runs from evidence and leaves solo out', () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-gate-ev-'))
  try {
    const results = join(root, 'results')
    evidenceRun(results, root, 'h4-lean-mo-r1', 's-lean', [review('2026-11-02T10:00:00Z', itemGrade(8, { structure: 5 }, 'fail'))])
    evidenceRun(results, root, 'h4-max-mo-r1', 's-max', [
      review('2026-11-02T10:05:00Z', itemGrade(9.5, { structure: 9, tests: 8 })),
      review('2026-11-02T10:00:00Z', itemGrade(9, { structure: 9, tests: 6 })),
    ])
    evidenceRun(results, root, 'h4-team-mo-r1', 's-team', [
      review('2026-11-02T10:00:00Z', itemGrade(8, { size: 5 })),
      review('2026-11-02T10:01:00Z', itemGrade(9, { size: 6 }), 'b1'),
    ])
    for (const id of ['h4-solo-mo-r1', 'h4-lean-ho-r1', 'h4-max-mo-r1-old']) evidenceRun(results, root, id, 's-x', [review('t', itemGrade(10, {}))])
    const rows = gateStats({ results, round: 'mo', home: join(root, 'empty-home') })
    assert.deepEqual(rows.map(r => [r.id, r.mode, r.noData, r.firstTryPasses, r.firstTryMeetsMark, r.finalMeetsMark]), [
      ['h4-lean-mo-r1', 'lean', false, 0, 1, { main: true }],
      ['h4-max-mo-r1', 'max', false, 1, 0, { main: true }],
      ['h4-team-mo-r1', 'balanced', false, 2, 1, { main: false, b1: true }],
    ])
    assert.deepEqual(rows[1].sequences.main.map(g => g.items), [{ structure: 9, tests: 6 }, { structure: 9, tests: 8 }], 'every graded item is kept, in start order')
    assert.deepEqual(['lean', 'team', 'max', 'solo', 'balanced', 'constructor', undefined].map(modeOfCond), ['lean', 'balanced', 'max', null, null, null, null])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a timed-out run with evidence but no result is a row, not a throw', () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-gate-timeout-'))
  try {
    const results = join(root, 'results')
    evidenceRun(results, root, 'h5-max-mo-r1', 's9', [{ parent: null, start: '2026-11-02T10:00:00Z', messages: [text('Reading the diff.'), toolUse()] }], { timedOut: true, end: 'timeout' })
    write(join(results, 'h5-max-mo-r1', 'raw.json'), `${JSON.stringify({ type: 'system', subtype: 'init', session_id: 's9' })}\n{"type":"assist`)
    const check = () => {
      const [row] = gateStats({ results, round: 'mo', home: root })
      assert.deepEqual([row.mode, row.noData, row.calls, row.ungraded, row.firstTryMeetsMark, row.finalMeetsMark, row.gateMisses], ['max', false, 1, 1, 0, { main: false }, null])
      assert.match(formatTable([row]), /\| h5-max-mo-r1 \| max \| 1 \| 0\/1 \| 0\/1 \| 0 \| no grade \| 0\/1 \|/)
    }
    check()
    rmSync(join(results, 'h5-max-mo-r1', 'session.json'))
    check() // a run from before session.json: the id comes from raw.json's init line
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a session.json whose id is not plain gives a no-data row naming the file in one line', () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-gate-sid-'))
  try {
    const results = join(root, 'results')
    evidenceRun(results, root, 'h6-lean-mo-r1', 's1', [])
    write(join(results, 'h6-lean-mo-r1', 'session.json'), JSON.stringify({ sessionId: '../../outside' }))
    const [row] = gateStats({ results, round: 'mo', home: root })
    assert.equal(row.noData, true)
    assert.match(row.reason, /h6-lean-mo-r1[\\/]session\.json has no plain sessionId$/)
    assert.doesNotMatch(row.reason, /[\r\n]/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a run.json that is not valid gives a no-data row naming the file', () => {
  const root = mkdtempSync(join(tmpdir(), 'bench-gate-bad-'))
  try {
    write(join(root, 'h1-team-ho-r1', 'run.json'), '{ not json')
    const [row] = gateStats({ results: root, round: 'ho', home: root })
    assert.deepEqual([row.id, row.noData], ['h1-team-ho-r1', true])
    assert.match(row.reason, /h1-team-ho-r1[\\/]run\.json/)
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
