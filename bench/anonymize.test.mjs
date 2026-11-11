import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { anonymize, judgeDirFor, missingRuns, stagesAskedOf } from './anonymize.mjs'

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

test('four setups get labels X, Y, Z and W, and a finished run is copied under W', t => {
  const box = sandbox(t)
  const runDir = join(box.root, 'solo-run')
  put(join(runDir, 'app.mjs'), 'export {}\n')
  put(join(box.results, 'h1-solo-mo-r1', 'run.json'), JSON.stringify({ id: 'h1-solo-mo-r1', dir: runDir }))
  const key = anonymize({ conds: ['solo-mo', 'lean-mo', 'team-mo', 'max-mo'], tasks: ['h1'], reps: 1, ...box })
  assert.deepEqual(key, { 'h1-r1': { X: 'lean-mo', Y: 'team-mo', Z: 'max-mo', W: 'solo-mo' } })
  assert.deepEqual(Object.keys(key['h1-r1']), ['X', 'Y', 'Z', 'W'])
  assert.ok(existsSync(join(box.judgeDir, 'h1-r1', 'W', 'app.mjs')))
})

// A finished p1 run of cond, as run.json records it (stagesAsked left out, as in a run made before it was recorded).
function fakeP1Run({ root, results }, cond, stagesAsked) {
  const run = join(root, `p1-${cond}`)
  put(join(run, 'app.mjs'), 'export {}\n')
  put(join(results, `p1-${cond}-r1`, 'run.json'), JSON.stringify({ id: `p1-${cond}-r1`, dir: run, ...(stagesAsked === undefined ? {} : { stagesAsked }) }))
}

test('a pair run with fewer stages than its task has is listed in stages.json, so the judges get only those prompts', t => {
  const box = sandbox(t)
  fakeP1Run(box, 'solo-mo', 1)
  fakeP1Run(box, 'lean-mo', 1)
  anonymize({ conds: ['solo-mo', 'lean-mo'], tasks: ['p1'], reps: 1, ...box })
  assert.deepEqual(JSON.parse(readFileSync(join(box.judgeDir, 'stages.json'), 'utf8')), { 'p1-r1': 1 })
  assert.equal(stagesAskedOf(box.judgeDir, 'p1-r1'), 1)
  assert.equal(stagesAskedOf(box.judgeDir, 'p1-r2'), undefined, 'a pair not listed asked for every stage')
})

test('a pair run with every stage writes no stages.json, and runs that asked for different stages are refused', t => {
  const box = sandbox(t)
  fakeP1Run(box, 'solo-mo', 3)
  fakeP1Run(box, 'lean-mo')
  anonymize({ conds: ['solo-mo', 'lean-mo'], tasks: ['p1'], reps: 1, ...box })
  assert.ok(!existsSync(join(box.judgeDir, 'stages.json')))
  assert.equal(stagesAskedOf(box.judgeDir, 'p1-r1'), undefined)
  const mixed = sandbox(t)
  fakeP1Run(mixed, 'solo-mo', 1)
  fakeP1Run(mixed, 'lean-mo', 3)
  assert.throws(() => anonymize({ conds: ['solo-mo', 'lean-mo'], tasks: ['p1'], reps: 1, ...mixed }), /p1-r1: its runs asked for different stages \(1, 3\)/)
  assert.ok(!existsSync(join(mixed.judgeDir, 'p1-r1')), 'nothing copied')
})

