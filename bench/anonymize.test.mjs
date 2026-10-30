import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { anonymize, judgeDirFor, missingRuns } from './anonymize.mjs'

// Fresh results/, judge/ and seeds/ folders under one temp root, removed after the test.
function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), 'bench-anon-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dirs = { root, results: join(root, 'results'), judgeDir: join(root, 'judge'), seeds: join(root, 'seeds') }
  mkdirSync(dirs.results)
  mkdirSync(dirs.seeds)
  return dirs
}

function put(path, text = 'x') {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

// A finished run of h2/team-ho: a run folder full of team traces, and the run.json that points at it.
function fakeH2Run({ root, results }) {
  const run = join(root, 'run')
  put(join(run, '.team', 'x.md'))
  put(join(run, '.git', 'HEAD'))
  put(join(run, 'app.mjs'), 'export {}\n')
  put(join(run, 'data.db'))
  put(join(results, 'h2-team-ho-r1', 'run.json'), JSON.stringify({ id: 'h2-team-ho-r1', dir: run }))
}

test('round-17 key is reproduced', t => {
  const { results, judgeDir } = sandbox(t)
  const key = anonymize({ conds: ['solo-v3', 'team-v3', 'team-v17'], results, judgeDir })
  const expected = JSON.parse(readFileSync(new URL('./data/blind-key-v17.json', import.meta.url), 'utf8'))
  assert.deepEqual(key, expected)
})

test('two setups, three reps', t => {
  const { results, judgeDir, seeds } = sandbox(t)
  const key = anonymize({ conds: ['solo-ho', 'team-ho'], tasks: ['h1'], reps: 3, results, judgeDir, seeds })
  assert.deepEqual(key, {
    'h1-r1': { X: 'team-ho', Y: 'solo-ho' },
    'h1-r2': { X: 'solo-ho', Y: 'team-ho' },
    'h1-r3': { X: 'team-ho', Y: 'solo-ho' },
  })
})

test('seeded task gets SEED and hides team traces', t => {
  const box = sandbox(t)
  fakeH2Run(box)
  put(join(box.seeds, 'h2', 's.mjs'), 'export {}\n')
  const key = anonymize({ conds: ['solo-ho', 'team-ho'], tasks: ['h2'], reps: 1, ...box })
  const label = Object.keys(key['h2-r1']).find(l => key['h2-r1'][l] === 'team-ho')
  const out = join(box.judgeDir, 'h2-r1', label)
  assert.ok(existsSync(join(out, 'app.mjs')), 'the solution is copied')
  for (const trace of ['.team', '.git', 'data.db']) assert.ok(!existsSync(join(out, trace)), `${trace} is hidden`)
  assert.ok(existsSync(join(box.judgeDir, 'h2-r1', 'SEED', 's.mjs')), 'the seed is copied')
  // solo-ho never ran, so its label gets no folder
  assert.deepEqual(readdirSync(join(box.judgeDir, 'h2-r1')).sort(), [label, 'SEED'].sort())
})

test('a pair with no finished run gets no folder, even for a seeded task', t => {
  const box = sandbox(t)
  put(join(box.seeds, 'h2', 's.mjs'))
  anonymize({ conds: ['solo-ho', 'team-ho'], tasks: ['h2'], reps: 1, ...box })
  assert.ok(!existsSync(join(box.judgeDir, 'h2-r1')))
})

test('more conditions than labels X, Y, Z is refused', t => {
  const box = sandbox(t)
  assert.throws(() => anonymize({ conds: ['a', 'b', 'c', 'd'], ...box }), RangeError)
  assert.throws(() => anonymize({ conds: [], ...box }), RangeError)
})

test('a run.json without a run folder names the file', t => {
  const box = sandbox(t)
  put(join(box.results, 'h2-team-ho-r1', 'run.json'), JSON.stringify({ id: 'h2-team-ho-r1' }))
  assert.throws(() => anonymize({ conds: ['solo-ho', 'team-ho'], tasks: ['h2'], reps: 1, ...box }), /h2-team-ho-r1/)
})

test('judgeDirFor is ~/bench-judge or ~/bench-judge-<round>, and refuses a round that could leave the home folder', () => {
  const home = join(tmpdir(), 'home')
  assert.equal(judgeDirFor('ho', home), join(home, 'bench-judge-ho'))
  assert.equal(judgeDirFor('', home), join(home, 'bench-judge'))
  for (const bad of ['x/..', '..', 'x\\..\\..', 'a b', '-x']) assert.throws(() => judgeDirFor(bad, home), /round/, bad)
})

// The CLI deletes the judge folder first; with --round=x/.. that folder would be the home folder itself.
test('the CLI refuses --round=x/.. and deletes nothing', t => {
  const home = mkdtempSync(join(tmpdir(), 'bench-home-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  put(join(home, 'keep.txt'))
  const cli = join(dirname(fileURLToPath(import.meta.url)), 'anonymize.mjs')
  const res = spawnSync(process.execPath, [cli, '--round=x/..'], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } })
  assert.equal(res.status, 1)
  assert.match(res.stderr, /round/)
  assert.ok(existsSync(join(home, 'keep.txt')), 'home folder untouched')
})

test('a relative symlink in a run stays relative, so it never points back into the run folder', t => {
  const box = sandbox(t)
  fakeH2Run(box)
  try {
    symlinkSync('app.mjs', join(box.root, 'run', 'link.mjs'), 'file')
  } catch (err) {
    if (err.code === 'EPERM') return t.skip('no permission to make symlinks here')
    throw err
  }
  const key = anonymize({ conds: ['solo-ho', 'team-ho'], tasks: ['h2'], reps: 1, ...box })
  const label = Object.keys(key['h2-r1']).find(l => key['h2-r1'][l] === 'team-ho')
  assert.equal(readlinkSync(join(box.judgeDir, 'h2-r1', label, 'link.mjs')), 'app.mjs')
})

test('missingRuns names every run that was not copied, so judging never starts on an incomplete round', t => {
  const box = sandbox(t)
  fakeH2Run(box)
  const key = anonymize({ conds: ['solo-ho', 'team-ho'], tasks: ['h2'], reps: 2, ...box })
  assert.deepEqual(missingRuns(key, box.judgeDir), ['h2-solo-ho-r1', 'h2-solo-ho-r2', 'h2-team-ho-r2'])
  assert.deepEqual(missingRuns({}, box.judgeDir), [])
})
