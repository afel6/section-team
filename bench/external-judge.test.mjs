import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyCaseSet, externalOptions, importRound, importVerdicts, pairWinners, planCases, prepare, prepareCases } from './external-judge.mjs'

// The held-out case set and check are in external-judge-heldout.test.mjs.
const BENCH = dirname(fileURLToPath(import.meta.url))
const scores = (overall, extra = {}) => ({ correctness: 8, codeQuality: 7, tests: 6, robustnessSecurity: 7, docsUsability: 5, overall, notes: 'A/x.mjs:1 ok', ...extra })
const keep = list => list // a "shuffle" that keeps the order, so the tests can name each case
const TWO = [['h2-r1', ['X', 'Y', 'SEED']], ['h3-r1', ['X', 'Y']]]

// results/leak-scan-<round>.json for each round: the leak scan runs before any judge, outside ones included.
const scanned = (results, ...rounds) => rounds.forEach(round => writeFileSync(join(results, `leak-scan-${round}.json`), '{}'))

function sandbox(t, groups = TWO) {
  const root = mkdtempSync(join(tmpdir(), 'bench-ext-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const judgeDir = join(root, 'judge')
  for (const [pair, labels] of groups) {
    for (const label of labels) {
      mkdirSync(join(judgeDir, pair, label), { recursive: true })
      writeFileSync(join(judgeDir, pair, label, 'who.txt'), `${pair} ${label}`)
    }
  }
  return { root, judgeDir, out: join(root, 'out') }
}

test('planCases gives every pair two cases, one per label order, numbered after shuffling', () => {
  assert.deepEqual(planCases(['h2-r1', 'h3-r1'], ['X', 'Y'], keep), [
    { case: 'case-01', pair: 'h2-r1', judge: 1, map: { A: 'X', B: 'Y' } },
    { case: 'case-02', pair: 'h2-r1', judge: 2, map: { A: 'Y', B: 'X' } },
    { case: 'case-03', pair: 'h3-r1', judge: 1, map: { A: 'X', B: 'Y' } },
    { case: 'case-04', pair: 'h3-r1', judge: 2, map: { A: 'Y', B: 'X' } },
  ])
  const reversed = planCases(['h2-r1'], ['X', 'Y'], list => [...list].reverse())
  assert.deepEqual(reversed.map(c => [c.case, c.judge]), [['case-01', 2], ['case-02', 1]], 'numbers follow the shuffled order')
})

test('planCases maps four labels in order for case 1 and mirrored for case 2', () => {
  assert.deepEqual(planCases(['h4-r1'], ['Z', 'X', 'W', 'Y'], keep), [
    { case: 'case-01', pair: 'h4-r1', judge: 1, map: { A: 'W', B: 'X', C: 'Y', D: 'Z' } },
    { case: 'case-02', pair: 'h4-r1', judge: 2, map: { A: 'Z', B: 'Y', C: 'X', D: 'W' } },
  ])
})

test('prepareCases copies each solution under its case label, adds SEED, scratch and JUDGE.md, and names no X or Y', t => {
  const box = sandbox(t)
  const cases = planCases(['h2-r1', 'h3-r1'], ['X', 'Y'], keep)
  const template = 'Solutions: {{LABELS}}.\n{{SEED_NOTE}}\n{{TASK}}\nExample: {"X": {"overall": 7}, "Y": {"overall": 8}, "ranking": ["Y", "X"]}\n'
  prepareCases({ judgeDir: box.judgeDir, out: box.out, cases, template, taskText: pair => `task of ${pair.split('-')[0]}` })
  const read = (...p) => readFileSync(join(box.out, ...p), 'utf8')
  assert.equal(read('case-01', 'A', 'who.txt'), 'h2-r1 X')
  assert.equal(read('case-02', 'A', 'who.txt'), 'h2-r1 Y', 'the second case swaps the labels')
  assert.equal(read('case-02', 'SEED', 'who.txt'), 'h2-r1 SEED')
  assert.ok(!existsSync(join(box.out, 'case-03', 'SEED')), 'no SEED where the pair has none')
  assert.deepEqual(readdirSync(join(box.out, 'case-03')).sort(), ['A', 'B', 'JUDGE.md', 'scratch'])
  const judge = read('case-01', 'JUDGE.md')
  assert.match(judge, /^Solutions: A, B\.\nSEED\/ is the repo before the change/)
  assert.match(judge, /task of h2/)
  assert.match(judge, /verdict\.json/)
  assert.match(judge, /Example: \{"A": \{"overall": 7\}, "B": \{"overall": 8\}, "ranking": \["B", "A"\]\}/, 'the example uses the case labels')
  assert.doesNotMatch(judge, /h2-r1|\bX\b|\bY\b/, 'nothing points back to the pair or its old labels')
  assert.deepEqual(readdirSync(box.out).sort(), ['case-01', 'case-02', 'case-03', 'case-04'], 'no README at the root')
})

test('prepareCases refuses a folder that already holds something, and writes nothing', t => {
  const box = sandbox(t)
  mkdirSync(box.out)
  writeFileSync(join(box.out, 'keep.txt'), 'x')
  assert.throws(() => prepareCases({ judgeDir: box.judgeDir, out: box.out, cases: planCases(['h3-r1'], ['X', 'Y'], keep), template: '', taskText: () => '' }), /not empty/)
  assert.deepEqual(readdirSync(box.out), ['keep.txt'])
})

test('importVerdicts maps each case back to the real labels and lists the cases it could not use', t => {
  const box = sandbox(t)
  const cases = planCases(['h3-r1'], ['X', 'Y'], keep).concat({ case: 'case-03', pair: 'h2-r1', judge: 1, map: { A: 'X', B: 'Y' } })
  for (const c of cases) mkdirSync(join(box.out, c.case), { recursive: true })
  // case-01 saw X as A; case-02 saw Y as A and ranked A first; case-03 has no verdict.
  writeFileSync(join(box.out, 'case-01', 'verdict.json'), JSON.stringify({ A: scores(9), B: scores(7), ranking: ['A', 'B'] }))
  writeFileSync(join(box.out, 'case-02', 'verdict.json'), JSON.stringify({ A: scores(6), B: scores(8), ranking: ['B', 'A'] }))
  const { rows, problems } = importVerdicts({ out: box.out, cases })
  assert.deepEqual(rows, [
    { pair: 'h3-r1', X: scores(9), Y: scores(7), ranking: ['X', 'Y'], judge: 1, case: 'case-01' },
    { pair: 'h3-r1', X: scores(8), Y: scores(6), ranking: ['X', 'Y'], judge: 2, case: 'case-02', swapped: true },
  ])
  assert.deepEqual(problems, ['case-03: no verdict.json'])
})

test('importVerdicts names a verdict that does not parse or breaks the score rules, each on one line', t => {
  const box = sandbox(t)
  const cases = planCases(['h3-r1', 'h2-r1'], ['X', 'Y'], keep)
  for (const c of cases) mkdirSync(join(box.out, c.case), { recursive: true })
  writeFileSync(join(box.out, 'case-01', 'verdict.json'), '{"A": ')
  writeFileSync(join(box.out, 'case-02', 'verdict.json'), JSON.stringify({ A: scores(11), B: scores(8), ranking: ['B', 'A'] }))
  writeFileSync(join(box.out, 'case-03', 'verdict.json'), '{"A": \n  oops\n}')
  writeFileSync(join(box.out, 'case-04', 'verdict.json'), JSON.stringify({ A: scores(8), B: scores(8), ranking: ['A', 'B'] }))
  const { rows, problems } = importVerdicts({ out: box.out, cases })
  assert.equal(rows.length, 1)
  assert.equal(problems.length, 3)
  assert.match(problems[0], /^case-01: /)
  assert.match(problems[1], /^case-02: A\.overall must be an integer 1-10/)
  assert.match(problems[2], /^case-03: judge json does not parse/)
  for (const problem of problems) assert.doesNotMatch(problem, /\n/, 'one line per case')
})

test('a mirrored four-label case imports back under W-Z with swapped true', t => {
  const box = sandbox(t)
  const cases = planCases(['h4-r1'], ['W', 'X', 'Y', 'Z'], keep)
  const verdict = { A: scores(9), B: scores(8), C: scores(7), D: scores(6), ranking: ['A', 'C', 'B', 'D'] }
  for (const c of cases) {
    mkdirSync(join(box.out, c.case), { recursive: true })
    writeFileSync(join(box.out, c.case, 'verdict.json'), JSON.stringify(verdict))
  }
  const { rows, problems } = importVerdicts({ out: box.out, cases })
  assert.deepEqual(problems, [])
  assert.deepEqual(rows, [
    { pair: 'h4-r1', W: scores(9), X: scores(8), Y: scores(7), Z: scores(6), ranking: ['W', 'Y', 'X', 'Z'], judge: 1, case: 'case-01' },
    { pair: 'h4-r1', Z: scores(9), Y: scores(8), X: scores(7), W: scores(6), ranking: ['Z', 'X', 'Y', 'W'], judge: 2, case: 'case-02', swapped: true },
  ])
})

test('old external-key-ho cases still import', t => {
  const box = sandbox(t)
  // The shape c5ba259 wrote to results/external-key-ho.json: A and B on the case itself, no map.
  const cases = [{ case: 'case-01', pair: 'h3-r1', judge: 2, A: 'Y', B: 'X' }, { case: 'case-02', pair: 'h3-r1', judge: 1, A: 'X', B: 'Y' }]
  for (const c of cases) mkdirSync(join(box.out, c.case), { recursive: true })
  writeFileSync(join(box.out, 'case-01', 'verdict.json'), JSON.stringify({ A: scores(6), B: scores(9), ranking: ['B', 'A'] }))
  writeFileSync(join(box.out, 'case-02', 'verdict.json'), JSON.stringify({ A: scores(8), B: scores(7), ranking: ['A', 'B'] }))
  const { rows, problems } = importVerdicts({ out: box.out, cases })
  assert.deepEqual(problems, [])
  assert.deepEqual(rows, [
    { pair: 'h3-r1', Y: scores(6), X: scores(9), ranking: ['X', 'Y'], judge: 2, case: 'case-01', swapped: true },
    { pair: 'h3-r1', X: scores(8), Y: scores(7), ranking: ['X', 'Y'], judge: 1, case: 'case-02' },
  ])
})

test('pairWinners picks each pair\'s setup with the higher summed overall score over its judges, or a tie', () => {
  const key = { 'h1-r1': { X: 'team-ho', Y: 'solo-ho' }, 'h1-r2': { X: 'solo-ho', Y: 'team-ho' } }
  const rows = [
    { pair: 'h1-r1', X: scores(9), Y: scores(8), ranking: ['X', 'Y'] },
    { pair: 'h1-r1', X: scores(8), Y: scores(8), ranking: ['Y', 'X'] },
    { pair: 'h1-r2', X: scores(7), Y: scores(7), ranking: ['X', 'Y'] },
  ]
  assert.deepEqual(pairWinners(rows, key), { 'h1-r1': 'team-ho', 'h1-r2': 'tie' })
})

test('externalOptions reads each command\'s options and rejects anything else', () => {
  const none = { round: '', out: '', as: '', from: '', to: '' }
  assert.deepEqual(externalOptions(['prepare', '--round=ho', '--out=C:/ag']), { ...none, command: 'prepare', round: 'ho', out: 'C:/ag' })
  assert.deepEqual(externalOptions(['import', '--round=ho', '--out=C:/ag', '--as=hoag']), { ...none, command: 'import', round: 'ho', out: 'C:/ag', as: 'hoag' })
  assert.deepEqual(externalOptions(['copy', '--from=C:/a', '--to=C:/b']), { ...none, command: 'copy', from: 'C:/a', to: 'C:/b' })
  assert.deepEqual(externalOptions(['rebuild-heldout', '--out=C:/c']), { ...none, command: 'rebuild-heldout', out: 'C:/c' })
  assert.deepEqual(externalOptions(['check', '--as=hocx']), { ...none, command: 'check', as: 'hocx' })
  const bad = [[], ['judge', '--round=ho', '--out=x'], ['prepare', '--out=x'], ['prepare', '--round=../x', '--out=x'], ['prepare', '--round=ho'], ['import', '--round=ho', '--out=x'], ['import', '--round=ho', '--out=x', '--as=a-b'],
    ['copy', '--from=a'], ['copy', '--to=b'], ['rebuild-heldout'], ['check'], ['check', '--as=a-b']]
  for (const argv of bad) assert.throws(() => externalOptions(argv), /^Error: usage/, argv.join(' '))
})

// A results folder holding a judged round 'ho' (one pair, h3-r1, team as X), its Opus verdicts and an external key.
function judgedRound(t) {
  const box = sandbox(t)
  const results = join(box.root, 'results')
  mkdirSync(results)
  const key = { 'h3-r1': { X: 'team-ho', Y: 'solo-ho' } }
  writeFileSync(join(results, 'blind-key-ho.json'), JSON.stringify(key))
  writeFileSync(join(results, 'judge-ho.json'), JSON.stringify([{ pair: 'h3-r1', X: scores(9), Y: scores(8), ranking: ['X', 'Y'], judge: 1 }]))
  const cases = planCases(['h3-r1'], ['X', 'Y'], keep)
  writeFileSync(join(results, 'external-key-ho.json'), JSON.stringify(cases))
  for (const c of cases) mkdirSync(join(box.out, c.case), { recursive: true })
  const hand = (name, text) => writeFileSync(join(box.out, name, 'verdict.json'), text)
  return { ...box, results, hand }
}

test('importRound writes the outside verdicts as a new round and counts the pairs where both judges pick the same winner', t => {
  const r = judgedRound(t)
  // case-01 shows X as A; case-02 shows Y as A. A byte-order mark and a json fence are both accepted.
  r.hand('case-01', '﻿' + JSON.stringify({ A: scores(9), B: scores(7), ranking: ['A', 'B'] }))
  r.hand('case-02', '```json\n' + JSON.stringify({ A: scores(7), B: scores(8), ranking: ['B', 'A'] }) + '\n```\n')
  const lines = []
  const summary = importRound({ round: 'ho', out: r.out, as: 'hoag', results: r.results, log: line => lines.push(line) })
  assert.deepEqual(summary, { same: 1, pairs: 1 })
  assert.equal(JSON.parse(readFileSync(join(r.results, 'judge-hoag.json'), 'utf8')).length, 2)
  assert.deepEqual(JSON.parse(readFileSync(join(r.results, 'blind-key-hoag.json'), 'utf8')), { 'h3-r1': { X: 'team-ho', Y: 'solo-ho' } })
  assert.match(lines.join('\n'), /h3-r1: outside team-ho, inside team-ho/)
})

test('importRound never overwrites a judged round and writes nothing when a case is unusable', t => {
  const r = judgedRound(t)
  const before = readFileSync(join(r.results, 'judge-ho.json'), 'utf8')
  r.hand('case-01', JSON.stringify({ A: scores(9), B: scores(7), ranking: ['A', 'B'] }))
  assert.throws(() => importRound({ round: 'ho', out: r.out, as: 'ho', results: r.results, log: () => {} }), /would overwrite/)
  assert.throws(() => importRound({ round: 'ho', out: r.out, as: 'hoag', results: r.results, log: () => {} }), /case-02: no verdict\.json/)
  assert.ok(!existsSync(join(r.results, 'judge-hoag.json')) && !existsSync(join(r.results, 'blind-key-hoag.json')), 'nothing written')
  writeFileSync(join(r.results, 'judge-hoag.json'), '[]')
  r.hand('case-02', JSON.stringify({ A: scores(7), B: scores(8), ranking: ['B', 'A'] }))
  assert.throws(() => importRound({ round: 'ho', out: r.out, as: 'hoag', results: r.results, log: () => {} }), /judge-hoag\.json.*would overwrite/)
  assert.equal(readFileSync(join(r.results, 'judge-ho.json'), 'utf8'), before, 'the paid verdicts are untouched')
})

// A judged mode round 'mo' (the 'ho' fixture under mo names) whose two cases both have a usable verdict.
function judgedModeRound(t) {
  const r = judgedRound(t)
  for (const name of ['blind-key', 'judge', 'external-key']) copyFileSync(join(r.results, `${name}-ho.json`), join(r.results, `${name}-mo.json`))
  r.hand('case-01', JSON.stringify({ A: scores(9), B: scores(7), ranking: ['A', 'B'] }))
  r.hand('case-02', JSON.stringify({ A: scores(7), B: scores(8), ranking: ['B', 'A'] }))
  return r
}
const CODEX = { name: 'Codex', heldOut: 'hocx', round: 'mocx', set: 'C:/Users/Asus/codex-judge-mo' }

// Spec: each held-out check is recorded before any mode-round outside verdict is imported.
test('importRound refuses a mode-round import that no outside judge names, or before its held-out check, and writes no verdicts', t => {
  const r = judgedModeRound(t)
  const imported = () => existsSync(join(r.results, 'judge-mocx.json')) || existsSync(join(r.results, 'blind-key-mocx.json'))
  assert.throws(() => importRound({ round: 'mo', out: r.out, as: 'mocx', results: r.results, outside: [], log: () => {} }),
    { message: 'no outside judge in bench/bars-mo.json imports its mode-round verdicts as mocx' })
  assert.throws(() => importRound({ round: 'mo', out: r.out, as: 'mocx', results: r.results, outside: [CODEX], log: () => {} }),
    { message: 'run node bench/external-judge.mjs check --as=hocx first' })
  assert.ok(!imported(), 'no verdicts written')
  assert.deepEqual(JSON.parse(readFileSync(join(r.results, 'outside-usable-mocx.json'), 'utf8')), { usable: 2, total: 2, problems: [] }, 'every import says how far it got')
  writeFileSync(join(r.results, 'outside-check-ho-hocx.json'), '{}')
  assert.deepEqual(importRound({ round: 'mo', out: r.out, as: 'mocx', results: r.results, outside: [CODEX], log: () => {} }), { same: 1, pairs: 1 })
  assert.ok(imported())
})

test('import writes outside-usable even when a case is unusable', t => {
  const r = judgedRound(t)
  const usable = () => JSON.parse(readFileSync(join(r.results, 'outside-usable-hoag.json'), 'utf8'))
  r.hand('case-01', JSON.stringify({ A: scores(9), B: scores(7), ranking: ['A', 'B'] }))
  r.hand('case-02', '{"A": \n  oops\n}')
  assert.throws(() => importRound({ round: 'ho', out: r.out, as: 'hoag', results: r.results, log: () => {} }), /1 case\(s\) not usable/)
  const refused = usable()
  assert.deepEqual([refused.usable, refused.total, refused.problems.length], [1, 2, 1])
  assert.match(refused.problems[0], /^case-02: judge json does not parse/)
  assert.ok(!existsSync(join(r.results, 'judge-hoag.json')), 'no rows written')
  r.hand('case-02', JSON.stringify({ A: scores(7), B: scores(8), ranking: ['B', 'A'] }))
  importRound({ round: 'ho', out: r.out, as: 'hoag', results: r.results, log: () => {} })
  assert.deepEqual(usable(), { usable: 2, total: 2, problems: [] })
})

test('importRound refuses when only the blind key of the import name exists', t => {
  const r = judgedRound(t)
  for (const c of ['case-01', 'case-02']) r.hand(c, JSON.stringify({ A: scores(8), B: scores(8), ranking: ['A', 'B'] }))
  writeFileSync(join(r.results, 'blind-key-hoag.json'), '{}')
  assert.throws(() => importRound({ round: 'ho', out: r.out, as: 'hoag', results: r.results, log: () => {} }), /blind-key-hoag\.json: importing as round hoag would overwrite it/)
})

test('importRound counts a pair where the outside judge picks the other winner as a disagreement', t => {
  const r = judgedRound(t)
  // The round's own judge picked team (X); the outside judge prefers solo (Y) in both orders.
  r.hand('case-01', JSON.stringify({ A: scores(7), B: scores(9), ranking: ['B', 'A'] }))
  r.hand('case-02', JSON.stringify({ A: scores(9), B: scores(7), ranking: ['A', 'B'] }))
  const lines = []
  assert.deepEqual(importRound({ round: 'ho', out: r.out, as: 'hoag', results: r.results, log: line => lines.push(line) }), { same: 0, pairs: 1 })
  assert.match(lines.join('\n'), /h3-r1: outside solo-ho, inside team-ho/)
})

test('importRound refuses a verdict whose pair is not in the blind key, before writing anything', t => {
  const r = judgedRound(t)
  writeFileSync(join(r.results, 'blind-key-ho.json'), JSON.stringify({ 'h1-r1': { X: 'team-ho', Y: 'solo-ho' } }))
  for (const c of ['case-01', 'case-02']) r.hand(c, JSON.stringify({ A: scores(8), B: scores(8), ranking: ['A', 'B'] }))
  assert.throws(() => importRound({ round: 'ho', out: r.out, as: 'hoag', results: r.results, log: () => {} }), /h3-r1 is not in .*blind-key-ho\.json/)
  assert.ok(!existsSync(join(r.results, 'judge-hoag.json')))
})

test('a results file that does not parse is named on one line', t => {
  const r = judgedRound(t)
  writeFileSync(join(r.results, 'blind-key-ho.json'), '{\n  "h3-r1": oops\n}\n')
  assert.throws(() => importRound({ round: 'ho', out: r.out, as: 'hoag', results: r.results, log: () => {} }),
    err => /blind-key-ho\.json is not valid JSON/.test(err.message) && !err.message.includes('\n'))
})

// A bench folder with the given prompt and a task file per task.
function benchWith(root, prompt, tasks) {
  const bench = join(root, 'bench')
  mkdirSync(join(bench, 'tasks'), { recursive: true })
  writeFileSync(join(bench, 'judge-prompt.md'), prompt)
  for (const task of tasks) writeFileSync(join(bench, 'tasks', `${task}.md`), `task ${task}`)
  return bench
}

test('prepare gives the outside judges of a two-stage task both prompts', t => {
  const box = sandbox(t, [['h7-r1', ['X', 'Y']]])
  const results = join(box.root, 'results')
  mkdirSync(results)
  scanned(results, 'ho')
  const bench = benchWith(box.root, '{{LABELS}}\n{{TASK}}\n', ['h7', 'h7-s2'])
  prepare({ round: 'ho', out: box.out, results, judgeDir: box.judgeDir, bench, log: () => {} })
  assert.match(readFileSync(join(box.out, 'case-01', 'JUDGE.md'), 'utf8'), /task h7\n[^]*task h7-s2/)
})

test('prepare checks every pair before copying anything, and JUDGE.md never says scratch is deleted for you', t => {
  const box = sandbox(t)
  const results = join(box.root, 'results')
  mkdirSync(results)
  scanned(results, 'ho')
  // h3 has no task file: nothing may be copied.
  const bench = benchWith(box.root, '{{LABELS}}\n3. Probes go only in `scratch`. It is deleted for you when you finish; do not delete anything yourself.\n{{TASK}}\n', ['h2'])
  assert.throws(() => prepare({ round: 'ho', out: box.out, results, judgeDir: box.judgeDir, bench, log: () => {} }), /h3\.md/)
  assert.ok(!existsSync(box.out), 'nothing copied')
  writeFileSync(join(bench, 'tasks', 'h3.md'), 'task h3')
  mkdirSync(join(box.judgeDir, 'h3-r1', 'Z'))
  assert.throws(() => prepare({ round: 'ho', out: box.out, results, judgeDir: box.judgeDir, bench, log: () => {} }), /h3-r1 has solutions X, Y, Z/)
  rmSync(join(box.judgeDir, 'h3-r1', 'Z'), { recursive: true })
  prepare({ round: 'ho', out: box.out, results, judgeDir: box.judgeDir, bench, log: () => {} })
  const judge = readFileSync(join(box.out, 'case-01', 'JUDGE.md'), 'utf8')
  assert.doesNotMatch(judge, /deleted for you when you finish/)
  assert.match(judge, /It is not deleted for you here; leaving it is fine/)
})

test('prepare writes the key and the cases, refuses a second key for the round, and names an empty judge folder', t => {
  const box = sandbox(t)
  const results = join(box.root, 'results')
  mkdirSync(results)
  scanned(results, 'ho', 'x')
  const bench = benchWith(box.root, 'Solutions: {{LABELS}}.\n{{SEED_NOTE}}\n{{TASK}}\n', ['h2', 'h3'])
  const count = prepare({ round: 'ho', out: box.out, results, judgeDir: box.judgeDir, bench, log: () => {} })
  assert.equal(count, 4)
  assert.equal(JSON.parse(readFileSync(join(results, 'external-key-ho.json'), 'utf8')).length, 4)
  assert.match(readFileSync(join(box.out, 'case-01', 'JUDGE.md'), 'utf8'), /^Solutions: A, B\./)
  assert.throws(() => prepare({ round: 'ho', out: join(box.root, 'out2'), results, judgeDir: box.judgeDir, bench, log: () => {} }), /already prepared/)
  const empty = join(box.root, 'empty-judge')
  mkdirSync(empty)
  assert.throws(() => prepare({ round: 'x', out: join(box.root, 'out3'), results, judgeDir: empty, bench, log: () => {} }), /no pairs in .*empty-judge/)
})

test('prepare accepts W, X, Y, Z groups and writes no root README', t => {
  const box = sandbox(t, [['h4-r1', ['W', 'X', 'Y', 'Z', 'SEED']], ['h5-r1', ['W', 'X', 'Y', 'Z']]])
  const results = join(box.root, 'results')
  mkdirSync(results)
  scanned(results, 'mo', 'one', 'five')
  const bench = benchWith(box.root, readFileSync(join(BENCH, 'judge-prompt.md'), 'utf8'), ['h4', 'h5'])
  assert.equal(prepare({ round: 'mo', out: box.out, results, judgeDir: box.judgeDir, bench, log: () => {} }), 4)
  assert.deepEqual(readdirSync(box.out).sort(), ['case-01', 'case-02', 'case-03', 'case-04'])
  const mirrored = JSON.parse(readFileSync(join(results, 'external-key-mo.json'), 'utf8')).find(c => c.pair === 'h4-r1' && c.judge === 2)
  assert.deepEqual(mirrored.map, { A: 'Z', B: 'Y', C: 'X', D: 'W' })
  const read = (...p) => readFileSync(join(box.out, mirrored.case, ...p), 'utf8')
  assert.deepEqual(['A', 'B', 'C', 'D', 'SEED'].map(folder => read(folder, 'who.txt')), ['h4-r1 Z', 'h4-r1 Y', 'h4-r1 X', 'h4-r1 W', 'h4-r1 SEED'])
  const judge = read('JUDGE.md')
  assert.match(judge, /each in its own folder: A, B, C, D\./)
  assert.match(judge, /"ranking": \["C", "A", "D", "B"\]/, 'the example\'s W, X, Y, Z become A, B, C, D')
  assert.doesNotMatch(judge, /"[W-Z]"/)
  assert.match(judge, /It is not deleted for you here; leaving it is fine/)
  const one = sandbox(t, [['h4-r1', ['X', 'SEED']]])
  assert.throws(() => prepare({ round: 'one', out: one.out, results, judgeDir: one.judgeDir, bench, log: () => {} }), /h4-r1 has solutions X: an outside judge takes 2 to 4/)
  const five = sandbox(t, [['h4-r1', ['V', 'W', 'X', 'Y', 'Z']]])
  assert.throws(() => prepare({ round: 'five', out: five.out, results, judgeDir: five.judgeDir, bench, log: () => {} }), /h4-r1 has solutions V, W, X, Y, Z: an outside judge takes 2 to 4/)
})

test('prepare refuses a round whose leak scan is not written, before copying anything', t => {
  const box = sandbox(t)
  const results = join(box.root, 'results')
  mkdirSync(results)
  const bench = benchWith(box.root, 'Solutions: {{LABELS}}.\n{{TASK}}\n', ['h2', 'h3'])
  assert.throws(() => prepare({ round: 'ho', out: box.out, results, judgeDir: box.judgeDir, bench, log: () => {} }), { message: 'run node bench/leak-scan.mjs --round=ho first' })
  assert.ok(!existsSync(box.out) && !existsSync(join(results, 'external-key-ho.json')), 'nothing copied, no key written')
})

test('copyCaseSet refuses a set with a verdict or scratch files', t => {
  const box = sandbox(t)
  prepareCases({ judgeDir: box.judgeDir, out: box.out, cases: planCases(['h2-r1', 'h3-r1'], ['X', 'Y'], keep), template: '{{LABELS}}\n', taskText: () => '' })
  const to = join(box.root, 'second')
  const planted = [join(box.out, 'case-01', 'verdict.json'), join(box.out, 'case-02', 'A', 'verdict.json'), join(box.out, 'case-03', 'scratch', 'probe.mjs')]
  for (const file of planted) writeFileSync(file, '{}')
  assert.throws(() => copyCaseSet({ from: box.out, to }), err => ['case-01', 'case-02', 'case-03'].every(name => err.message.includes(name)) && /verdict\.json/.test(err.message) && /scratch/.test(err.message))
  assert.ok(!existsSync(to), 'nothing copied')
  for (const file of planted) rmSync(file)
  mkdirSync(to)
  writeFileSync(join(to, 'keep.txt'), 'x')
  assert.throws(() => copyCaseSet({ from: box.out, to }), /not empty/)
  rmSync(to, { recursive: true })
  assert.equal(copyCaseSet({ from: box.out, to }), 4)
  assert.equal(readFileSync(join(to, 'case-02', 'A', 'who.txt'), 'utf8'), 'h2-r1 Y')
  assert.equal(readFileSync(join(to, 'case-02', 'JUDGE.md'), 'utf8'), readFileSync(join(box.out, 'case-02', 'JUDGE.md'), 'utf8'))
  assert.deepEqual(readdirSync(join(to, 'case-03', 'scratch')), [], 'an empty scratch/ in every case')
})
