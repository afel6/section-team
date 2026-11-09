import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { BUILDERS, HEADS, checkRun, gates, main, modeCheck, nearMissState, reviewerCalls, toolUses, wakeUps } from './mode-check.mjs'

const checkRunAt = checkRun

// Fixtures copy the real transcript shapes (held-out team runs, 2026-10-31): line timestamps, Agent and SendMessage
// tool_use inputs, queued_command attachments, SubagentHandback answers, and roles as collectRolesFrom returns them.
const T0 = Date.parse('2026-11-03T10:00:00.000Z')
const at = s => new Date(T0 + s * 1000).toISOString()
const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'
const toolLine = (t, name, input) => ({ type: 'assistant', timestamp: at(t), message: { model: OPUS, content: [{ type: 'tool_use', id: `toolu_${t}`, name, input }] } })
const wake = (t, type) => toolLine(t, 'Agent', { subagent_type: `section-team:${type}`, description: 'job', prompt: 'job', run_in_background: true })
const send = (t, to) => toolLine(t, 'SendMessage', { to, summary: 'note', message: 'note' })
const write = (t, file_path, name = 'Write') => toolLine(t, name, { file_path, content: 'x' })
const userLine = (t, content) => ({ type: 'user', timestamp: at(t), message: { role: 'user', content } })
const queued = (t, prompt) => ({ type: 'attachment', timestamp: at(t), attachment: { type: 'queued_command', prompt } })
const handBack = (t, from) => queued(t, `<agent-message from="${from}">\n[Subagent hand-back] The text below is the final report of a subagent.`)
const notified = (t, id) => queued(t, `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n</task-notification>`)
const skillLoad = t => userLine(t, [{ type: 'text', text: '<command-message>tdd-workflow</command-message>' }])
const GRADE = overall => `## GRADE\nOverall: ${overall}/10\nVerdict: ${overall >= 8 ? 'pass' : 'fail'}\nstructure: 9 — ok\n`
const answer = (t, overall, model) => ({ type: 'assistant', timestamp: at(t), message: { model, content: [{ type: 'tool_use', id: 'toolu_hb', name: 'SubagentHandback', input: { message: `Done.\n\n${GRADE(overall)}` } }] } })

const main_ = (...messages) => ({ role: 'main', messages })
const section = (head, agentId, messages, parentId = null) => ({ role: `section-team:${head}`, agentId, parentId, start: messages[0]?.timestamp ?? null, messages })
// A reviewer call: its first line's timestamp is its start; it hands back a GRADE with the given overall.
const reviewer = (agentId, parentId, t, overall, model = OPUS) =>
  ({ role: 'section-team:reviewer', agentId, parentId, start: at(t), messages: [userLine(t, 'Grade the changed files.'), answer(t + 1, overall, model)] })
// Reviewer calls from one caller at the given start seconds and overall grades: [[start, overall], ...].
const reviews = (parentId, list, model = OPUS) => list.map(([t, overall], i) => reviewer(`r${parentId ?? 'm'}${i}`, parentId, t, overall, model))

function runDir(t, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bench-mode-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), text)
  }
  return dir
}
const modeFile = mode => ({ '.team/mode.json': JSON.stringify({ mode }) })
const COPY = '// near-miss: off by one in the range end\nexport const last = xs => xs[xs.length]\n'

test('HEADS and BUILDERS are the brief\'s lists', () => {
  assert.deepEqual(HEADS, ['backend', 'frontend', 'database', 'devops', 'mobile', 'uiux', 'ai-llm', 'testing', 'security', 'docs'])
  assert.deepEqual(BUILDERS, ['backend', 'frontend', 'database', 'devops', 'mobile', 'uiux', 'ai-llm'])
})

test('toolUses lists the named tool calls in line order with their line timestamps', () => {
  const lines = [write(1, 'a.md', 'Edit'), wake(2, 'testing'), write(3, 'b.md')]
  assert.deepEqual(toolUses(lines, 'Write', 'Edit').map(use => [use.at, use.input.file_path]), [[at(1), 'a.md'], [at(3), 'b.md']])
})

test('reviewer, scout and coder calls are not wake-ups', () => {
  const roles = [
    main_(wake(1, 'backend'), wake(2, 'reviewer'), wake(3, 'scout'), wake(4, 'coder'), wake(5, 'ai-engineer'), wake(6, 'data-scientist'),
      toolLine(7, 'Agent', { subagent_type: 'general-purpose', prompt: 'x' }), send(8, 'b1')),
    section('backend', 'b1', [userLine(1, 'job'), wake(2, 'coder'), wake(3, 'scout'), wake(4, 'reviewer'), wake(5, 'security')]),
  ]
  assert.deepEqual(wakeUps(roles), [
    { section: 'backend', at: at(1), caller: 'main' },
    { section: 'security', at: at(5), caller: 'b1' },
  ])
})

test('reviewerCalls orders calls by start and reads caller, model and the handed-back grade', () => {
  const roles = [main_(), reviewer('late', null, 30, 9), reviewer('early', 'b1', 10, 7, SONNET), section('backend', 'b1', [userLine(1, 'job')])]
  assert.deepEqual(reviewerCalls(roles), [
    { caller: 'b1', start: at(10), model: SONNET, grade: { overall: 7, verdict: 'fail', items: { structure: 9 } } },
    { caller: 'main', start: at(30), model: OPUS, grade: { overall: 9, verdict: 'pass', items: { structure: 9 } } },
  ])
})

// A lean h5 run that did everything right: no section woken, one Sonnet review that passed first time.
const leanH5 = (extra = []) => [main_(write(1, 'src/x.mjs'), wake(2, 'reviewer'), ...extra), ...reviews(null, [[3, 9]], SONNET)]

