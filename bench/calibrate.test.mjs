import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { calibrate, calibrationVerdict, seedTests } from './calibrate.mjs'

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'calibrate.mjs')
const ref = { rate: 1 }
const misses = n => Array.from({ length: n }, (_, i) => ({ name: `miss-${i + 1}`, fail: i + 1 }))

test('calibrationVerdict: a reference at 100% and 3 near-misses that each fail a test is ok', () => {
  assert.deepEqual(calibrationVerdict({ reference: ref, nearMisses: misses(3) }), { ok: true, problems: [] })
})

test('calibrationVerdict: a reference below 100% is a problem about the reference', () => {
  const v = calibrationVerdict({ reference: { rate: 0.9 }, nearMisses: misses(3) })
  assert.equal(v.ok, false)
  assert.equal(v.problems.length, 1)
  assert.match(v.problems[0], /reference/)
})

test('calibrationVerdict: a near-miss that fails no hidden test is a problem naming it', () => {
  const v = calibrationVerdict({ reference: ref, nearMisses: [...misses(3), { name: 'dom-dow-and', fail: 0 }] })
  assert.equal(v.ok, false)
  assert.equal(v.problems.length, 1)
  assert.match(v.problems[0], /dom-dow-and/)
})

test('calibrationVerdict: only 2 near-misses is a problem asking for at least 3', () => {
  const v = calibrationVerdict({ reference: ref, nearMisses: misses(2) })
  assert.equal(v.ok, false)
  assert.equal(v.problems.length, 1)
  assert.match(v.problems[0], /at least 3/)
})

test('calibrationVerdict: a reference with no result (rate missing) is a problem, never ok', () => {
  assert.equal(calibrationVerdict({ reference: {}, nearMisses: misses(3) }).ok, false)
  assert.equal(calibrationVerdict({ reference: { rate: 0 }, nearMisses: misses(3) }).ok, false)
})

const write = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text) }

// A calibration root with task t1 (seeded) or t2 (no seed): reference a.txt/b.txt, near-misses overwrite one file each.
function fixture(t) {
  const tmp = mkdtempSync(join(tmpdir(), 'calibrate-fixture-'))
  const root = join(tmp, 'calib')
  const seeds = join(tmp, 'seeds')
  mkdirSync(seeds)
  if (t === 't1') { write(seeds, 't1/a.txt', 'seed'); write(seeds, 't1/s.txt', 'seed') }
  write(root, `${t}/reference/a.txt`, 'ref')
  write(root, `${t}/reference/sub/b.txt`, 'ref')
  write(root, `${t}/near-miss/n2/sub/b.txt`, 'n2')
  write(root, `${t}/near-miss/n1/a.txt`, 'n1')
  write(root, `${t}/near-miss/n3/a.txt`, 'ref')
  write(root, `${t}/near-miss/stray.txt`, 'not a variant')
  return { tmp, root, seeds }
}

// A fake hidden-test runner: one test per file, failing when the file's text is not 'ref' or 'seed'.
function fakeRun(seen) {
  return (task, dir) => {
    const files = Object.fromEntries(['a.txt', 's.txt', 'sub/b.txt'].filter(f => existsSync(join(dir, f))).map(f => [f, readFileSync(join(dir, f), 'utf8')]))
    seen.push({ task, dir, files })
    const fail = Object.values(files).filter(v => v !== 'ref' && v !== 'seed').length
    const tests = Object.keys(files).length
    return { tests, pass: tests - fail, fail, rate: tests ? (tests - fail) / tests : 0, tap: '' }
  }
}

