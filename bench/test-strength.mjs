// Test strength (h5, h6, h7): the share of a task's frozen near-miss versions that a solution's OWN tests catch
// (docs/specs/2026-11-01-mode-round-design.md, "Secondary measures"). Each solution test file runs alone, with
// `node --test <file>`, score.mjs's hidden-test env and a 300 s limit, in a temp folder built from the seed (if the task
// has one), then the reference without its own test files, then the solution's test files. A file that passes there
// is valid. A near-miss laid on top of the reference is caught when any valid file fails or times out.
// Usage: node bench/test-strength.mjs --round=mo   (writes results/test-strength-<round>.json, one line per run)
import { spawnSync } from 'node:child_process'
import { cpSync, globSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { CALIBRATION, NODE_TEST_PATTERNS, taskLayout } from './calibrate.mjs'
import { NAME, RESULTS, ROUND_CONDS, SEEDS } from './run.mjs'
import { hiddenEnv, isTestPath, sameAsSeed } from './score.mjs'

export const TIME_LIMIT_MS = 300_000
const TASKS = ['h5', 'h6', 'h7']
// Node 26 reads every `node --test <file>` argument as a glob, so a path holding one of these could run another file
// or none: [ ] * ? { }, and the extglobs +( and @(, with which Node 26.2 runs no test and still exits 0.
const GLOB_CHARS = /[[\]*?{}]|[+@]\(/
// An argument starting with - is read as an option: a test file or folder named so is skipped too.
const OPTION_LIKE = /(^|\/)-/
// Why a solution test file is skipped and listed instead of run, or null when it runs.
const skipReason = rel => (GLOB_CHARS.test(rel) ? 'glob characters in name' : OPTION_LIKE.test(rel) ? 'name starts with -' : null)
const toPosix = path => path.split(sep).join('/')
// A system error (ENOENT, EACCES, EBUSY ...); Node's own ERR_* codes are bugs and are never caught.
const isFsError = err => /^E[A-Z]+$/.test(err?.code ?? '')

// dir-relative posix paths of the files (not folders or links) matching patterns; like Node's glob it skips dot
// entries, and like `node --test` it leaves node_modules out.
const filesMatching = (dir, patterns) => globSync(patterns, { cwd: dir, withFileTypes: true })
  .filter(e => e.isFile())
  .map(e => toPosix(relative(dir, join(e.parentPath, e.name))))
  .filter(rel => !rel.split('/').includes('node_modules'))
  .sort()

const ownTestFiles = (dir, seedDir) => filesMatching(dir, NODE_TEST_PATTERNS).filter(rel => !sameAsSeed(seedDir, rel, join(dir, rel)))

// The files Node's default `node --test` patterns match in dir, minus files byte-identical to the seed's same path
// and files whose path holds a glob character or a part starting with - (strength lists those as skipped).
export const solutionTestFiles = (dir, seedDir = null) => ownTestFiles(dir, seedDir).filter(rel => skipReason(rel) === null)

// Every file a test run may need: Node's test files plus score.mjs's test paths (a tests/helpers.mjs, fixtures).
function testSupport(dir) {
  const nodeTests = new Set(filesMatching(dir, NODE_TEST_PATTERNS))
  return filesMatching(dir, '**/*').filter(rel => nodeTests.has(rel) || isTestPath(rel))
}

// `node --test <file>` inside dir with the hidden tests' env: ok on exit 0; a run past the limit is not ok.
// Output is discarded, so no buffer can overflow. Any other spawn failure is the harness's and throws.
export function runTestFile(dir, file, { env = process.env, timeoutMs = TIME_LIMIT_MS, spawn = spawnSync } = {}) {
  const r = spawn(process.execPath, ['--test', file], {
    cwd: dir, env: hiddenEnv(dir, env), stdio: 'ignore', timeout: timeoutMs, windowsHide: true,
  })
  const error = r.error?.code ?? null
  if (error !== null && error !== 'ETIMEDOUT') throw new Error(`could not run node --test ${file} (${error})`, { cause: r.error })
  return { ok: r.status === 0 }
}

// The task's fixed parts (calibrate.mjs taskLayout). A bad name, or a task without a reference or near-miss
// versions, stops the measurement: that is the harness's problem, not one solution's.
function taskParts(task, root, seeds) {
  const { reference, nearDir, nearMissNames, seed } = taskLayout(task, { root, seeds })
  if (nearMissNames.length === 0) throw new Error(`no near-miss versions for ${task} in ${nearDir}`)
  return { reference, seed, nearMisses: nearMissNames.map(name => ({ name, dir: join(nearDir, name) })) }
}

// The solution's test files to run, the skipped ones, and the bytes of every test file, read here once so that no
// later failure is the solution's. A missing or unreadable folder gives { reason } instead; an unreadable seed file
// is the harness's and throws.
function readSolution(dir, seed) {
  try {
    if (!statSync(dir).isDirectory()) return { reason: 'no solution folder' }
    const own = ownTestFiles(dir, seed)
    return {
      files: own.filter(rel => skipReason(rel) === null),
      skipped: own.filter(rel => skipReason(rel) !== null).map(path => ({ path, reason: skipReason(path) })),
      bytes: testSupport(dir).map(rel => [rel, readFileSync(join(dir, rel))]),
    }
  } catch (err) {
    if (seed !== null && String(err?.path ?? '').startsWith(seed)) throw err
    if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') return { reason: 'no solution folder' }
    if (isFsError(err)) return { reason: `solution folder unreadable (${err.code})` }
    throw err
  }
}

// Builds one variant in a fresh temp folder: each layer in order (minus its skip paths), then the solution's test
// files over them. Runs check(dir) there and deletes the folder afterwards, also on a throw.
function withVariant(task, layers, bytes, check) {
  const dir = mkdtempSync(join(tmpdir(), `strength-${task}-`))
  try {
    for (const { from, skip } of layers) cpSync(from, dir, { recursive: true, filter: src => !skip?.has(toPosix(relative(from, src))) })
    for (const [rel, data] of bytes) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true })
      writeFileSync(join(dir, rel), data)
    }
    return check(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  }
}