test('lean h5 run that woke testing is unfaithful', t => {
  const dir = runDir(t, modeFile('lean'))
  assert.deepEqual(checkRun({ cond: 'lean-mo', task: 'h5', roles: leanH5(), runDir: dir, record: 'lean' }), { faithful: true, broken: [], tier: 'small' })
  const result = checkRun({ cond: 'lean-mo', task: 'h5', roles: leanH5([wake(10, 'testing')]), runDir: dir, record: 'lean' })
  assert.deepEqual(result, { faithful: false, broken: ['h5 woke testing (none allowed)'], tier: 'single' })
})

test('lean reviewer on Opus is unfaithful', t => {
  const roles = [main_(wake(2, 'reviewer')), ...reviews(null, [[3, 9]], OPUS)]
  const result = checkRun({ cond: 'lean-mo', task: 'h5', roles, runDir: runDir(t, modeFile('lean')), record: 'lean' })
  assert.deepEqual(result.broken, ['reviewer not on sonnet: claude-opus-5-5'])
})

test('a reviewer\'s model skips <synthetic> assistant lines', () => {
  const synthetic = t => ({ type: 'assistant', timestamp: at(t), message: { model: '<synthetic>', content: [{ type: 'text', text: 'API Error' }] } })
  const roles = [
    main_(),
    { role: 'section-team:reviewer', agentId: 'r1', parentId: null, start: at(5), messages: [userLine(5, 'Grade.'), synthetic(6), answer(7, 9, SONNET)] },
    { role: 'section-team:reviewer', agentId: 'r2', parentId: null, start: at(8), messages: [userLine(8, 'Grade.'), synthetic(9)] },
  ]
  assert.deepEqual(reviewerCalls(roles).map(call => call.model), [SONNET, null])
})

// A Balanced h6 run: main wakes testing, testing's own reviewer passes first time.
const teamH6 = (extra = []) => [
  main_(wake(1, 'testing'), ...extra),
  section('testing', 't1', [userLine(2, 'job'), wake(3, 'reviewer')]),
  ...reviews('t1', [[4, 9]]),
]

test('team h6 run that woke only testing is faithful', t => {
  const dir = runDir(t)
  assert.deepEqual(checkRun({ cond: 'team-mo', task: 'h6', roles: teamH6(), runDir: dir, record: 'balanced' }), { faithful: true, broken: [], tier: 'single' })
  const other = checkRun({ cond: 'team-mo', task: 'h6', roles: teamH6([wake(9, 'backend')]), runDir: dir, record: 'balanced' })
  assert.deepEqual(other, { faithful: false, broken: ['h6 woke backend (only testing allowed)'], tier: 'multi' })
  const none = checkRun({ cond: 'team-mo', task: 'h6', roles: [main_()], runDir: dir, record: 'balanced' })
  assert.deepEqual(none.broken, ['testing not woken'])
})

// A Max h5 run: testing and security woken, testing left a near-miss copy in .team/near-miss/.
const maxH5 = (extra = [], heads = ['testing', 'security']) => [
  main_(...heads.map((head, i) => wake(1 + i, head)), wake(5, 'reviewer'), ...extra),
  ...reviews(null, [[6, 9.5]]),
]
const maxDir = (t, files = {}) => runDir(t, { ...modeFile('max'), '.team/near-miss/1-range.mjs': COPY, ...files })

test('max h5 run without a security wake-up is unfaithful', t => {
  const dir = maxDir(t)
  assert.deepEqual(checkRun({ cond: 'max-mo', task: 'h5', roles: maxH5(), runDir: dir, record: 'max' }), { faithful: true, broken: [], tier: 'single' })
  const result = checkRun({ cond: 'max-mo', task: 'h5', roles: maxH5([], ['testing']), runDir: dir, record: 'max' })
  assert.deepEqual(result.broken, ['security not woken'])
})

test('a 0.3.0 max gate with 2 fix rounds is faithful, with 3 it is not, and after 1 with no later call it ended early', t => {
  const dir = maxDir(t)
  const checkRun = run => checkRunAt({ ...run, pluginVersion: '0.3.0' })
  const twoRounds = [main_(wake(1, 'testing'), wake(2, 'security')), ...reviews(null, [[10, 7], [20, 8], [30, 8.5]])]
  assert.deepEqual(gates(twoRounds, 'max').map(({ caller, fixRounds, endsEarly, regradeAfterPass }) => ({ caller, fixRounds, endsEarly, regradeAfterPass })),
    [{ caller: 'main', fixRounds: 2, endsEarly: false, regradeAfterPass: false }])
  assert.equal(gates(twoRounds, 'max')[0].reviews.length, 3)
  assert.deepEqual(checkRun({ cond: 'max-mo', task: 'h5', roles: twoRounds, runDir: dir, record: 'max' }).broken, [])
  const threeRounds = [main_(wake(1, 'testing'), wake(2, 'security')), ...reviews(null, [[10, 7], [20, 8], [30, 8.5], [40, 8]])]
  assert.deepEqual(checkRun({ cond: 'max-mo', task: 'h5', roles: threeRounds, runDir: dir, record: 'max' }).broken, ['gate of main had 3 fix rounds (at most 2)'])
  const one = twoRounds.slice(0, -1)
  assert.equal(gates(one, 'max')[0].endsEarly, true)
  const result = checkRun({ cond: 'max-mo', task: 'h5', roles: one, runDir: dir, record: 'max' })
  assert.deepEqual(result.broken, ['gate of main ended early'])
  const later = [main_(wake(1, 'testing'), wake(2, 'security'), wake(8, 'backend')), ...reviews(null, [[5, 7], [10, 9.5]])]
  assert.deepEqual(gates(later, 'max').map(g => [g.fixRounds, g.endsEarly]), [[0, false], [0, false]])
})

