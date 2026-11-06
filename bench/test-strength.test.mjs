import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { main, runTestFile, solutionTestFiles, strength, TIME_LIMIT_MS } from './test-strength.mjs'

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'test-strength.mjs')

// A temp folder holding files { rel: text }, deleted after the test.
function folder(t, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'strength-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }))
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), text)
  }
  return dir
}

// Task <name> in a calibration root: the reference's lib.mjs and other.mjs read 'ref' and it has its own test file
// and test helper; near-miss n1 breaks lib.mjs, n2 breaks other.mjs, n3 changes only files no valid test reads
// (one at a test-helper path, which the solution's own helper must replace).
const taskFiles = name => ({
  [`${name}/reference/lib.mjs`]: 'ref',
  [`${name}/reference/other.mjs`]: 'ref',
  [`${name}/reference/test/ref.test.mjs`]: 'lib.mjs=ref',
  [`${name}/reference/tests/helpers.mjs`]: "the reference's helper",
  [`${name}/near-miss/n1/lib.mjs`]: 'n1',
  [`${name}/near-miss/n2/other.mjs`]: 'n2',
  [`${name}/near-miss/n3/unread.mjs`]: 'n3',
  [`${name}/near-miss/n3/tests/helpers.mjs`]: "the near-miss's helper",
})

const listing = dir => readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter(e => e.isFile()).map(e => relative(dir, join(e.parentPath, e.name)).split(sep).join('/')).sort()

// A fake `node --test <file>`: each line of the file is a check, `<path>=<text>` (that file in the folder reads
// exactly so) or `<path>` (it exists); the file passes when every check holds. Each call is recorded with the
// folder's file list.
const fakeRun = (calls = []) => (dir, file) => {
  calls.push({ dir, file, files: listing(dir) })
  const holds = line => {
    const [path, want] = line.split('=')
    return existsSync(join(dir, path)) && (want === undefined || readFileSync(join(dir, path), 'utf8') === want)
  }
  return { ok: readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean).every(holds) }
}

const NOT_MEASURED = { files: [], skipped: [], valid: [], nearMisses: [], caught: null, total: null, share: null }

test('a test file that fails on the reference is not valid', t => {
  const root = folder(t, taskFiles('tk'))
  const solutionDir = folder(t, { 'lib.mjs': 'solution code', 'a.test.mjs': 'lib.mjs=ref', 'b.test.mjs': 'lib.mjs=solution code' })
  const calls = []
  const r = strength({ task: 'tk', solutionDir, root, seeds: folder(t), run: fakeRun(calls) })
  assert.deepEqual(r.files, ['a.test.mjs', 'b.test.mjs'])
  assert.deepEqual(r.valid, ['a.test.mjs'])
  assert.deepEqual(calls.slice(0, 2).map(c => c.file), ['a.test.mjs', 'b.test.mjs'], 'each test file runs once on the reference')
  assert.deepEqual(calls[0].files, ['a.test.mjs', 'b.test.mjs', 'lib.mjs', 'other.mjs'], "the reference without its own test file, and none of the solution's code")
  assert.equal(calls.slice(2).some(c => c.file === 'b.test.mjs'), false, 'an invalid file never runs on a near-miss')
})

test('a shared test helper is laid in, so a file importing it can be valid', t => {
  const root = folder(t, taskFiles('tk'))
  const solutionDir = folder(t, {
    'tests/helpers.mjs': 'helper',
    '__tests__/data.json': '{}',
    'tests/x.test.mjs': 'tests/helpers.mjs=helper\nlib.mjs=ref',
    'tests/y.test.mjs': '__tests__/data.json={}',
  })
  const r = strength({ task: 'tk', solutionDir, root, seeds: folder(t), run: fakeRun() })
  assert.deepEqual(r.files, ['tests/x.test.mjs', 'tests/y.test.mjs'], 'helpers are laid in, not run')
  assert.deepEqual(r.valid, ['tests/x.test.mjs', 'tests/y.test.mjs'])
  assert.deepEqual(r.nearMisses, [{ name: 'n1', caught: true }, { name: 'n2', caught: false }, { name: 'n3', caught: false }], 'laid in for each near-miss too')
})

