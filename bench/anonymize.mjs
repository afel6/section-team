// Copies each team/solo pair into neutral folders X, Y (and Z) for blind judging, without anything that reveals
// the condition (.team/, .claude/, .superpowers/, .git, node_modules, databases). For a seeded task it also copies
// the untouched seed into <pair>/SEED/ so judges see what each run changed. Writes the secret key to
// results/blind-key.json (or blind-key-<round>.json).
// Usage: node bench/anonymize.mjs [--round=ho --conds=solo-ho,team-ho --tasks=h1,h2,h3 --reps=3]
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { CONDITIONS, NAME, RESULTS, SEEDS, TASKS, parseArgs } from './run.mjs'

const LABELS = ['X', 'Y', 'Z']
const HIDDEN = new Set(['.team', '.claude', '.superpowers', '.git', 'node_modules'])
const isHidden = src => HIDDEN.has(basename(src)) || /\.(db|db-wal|db-shm|sqlite)$/i.test(src)

function copyClean(src, dest) {
  mkdirSync(dest, { recursive: true })
  // verbatimSymlinks: a relative link stays relative, so it never points back into the run folder.
  cpSync(src, dest, { recursive: true, verbatimSymlinks: true, filter: path => !isHidden(path) })
}

function runDir(runPath) {
  try {
    const { dir } = JSON.parse(readFileSync(runPath, 'utf8'))
    if (typeof dir !== 'string' || dir === '') throw new Error('no "dir" field')
    return dir
  } catch (err) {
    throw new Error(`bad run file ${runPath}: ${err.message}`, { cause: err })
  }
}

// Each pair's labels: the conditions rotated by (t + rep), where t is the task's index in tasks.
function pairs(conds, tasks, reps) {
  return tasks.flatMap((task, t) => Array.from({ length: reps }, (_, i) => {
    const rep = i + 1
    const shift = (t + rep) % conds.length
    const order = [...conds.slice(shift), ...conds.slice(0, shift)]
    return { task, rep, pair: `${task}-r${rep}`, labels: Object.fromEntries(order.map((cond, j) => [LABELS[j], cond])) }
  }))
}

// Copies the pair's finished runs (those with a run.json) and, when at least one was copied, the task's seed.
function copyPair({ task, rep, pair, labels }, { results, judgeDir, seeds }) {
  const done = Object.entries(labels)
    .map(([label, cond]) => [label, join(results, `${task}-${cond}-r${rep}`, 'run.json')])
    .filter(([, runPath]) => existsSync(runPath))
  for (const [label, runPath] of done) copyClean(runDir(runPath), join(judgeDir, pair, label))
  const seed = join(seeds, task)
  if (done.length > 0 && existsSync(seed)) copyClean(seed, join(judgeDir, pair, 'SEED'))
}

// Blind key { '<task>-r<rep>': { X: cond, Y: cond, … } }; copies every finished run into <judgeDir>/<pair>/<label>/.
// It adds to judgeDir and never deletes from it; main() empties the folder first.
export function anonymize({ conds, tasks = TASKS, reps = 2, results = RESULTS, judgeDir, seeds = SEEDS }) {
  if (conds.length === 0 || conds.length > LABELS.length) {
    throw new RangeError(`anonymize needs 1 to ${LABELS.length} conditions, got ${conds.length}`)
  }
  const all = pairs(conds, tasks, reps)
  for (const p of all) copyPair(p, { results, judgeDir, seeds })
  return Object.fromEntries(all.map(({ pair, labels }) => [pair, labels]))
}

// Run ids ('<task>-<cond>-r<rep>') in the key whose run was not copied because it never finished, sorted.
// Only meaningful on a judge folder that anonymize() just filled from empty: a leftover label folder hides a missing run.
export function missingRuns(key, judgeDir) {
  return Object.entries(key).flatMap(([pair, labels]) => {
    const [task, repTag] = pair.split('-')
    return Object.entries(labels)
      .filter(([label]) => !existsSync(join(judgeDir, pair, label)))
      .map(([, cond]) => `${task}-${cond}-${repTag}`)
  }).sort()
}

// ~/bench-judge, or ~/bench-judge-<round>. main() deletes this folder, so the round is checked here as well as in
// parseArgs: letters and digits only, so the folder always sits directly in home.
export function judgeDirFor(round, home = homedir()) {
  if (round !== '' && !NAME.test(round)) throw new RangeError(`round takes letters and digits only, got "${round}"`)
  return join(home, round ? `bench-judge-${round}` : 'bench-judge')
}

function main() {
  // --round=v2 --conds=solo,team-v2,forced-v2 → judges those condition labels into ~/bench-judge-v2, key blind-key-v2.json
  const { round, conds, tasks, reps } = parseArgs(process.argv.slice(2))
  const judgeDir = judgeDirFor(round)
  rmSync(judgeDir, { recursive: true, force: true })
  const key = anonymize({ conds: round ? conds : CONDITIONS, tasks, reps, judgeDir })
  writeFileSync(join(RESULTS, round ? `blind-key-${round}.json` : 'blind-key.json'), JSON.stringify(key, null, 2) + '\n')
  console.log('anonymized pairs:', Object.keys(key).join(' '))
  const missing = missingRuns(key, judgeDir)
  if (missing.length > 0) {
    console.error(`not finished, so not anonymized: ${missing.join(' ')}; finish them before judging`)
    process.exitCode = 1
  }
}

if (isMainModule(import.meta.url)) {
  try {
    main()
  } catch (err) {
    console.error(err.message)
    process.exitCode = 1
  }
}
