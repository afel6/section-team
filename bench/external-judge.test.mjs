import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { externalOptions, importRound, importVerdicts, pairWinners, planCases, prepare, prepareCases } from './external-judge.mjs'

const scores = (overall, extra = {}) => ({ correctness: 8, codeQuality: 7, tests: 6, robustnessSecurity: 7, docsUsability: 5, overall, notes: 'A/x.mjs:1 ok', ...extra })
const keep = list => list // a "shuffle" that keeps the order, so the tests can name each case

function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), 'bench-ext-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const judgeDir = join(root, 'judge')
  for (const [pair, labels] of [['h2-r1', ['X', 'Y', 'SEED']], ['h3-r1', ['X', 'Y']]]) {
    for (const label of labels) {
      mkdirSync(join(judgeDir, pair, label), { recursive: true })
      writeFileSync(join(judgeDir, pair, label, 'who.txt'), `${pair} ${label}`)
    }
  }
  return { root, judgeDir, out: join(root, 'out') }
}

test('planCases gives every pair two cases, one per label order, numbered after shuffling', () => {
  assert.deepEqual(planCases(['h2-r1', 'h3-r1'], keep), [
    { case: 'case-01', pair: 'h2-r1', judge: 1, A: 'X', B: 'Y' },
    { case: 'case-02', pair: 'h2-r1', judge: 2, A: 'Y', B: 'X' },
    { case: 'case-03', pair: 'h3-r1', judge: 1, A: 'X', B: 'Y' },
    { case: 'case-04', pair: 'h3-r1', judge: 2, A: 'Y', B: 'X' },
  ])
  const reversed = planCases(['h2-r1'], list => [...list].reverse())
  assert.deepEqual(reversed.map(c => [c.case, c.judge]), [['case-01', 2], ['case-02', 1]], 'numbers follow the shuffled order')
})

test('prepareCases copies each solution under its case label, adds SEED, scratch and JUDGE.md, and names no X or Y', t => {
  const box = sandbox(t)
  const cases = planCases(['h2-r1', 'h3-r1'], keep)
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
  assert.match(read('README.md'), /case-01 \.\. case-04/)
})

test('prepareCases refuses a folder that already holds something, and writes nothing', t => {
  const box = sandbox(t)
  mkdirSync(box.out)
  writeFileSync(join(box.out, 'keep.txt'), 'x')
  assert.throws(() => prepareCases({ judgeDir: box.judgeDir, out: box.out, cases: planCases(['h3-r1'], keep), template: '', taskText: () => '' }), /not empty/)
  assert.deepEqual(readdirSync(box.out), ['keep.txt'])
})

test('importVerdicts maps each case back to the real labels and lists the cases it could not use', t => {
  const box = sandbox(t)
  const cases = planCases(['h3-r1'], keep).concat({ case: 'case-03', pair: 'h2-r1', judge: 1, A: 'X', B: 'Y' })
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

test('importVerdicts names a verdict that does not parse or breaks the score rules', t => {
  const box = sandbox(t)
  const cases = planCases(['h3-r1'], keep)
  for (const c of cases) mkdirSync(join(box.out, c.case), { recursive: true })
  writeFileSync(join(box.out, 'case-01', 'verdict.json'), '{"A": ')
  writeFileSync(join(box.out, 'case-02', 'verdict.json'), JSON.stringify({ A: scores(11), B: scores(8), ranking: ['B', 'A'] }))
  const { rows, problems } = importVerdicts({ out: box.out, cases })
  assert.deepEqual(rows, [])
  assert.equal(problems.length, 2)
  assert.match(problems[0], /^case-01: /)
  assert.match(problems[1], /^case-02: A\.overall must be an integer 1-10/)
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

test('externalOptions reads the command, round, folder and import name, and rejects anything else', () => {
  assert.deepEqual(externalOptions(['prepare', '--round=ho', '--out=C:/ag']), { command: 'prepare', round: 'ho', out: 'C:/ag', as: '' })
  assert.deepEqual(externalOptions(['import', '--round=ho', '--out=C:/ag', '--as=hoag']), { command: 'import', round: 'ho', out: 'C:/ag', as: 'hoag' })
  for (const argv of [[], ['judge', '--round=ho', '--out=x'], ['prepare', '--out=x'], ['prepare', '--round=../x', '--out=x'], ['prepare', '--round=ho'], ['import', '--round=ho', '--out=x'], ['import', '--round=ho', '--out=x', '--as=a-b']]) {
    assert.throws(() => externalOptions(argv), /^Error: usage/, argv.join(' '))
  }
})

// A results folder holding a judged round 'ho' (one pair, h3-r1, team as X), its Opus verdicts and an external key.
function judgedRound(t) {
  const box = sandbox(t)
  const results = join(box.root, 'results')
  mkdirSync(results)
  const key = { 'h3-r1': { X: 'team-ho', Y: 'solo-ho' } }
  writeFileSync(join(results, 'blind-key-ho.json'), JSON.stringify(key))
  writeFileSync(join(results, 'judge-ho.json'), JSON.stringify([{ pair: 'h3-r1', X: scores(9), Y: scores(8), ranking: ['X', 'Y'], judge: 1 }]))
  const cases = planCases(['h3-r1'], keep)
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

test('prepare checks every pair before copying anything, and JUDGE.md never says scratch is deleted for you', t => {
  const box = sandbox(t)
  const results = join(box.root, 'results')
  const bench = join(box.root, 'bench')
  mkdirSync(results)
  mkdirSync(join(bench, 'tasks'), { recursive: true })
  writeFileSync(join(bench, 'judge-prompt.md'), '{{LABELS}}\n3. Probes go only in `scratch`. It is deleted for you when you finish; do not delete anything yourself.\n{{TASK}}\n')
  writeFileSync(join(bench, 'tasks', 'h2.md'), 'task h2')
  // h3 has no task file: nothing may be copied.
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
  const bench = join(box.root, 'bench')
  mkdirSync(results)
  mkdirSync(join(bench, 'tasks'), { recursive: true })
  writeFileSync(join(bench, 'judge-prompt.md'), 'Solutions: {{LABELS}}.\n{{SEED_NOTE}}\n{{TASK}}\n')
  for (const task of ['h2', 'h3']) writeFileSync(join(bench, 'tasks', `${task}.md`), `task ${task}`)
  const count = prepare({ round: 'ho', out: box.out, results, judgeDir: box.judgeDir, bench, log: () => {} })
  assert.equal(count, 4)
  assert.equal(JSON.parse(readFileSync(join(results, 'external-key-ho.json'), 'utf8')).length, 4)
  assert.match(readFileSync(join(box.out, 'case-01', 'JUDGE.md'), 'utf8'), /^Solutions: A, B\./)
  assert.throws(() => prepare({ round: 'ho', out: join(box.root, 'out2'), results, judgeDir: box.judgeDir, bench, log: () => {} }), /already prepared/)
  const empty = join(box.root, 'empty-judge')
  mkdirSync(empty)
  assert.throws(() => prepare({ round: 'x', out: join(box.root, 'out3'), results, judgeDir: empty, bench, log: () => {} }), /no pairs in .*empty-judge/)
})