test('a near-miss is caught when any valid file fails', t => {
  const root = folder(t, taskFiles('tk'))
  // bad fails on the reference and on n3, so a rerun of an invalid file would count n3 as caught.
  const solutionDir = folder(t, { 'a.test.mjs': 'lib.mjs=ref', 'c.test.mjs': 'other.mjs=ref', 'bad.test.mjs': 'lib.mjs=n1' })
  const calls = []
  const r = strength({ task: 'tk', solutionDir, root, seeds: folder(t), run: fakeRun(calls) })
  assert.deepEqual(r, {
    files: ['a.test.mjs', 'bad.test.mjs', 'c.test.mjs'],
    skipped: [],
    valid: ['a.test.mjs', 'c.test.mjs'],
    nearMisses: [{ name: 'n1', caught: true }, { name: 'n2', caught: true }, { name: 'n3', caught: false }],
    caught: 2,
    total: 3,
    share: 2 / 3,
    reason: null,
  })
  assert.equal(new Set(calls.map(c => c.dir)).size, 4, 'the reference and each near-miss get their own folder')
  assert.equal(calls.some(c => existsSync(c.dir)), false, 'temp folders are deleted')
})

test('no valid file gives n/a', t => {
  const root = folder(t, taskFiles('tk'))
  for (const files of [{ 'bad.test.mjs': 'lib.mjs=n1' }, { 'lib.mjs': 'a solution without tests' }]) {
    const calls = []
    const r = strength({ task: 'tk', solutionDir: folder(t, files), root, seeds: folder(t), run: fakeRun(calls) })
    const tests = Object.keys(files).filter(f => f.endsWith('.test.mjs'))
    assert.deepEqual(r, { ...NOT_MEASURED, files: tests, reason: 'no valid test file' })
    assert.deepEqual(calls.map(c => c.file), tests, 'no near-miss is run')
  }
})

test('seed test files are left out', t => {
  const seeds = folder(t, {
    'tk/lib.mjs': "the seed's version, which the reference replaces",
    'tk/server.mjs': 'seed',
    'tk/test/seed.test.mjs': 'server.mjs=seed',
    'tk/test/helpers.mjs': 'seed helper',
    'tk/test/changed.test.mjs': 'seed version',
  })
  const root = folder(t, { ...taskFiles('tk'), 'tk/reference/test/changed.test.mjs': "the reference's version" })
  const solutionDir = folder(t, {
    'server.mjs': 'seed',
    'test/seed.test.mjs': 'server.mjs=seed',
    'test/helpers.mjs': 'seed helper',
    'test/changed.test.mjs': 'lib.mjs=ref',
    'test/new.test.mjs': 'test/helpers.mjs=seed helper\nother.mjs=ref',
  })
  assert.deepEqual(solutionTestFiles(solutionDir, join(seeds, 'tk')), ['test/changed.test.mjs', 'test/new.test.mjs'])
  assert.deepEqual(solutionTestFiles(solutionDir), ['test/changed.test.mjs', 'test/helpers.mjs', 'test/new.test.mjs', 'test/seed.test.mjs'], 'without a seed every test file counts')
  const calls = []
  const r = strength({ task: 'tk', solutionDir, root, seeds, run: fakeRun(calls) })
  assert.deepEqual(r.files, ['test/changed.test.mjs', 'test/new.test.mjs'])
  assert.deepEqual(r.valid, ['test/changed.test.mjs', 'test/new.test.mjs'], "the solution's version of a changed seed test runs")
  assert.deepEqual(calls[0].files, ['lib.mjs', 'other.mjs', 'server.mjs', 'test/changed.test.mjs', 'test/helpers.mjs', 'test/new.test.mjs', 'test/seed.test.mjs'], 'the seed, then the reference without its own tests, then the solution tests')
  assert.equal(calls.some(c => c.file === 'test/seed.test.mjs' || c.file === 'test/helpers.mjs'), false)
})

test('a test file with glob characters in its path is skipped, listed and never run', t => {
  const root = folder(t, taskFiles('tk'))
  // Windows file names cannot hold * or ?. Node 26.2 runs no test from x+(1).test.mjs or y@(2).test.mjs and exits 0.
  const names = ['test/[x].test.mjs', 'c{1}.test.mjs', 'g[1]/y.test.mjs', 'x+(1).test.mjs', 'y@(2).test.mjs', ...(process.platform === 'win32' ? [] : ['d*.test.mjs', 'e?.test.mjs'])]
  const solutionDir = folder(t, { 'a.test.mjs': 'lib.mjs=ref', 'test/x.test.mjs': 'lib.mjs=ref', ...Object.fromEntries(names.map(n => [n, 'lib.mjs=ref'])) })
  assert.deepEqual(solutionTestFiles(solutionDir), ['a.test.mjs', 'test/x.test.mjs'])
  const calls = []
  const r = strength({ task: 'tk', solutionDir, root, seeds: folder(t), run: fakeRun(calls) })
  assert.deepEqual(r.skipped, [...names].sort().map(path => ({ path, reason: 'glob characters in name' })))
  assert.deepEqual(r.valid, ['a.test.mjs', 'test/x.test.mjs'])
  assert.equal(calls.some(c => names.includes(c.file)), false)
})

