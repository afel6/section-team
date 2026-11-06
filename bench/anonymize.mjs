// Copies each pair's runs (1 to 4 setups) into neutral folders X, Y, Z and W for blind judging, without anything that reveals
// the condition (.team/, .claude/, .superpowers/, .git, node_modules, databases). For a seeded task it also copies
// the untouched seed into <pair>/SEED/ so judges see what each run changed. Writes the secret key to
// results/blind-key.json (or blind-key-<round>.json).
// Usage: node bench/anonymize.mjs --round=ho --conds=solo-ho,team-ho --tasks=h1,h2,h3 --reps=3
//        A round names all three: the folder is emptied first, and flags that do not give the round's key are refused before that.
//        node bench/anonymize.mjs   (no round: the first rounds' setups, tasks and 2 reps, into ~/bench-judge)
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { DEFAULT_CONDS, NAME, RESULTS, SEEDS, TASKS, parseArgs, requireFlags } from './run.mjs'
import { stageCountOf } from './stages.mjs'

const LABELS = ['X', 'Y', 'Z', 'W']

// What a hint prints for a round with no key yet: the bare --round form is refused.
export const anonymizeCommand = round => `node bench/anonymize.mjs --round=${round} --conds=<setups> --tasks=<tasks> --reps=<n>`
const HIDDEN = new Set(['.team', '.claude', '.superpowers', '.git', 'node_modules'])
const isHidden = src => HIDDEN.has(basename(src)) || /\.(db|db-wal|db-shm|sqlite)$/i.test(src)

function copyClean(src, dest) {
  mkdirSync(dest, { recursive: true })
  // verbatimSymlinks: a relative link stays relative, so it never points back into the run folder.
  cpSync(src, dest, { recursive: true, verbatimSymlinks: true, filter: path => !isHidden(path) })
}

// A run's folder and the stages it was asked for (absent in a run made before run.json recorded them: every stage).
function readRun(runPath) {
  try {
    const { dir, stagesAsked } = JSON.parse(readFileSync(runPath, 'utf8'))
    if (typeof dir !== 'string' || dir === '') throw new Error('no "dir" field')
    return { dir, stagesAsked }
  } catch (err) {
    throw new Error(`bad run file ${runPath}: ${err.message}`, { cause: err })
  }
}

// judgeDir/stages.json lists each pair whose runs were asked for fewer stages than the task has ({ pair: n }); the judges
// are told only those prompts. Outside the pair folders, so no judge sees it.
const STAGES_FILE = 'stages.json'

// The stages a pair's runs were asked for, or undefined when they were asked for all of them.
export function stagesAskedOf(judgeDir, pair) {
  const path = join(judgeDir, STAGES_FILE)
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8'))[pair]
  } catch (err) {
    throw new Error(`${path} is not valid JSON: anonymize the round again`, { cause: err })
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

// Copies the pair's finished runs (those with a run.json) and, when at least one was copied, the task's seed. Returns the
// stages its runs were asked for (null when none finished); runs asked for different stages are refused before any copy.
function copyPair({ task, rep, pair, labels }, { results, judgeDir, seeds }) {
  const done = Object.entries(labels)
    .map(([label, cond]) => [label, join(results, `${task}-${cond}-r${rep}`, 'run.json')])
    .filter(([, runPath]) => existsSync(runPath))
    .map(([label, runPath]) => [label, readRun(runPath)])
  const asked = [...new Set(done.map(([, run]) => run.stagesAsked ?? stageCountOf(task)))]
  if (asked.length > 1) throw new Error(`${pair}: its runs asked for different stages (${asked.toSorted().join(', ')}), so no one task text fits them`)
  for (const [label, run] of done) copyClean(run.dir, join(judgeDir, pair, label))
  const seed = join(seeds, task)
  if (done.length > 0 && existsSync(seed)) copyClean(seed, join(judgeDir, pair, 'SEED'))
  return asked[0] ?? null
}

function checkedPairs(conds, tasks, reps) {
  if (conds.length === 0 || conds.length > LABELS.length) {
    throw new RangeError(`anonymize needs 1 to ${LABELS.length} conditions, got ${conds.length}`)
  }
  return pairs(conds, tasks, reps)
}

const keyOf = all => Object.fromEntries(all.map(({ pair, labels }) => [pair, labels]))

// Blind key { '<task>-r<rep>': { X: cond, Y: cond, … } }; copies every finished run into <judgeDir>/<pair>/<label>/.
// It adds to judgeDir and never deletes from it; main() empties the folder first.
export function anonymize({ conds, tasks = TASKS, reps = 2, results = RESULTS, judgeDir, seeds = SEEDS }) {
  const all = checkedPairs(conds, tasks, reps)
  const asked = all.map(p => [p.pair, copyPair(p, { results, judgeDir, seeds }), stageCountOf(p.task)])
  const fewer = Object.fromEntries(asked.filter(([, n, count]) => n !== null && n < count).map(([pair, n]) => [pair, n]))
  if (Object.keys(fewer).length > 0) writeFileSync(join(judgeDir, STAGES_FILE), `${JSON.stringify(fewer, null, 2)}\n`)
  return keyOf(all)
}

const sameKey = (path, key) => {
  try {
    return isDeepStrictEqual(JSON.parse(readFileSync(path, 'utf8')), key)
  } catch (err) {
    if (err instanceof SyntaxError) return false // not a key at all: refused like another round's
    throw err
  }
}

// Scoring reads the key, and the labels in judge verdicts mean nothing without it, so flags that would change it stop here.
function refuseOtherKey(path, key) {
  if (existsSync(path) && !sameKey(path, key)) {
    throw new Error(`${path} is not the key of these flags, and nothing was changed: check --conds, --tasks and --reps. To judge this round anew, move that file away first.`)
  }
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
  const argv = process.argv.slice(2)
  const { round, conds, tasks, reps } = parseArgs(argv)
  if (round) requireFlags(argv, ['conds', 'tasks', 'reps'])
  const judgeDir = judgeDirFor(round)
  const setups = round ? conds : DEFAULT_CONDS
  const keyPath = join(RESULTS, round ? `blind-key-${round}.json` : 'blind-key.json')
  refuseOtherKey(keyPath, keyOf(checkedPairs(setups, tasks, reps)))
  rmSync(judgeDir, { recursive: true, force: true })
  const key = anonymize({ conds: setups, tasks, reps, judgeDir })
  writeFileSync(keyPath, JSON.stringify(key, null, 2) + '\n')
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
