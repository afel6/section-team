import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { outsideCheck, rebuildHeldOut, recordCheck } from './external-judge.mjs'
import { fillPrompt } from './judge.mjs'

// The held-out side of bench/external-judge.mjs: c5ba259's case set rebuilt for a fresh judge, and c5ba259's rule.
const BENCH = dirname(fileURLToPath(import.meta.url))
const HELD_OUT = join(BENCH, 'data', 'heldout')
const scores = (overall, extra = {}) => ({ correctness: 8, codeQuality: 7, tests: 6, robustnessSecurity: 7, docsUsability: 5, overall, notes: 'A/x.mjs:1 ok', ...extra })

// A held-out judge folder: h2-r1 (seeded) and h3-r1, each with solutions X and Y.
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

test('rebuildHeldOut gives c5ba259\'s JUDGE.md text, the same cases and labels, and empty scratch', t => {
  const box = sandbox(t)
  const results = join(box.root, 'results')
  mkdirSync(results)
  writeFileSync(join(results, 'external-key-ho.json'), JSON.stringify([
    { case: 'case-01', pair: 'h3-r1', judge: 2, A: 'Y', B: 'X' },
    { case: 'case-02', pair: 'h2-r1', judge: 1, A: 'X', B: 'Y' },
  ]))
  assert.equal(rebuildHeldOut({ results, judgeDir: box.judgeDir, out: box.out }), 2)
  const read = (...p) => readFileSync(join(box.out, ...p), 'utf8')
  assert.deepEqual(readdirSync(box.out).sort(), ['case-01', 'case-02'], 'no README at the root')
  assert.deepEqual([read('case-01', 'A', 'who.txt'), read('case-01', 'B', 'who.txt'), read('case-02', 'SEED', 'who.txt')], ['h3-r1 Y', 'h3-r1 X', 'h2-r1 SEED'])
  assert.deepEqual(readdirSync(join(box.out, 'case-01')).sort(), ['A', 'B', 'JUDGE.md', 'scratch'])
  assert.deepEqual(readdirSync(join(box.out, 'case-01', 'scratch')), [])
  // The frozen prompt is c5ba259's bench/judge-prompt.md; JUDGE.md is what c5ba259's prepareCases wrote from it.
  const frozen = readFileSync(join(HELD_OUT, 'judge-prompt-ho.md'))
  assert.equal(createHash('sha256').update(frozen).digest('hex'), '4d39376a6c6c723ea2a10aec024401ca7300a5fbb22963b409c1b66df28fe8de')
  const relabelled = frozen.toString('utf8').replaceAll('"X"', '"A"').replaceAll('"Y"', '"B"')
    .replace('It is deleted for you when you finish; do not delete anything yourself.', 'It is not deleted for you here; leaving it is fine. Do not delete anything yourself.')
  const handIn = '\n## How to hand in your verdict\n\n'
    + '- This folder is the whole case: judge only what is in it. Do not open other case folders, any repository or the web.\n'
    + '- Put probes only in the `scratch` folder here.\n'
    + '- When you are done, also write your final JSON object (the same one, without the fence) to `verdict.json` in this folder.\n'
  const task = name => readFileSync(join(BENCH, 'tasks', `${name}.md`), 'utf8')
  assert.equal(read('case-01', 'JUDGE.md'), fillPrompt(relabelled, { labels: ['A', 'B'], task: task('h3'), seed: false }) + handIn)
  assert.equal(read('case-02', 'JUDGE.md'), fillPrompt(relabelled, { labels: ['A', 'B'], task: task('h2'), seed: true }) + handIn)
  assert.throws(() => rebuildHeldOut({ results, judgeDir: box.judgeDir, out: box.out }), /not empty/)
})

test('rebuildHeldOut checks every solution folder before copying anything', t => {
  const box = sandbox(t)
  const results = join(box.root, 'results')
  mkdirSync(results)
  writeFileSync(join(results, 'external-key-ho.json'), JSON.stringify([
    { case: 'case-01', pair: 'h3-r1', judge: 1, A: 'X', B: 'Y' },
    { case: 'case-02', pair: 'h1-r1', judge: 1, A: 'X', B: 'Y' },
  ]))
  assert.throws(() => rebuildHeldOut({ results, judgeDir: box.judgeDir, out: box.out }), /no folder .*h1-r1.*: nothing copied/)
  assert.ok(!existsSync(box.out), 'no half-copied set')
})