test('team gate with 3 fix rounds is unfaithful', t => {
  const roles = teamH6().slice(0, 2).concat(reviews('t1', [[4, 7], [10, 7], [20, 7], [30, 9]]))
  assert.equal(gates(roles, 'balanced')[0].fixRounds, 3)
  const result = checkRun({ cond: 'team-mo', task: 'h6', roles, runDir: runDir(t), record: 'balanced' })
  assert.deepEqual(result.broken, ['gate of t1 had 3 fix rounds (at most 2)'])
  const two = teamH6().slice(0, 2).concat(reviews('t1', [[4, 7], [10, 7], [20, 7]]))
  assert.deepEqual(checkRun({ cond: 'team-mo', task: 'h6', roles: two, runDir: runDir(t), record: 'balanced' }).broken, [])
})

test('a failed review fixed by one re-grade is faithful', t => {
  const roles = teamH6().slice(0, 2).concat(reviews('t1', [[4, 7], [10, 9]]))
  assert.deepEqual(gates(roles, 'balanced').map(g => [g.fixRounds, g.endsEarly, g.regradeAfterPass]), [[1, false, false]])
  assert.deepEqual(checkRun({ cond: 'team-mo', task: 'h6', roles, runDir: runDir(t), record: 'balanced' }).broken, [])
})

test('a re-grade after a pass is unfaithful', t => {
  const roles = [main_(wake(2, 'reviewer'), wake(5, 'reviewer')), ...reviews(null, [[3, 9], [6, 9]], SONNET)]
  assert.equal(gates(roles, 'lean')[0].regradeAfterPass, true)
  const result = checkRun({ cond: 'lean-mo', task: 'h5', roles, runDir: runDir(t, modeFile('lean')), record: 'lean' })
  assert.deepEqual(result.broken, ['gate of main graded again after a pass'])
})

// A pass ends the gate for a section and for main alike: a second grade with no new job between the calls is a re-grade,
// whatever was edited in between.
const graded = (between, helper = []) => [
  main_(wake(0, 'testing')),
  section('testing', 't1', [userLine(1, 'job'), wake(3, 'reviewer'), ...between, wake(9, 'reviewer')]),
  ...helper,
  ...reviews('t1', [[4, 9], [10, 9]]),
]
const shapeOf = list => list.map(g => [g.caller, g.reviews.length, g.fixRounds, g.regradeAfterPass])

test('a section that edits code after a pass and grades again graded again after a pass', t => {
  const ways = {
    'its own Edit': graded([write(6, 'src/app.mjs', 'Edit')]),
    'its own Write': graded([write(6, 'src/app.mjs')]),
    'its coder': graded([], [section('coder', 'c1', [userLine(5, 'fix'), write(6, 'src/app.mjs')], 't1')]),
    'nothing between': graded([]),
    'a note and memory only': graded([write(6, '.team/notes/api.md'), write(7, '.claude/agent-memory-local/section-team-testing/MEMORY.md', 'Edit')]),
    'an edit before the pass': [main_(wake(0, 'testing')), section('testing', 't1', [userLine(1, 'job'), write(2, 'src/app.mjs'), wake(3, 'reviewer'), wake(9, 'reviewer')]), ...reviews('t1', [[4, 9], [10, 9]])],
  }
  for (const [name, roles] of Object.entries(ways)) {
    assert.deepEqual(shapeOf(gates(roles, 'balanced')), [['t1', 2, 1, true]], name)
    assert.ok(checkRun({ cond: 'team-mo', task: 'h6', roles, runDir: runDir(t), record: 'balanced' }).broken.includes('gate of t1 graded again after a pass'), name)
  }
})

test('an edit after a failing grade stays in the gate as a fix round', () => {
  const roles = [main_(wake(0, 'testing')), section('testing', 't1', [userLine(1, 'job'), write(6, 'src/app.mjs', 'Edit')]), ...reviews('t1', [[4, 7], [10, 9]])]
  assert.deepEqual(shapeOf(gates(roles, 'balanced')), [['t1', 2, 1, false]])
})

test('main\'s own edit after a pass does not excuse its re-grade: its brief says a pass ends the gate', () => {
  const roles = [main_(wake(2, 'reviewer'), write(5, 'src/app.mjs', 'Edit'), wake(8, 'reviewer')), ...reviews(null, [[3, 9], [9, 9]])]
  assert.deepEqual(shapeOf(gates(roles, 'balanced')), [['main', 2, 1, true]])
})

test('a queued_command from main between two section reviewer calls starts a new gate; the section\'s own reviewer hand-back does not; a skill-load user line does not', () => {
  const backend = between => section('backend', 'b1', [userLine(1, 'job'), skillLoad(2), wake(3, 'reviewer'), wake(4, 'coder'), ...between, wake(9, 'reviewer')])
  const own = [handBack(6, 'rb10'), notified(6.5, 'rb10'), handBack(7, 'c1'), skillLoad(8)]
  const roles = between => [main_(wake(0, 'backend')), backend(between), section('coder', 'c1', [userLine(4.5, 'code')], 'b1'), ...reviews('b1', [[5, 9], [10, 9]])]
  const shape = list => list.map(g => [g.caller, g.reviews.length, g.fixRounds, g.regradeAfterPass])
  assert.deepEqual(shape(gates(roles(own), 'balanced')), [['b1', 2, 1, true]])
  const fromMain = queued(8.5, 'Supervisor: the API changed, update your part.')
  assert.deepEqual(shape(gates(roles([...own, fromMain]), 'balanced')), [['b1', 1, 0, false], ['b1', 1, 0, false]])
  const otherAgent = handBack(8.5, 'f1')
  assert.deepEqual(shape(gates(roles([...own, otherAgent]), 'balanced')), [['b1', 1, 0, false], ['b1', 1, 0, false]])
  for (const prompt of ['Supervisor: see <agent-message from="rb10"> above.', 'Supervisor: task <task-id>rb10</task-id> again.']) {
    assert.deepEqual(shape(gates(roles([...own, queued(8.5, prompt)]), 'balanced')), [['b1', 1, 0, false], ['b1', 1, 0, false]])
  }
})