const notMeasured = (reason, found = {}) => ({
  files: [], skipped: [], valid: [], ...found, nearMisses: [], caught: null, total: null, share: null, reason,
})

// { files, skipped, valid, nearMisses: [{ name, caught }], caught, total, share, reason }. share is caught ÷ total;
// it is null ("n/a"), with caught and total, when no file is valid or the solution folder is missing or unreadable.
export function strength({ task, solutionDir, root = CALIBRATION, seeds = SEEDS, run = runTestFile }) {
  const parts = taskParts(task, root, seeds)
  const solution = readSolution(solutionDir, parts.seed)
  if (solution.reason) return notMeasured(solution.reason)
  const base = [...(parts.seed ? [{ from: parts.seed }] : []), { from: parts.reference, skip: new Set(testSupport(parts.reference)) }]
  const valid = withVariant(task, base, solution.bytes, dir => solution.files.filter(file => run(dir, file).ok))
  const found = { files: solution.files, skipped: solution.skipped, valid }
  if (valid.length === 0) return notMeasured('no valid test file', found)
  const nearMisses = parts.nearMisses.map(({ name, dir: from }) => ({
    name,
    caught: withVariant(task, [...base, { from }], solution.bytes, dir => valid.some(file => !run(dir, file).ok)),
  }))
  const caught = nearMisses.filter(n => n.caught).length
  return { ...found, nearMisses, caught, total: nearMisses.length, share: caught / nearMisses.length, reason: null }
}

// The run's solution folder from results/<id>/run.json, or { reason } when there is none or it cannot be read.
function solutionDirOf(folder) {
  let text
  try {
    text = readFileSync(join(folder, 'run.json'), 'utf8')
  } catch (err) {
    if (err?.code === 'ENOENT') return { reason: 'no run.json' }
    if (isFsError(err)) return { reason: `run.json unreadable (${err.code})` }
    throw err
  }
  let dir
  try {
    dir = JSON.parse(text)?.dir
  } catch {
    return { reason: 'run.json unreadable' } // not JSON
  }
  return typeof dir === 'string' ? { dir } : { reason: 'run.json unreadable' }
}

// { [runId]: { task, cond, ...strength } } for every solo, lean, team and max run of those tasks in the round; log(id, row)
// after each. A run without a readable run.json or solution folder gets an n/a row; only a results/ that cannot be
// read stops it with one line, or a bug, named with its run.
export function testStrength({ results = RESULTS, round, root, seeds, run, log = () => {} }) {
  const runId = new RegExp(`^(${TASKS.join('|')})-(${ROUND_CONDS.join('|')})-${round}-r\\d+$`)
  let entries
  try {
    entries = readdirSync(results, { withFileTypes: true })
  } catch (err) {
    throw new Error(`cannot read ${results} (${err.code ?? err.message})`, { cause: err })
  }
  const ids = entries.filter(d => d.isDirectory() && runId.test(d.name)).map(d => d.name).sort()
  return Object.fromEntries(ids.map(id => {
    const [, task, base] = runId.exec(id)
    try {
      const { dir, reason } = solutionDirOf(join(results, id))
      const row = { task, cond: `${base}-${round}`, ...(reason ? notMeasured(reason) : strength({ task, solutionDir: dir, root, seeds, run })) }
      log(id, row)
      return [id, row]
    } catch (err) {
      throw new Error(`${id}: ${err.message}`, { cause: err })
    }
  }))
}

const lineOf = (id, row) => {
  const measure = row.share === null ? `n/a (${row.reason})` : `caught ${row.caught}/${row.total} (${row.share.toFixed(2)})`
  const skipped = row.skipped.length ? `  skipped ${row.skipped.length}` : ''
  return `${id}  ${measure}  valid ${row.valid.length}/${row.files.length}${skipped}`
}

export function main(argv = process.argv.slice(2), { results = RESULTS, root, seeds, run } = {}) {
  const round = argv.find(a => a.startsWith('--round='))?.slice(8) ?? ''
  if (!NAME.test(round)) {
    console.error('usage: node bench/test-strength.mjs --round=<tag>   (letters and digits only)')
    process.exitCode = 1
    return
  }
  try {
    const rows = testStrength({ results, round, root, seeds, run, log: (id, row) => console.log(lineOf(id, row)) })
    writeFileSync(join(results, `test-strength-${round}.json`), JSON.stringify(rows, null, 2) + '\n')
  } catch (err) {
    console.error(`test-strength: ${err.message}`)
    process.exitCode = 1
  }
}

if (isMainModule(import.meta.url)) main()