// `node --test -x.test.mjs` reads the file name as an option: such a file is skipped and listed like a glob name.
test('a test file whose name or folder starts with - is skipped, listed and never run', t => {
  const root = folder(t, taskFiles('tk'))
  const names = ['-x.test.mjs', 'test/-y.test.mjs', '-dir/z.test.mjs']
  const solutionDir = folder(t, { 'a.test.mjs': 'lib.mjs=ref', 'test/x-1.test.mjs': 'lib.mjs=ref', ...Object.fromEntries(names.map(n => [n, 'lib.mjs=ref'])) })
  assert.deepEqual(solutionTestFiles(solutionDir), ['a.test.mjs', 'test/x-1.test.mjs'])
  const calls = []
  const r = strength({ task: 'tk', solutionDir, root, seeds: folder(t), run: fakeRun(calls) })
  assert.deepEqual(r.skipped, [...names].sort().map(path => ({ path, reason: 'name starts with -' })))
  assert.deepEqual(r.valid, ['a.test.mjs', 'test/x-1.test.mjs'])
  assert.equal(calls.some(c => names.includes(c.file)), false)
})

test('runTestFile gives each file 300 s unless told otherwise', () => {
  const seen = []
  const spawn = (command, args, options) => { seen.push(options.timeout); return { status: 0 } }
  assert.deepEqual(runTestFile('C:/dir', 'a.test.mjs', { spawn }), { ok: true })
  assert.deepEqual(runTestFile('C:/dir', 'a.test.mjs', { spawn, timeoutMs: 500 }), { ok: true })
  assert.deepEqual(seen, [300_000, 500])
})

test("files under node_modules or a dot folder are not the solution's test files, as for node --test", t => {
  const solutionDir = folder(t, { 'a.test.mjs': '', 'node_modules/dep/z.test.mjs': '', 'lib/node_modules/test/w.mjs': '', '.team/near-miss/1-a.test.mjs': '', '.b.test.mjs': '' })
  assert.deepEqual(solutionTestFiles(solutionDir), ['a.test.mjs'])
})

test('a missing solution folder, or a file in its place, gives n/a with a reason and runs nothing', t => {
  const root = folder(t, taskFiles('tk'))
  const parent = folder(t, { 'file.txt': 'not a folder' })
  for (const solutionDir of [join(parent, 'gone'), join(parent, 'file.txt')]) {
    const r = strength({ task: 'tk', solutionDir, root, seeds: folder(t), run: () => assert.fail('must not run') })
    assert.deepEqual(r, { ...NOT_MEASURED, reason: 'no solution folder' })
  }
})

const isRoot = process.getuid?.() === 0
test('an unreadable solution test file gives n/a with its error code; an unreadable seed file stops', { skip: (process.platform === 'win32' || isRoot) && 'chmod cannot make a file unreadable here' }, async t => {
  const { chmodSync } = await import('node:fs')
  const root = folder(t, taskFiles('tk'))
  const solutionDir = folder(t, { 'a.test.mjs': 'lib.mjs=ref' })
  const run = () => assert.fail('must not run')
  chmodSync(join(solutionDir, 'a.test.mjs'), 0o000)
  assert.deepEqual(strength({ task: 'tk', solutionDir, root, seeds: folder(t), run }), { ...NOT_MEASURED, reason: 'solution folder unreadable (EACCES)' })
  chmodSync(join(solutionDir, 'a.test.mjs'), 0o644)
  const seeds = folder(t, { 'tk/a.test.mjs': 'lib.mjs=ref' })
  chmodSync(join(seeds, 'tk/a.test.mjs'), 0o000)
  assert.throws(() => strength({ task: 'tk', solutionDir, root, seeds, run }), { code: 'EACCES' })
})