test('a new job only counts strictly between the two reviewer starts, by line timestamp', () => {
  const roles = at10 => [main_(wake(1, 'backend'), wake(at10 ? 10 : 11, 'frontend')), ...reviews(null, [[5, 9], [10, 9]])]
  assert.equal(gates(roles(true), 'lean').length, 1)
  assert.equal(gates(roles(false), 'lean').length, 1)
  const atStart = [main_(wake(1, 'backend'), wake(5, 'frontend')), ...reviews(null, [[5, 9], [10, 9]])]
  assert.equal(gates(atStart, 'lean').length, 1)
  const inside = [main_(wake(1, 'backend'), wake(7, 'frontend')), ...reviews(null, [[5, 9], [10, 9]])]
  assert.equal(gates(inside, 'lean').length, 2)
})

test('main waking testing, security or docs between its reviews is not a new job', () => {
  for (const head of ['testing', 'security', 'docs']) {
    const roles = [main_(wake(1, 'backend'), wake(7, head)), ...reviews(null, [[5, 7], [10, 9]])]
    assert.deepEqual(gates(roles, 'balanced').map(g => g.fixRounds), [1])
  }
})

test('main\'s SendMessage to a builder\'s agentId starts a new gate; to testing it does not', () => {
  const roles = to => [
    main_(wake(1, 'backend'), wake(2, 'testing'), wake(3, 'reviewer'), send(6, to), wake(7, 'reviewer')),
    section('backend', 'b1', [userLine(1.5, 'job')]),
    section('testing', 't1', [userLine(2.5, 'job')]),
    ...reviews(null, [[4, 9], [8, 9]]),
  ]
  assert.deepEqual(gates(roles('t1'), 'balanced').map(g => g.reviews.length), [2])
  assert.deepEqual(gates(roles('b1'), 'balanced').map(g => g.reviews.length), [1, 1])
})

test('max run with a near-miss copy left in src is unfaithful', t => {
  const dir = maxDir(t, { 'src/range.mjs': COPY, 'src/ok.mjs': 'export const ok = 1\n' })
  assert.deepEqual(nearMissState(dir), { copies: 1, outside: ['src/range.mjs'] })
  const result = checkRun({ cond: 'max-mo', task: 'h5', roles: maxH5(), runDir: dir, record: 'max' })
  assert.deepEqual(result, { faithful: false, broken: ['near-miss copy outside .team/: src/range.mjs'], tier: 'single' })
})

// 0.3.0 dropped the near-miss copies and cut Max to 2 fix rounds; the mode round's Max runs (0.2.1) keep their own gate.
test('a 0.3.0 max run needs no near-miss copy; a run from before 0.3.0 keeps 3 fix rounds and its copy', t => {
  const bare = runDir(t, modeFile('max'))
  const now = run => checkRun({ cond: 'max-p2', task: 'h5', record: 'max', pluginVersion: '0.3.0', ...run })
  assert.deepEqual(now({ roles: maxH5(), runDir: bare }), { faithful: true, broken: [], tier: 'single' })
  assert.deepEqual(now({ roles: maxH5(), runDir: runDir(t, { ...modeFile('max'), 'src/mutant.mjs': 'x' }) }).broken, [])
  const threeRounds = [main_(wake(1, 'testing'), wake(2, 'security')), ...reviews(null, [[10, 7], [20, 8], [30, 8.5], [40, 9.5]])]
  const fourRounds = [main_(wake(1, 'testing'), wake(2, 'security')), ...reviews(null, [[10, 7], [20, 8], [30, 8.5], [40, 8], [50, 9.5]])]
  const failsAfterTwo = [main_(wake(1, 'testing'), wake(2, 'security')), ...reviews(null, [[10, 7], [20, 8], [30, 8.5]])]
  for (const pluginVersion of ['0.2.1', undefined]) {
    const old = run => checkRun({ cond: 'max-mo', task: 'h5', record: 'max', runDir: maxDir(t), pluginVersion, ...run }).broken
    assert.deepEqual(old({ roles: threeRounds }), [], `${pluginVersion}: 3 fix rounds were allowed`)
    assert.deepEqual(old({ roles: fourRounds }), ['gate of main had 4 fix rounds (at most 3)'])
    assert.deepEqual(old({ roles: failsAfterTwo }), ['gate of main ended early'])
    assert.deepEqual(old({ roles: maxH5(), runDir: bare }), ['no near-miss copy in .team/near-miss/'])
  }
  assert.deepEqual(now({ roles: threeRounds, runDir: bare }).broken, ['gate of main had 3 fix rounds (at most 2)'])
  assert.deepEqual(now({ roles: failsAfterTwo, runDir: bare }).broken, [])
})

test("modeCheck takes each run's gate from the plugin version its run.json records", t => {
  const results = runDir(t)
  const bare = runDir(t, modeFile('max'))
  writeRun(results, 'h5-max-p2-r1', { dir: bare, roles: maxH5(), record: 'max', version: '0.3.0' })
  writeRun(results, 'h5-max-p2-r2', { dir: bare, roles: maxH5(), record: 'max', version: '0.2.3' })
  writeRun(results, 'h5-max-p2-r3', { dir: bare, roles: maxH5(), record: 'max' })
  const rows = modeCheck({ results, round: 'p2' })
  assert.deepEqual(Object.fromEntries(Object.entries(rows).map(([id, row]) => [id, row.broken])), {
    'h5-max-p2-r1': [],
    'h5-max-p2-r2': ['no near-miss copy in .team/near-miss/'],
    'h5-max-p2-r3': ['no near-miss copy in .team/near-miss/'],
  })
})

