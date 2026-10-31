import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { calibrate, calibrationVerdict } from './calibrate.mjs'

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
    const verdict = calibrate('t1', { root, seeds, run: fakeRun(seen), log: l => lines.push(l) })
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
    calibrate('t2', { root, seeds, run: fakeRun(seen), log: () => {} })
    assert.deepEqual(seen[0].files, { 'a.txt': 'ref', 'sub/b.txt': 'ref' })
    assert.deepEqual(seen[1].files, { 'a.txt': 'n1', 'sub/b.txt': 'ref' })
  } finally { rmSync(tmp, { recursive: true, force: true }) }
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
