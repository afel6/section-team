// Hidden-test calibration for one held-out task: the reference must pass every hidden test, and at least
// 3 near-miss versions must each fail at least one. Each variant is built in its own temp folder from
// bench/seeds/<task>/ (if any), then heldout-calibration/<task>/reference/, then the near-miss on top.
// For a seeded task, each near-miss must also still pass the seed's own tests, run in that same folder.
// A two-stage task also has reference-s1/ (the code after stage 1, which the hidden sets s1 and reg start) and near-miss-s1/,
// versions laid on it instead, so the s1 set is calibrated too.
// Usage: node bench/calibrate.mjs <task>
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, globSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { SEEDS } from './run.mjs'
import { hiddenEnv, hiddenTests, parseTap } from './score.mjs'

export const CALIBRATION = join(dirname(fileURLToPath(import.meta.url)), 'heldout-calibration')
const MIN_NEAR_MISSES = 3

// { reference: { rate }, nearMisses: [{ name, fail, seedOk? }] } → { ok, problems }. seedOk is absent without seed tests.
export function calibrationVerdict({ reference, nearMisses }) {
  const problems = [
    ...(reference?.rate === 1 ? [] : [`reference must pass every hidden test (pass rate ${reference?.rate ?? 'missing'})`]),
    ...(nearMisses.length >= MIN_NEAR_MISSES ? [] : [`needs at least ${MIN_NEAR_MISSES} near-miss versions, has ${nearMisses.length}`]),
    ...nearMisses.filter(n => !(n.fail >= 1)).map(n => `near-miss ${n.name} fails no hidden test`),
    ...nearMisses.filter(n => n.seedOk === false).map(n => `near-miss ${n.name} fails the seed's own tests`),
  ]
  return { ok: problems.length === 0, problems }
}

// Node's default `node --test` patterns (Node 26, with type stripping on); like Node, node_modules is left out.
const EXT = '{cjs,mjs,js,cts,mts,ts}'
export const NODE_TEST_PATTERNS = [`**/*.test.${EXT}`, `**/*-test.${EXT}`, `**/*_test.${EXT}`, `**/test-*.${EXT}`, `**/test.${EXT}`, `**/test/**/*.${EXT}`]
const seedTestFiles = seed => [...new Set(globSync(NODE_TEST_PATTERNS, { cwd: seed }).map(f => f.replaceAll('\\', '/')))]
  .filter(f => !f.split('/').includes('node_modules'))
  .sort()

// Runs the seed's test files (paths relative to dir) inside dir, with the hidden tests' env and limit.
// ok needs a clean exit: a failing test, a timeout or a spawn error is not ok; error names a timeout or spawn error.
export function seedTests(dir, files, env = process.env) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], {
    cwd: dir, env: hiddenEnv(dir, env), encoding: 'utf8', timeout: 300_000, windowsHide: true,
  })
  return { ...parseTap(r.stdout ?? ''), ok: r.status === 0, error: r.error?.code ?? null }
}

// Copies the layers in order into a fresh temp folder (later files overwrite earlier ones), runs check(dir)
// there, and deletes that exact folder afterwards, also when copying or the check throws.
function testVariant(task, layers, check) {
  const dir = mkdtempSync(join(tmpdir(), `calibrate-${task}-`))
  try {
    for (const layer of layers) cpSync(layer, dir, { recursive: true })
    return check(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  }
}

const subfolders = dir => existsSync(dir)
  ? readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort()
  : []

// A held-out task's layout under root: its reference folder, its near-miss folder and version names, and its seed
// folder (null without one). A task name that is not plain, or a task without a reference, throws one line.
export function taskLayout(task, { root = CALIBRATION, seeds = SEEDS } = {}) {
  if (typeof task !== 'string' || !/^[a-z0-9]+$/i.test(task)) throw new Error(`not a task name: ${task ?? '(none)'}`)
  const reference = join(root, task, 'reference')
  if (!existsSync(reference)) throw new Error(`no reference for ${task}: ${reference} is missing`)
  const nearDir = join(root, task, 'near-miss')
  const seed = join(seeds, task)
  const stageOne = join(root, task, 'reference-s1')
  const stageOneNear = join(root, task, 'near-miss-s1')
  return {
    reference, nearDir, nearMissNames: subfolders(nearDir), seed: existsSync(seed) ? seed : null,
    stageOne: existsSync(stageOne) ? { reference: stageOne, nearDir: stageOneNear, nearMissNames: subfolders(stageOneNear) } : null,
  }
}

export function calibrate(task, { root = CALIBRATION, seeds = SEEDS, run = hiddenTests, seedRun = seedTests, log = () => {} } = {}) {
  const { reference, nearDir, nearMissNames, seed, stageOne } = taskLayout(task, { root, seeds })
  const base = seed ? [seed, reference] : [reference]
  const seedFiles = seed ? seedTestFiles(seed) : []
  const hidden = stageOne ? dir => run(task, dir, { s1Dir: stageOne.reference }) : dir => run(task, dir)
  const ref = testVariant(task, base, hidden)
  log(`reference ${ref.pass}/${ref.tests}`)
  // A reference may replace a seed test file with its own version (h2's does), so the seed's own copies go
  // back in place after the hidden run and before the seed tests run.
  const seedCheck = dir => {
    for (const file of seedFiles) cpSync(join(seed, file), join(dir, file))
    return seedRun(dir, seedFiles)
  }
  const nearMisses = nearMissNames.map(name => {
    const { counts, seedResult } = testVariant(task, [...base, join(nearDir, name)], dir => ({
      counts: hidden(dir),
      seedResult: seedFiles.length > 0 ? seedCheck(dir) : null,
    }))
    const why = seedResult?.error ? ` (${seedResult.error})` : ''
    const seedLine = seedResult ? `; seed tests ${seedResult.pass}/${seedResult.tests} ${seedResult.ok ? 'ok' : `FAILED${why}`}` : ''
    log(`near-miss ${name} ${counts.pass}/${counts.tests} (${counts.fail} fail)${seedLine}`)
    return seedResult ? { name, fail: counts.fail, seedOk: seedResult.ok === true } : { name, fail: counts.fail }
  })
  const stageOneMisses = (stageOne?.nearMissNames ?? []).map(name => {
    const counts = testVariant(task, [stageOne.reference, join(stageOne.nearDir, name)], s1Dir => run(task, reference, { s1Dir }))
    log(`near-miss s1/${name} ${counts.pass}/${counts.tests} (${counts.fail} fail)`)
    return { name: `s1/${name}`, fail: counts.fail }
  })
  return calibrationVerdict({ reference: ref, nearMisses: [...nearMisses, ...stageOneMisses] })
}

function main() {
  const task = process.argv[2]
  if (!task) throw new Error('usage: node bench/calibrate.mjs <task>')
  const { ok, problems } = calibrate(task, { log: console.log })
  for (const p of problems) console.log(`problem: ${p}`)
  console.log(`${task}: calibration ${ok ? 'ok' : 'FAILED'}`)
  process.exitCode = ok ? 0 : 1
}

if (isMainModule(import.meta.url)) {
  try { main() } catch (e) { console.error(e.message); process.exitCode = 1 }
}