test('nearMissState finds copies by bytes, path words and first line, outside .team/, .git/ and node_modules/', t => {
  const dir = runDir(t, {
    '.team/near-miss/1-range.mjs': COPY, '.team/near-miss/sub/2-sort.mjs': 'x\n', '.team/notes/near-miss.md': 'plan',
    'lib/Mutant-check.js': 'a', 'test/NearMiss.test.mjs': 'b', 'src/flag.mjs': 'export {} // near-miss: later\n',
    'src/second.mjs': 'ok\n// near-miss: not on the first line\n', 'notes.txt': 'a near-miss without the colon\n', 'copy.mjs': 'x\n',
    '.git/near-miss-x': 'c', 'node_modules/mutant/index.js': 'd', 'README.md': 'clean',
    'web/node_modules/stryker/mutant-x.js': 'e', 'web/.git/near-miss': 'f', 'web/.team/near-miss.mjs': 'g',
  })
  assert.deepEqual(nearMissState(dir), { copies: 2, outside: ['copy.mjs', 'lib/Mutant-check.js', 'src/flag.mjs', 'test/NearMiss.test.mjs', 'web/.team/near-miss.mjs'] })
  assert.deepEqual(nearMissState(runDir(t, { 'src/a.mjs': 'a' })), { copies: 0, outside: [] })
  assert.deepEqual(nearMissState(join(tmpdir(), 'bench-mode-missing-run')), { copies: 0, outside: [] })
})

// An empty file's bytes match every empty file: a .gitkeep in .team/near-miss/ must not make every empty file a copy.
test('nearMissState leaves zero-length files out of the byte match', t => {
  const dir = runDir(t, { '.team/near-miss/.gitkeep': '', '.team/near-miss/1-range.mjs': COPY, 'src/.gitkeep': '', 'lib/empty.mjs': '', 'lib/range.mjs': COPY })
  assert.deepEqual(nearMissState(dir).outside, ['lib/range.mjs'])
})

// An empty .gitkeep is not a near-miss copy: with nothing else there and no testing write, Max made none.
test('a .team/near-miss/ holding only empty files has no copy', t => {
  const dir = runDir(t, { ...modeFile('max'), '.team/near-miss/.gitkeep': '' })
  assert.deepEqual(nearMissState(dir), { copies: 0, outside: [] })
  const result = checkRun({ cond: 'max-mo', task: 'h5', roles: maxH5(), runDir: dir, record: 'max' })
  assert.deepEqual(result.broken, ['no near-miss copy in .team/near-miss/'])
})

test('max run whose copies are gone counts any testing-section write into .team/near-miss/', t => {
  const dir = runDir(t, modeFile('max'))
  const NONE = ['no near-miss copy in .team/near-miss/']
  const testing = lines => section('testing', 't1', [userLine(1.5, 'job'), ...lines])
  const check = lines => checkRun({ cond: 'max-mo', task: 'h5', roles: [...maxH5(), testing(lines)], runDir: dir, record: 'max' }).broken
  assert.deepEqual(check([]), NONE)
  // A backslash separates folders only on Windows; on Linux it is part of a file name, beside the run folder.
  assert.deepEqual(check([write(3, `${dir}\\.team\\near-miss\\1-range.mjs`)]), process.platform === 'win32' ? [] : NONE)
  assert.deepEqual(check([write(3, join(dir, '.team', 'near-miss', '1-range.mjs'), 'Edit')]), [])
  assert.deepEqual(check([write(3, '.team/near-miss/1-range.mjs', 'MultiEdit')]), [])
  assert.deepEqual(check([toolLine(3, 'Bash', { command: 'cp src/range.mjs .team/near-miss/1-range.mjs' })]), [])
  assert.deepEqual(check([toolLine(3, 'Bash', { command: 'cp src\\range.mjs .team\\near-miss\\1-range.mjs' })]), [])
  assert.deepEqual(check([toolLine(3, 'PowerShell', { command: 'Copy-Item src\\range.mjs .team\\near-miss\\1-range.mjs' })]), [])
  assert.deepEqual(check([toolLine(3, 'PowerShell', { command: 'Copy-Item src/range.mjs .team/near-miss/1-range.mjs' })]), [])
  assert.deepEqual(check([write(3, join(tmpdir(), 'elsewhere', '.team', 'near-miss', '1-range.mjs'))]), NONE)
  assert.deepEqual(check([write(3, join(dir, '.team', 'notes.md')), toolLine(4, 'PowerShell', { command: 'Get-ChildItem .team' })]), NONE)
  assert.deepEqual(check([toolLine(3, 'Read', { file_path: join(dir, '.team', 'near-miss', '1-range.mjs') })]), NONE)
  const shell = (name, command) => check([toolLine(3, name, { command })])
  assert.deepEqual(shell('Bash', 'cp x.mjs .team/near-miss'), [])
  assert.deepEqual(shell('Bash', 'mkdir -p ".team/near-miss" && cp x.mjs "$_"'), [])
  assert.deepEqual(shell('PowerShell', 'Copy-Item x -Destination .team\\near-miss'), [])
  assert.deepEqual(shell('PowerShell', 'Copy-Item x -Destination .team\\near-miss; Get-Item x'), [])
  assert.deepEqual(shell('Bash', 'cp x.mjs .team/near-missing/x.mjs'), NONE)
  assert.deepEqual(shell('PowerShell', 'Copy-Item x .team\\near-miss-old'), NONE)
  assert.deepEqual(shell('Bash', 'ls .team/near-miss_list'), NONE)
  const byMain = [main_(wake(1, 'testing'), wake(2, 'security'), write(3, `${dir}/.team/near-miss/1-range.mjs`)), ...reviews(null, [[6, 9.5]])]
  assert.deepEqual(checkRun({ cond: 'max-mo', task: 'h5', roles: byMain, runDir: dir, record: 'max' }).broken, NONE)
})

