// Hidden-test calibration for one held-out task: the reference must pass every hidden test, and at least
// 3 near-miss versions must each fail at least one. Each variant is built in its own temp folder from
// bench/seeds/<task>/ (if any), then heldout-calibration/<task>/reference/, then the near-miss on top.
// Usage: node bench/calibrate.mjs <task>
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { SEEDS } from './run.mjs'
import { hiddenTests } from './score.mjs'

export const CALIBRATION = join(dirname(fileURLToPath(import.meta.url)), 'heldout-calibration')
const MIN_NEAR_MISSES = 3

// { reference: { rate }, nearMisses: [{ name, fail }] } → { ok, problems }
export function calibrationVerdict({ reference, nearMisses }) {
  const problems = [
    ...(reference?.rate === 1 ? [] : [`reference must pass every hidden test (pass rate ${reference?.rate ?? 'missing'})`]),
    ...(nearMisses.length >= MIN_NEAR_MISSES ? [] : [`needs at least ${MIN_NEAR_MISSES} near-miss versions, has ${nearMisses.length}`]),
    ...nearMisses.filter(n => !(n.fail >= 1)).map(n => `near-miss ${n.name} fails no hidden test`),
  ]
  return { ok: problems.length === 0, problems }
}

// Copies the layers in order into a fresh temp folder (later files overwrite earlier ones), runs the hidden
// tests there, and deletes that exact folder afterwards, also when copying or the run throws.
function testVariant(task, layers, run) {
  const dir = mkdtempSync(join(tmpdir(), `calibrate-${task}-`))
  try {
    for (const layer of layers) cpSync(layer, dir, { recursive: true })
    return run(task, dir)
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  }
}

const subfolders = dir => existsSync(dir)
  ? readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort()
  : []

export function calibrate(task, { root = CALIBRATION, seeds = SEEDS, run = hiddenTests, log = () => {} } = {}) {
  if (typeof task !== 'string' || !/^[a-z0-9]+$/i.test(task)) throw new Error(`not a task name: ${task ?? '(none)'}`)
  const reference = join(root, task, 'reference')
  if (!existsSync(reference)) throw new Error(`no reference for ${task}: ${reference} is missing`)
  const seed = join(seeds, task)
  const base = existsSync(seed) ? [seed, reference] : [reference]
  const ref = testVariant(task, base, run)
  log(`reference ${ref.pass}/${ref.tests}`)
  const nearDir = join(root, task, 'near-miss')
  const nearMisses = subfolders(nearDir).map(name => {
    const r = testVariant(task, [...base, join(nearDir, name)], run)
    log(`near-miss ${name} ${r.pass}/${r.tests} (${r.fail} fail)`)
    return { name, fail: r.fail }
  })
  return calibrationVerdict({ reference: ref, nearMisses })
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