test('strength stops on a task name that is not plain, a task without a reference, or one without near-miss versions', t => {
  const root = folder(t, { 'tk/reference/lib.mjs': 'ref' })
  const opts = { solutionDir: folder(t, { 'a.test.mjs': 'lib.mjs=ref' }), root, seeds: folder(t), run: () => assert.fail('must not run') }
  for (const task of ['../tk', 'tk/x', '', undefined]) assert.throws(() => strength({ ...opts, task }), /^Error: not a task name/)
  assert.throws(() => strength({ ...opts, task: 'zz' }), /^Error: no reference for zz: /)
  assert.throws(() => strength({ ...opts, task: 'tk' }), /^Error: no near-miss versions for tk /)
})

const testFile = body => `import { test } from 'node:test'\nimport assert from 'node:assert/strict'\n${body}\n`

// The one test that runs real `node --test`: the runner on its own, then strength through it end to end.
test('real node --test: the runner keeps the env out, fails a broken or slow file, and strength measures through it', t => {
  const dir = folder(t, {
    'env.test.mjs': testFile("test('env', () => { assert.equal(process.env.BENCH_SECRET, undefined) })"),
    'bad.test.mjs': testFile("test('bad', () => { throw new Error('broken') })"),
    'slow.test.mjs': testFile("test('slow', () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000) })"),
  })
  const env = { ...process.env, BENCH_SECRET: 'must not reach a solution test' }
  assert.deepEqual(runTestFile(dir, 'env.test.mjs', { env }), { ok: true })
  assert.deepEqual(runTestFile(dir, 'bad.test.mjs', { env }), { ok: false })
  assert.deepEqual(runTestFile(dir, 'slow.test.mjs', { env, timeoutMs: 500 }), { ok: false }, 'a run past the limit is not ok')
  assert.equal(TIME_LIMIT_MS, 300_000)
  assert.throws(() => runTestFile(join(dir, 'gone'), 'env.test.mjs'), { message: 'could not run node --test env.test.mjs (ENOENT)' })

  const add = body => `export const add = (a, b) => ${body}\n`
  const root = folder(t, { 'tk/reference/lib.mjs': add('a + b'), 'tk/near-miss/off/lib.mjs': add('a + b + 1'), 'tk/near-miss/swap/lib.mjs': add('b + a') })
  const addTest = want => testFile(`import { add } from '../lib.mjs'\ntest('add', () => { assert.equal(add(1, 2), ${want}) })`)
  const solutionDir = folder(t, { 'lib.mjs': add('a - b'), 'test/add.test.mjs': addTest(3), 'test/wrong.test.mjs': addTest(4) })
  assert.deepEqual(strength({ task: 'tk', solutionDir, root, seeds: folder(t) }), {
    files: ['test/add.test.mjs', 'test/wrong.test.mjs'],
    skipped: [],
    valid: ['test/add.test.mjs'],
    nearMisses: [{ name: 'off', caught: true }, { name: 'swap', caught: false }],
    caught: 1,
    total: 2,
    share: 0.5,
    reason: null,
  })
})

// main's console lines and exit code, with both restored afterwards.
function runMain(t, argv, opts) {
  const out = { logs: [], errors: [] }
  t.mock.method(console, 'log', line => out.logs.push(line))
  t.mock.method(console, 'error', line => out.errors.push(line))
  const before = process.exitCode
  process.exitCode = undefined
  try {
    main(argv, opts)
    return { ...out, exitCode: process.exitCode }
  } finally {
    process.exitCode = before
    t.mock.restoreAll()
  }
}