// Linux runs (the cloud machine) write POSIX paths into their transcripts, and the run folder is a POSIX path.
test('mode-check reads Linux transcript paths case for case inside a Linux run folder', { skip: process.platform === 'win32' && 'Linux paths' }, t => {
  const dir = runDir(t, modeFile('max'))
  const NONE = ['no near-miss copy in .team/near-miss/']
  const testing = lines => section('testing', 't1', [userLine(1.5, 'job'), ...lines])
  const check = lines => checkRun({ cond: 'max-mo', task: 'h5', roles: [...maxH5(), testing(lines)], runDir: dir, record: 'max' }).broken
  assert.deepEqual(check([write(3, `${dir}/.team/near-miss/1-range.mjs`)]), [])
  assert.deepEqual(check([write(3, `${dir.toUpperCase()}/.team/near-miss/1-range.mjs`)]), NONE, 'another folder on Linux')
  const h4 = checkRun({ cond: 'team-mo', task: 'h4', roles: teamH4(dir, [write(20, `${dir}/src/server.mjs`, 'Edit'), write(21, `${dir}-attempt-1/src/x.mjs`)]), runDir: dir, record: 'balanced' })
  assert.deepEqual(h4.broken, ['.team/mode.json present (a team run has none)', 'main wrote src/server.mjs'])
})

test('lean run whose mode.json says balanced at the end is unfaithful', t => {
  const run = (files, record = 'lean') => checkRun({ cond: 'lean-mo', task: 'h5', roles: leanH5(), runDir: runDir(t, files), record })
  assert.equal(run(modeFile('lean')).faithful, true)
  assert.deepEqual(run(modeFile('balanced')).broken, ['.team/mode.json says balanced, not lean'])
  assert.deepEqual(run({}).broken, ['.team/mode.json missing (lean expected)'])
  assert.deepEqual(run({ '.team/mode.json': '{"mode":' }).broken, ['.team/mode.json says nothing usable, not lean'])
  assert.deepEqual(run(modeFile('lean'), 'balanced').broken, ['mode record is balanced, not lean'])
  assert.deepEqual(run(modeFile('lean'), null).broken, ['mode record is missing, not lean'])
  const team = checkRun({ cond: 'team-mo', task: 'h6', roles: teamH6(), runDir: runDir(t, modeFile('balanced')), record: 'balanced' })
  assert.deepEqual(team.broken, ['.team/mode.json present (a team run has none)'])
})

// A Balanced h4 run: main wakes backend, frontend, testing and docs and writes only docs and config itself.
const teamH4 = (dir, extra = [], heads = ['backend', 'frontend', 'testing', 'docs']) => [
  main_(...heads.map((head, i) => wake(1 + i, head)),
    write(6, join(dir, 'README.md')), write(7, join(dir, 'docs', 'API.md'), 'Edit'), write(8, join(dir, 'package.json')),
    write(9, `${dir}/.gitignore`, 'MultiEdit'), write(10, join(dir, '.team', 'plan.json')), write(11, join(tmpdir(), 'elsewhere', 'memory.js')),
    write(12, 'notes.md'), ...extra),
]

test('h4 run that never woke docs, or whose supervisor wrote src, is unfaithful', t => {
  const dir = runDir(t)
  const check = roles => checkRun({ cond: 'team-mo', task: 'h4', roles, runDir: dir, record: 'balanced' })
  assert.deepEqual(check(teamH4(dir)), { faithful: true, broken: [], tier: 'multi' })
  assert.deepEqual(check(teamH4(dir, [], ['backend', 'frontend', 'testing'])).broken, ['docs not woken'])
  assert.deepEqual(check(teamH4(dir, [write(20, join(dir, 'src', 'server.mjs'), 'Edit'), write(21, 'public/app.js')])).broken,
    ['main wrote src/server.mjs, public/app.js'])
  const viaBackend = [...teamH4(dir, [], ['backend', 'testing', 'docs']), section('backend', 'b1', [userLine(1.5, 'job'), wake(2, 'frontend')])]
  assert.deepEqual(check(viaBackend).broken, ['main did not wake frontend'])
  const lean = checkRun({ cond: 'lean-mo', task: 'h4', roles: teamH4(dir, [], ['backend', 'frontend', 'docs']), runDir: runDir(t, modeFile('lean')), record: 'lean' })
  assert.deepEqual(lean.broken, ['testing not woken'])
})

test('tier is multi, single or small', t => {
  const dir = runDir(t)
  const tier = (cond, task, roles) => checkRun({ cond, task, roles, runDir: dir, record: null }).tier
  assert.equal(tier('team-mo', 'h4', teamH4(dir)), 'multi')
  assert.equal(tier('team-mo', 'h6', teamH6()), 'single')
  assert.equal(tier('lean-mo', 'h5', leanH5()), 'small')
  assert.equal(tier('max-mo', 'h5', [main_(wake(1, 'security'), wake(2, 'database'))]), 'multi')
})

// Spec: the tier each run's supervisor chose, from its wake-ups; a section's own wake-ups are not the supervisor's choice.
test('tier counts only the supervisor\'s wake-ups: testing waking backend stays single', t => {
  const dir = runDir(t)
  const roles = [main_(wake(1, 'testing')), section('testing', 'a1', [wake(2, 'backend')])]
  assert.equal(checkRun({ cond: 'max-mo', task: 'h6', roles, runDir: dir, record: null }).tier, 'single')
})