test('calibrate overlays seed, then reference, then each near-miss in a temp folder, and prints one line per variant', () => {
  const { tmp, root, seeds } = fixture('t1')
  try {
    const seen = []
    const lines = []
    const seedRun = () => assert.fail('a seed without test files has no seed tests to run')
    const verdict = calibrate('t1', { root, seeds, run: fakeRun(seen), seedRun, log: l => lines.push(l) })
    assert.deepEqual(seen.map(s => s.files), [
      { 'a.txt': 'ref', 's.txt': 'seed', 'sub/b.txt': 'ref' },
      { 'a.txt': 'n1', 's.txt': 'seed', 'sub/b.txt': 'ref' },
      { 'a.txt': 'ref', 's.txt': 'seed', 'sub/b.txt': 'n2' },
      { 'a.txt': 'ref', 's.txt': 'seed', 'sub/b.txt': 'ref' },
    ])
    assert.deepEqual(lines, ['reference 3/3', 'near-miss n1 2/3 (1 fail)', 'near-miss n2 2/3 (1 fail)', 'near-miss n3 3/3 (0 fail)'])
    assert.equal(verdict.ok, false)
    assert.equal(verdict.problems.length, 1)
    assert.match(verdict.problems[0], /n3/)
    assert.equal(new Set(seen.map(s => s.dir)).size, 4, 'each variant gets its own folder')
    for (const { task, dir } of seen) {
      assert.equal(task, 't1')
      assert.equal(existsSync(dir), false, `temp folder ${dir} was deleted`)
    }
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('calibrate without a seed folder starts each variant from the reference', () => {
  const { tmp, root, seeds } = fixture('t2')
  try {
    const seen = []
    const seedRun = () => assert.fail('a task without a seed runs no seed tests')
    calibrate('t2', { root, seeds, run: fakeRun(seen), seedRun, log: () => {} })
    assert.deepEqual(seen[0].files, { 'a.txt': 'ref', 'sub/b.txt': 'ref' })
    assert.deepEqual(seen[1].files, { 'a.txt': 'n1', 'sub/b.txt': 'ref' })
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('a seeded near-miss that breaks a seed test fails calibration', () => {
  const { tmp, root, seeds } = fixture('t1')
  try {
    for (const rel of ['test/a.test.mjs', 'test/helpers.mjs', 'lib/c_test.cjs', 'test-d.ts', 'b-test.js', 'test.mts']) write(seeds, `t1/${rel}`, 'seed test')
    for (const rel of ['lib/helper.mjs', 'x.spec.js', 'README.md', 'node_modules/dep/test/x.test.mjs']) write(seeds, `t1/${rel}`, 'not a seed test')
    write(root, 't1/reference/test/a.test.mjs', "the reference's own version") // as h2's reference replaces test/api.test.mjs
    const hidden = []
    const seedRuns = []
    // A fake seed-test runner: the seed's tests break when a.txt reads 'n1'.
    const seedRun = (dir, files) => {
      const a = readFileSync(join(dir, 'a.txt'), 'utf8')
      seedRuns.push({ dir, files, a, testFile: readFileSync(join(dir, 'test/a.test.mjs'), 'utf8') })
      if (a === 'n1') return { tests: 4, pass: 3, fail: 1, ok: false, error: null }
      return seedRuns.length === 3 ? { tests: 1, pass: 0, fail: 0, ok: false, error: 'ETIMEDOUT' } : { tests: 4, pass: 4, fail: 0, ok: true, error: null }
    }
    const lines = []
    const verdict = calibrate('t1', { root, seeds, run: fakeRun(hidden), seedRun, log: l => lines.push(l) })
    const files = ['b-test.js', 'lib/c_test.cjs', 'test-d.ts', 'test.mts', 'test/a.test.mjs', 'test/helpers.mjs']
    const seedTest = 'seed test'
    assert.deepEqual(seedRuns.map(s => [s.a, s.files, s.testFile]), [['n1', files, seedTest], ['ref', files, seedTest], ['ref', files, seedTest]], "each near-miss, not the reference, with the seed's own test files")
    assert.deepEqual(seedRuns.map(s => s.dir), hidden.slice(1).map(h => h.dir), "in the near-miss's own temp folder")
    assert.equal(seedRuns.some(s => existsSync(s.dir)), false, 'temp folders deleted')
    assert.deepEqual(verdict, { ok: false, problems: ['near-miss n3 fails no hidden test', "near-miss n1 fails the seed's own tests", "near-miss n3 fails the seed's own tests"] })
    assert.deepEqual(lines, [
      'reference 3/3',
      'near-miss n1 2/3 (1 fail); seed tests 3/4 FAILED',
      'near-miss n2 2/3 (1 fail); seed tests 4/4 ok',
      'near-miss n3 3/3 (0 fail); seed tests 0/1 FAILED (ETIMEDOUT)',
    ])
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test("calibrationVerdict: a near-miss that fails the seed's own tests is a problem; one without a seed result is not", () => {
  const nearMisses = [{ name: 'a', fail: 1, seedOk: true }, { name: 'b', fail: 2, seedOk: false }, { name: 'c', fail: 1 }]
  assert.deepEqual(calibrationVerdict({ reference: ref, nearMisses }), { ok: false, problems: ["near-miss b fails the seed's own tests"] })
})

test('seedTests runs the given test files with node --test inside the folder, with only the hidden-test env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'calibrate-seedtests-'))
  try {
    write(dir, 'test/env.test.mjs', "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\ntest('env', () => { assert.equal(process.env.BENCH_SECRET, undefined) })\n")
    write(dir, 'test/bad.test.mjs', "import { test } from 'node:test'\ntest('bad', () => { throw new Error('broken') })\n")
    const env = { ...process.env, BENCH_SECRET: 'must not reach the seed tests' }
    const pick = ({ tests, pass, fail, ok, error }) => ({ tests, pass, fail, ok, error })
    assert.deepEqual(pick(seedTests(dir, ['test/env.test.mjs'], env)), { tests: 1, pass: 1, fail: 0, ok: true, error: null })
    assert.deepEqual(pick(seedTests(dir, ['test/env.test.mjs', 'test/bad.test.mjs'], env)), { tests: 2, pass: 1, fail: 1, ok: false, error: null })
    assert.deepEqual(pick(seedTests(join(dir, 'no-such-folder'), ['test/env.test.mjs'], env)), { tests: 0, pass: 0, fail: 0, ok: false, error: 'ENOENT' }, 'a spawn error is not ok and says why')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('calibrate deletes the temp folder even when the hidden-test run throws', () => {
  const { tmp, root, seeds } = fixture('t2')
  try {
    let dir
    const run = (task, d) => { dir = d; throw new Error('runner broke') }
    assert.throws(() => calibrate('t2', { root, seeds, run, log: () => {} }), /runner broke/)
    assert.equal(existsSync(dir), false)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('calibrate with no near-miss folder reports fewer than 3 near-misses', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'calibrate-fixture-'))
  try {
    write(tmp, 'calib/t4/reference/a.txt', 'ref')
    const verdict = calibrate('t4', { root: join(tmp, 'calib'), seeds: join(tmp, 'seeds'), run: fakeRun([]), log: () => {} })
    assert.deepEqual(verdict, calibrationVerdict({ reference: ref, nearMisses: [] }))
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('calibrate refuses a task name that is not a plain name, and a task with no reference folder', () => {
  const { tmp, root, seeds } = fixture('t1')
  try {
    const opts = { root, seeds, run: () => assert.fail('must not run'), log: () => {} }
    for (const bad of ['../t1', 't1/x', '', undefined]) assert.throws(() => calibrate(bad, opts), /task name/)
    assert.throws(() => calibrate('t9', opts), /no reference/)
    assert.deepEqual(readdirSync(tmp).sort(), ['calib', 'seeds'])
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

test('CLI: no task or an unknown task exits 1 with a one-line message and no stack trace', () => {
  for (const args of [[], ['nosuchtask']]) {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', windowsHide: true })
    assert.equal(r.status, 1, r.stderr)
    assert.equal(r.stdout, '')
    const err = r.stderr.trim()
    assert.equal(err.split('\n').length, 1, err)
    assert.doesNotMatch(err, /\bat .*:\d+:\d+/)
  }
})