test('main measures every h5 and h6 run of the round and writes results/test-strength-<round>.json', t => {
  const root = folder(t, { ...taskFiles('h5'), ...taskFiles('h6') })
  const solution = folder(t, { 'a.test.mjs': 'lib.mjs=ref', 'b.test.mjs': 'lib.mjs=other' })
  const results = folder(t, {
    'h5-lean-mo-r1/run.json': JSON.stringify({ dir: solution }),
    'h5-team-mo-r1/run.json': JSON.stringify({ task: 'h5' }),
    'h5-max-mo-r1/run.json': JSON.stringify({ dir: 42 }),
    'h6-max-mo-r1/run.json': '{"dir":',
    'h6-solo-mo-r2/run.json': JSON.stringify({ dir: join(solution, 'gone') }),
    'h4-lean-mo-r1/run.json': JSON.stringify({ dir: solution }),
    'h5-lean-ho-r1/run.json': JSON.stringify({ dir: solution }),
    'h5-forced-mo-r1/run.json': JSON.stringify({ dir: solution }),
  })
  mkdirSync(join(results, 'h6-team-mo-r3'))
  mkdirSync(join(results, 'h6-lean-mo-r1', 'run.json'), { recursive: true })
  const none = reason => ({ ...NOT_MEASURED, reason })
  const rows = {
    'h5-lean-mo-r1': {
      task: 'h5', cond: 'lean-mo', files: ['a.test.mjs', 'b.test.mjs'], skipped: [], valid: ['a.test.mjs'],
      nearMisses: [{ name: 'n1', caught: true }, { name: 'n2', caught: false }, { name: 'n3', caught: false }], caught: 1, total: 3, share: 1 / 3, reason: null,
    },
    'h5-max-mo-r1': { task: 'h5', cond: 'max-mo', ...none('run.json unreadable') },
    'h5-team-mo-r1': { task: 'h5', cond: 'team-mo', ...none('run.json unreadable') },
    'h6-lean-mo-r1': { task: 'h6', cond: 'lean-mo', ...none('run.json unreadable (EISDIR)') },
    'h6-max-mo-r1': { task: 'h6', cond: 'max-mo', ...none('run.json unreadable') },
    'h6-solo-mo-r2': { task: 'h6', cond: 'solo-mo', ...none('no solution folder') },
    'h6-team-mo-r3': { task: 'h6', cond: 'team-mo', ...none('no run.json') },
  }
  const out = runMain(t, ['--round=mo'], { results, root, seeds: folder(t), run: fakeRun() })
  assert.deepEqual([out.exitCode, out.errors], [undefined, []])
  assert.deepEqual(JSON.parse(readFileSync(join(results, 'test-strength-mo.json'), 'utf8')), rows)
  assert.deepEqual(out.logs, [
    'h5-lean-mo-r1  caught 1/3 (0.33)  valid 1/2',
    'h5-max-mo-r1  n/a (run.json unreadable)  valid 0/0',
    'h5-team-mo-r1  n/a (run.json unreadable)  valid 0/0',
    'h6-lean-mo-r1  n/a (run.json unreadable (EISDIR))  valid 0/0',
    'h6-max-mo-r1  n/a (run.json unreadable)  valid 0/0',
    'h6-solo-mo-r2  n/a (no solution folder)  valid 0/0',
    'h6-team-mo-r3  n/a (no run.json)  valid 0/0',
  ])
})

test('main stops with one line when results/ cannot be read, or on a bug while measuring a run', t => {
  const missing = runMain(t, ['--round=mo'], { results: join(folder(t), 'no-results') })
  assert.equal(missing.exitCode, 1)
  assert.equal(missing.errors.length, 1)
  assert.match(missing.errors[0], /^test-strength: cannot read .*no-results \(ENOENT\)$/)
  const root = folder(t, taskFiles('h5'))
  const results = folder(t, { 'h5-lean-mo-r1/run.json': JSON.stringify({ dir: folder(t, { 'a.test.mjs': 'lib.mjs=ref' }) }) })
  const bug = runMain(t, ['--round=mo'], { results, root, seeds: folder(t), run: () => { throw new TypeError('boom') } })
  assert.deepEqual([bug.exitCode, bug.errors], [1, ['test-strength: h5-lean-mo-r1: boom']])
  assert.equal(existsSync(join(results, 'test-strength-mo.json')), false)
})

test('main refuses a round that is not letters and digits; the CLI file says so in one line', t => {
  const out = runMain(t, ['--round=../x'], { results: folder(t) })
  assert.equal(out.exitCode, 1)
  assert.deepEqual(out.errors, ['usage: node bench/test-strength.mjs --round=<tag>   (letters and digits only)'])
  const r = spawnSync(process.execPath, [CLI, '--round=../x'], { encoding: 'utf8', windowsHide: true })
  assert.equal(r.status, 1, r.stderr)
  assert.equal(r.stdout, '')
  assert.equal(r.stderr.trim(), 'usage: node bench/test-strength.mjs --round=<tag>   (letters and digits only)')
})

test('main also measures h7 runs, on their final code', t => {
  const root = folder(t, taskFiles('h7'))
  const solution = folder(t, { 'a.test.mjs': 'lib.mjs=ref' })
  const results = folder(t, { 'h7-team-sm-r1/run.json': JSON.stringify({ dir: solution, snapshot: join(solution, 'never-read') }) })
  const out = runMain(t, ['--round=sm'], { results, root, seeds: folder(t), run: fakeRun() })
  assert.deepEqual([out.exitCode, out.errors], [undefined, []])
  assert.deepEqual(out.logs, ['h7-team-sm-r1  caught 1/3 (0.33)  valid 1/1'])
})