test('a run with no evidence is a no-data row', () => {
  assert.deepEqual(checkRun({ cond: 'lean-mo', task: 'h5', roles: null, runDir: join(tmpdir(), 'bench-mode-none'), record: null }),
    { faithful: false, broken: ['no data'], tier: null })
  assert.deepEqual(checkRun({ cond: 'solo-mo', task: 'h5', roles: null, runDir: null, record: null }), { faithful: true, broken: [], tier: null })
  assert.deepEqual(checkRun({ cond: 'team', task: 'h5', roles: null, runDir: null, record: null }), { faithful: false, broken: ['no data'], tier: null })
  assert.throws(() => checkRun({ cond: 'team', task: 'h5', roles: [], runDir: null, record: null }), /unknown setup "team"/)
})

const jsonl = lines => lines.map(line => JSON.stringify(line)).join('\n') + '\n'

// results/<id>/ with run.json and, when roles are given, evidence/ laid out as copyEvidence writes it.
function writeRun(results, id, { dir, roles, record, version }) {
  const [task, cond] = [id.split('-')[0], id.split('-').slice(1, 3).join('-')]
  const out = join(results, id)
  const sid = `${id}-0000-sid`
  mkdirSync(out, { recursive: true })
  const sectionTeam = version === undefined ? {} : { sectionTeam: { path: 'C:/plugin', version } }
  writeFileSync(join(out, 'run.json'), JSON.stringify({ id, task, cond, dir, ...sectionTeam }))
  writeFileSync(join(out, 'session.json'), JSON.stringify({ sessionId: sid, attempt: 1 }))
  if (!roles) return
  const evidence = join(out, 'evidence')
  mkdirSync(join(evidence, sid, 'subagents'), { recursive: true })
  mkdirSync(join(evidence, '.claude', 'section-team', 'modes'), { recursive: true })
  writeFileSync(join(evidence, '.claude', 'section-team', 'modes', `${sid}.json`), JSON.stringify({ mode: record }))
  writeFileSync(join(evidence, `${sid}.jsonl`), jsonl(roles[0].messages))
  for (const role of roles.slice(1)) {
    const base = join(evidence, sid, 'subagents', `agent-${role.agentId}`)
    writeFileSync(`${base}.jsonl`, jsonl(role.messages))
    writeFileSync(`${base}.meta.json`, JSON.stringify({ agentType: role.role, ...(role.parentId ? { parentAgentId: role.parentId } : {}) }))
  }
}

test('modeCheck reads each run of the round from its evidence; main writes results/mode-check-<round>.json', t => {
  const results = runDir(t)
  const dir = runDir(t, modeFile('lean'))
  writeRun(results, 'h5-lean-mo-r1', { dir, roles: leanH5(), record: 'lean' })
  writeRun(results, 'h5-lean-mo-r2', { dir })
  writeRun(results, 'h5-solo-mo-r1', { dir })
  writeRun(results, 'h5-lean-ho-r1', { dir })
  mkdirSync(join(results, 'h6-max-mo-r1'))
  const rows = {
    'h5-lean-mo-r1': { cond: 'lean-mo', task: 'h5', faithful: true, broken: [], tier: 'small' },
    'h5-lean-mo-r2': { cond: 'lean-mo', task: 'h5', faithful: false, broken: ['no data'], tier: null },
    'h5-solo-mo-r1': { cond: 'solo-mo', task: 'h5', faithful: true, broken: [], tier: null },
    'h6-max-mo-r1': { cond: 'max-mo', task: 'h6', faithful: false, broken: ['no data'], tier: null },
  }
  assert.deepEqual(modeCheck({ results, round: 'mo' }), rows)
  const logs = []
  t.mock.method(console, 'log', line => logs.push(line))
  main(['--round=mo'], { results })
  assert.deepEqual(JSON.parse(readFileSync(join(results, 'mode-check-mo.json'), 'utf8')), rows)
  assert.match(logs.join('\n'), /h5-lean-mo-r2 .*no data/)
})

const rowOf = (cond, task, line) => ({ cond, task, faithful: false, broken: [line], tier: null })

test('every run gets a row: a bad mode record, session.json or run.json, or a missing or unreadable run folder', t => {
  const results = runDir(t)
  const dir = runDir(t, modeFile('lean'))
  writeRun(results, 'h5-lean-mo-r1', { dir, roles: leanH5(), record: 'bogus' })
  writeRun(results, 'h5-lean-mo-r2', { dir, roles: leanH5(), record: 'lean' })
  writeFileSync(join(results, 'h5-lean-mo-r2', 'session.json'), '{"sessionId":')
  writeRun(results, 'h5-lean-mo-r3', { dir: join(results, 'no-such-run'), roles: leanH5(), record: 'lean' })
  writeRun(results, 'h6-lean-mo-r1', { dir, roles: leanH5(), record: 'lean' })
  writeFileSync(join(results, 'h6-lean-mo-r1', 'run.json'), '{"dir":')
  writeRun(results, 'h6-lean-mo-r2', { dir: runDir(t, { '.team/mode.json/x': 'a folder, not a file' }), roles: leanH5(), record: 'lean' })
  writeRun(results, 'h6-lean-mo-r3', { dir, roles: leanH5(), record: 'lean' })
  writeFileSync(join(results, 'h6-lean-mo-r3', 'run.json'), JSON.stringify({ task: 'h6', cond: 'lean-mo' }))
  writeRun(results, 'h5-lean-mo-r4', { dir, roles: leanH5(), record: 'lean' })
  assert.deepEqual(modeCheck({ results, round: 'mo' }), {
    'h5-lean-mo-r1': rowOf('lean-mo', 'h5', 'mode record unreadable'),
    'h5-lean-mo-r2': rowOf('lean-mo', 'h5', 'session unreadable'),
    'h5-lean-mo-r3': rowOf('lean-mo', 'h5', 'no data'),
    'h5-lean-mo-r4': { cond: 'lean-mo', task: 'h5', faithful: true, broken: [], tier: 'small' },
    'h6-lean-mo-r1': rowOf('lean-mo', 'h6', 'run.json unreadable'),
    'h6-lean-mo-r2': rowOf('lean-mo', 'h6', 'run folder unreadable'),
    'h6-lean-mo-r3': rowOf('lean-mo', 'h6', 'run.json unreadable'),
  })
})