test('more conditions than labels X, Y, Z and W is refused', t => {
  const box = sandbox(t)
  assert.throws(() => anonymize({ conds: ['a', 'b', 'c', 'd', 'e'], ...box }), RangeError)
  assert.throws(() => anonymize({ conds: ['a', 'b', 'c', 'd', 'e'], ...box }), /needs 1 to 4 conditions, got 5/)
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

// A round already anonymized by the CLI in a temp home and results folder, with one finished run.
function anonymizedRound(t) {
  const home = mkdtempSync(join(tmpdir(), 'bench-home-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const results = join(home, 'results')
  put(join(home, 'run', 'app.mjs'), 'export {}\n')
  put(join(results, 'zz-a-r1', 'run.json'), JSON.stringify({ id: 'zz-a-r1', dir: join(home, 'run') }))
  const env = { ...process.env, HOME: home, USERPROFILE: home, BENCH_RESULTS: results }
  const cli = (...flags) => spawnSync(process.execPath, [join(import.meta.dirname, 'anonymize.mjs'), '--round=zzclitest', ...flags], { encoding: 'utf8', env })
  const keyPath = join(results, 'blind-key-zzclitest.json')
  const judgeDir = join(home, 'bench-judge-zzclitest')
  const { status, stderr } = cli('--conds=a', '--tasks=zz', '--reps=1')
  assert.equal(status, 0, stderr)
  return { cli, keyPath, judgeDir, key: readFileSync(keyPath, 'utf8') }
}

const assertKept = ({ judgeDir, keyPath, key }) => {
  assert.ok(existsSync(join(judgeDir, 'zz-r1', 'X', 'app.mjs')), 'the judge folder is kept')
  assert.equal(readFileSync(keyPath, 'utf8'), key, 'the key is kept')
}

test('the CLI refuses a round that leaves out --conds, --tasks or --reps, and deletes nothing', t => {
  const round = anonymizedRound(t)
  for (const [flags, missing] of [[['--tasks=zz', '--reps=1'], 'conds'], [['--conds=a', '--reps=1'], 'tasks'], [['--conds=a', '--tasks=zz'], 'reps'], [[], 'conds']]) {
    const res = round.cli(...flags)
    assert.equal(res.status, 1, missing)
    assert.match(res.stderr, new RegExp(`--${missing}= is required`))
    assertKept(round)
  }
})

test('the CLI refuses flags that would replace the round\'s key, and deletes nothing', t => {
  const round = anonymizedRound(t)
  for (const flags of [['--conds=a', '--tasks=zz', '--reps=2'], ['--conds=a', '--tasks=yy', '--reps=1'], ['--conds=a,b', '--tasks=zz', '--reps=1']]) {
    const res = round.cli(...flags)
    assert.equal(res.status, 1, flags.join(' '))
    assert.match(res.stderr, /blind-key-zzclitest\.json is not the key of these flags/)
    assertKept(round)
  }
})

test('the CLI refuses too many setups and a key it cannot read, before it deletes anything', t => {
  const round = anonymizedRound(t)
  const res = round.cli('--conds=a,b,c,d,e', '--tasks=zz', '--reps=1')
  assert.equal(res.status, 1)
  assert.match(res.stderr, /1 to 4 conditions/)
  assertKept(round)
  writeFileSync(round.keyPath, '{ nope')
  assert.equal(round.cli('--conds=a', '--tasks=zz', '--reps=1').status, 1)
  assert.ok(existsSync(join(round.judgeDir, 'zz-r1', 'X', 'app.mjs')))
})

test('anonymizing again with the same flags rebuilds the folder from empty and keeps the key', t => {
  const round = anonymizedRound(t)
  const stale = join(round.judgeDir, 'zz-r1', 'X', 'stale.txt')
  put(stale)
  const { status, stderr } = round.cli('--conds=a', '--tasks=zz', '--reps=1')
  assert.equal(status, 0, stderr)
  assert.ok(!existsSync(stale))
  assertKept(round)
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
  // With 3 reps the labels rotate, so r3 lists team before solo: the result is only in this order when sorted.
  const key = anonymize({ conds: ['solo-ho', 'team-ho'], tasks: ['h2'], reps: 3, ...box })
  assert.deepEqual(missingRuns(key, box.judgeDir), ['h2-solo-ho-r1', 'h2-solo-ho-r2', 'h2-solo-ho-r3', 'h2-team-ho-r2', 'h2-team-ho-r3'])
  assert.deepEqual(missingRuns({}, box.judgeDir), [])
})

test('the CLI names the unfinished runs and exits 1', t => {
  const home = mkdtempSync(join(tmpdir(), 'bench-home-'))
  const bench = dirname(fileURLToPath(import.meta.url))
  const results = join(home, 'results')
  t.after(() => rmSync(home, { recursive: true, force: true }))
  mkdirSync(results)
  const args = [join(bench, 'anonymize.mjs'), '--round=zzclitest', '--conds=a,b', '--tasks=zz', '--reps=1']
  const res = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, BENCH_RESULTS: results } })
  assert.equal(res.status, 1)
  assert.match(res.stderr, /not finished, so not anonymized: zz-a-r1 zz-b-r1;/)
  assert.equal(existsSync(join(results, 'blind-key-zzclitest.json')), true, 'the key goes to the results folder the CLI was told to use')
})