test('outsideCheck reproduces hoag: gap 0.93, same 8 of 9, passed', () => {
  assert.deepEqual(outsideCheck({ results: HELD_OUT, as: 'hoag' }), { gap: 0.93, same: 8, pairs: 9, passed: true })
})

// Results for outsideCheck: pairs h1-r1.. with team as X. The round's own judges pick team in every pair; the
// outside judge gives team diffs[i] more than solo on every dimension. No summary.json: the check never needs it.
function heldOut(t, diffs) {
  const results = mkdtempSync(join(tmpdir(), 'bench-check-'))
  t.after(() => rmSync(results, { recursive: true, force: true }))
  const pairs = diffs.map((_, i) => `h1-r${i + 1}`)
  const key = Object.fromEntries(pairs.map(pair => [pair, { X: 'team-ho', Y: 'solo-ho' }]))
  const all = v => scores(v, { correctness: v, codeQuality: v, tests: v, robustnessSecurity: v, docsUsability: v })
  const save = (name, value) => writeFileSync(join(results, name), JSON.stringify(value))
  save('blind-key-ho.json', key)
  save('blind-key-out.json', key)
  save('judge-ho.json', pairs.map(pair => ({ pair, X: scores(9), Y: scores(8), ranking: ['X', 'Y'] })))
  save('judge-out.json', pairs.map((pair, i) => ({ pair, X: all(5 + diffs[i]), Y: all(5), ranking: ['X', 'Y'] })))
  return results
}

test('outsideCheck rounds the gap, passes at +0.50 and 7 same winners, and fails just below either', t => {
  const check = diffs => outsideCheck({ results: heldOut(t, diffs), as: 'out' })
  assert.deepEqual(check([1, 1, 1, 1, 1, 1, 1, -1, -1, -0.03]), { gap: 0.5, same: 7, pairs: 10, passed: true }, 'a raw gap of 0.497 rounds to 0.50')
  assert.deepEqual(check([1, 1, 1, 1, 1, 1, 1, -1, -2, 0]), { gap: 0.4, same: 7, pairs: 10, passed: false })
  assert.deepEqual(check([1, 1, 1, 1, 1, 1, 0, 0, 0, 0]), { gap: 0.6, same: 6, pairs: 10, passed: false })
  assert.throws(() => check([]), /blind-key-out\.json has no pairs/)
})

test('recordCheck writes outside-check-ho-<as>.json once and refuses to overwrite it', t => {
  const results = mkdtempSync(join(tmpdir(), 'bench-check-'))
  t.after(() => rmSync(results, { recursive: true, force: true }))
  for (const name of ['judge-ho.json', 'blind-key-ho.json', 'judge-hoag.json', 'blind-key-hoag.json']) copyFileSync(join(HELD_OUT, name), join(results, name))
  const path = join(results, 'outside-check-ho-hoag.json')
  assert.deepEqual(recordCheck({ results, as: 'hoag' }), { gap: 0.93, same: 8, pairs: 9, passed: true })
  const saved = readFileSync(path, 'utf8')
  assert.deepEqual(JSON.parse(saved), { gap: 0.93, same: 8, pairs: 9, passed: true })
  assert.throws(() => recordCheck({ results, as: 'hoag' }), /outside-check-ho-hoag\.json exists/)
  assert.equal(readFileSync(path, 'utf8'), saved)
})

// A held-out check recorded after that judge's mode-round import would not be a check made in advance.
test('recordCheck refuses once the same judge\'s mode-round verdicts are imported, and writes nothing', t => {
  const results = mkdtempSync(join(tmpdir(), 'bench-check-'))
  t.after(() => rmSync(results, { recursive: true, force: true }))
  for (const name of ['judge-ho.json', 'blind-key-ho.json', 'judge-hoag.json', 'blind-key-hoag.json']) copyFileSync(join(HELD_OUT, name), join(results, name))
  writeFileSync(join(results, 'judge-moag.json'), '[]')
  const outside = [{ name: 'Antigravity', heldOut: 'hoag', round: 'moag' }]
  assert.throws(() => recordCheck({ results, as: 'hoag', outside }),
    { message: 'mode-round verdicts for moag were imported before the held-out check; the check no longer counts' })
  assert.ok(!existsSync(join(results, 'outside-check-ho-hoag.json')))
  assert.deepEqual(recordCheck({ results, as: 'hoag', outside: [{ ...outside[0], round: 'moag2' }] }).passed, true, 'another judge\'s import does not stop it')
})