test('main stops with one line only when results/ cannot be read', t => {
  const errors = []
  t.mock.method(console, 'error', line => errors.push(line))
  const before = process.exitCode
  main(['--round=mo'], { results: join(runDir(t), 'no-results') })
  const exitCode = process.exitCode
  process.exitCode = before
  assert.equal(exitCode, 1)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /^mode-check: cannot read .*no-results \(ENOENT\)$/)
})

test('only file errors and the readers\' known one-line errors become rows; a TypeError or ERR_* stops main with one line', t => {
  const results = runDir(t)
  writeRun(results, 'h5-lean-mo-r1', { dir: runDir(t, modeFile('lean')), roles: leanH5(), record: 'lean' })
  const failing = err => ({ record: () => { throw err } })
  const coded = code => Object.assign(new Error(`${code}: refused`), { code })
  const row = readers => modeCheck({ results, round: 'mo', readers })['h5-lean-mo-r1'].broken
  for (const code of ['ENOENT', 'EACCES', 'EPERM', 'EISDIR', 'ENOTDIR', 'EBUSY']) assert.deepEqual(row(failing(coded(code))), ['mode record unreadable'])
  assert.deepEqual(row(failing(new Error('no usable session id (letters, digits, - and _ only)'))), ['mode record unreadable'])
  assert.throws(() => row(failing(new TypeError('boom'))), { name: 'Error', message: 'h5-lean-mo-r1: boom' })
  assert.throws(() => row(failing(new TypeError('x is not valid JSON'))), { message: 'h5-lean-mo-r1: x is not valid JSON' })
  assert.throws(() => row(failing(coded('ERR_INVALID_ARG_TYPE'))), { message: 'h5-lean-mo-r1: ERR_INVALID_ARG_TYPE: refused' })
  assert.throws(() => row(failing(new Error('something else'))), { message: 'h5-lean-mo-r1: something else' })
  const errors = []
  t.mock.method(console, 'error', line => errors.push(line))
  const before = process.exitCode
  main(['--round=mo'], { results, readers: failing(new TypeError('boom')) })
  const exitCode = process.exitCode
  process.exitCode = before
  assert.equal(exitCode, 1)
  assert.deepEqual(errors, ['mode-check: h5-lean-mo-r1: boom'])
})

test('a run folder path Node refuses (ERR_INVALID_ARG_VALUE) is not turned into a row', t => {
  const results = runDir(t)
  writeRun(results, 'h5-lean-mo-r1', { dir: `bad${String.fromCharCode(0)}dir`, roles: leanH5(), record: 'lean' })
  assert.throws(() => modeCheck({ results, round: 'mo' }), err => err.cause?.code === 'ERR_INVALID_ARG_VALUE' && err.message.startsWith('h5-lean-mo-r1: '))
})

test('main refuses a round that is not letters and digits', t => {
  const errors = []
  t.mock.method(console, 'error', line => errors.push(line))
  const before = process.exitCode
  main(['--round=../x'], { results: runDir(t) })
  const exitCode = process.exitCode
  process.exitCode = before
  assert.equal(exitCode, 1)
  assert.match(errors[0], /usage: node bench\/mode-check\.mjs --round=<tag>/)
})

test('h7 is held to the rules of h4, the other multi-area task', t => {
  const dir = runDir(t)
  const check = roles => checkRun({ cond: 'team-mo', task: 'h7', roles, runDir: dir, record: 'balanced' })
  assert.deepEqual(check(teamH4(dir)), { faithful: true, broken: [], tier: 'multi' })
  assert.deepEqual(check(teamH4(dir, [], ['backend', 'frontend', 'docs'])).broken, ['testing not woken'])
  assert.deepEqual(check(teamH4(dir, [], ['backend', 'testing', 'docs'])).broken, ['main did not wake frontend'])
  assert.deepEqual(check(teamH4(dir, [write(20, `${dir}/server.mjs`)])).broken, ['main wrote server.mjs'])
})

test('a round under any tag is checked: the setup comes from the part before the tag', t => {
  const dir = runDir(t)
  assert.deepEqual(checkRun({ cond: 'team-sm', task: 'h7', roles: teamH4(dir), runDir: dir, record: 'balanced' }), { faithful: true, broken: [], tier: 'multi' })
  assert.deepEqual(checkRun({ cond: 'solo-sm', task: 'h7', roles: null, runDir: null, record: null }), { faithful: true, broken: [], tier: null })
  assert.throws(() => checkRun({ cond: 'forced-sm', task: 'h7', roles: [], runDir: null, record: null }), /unknown setup "forced-sm"/)
  const results = runDir(t)
  writeRun(results, 'h7-team-sm-r1', { dir, roles: teamH4(dir), record: 'balanced' })
  assert.deepEqual(modeCheck({ results, round: 'sm' }), { 'h7-team-sm-r1': { cond: 'team-sm', task: 'h7', faithful: true, broken: [], tier: 'multi' } })
})
