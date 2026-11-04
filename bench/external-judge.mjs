// Hands a round's anonymized groups to outside judges (non-Claude models such as Codex or Antigravity's agent) and
// reads their verdicts back, so the round can be judged by models that did not build the solutions.
// prepare: each group of 2 to 4 solutions becomes two cases, numbered in shuffled order, with fresh letters A, B (C, D):
//   one shows the group's labels in alphabetical order, the other mirrored (the round's own labels may already be
//   public). Each case folder holds the solutions, SEED/ (seeded tasks), an empty scratch/ and JUDGE.md: the committed
//   judge prompt for that group, plus how to hand in verdict.json. The set's root holds nothing else: the judge works
//   from the run sheet. The case → group map is written to results/external-key-<round>.json and stays there.
//   It refuses before results/leak-scan-<round>.json exists: the leak scan runs before any judge.
// copy: copies a fresh case set once for the second judge, before either judge opens a case.
// import: reads every case's verdict.json, checks it like an Opus verdict, maps the letters back to the round's labels
//   and writes results/judge-<as>.json plus blind-key-<as>.json, so `node bench/aggregate.mjs --round=<as>` scores it.
//   It always writes results/outside-usable-<as>.json, never overwrites a judged round, and writes no verdicts unless
//   every case is usable. A mode-round import (any --round but ho) needs an outside judge of bench/bars-mo.json whose
//   round is <as>, and that judge's held-out check recorded first.
// rebuild-heldout: a fresh held-out case set for one judge, as c5ba259 wrote it, from the existing external-key-ho.json.
// check: c5ba259's held-out rule for an imported judge, written once to results/outside-check-ho-<as>.json, and
//   refused once that judge's mode-round verdicts are imported.
// Usage: node bench/external-judge.mjs prepare --round=mo --out=C:/Users/Asus/codex-judge-mo
//        node bench/external-judge.mjs copy --from=C:/Users/Asus/codex-judge-mo --to=C:/Users/Asus/ag-judge-mo
//        node bench/external-judge.mjs import --round=mo --out=C:/Users/Asus/codex-judge-mo --as=mocx
//        node bench/external-judge.mjs rebuild-heldout --out=C:/Users/Asus/codex-judge-ho2
//        node bench/external-judge.mjs check --as=hocx
import { randomInt } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { judgeScores } from './aggregate.mjs'
import { readBars } from './bars-common.mjs'
import { judgeDirFor } from './anonymize.mjs'
import { checkLeakScan, fillPrompt, parseVerdict, subfolders } from './judge.mjs'
import { NAME, RESULTS } from './run.mjs'

const BENCH = dirname(fileURLToPath(import.meta.url))
const USAGE = 'usage: node bench/external-judge.mjs prepare --round=<r> --out=<d> | import --round=<r> --out=<d> --as=<n> | copy --from=<d> --to=<d> | rebuild-heldout --out=<d> | check --as=<n>'
const HAND_IN = `
## How to hand in your verdict

- This folder is the whole case: judge only what is in it. Do not open other case folders, any repository or the web.
- Put probes only in the \`scratch\` folder here.
- When you are done, also write your final JSON object (the same one, without the fence) to \`verdict.json\` in this folder.
`
const LETTERS = ['A', 'B', 'C', 'D']
const COPY_OPTIONS = { recursive: true, verbatimSymlinks: true }

function shuffleRandom(list) {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

// [{ case: 'case-NN', pair, judge: 1|2, map: { A: label, B: label, ... } }] — two cases per group, numbered after
// shuffling. Case 1 gives the sorted labels the letters in order; case 2 gives them the mirrored order.
export function planCases(groups, labels, shuffle = shuffleRandom) {
  const sorted = [...labels].sort()
  const mapOf = order => Object.fromEntries(order.map((label, i) => [LETTERS[i], label]))
  const all = groups.flatMap(pair => [{ pair, judge: 1, map: mapOf(sorted) }, { pair, judge: 2, map: mapOf([...sorted].reverse()) }])
  return shuffle(all).map((c, i) => ({ case: `case-${String(i + 1).padStart(2, '0')}`, ...c }))
}

// A case's letter → label map. c5ba259's cases (results/external-key-ho.json) hold A and B on the case itself.
export const caseMap = c => c.map ?? { A: c.A, B: c.B }

// c5ba259's prompt (the held-out one) has an example answer in X and Y, and it says scratch/ is deleted for the judge:
// here an A/B judge must see A and B, and its scratch/ stays.
const relabel = text => text.replaceAll('"X"', '"A"').replaceAll('"Y"', '"B"')
  .replace('It is deleted for you when you finish; do not delete anything yourself.', 'It is not deleted for you here; leaving it is fine. Do not delete anything yourself.')

// The mode round's prompt shows every label in its example: the i-th sorted label becomes the i-th letter, in one pass,
// then the same scratch sentence change as relabel.
export function relabelFour(text, labels) {
  const letterOf = Object.fromEntries(labels.map((label, i) => [label, LETTERS[i]]))
  return text.replace(/"([A-Z])"/g, (quoted, label) => (letterOf[label] ? `"${letterOf[label]}"` : quoted))
    .replace('It is deleted for you when you finish; do not delete anything yourself.', 'It is not deleted for you here; leaving it is fine. Do not delete anything yourself.')
}

function refuseNonEmpty(dir) {
  if (existsSync(dir) && readdirSync(dir).length > 0) throw new Error(`${dir} is not empty: pick a new folder`)
}

// Each case's solutions under its letters, SEED/ when the group has one, an empty scratch/ and JUDGE.md from
// judgeText(c, seed). Refuses a folder that already holds something, and checks every solution folder before the first
// copy, so a set is never left half copied.
function writeCases({ judgeDir, out, cases, judgeText }) {
  refuseNonEmpty(out)
  const missing = cases.flatMap(c => Object.values(caseMap(c)).map(label => join(judgeDir, c.pair, label))).find(path => !existsSync(path))
  if (missing) throw new Error(`no folder ${missing}: nothing copied`)
  for (const c of cases) {
    const source = join(judgeDir, c.pair)
    const dir = join(out, c.case)
    for (const [letter, label] of Object.entries(caseMap(c))) cpSync(join(source, label), join(dir, letter), COPY_OPTIONS)
    const seed = existsSync(join(source, 'SEED'))
    if (seed) cpSync(join(source, 'SEED'), join(dir, 'SEED'), COPY_OPTIONS)
    mkdirSync(join(dir, 'scratch'))
    writeFileSync(join(dir, 'JUDGE.md'), judgeText(c, seed))
  }
}

export function prepareCases({ judgeDir, out, cases, template, taskText }) {
  writeCases({
    judgeDir, out, cases,
    judgeText: (c, seed) => {
      const map = caseMap(c)
      const prompt = relabelFour(template, Object.values(map).sort())
      return fillPrompt(prompt, { labels: Object.keys(map).sort(), task: taskText(c.pair), seed }) + HAND_IN
    },
  })
}

// A verdict.json as an outside judge may write it: plain JSON, maybe with a byte-order mark or still in its fence.
export function verdictText(text) {
  const plain = text.replace(/^\uFEFF/, '')
  return plain.includes('```json') ? plain : '```json\n' + plain + '\n```'
}

function rowFor(c, verdict) {
  const map = caseMap(c)
  const scored = Object.fromEntries(Object.entries(map).map(([letter, label]) => [label, verdict[letter]]))
  const row = { pair: c.pair, ...scored, ranking: verdict.ranking.map(letter => map[letter]), judge: c.judge, case: c.case }
  return c.judge === 2 ? { ...row, swapped: true } : row
}

// Every case's verdict, back under the round's real labels; problems name the cases that could not be used, one line
// each (a JSON parse error quotes the bad text, newlines included).
export function importVerdicts({ out, cases }) {
  const rows = []
  const problems = []
  for (const c of cases) {
    const path = join(out, c.case, 'verdict.json')
    if (!existsSync(path)) {
      problems.push(`${c.case}: no verdict.json`)
      continue
    }
    try {
      rows.push(rowFor(c, parseVerdict(verdictText(readFileSync(path, 'utf8')), c.pair, Object.keys(caseMap(c)).sort())))
    } catch (err) {
      problems.push(`${c.case}: ${err.message.replace(/\s+/g, ' ')}`)
    }
  }
  return { rows, problems }
}

// { pair: setup whose overall scores, summed over that pair's judges, are higher, or 'tie' }.
export function pairWinners(rows, key) {
  const totals = {}
  for (const row of rows) {
    if (!key[row.pair]) continue
    const pairTotals = (totals[row.pair] ??= {})
    for (const [label, cond] of Object.entries(key[row.pair] ?? {})) pairTotals[cond] = (pairTotals[cond] ?? 0) + (row[label]?.overall ?? 0)
  }
  return Object.fromEntries(Object.entries(totals).map(([pair, byCond]) => {
    const [first, second] = Object.entries(byCond).sort((x, y) => y[1] - x[1])
    return [pair, second && second[1] === first[1] ? 'tie' : first[0]]
  }))
}

// One line naming the file: Node's parse error quotes the bad text, newlines included.
function readJson(path) {
  const text = readFileSync(path, 'utf8')
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`${path} is not valid JSON: fix or replace it`, { cause: err })
  }
}

const taskTextOf = (bench, pair) => readFileSync(join(bench, 'tasks', `${pair.split('-')[0]}.md`), 'utf8')

// Every group's labels and task text, read before anything is copied: each group must hold the same 2 to 4 solutions.
function checkPairs(judgeDir, pairs, bench) {
  const labelsOf = pair => subfolders(join(judgeDir, pair)).filter(name => /^[A-Z]$/.test(name))
  const labels = labelsOf(pairs[0])
  if (labels.length < 2 || labels.length > LETTERS.length) {
    throw new Error(`${pairs[0]} has solutions ${labels.join(', ') || 'none'}: an outside judge takes 2 to ${LETTERS.length}`)
  }
  const tasks = Object.fromEntries(pairs.map(pair => {
    const own = labelsOf(pair)
    if (own.join() !== labels.join()) throw new Error(`${pair} has solutions ${own.join(', ') || 'none'}, but ${pairs[0]} has ${labels.join(', ')}: every group needs the same`)
    return [pair, taskTextOf(bench, pair)]
  }))
  return { labels, tasks }
}

const OPTION_NAMES = ['round', 'out', 'as', 'from', 'to']
const REQUIRED_OPTIONS = { prepare: ['round', 'out'], import: ['round', 'out', 'as'], copy: ['from', 'to'], 'rebuild-heldout': ['out'], check: ['as'] }

export function externalOptions(argv) {
  const [command] = argv
  const opt = name => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? ''
  const options = Object.fromEntries(OPTION_NAMES.map(name => [name, opt(name)]))
  const valid = name => (name === 'round' || name === 'as' ? NAME.test(options[name]) : options[name] !== '')
  if (!Object.hasOwn(REQUIRED_OPTIONS, command) || !REQUIRED_OPTIONS[command].every(valid)) throw new Error(USAGE)
  return { command, ...options }
}

// Returns the number of cases written.
export function prepare({ round, out, results = RESULTS, judgeDir = judgeDirFor(round), bench = BENCH, log = console.log }) {
  const keyPath = join(results, `external-key-${round}.json`)
  if (existsSync(keyPath)) throw new Error(`${keyPath} exists: round ${round} was already prepared; delete it to start over`)
  if (!existsSync(judgeDir)) throw new Error(`no folder ${judgeDir}: anonymize round ${round} first`)
  const pairs = subfolders(judgeDir)
  if (pairs.length === 0) throw new Error(`no pairs in ${judgeDir}: anonymize round ${round} first`)
  // The leak scan runs before any judge, the outside ones included (spec "Leak scan").
  checkLeakScan(results, round, pairs)
  const { labels, tasks } = checkPairs(judgeDir, pairs, bench)
  const template = readFileSync(join(bench, 'judge-prompt.md'), 'utf8')
  const cases = planCases(pairs, labels)
  prepareCases({ judgeDir, out, cases, template, taskText: pair => tasks[pair] })
  writeFileSync(keyPath, JSON.stringify(cases, null, 2) + '\n')
  log(`${cases.length} cases in ${out}; key in ${keyPath}`)
  return cases.length
}

// The outside judges of the mode round's bars (bench/bars-mo.json `outside`: name, heldOut, round).
const outsideJudgesOf = outside => outside ?? readBars().outside

// A mode-round import (any round but the held-out 'ho') belongs to one outside judge, and its held-out check is
// recorded first (spec "Outside confirmation").
function refuseBeforeCheck({ round, as, results, outside }) {
  if (round === 'ho') return
  const judge = outsideJudgesOf(outside).find(entry => entry.round === as)
  if (!judge) throw new Error(`no outside judge in bench/bars-mo.json imports its mode-round verdicts as ${as}`)
  if (!existsSync(join(results, `outside-check-ho-${judge.heldOut}.json`))) throw new Error(`run node bench/external-judge.mjs check --as=${judge.heldOut} first`)
}

// Reads everything first, writes verdicts only when every case is usable and the order holds, and never over an
// existing round. The usable count goes to outside-usable-<as>.json on every import, so a refused import still says
// how far it got. outside: the bars config's outside judges (read from bench/bars-mo.json when not given).
export function importRound({ round, out, as, results = RESULTS, outside, log = console.log }) {
  const targets = [join(results, `judge-${as}.json`), join(results, `blind-key-${as}.json`)]
  const taken = targets.find(existsSync)
  if (taken) throw new Error(`${taken}: importing as round ${as} would overwrite it; pick another --as`)
  const keyPath = join(results, `blind-key-${round}.json`)
  const key = readJson(keyPath)
  const inside = pairWinners(readJson(join(results, `judge-${round}.json`)), key)
  const cases = readJson(join(results, `external-key-${round}.json`))
  const { rows, problems } = importVerdicts({ out, cases })
  const unknown = rows.filter(row => !key[row.pair]).map(row => `${row.case}: ${row.pair} is not in ${keyPath}`)
  const all = [...problems, ...unknown]
  writeFileSync(join(results, `outside-usable-${as}.json`), JSON.stringify({ usable: cases.length - all.length, total: cases.length, problems: all }, null, 2) + '\n')
  refuseBeforeCheck({ round, as, results, outside })
  if (all.length > 0) throw new Error(`${all.length} case(s) not usable, nothing written:\n  ${all.join('\n  ')}`)
  const winners = pairWinners(rows, key)
  writeFileSync(targets[0], JSON.stringify(rows, null, 2) + '\n')
  writeFileSync(targets[1], JSON.stringify(key, null, 2) + '\n')
  const pairs = Object.keys(winners)
  const same = pairs.filter(pair => winners[pair] === inside[pair]).length
  log(`${rows.length} verdicts imported as round ${as}. Same pair winner as the round's own judges: ${same} of ${pairs.length}.`)
  for (const pair of pairs) log(`  ${pair}: outside ${winners[pair]}, inside ${inside[pair] ?? '–'}`)
  log(`Scores: node bench/aggregate.mjs --round=${as}`)
  return { same, pairs: pairs.length }
}

// Copies a case set once for the second judge. Refuses a target that holds anything, and a set where a judge has
// already been: a verdict.json anywhere in it, or anything in a case's scratch/. Returns the number of cases copied.
export function copyCaseSet({ from, to }) {
  refuseNonEmpty(to)
  const cases = subfolders(from)
  const verdicts = readdirSync(from, { recursive: true }).filter(path => basename(path) === 'verdict.json')
  const probes = cases.filter(name => existsSync(join(from, name, 'scratch')) && readdirSync(join(from, name, 'scratch')).length > 0)
  const found = [...verdicts, ...probes.map(name => `${name}: scratch/ is not empty`)]
  if (found.length > 0) throw new Error(`${from} was already judged, nothing copied:\n  ${found.join('\n  ')}`)
  cpSync(from, to, COPY_OPTIONS)
  return cases.length
}

// A fresh copy of the held-out case set for one outside judge: the same cases, pairs and letters as
// results/external-key-ho.json, and JUDGE.md as c5ba259 wrote it from the frozen prompt. The earlier case sets are
// never read. Returns the number of cases written.
export function rebuildHeldOut({ results = RESULTS, judgeDir = judgeDirFor('ho'), out, bench = BENCH }) {
  const cases = readJson(join(results, 'external-key-ho.json'))
  if (!existsSync(judgeDir)) throw new Error(`no folder ${judgeDir}: anonymize round ho first`)
  const template = relabel(readFileSync(join(bench, 'data', 'heldout', 'judge-prompt-ho.md'), 'utf8'))
  const tasks = Object.fromEntries(cases.map(c => [c.pair, taskTextOf(bench, c.pair)]))
  writeCases({ judgeDir, out, cases, judgeText: (c, seed) => fillPrompt(template, { labels: ['A', 'B'], task: tasks[c.pair], seed }) + HAND_IN })
  return cases.length
}

const round2 = n => Math.round(n * 100) / 100

// c5ba259's held-out rule for an imported judge: the gap is the mean over the held-out pairs of team-ho minus solo-ho
// quality, from judgeScores on the judge's own verdicts and key alone (never summary.json); same counts the pairs where
// pairWinners agrees with the round's Opus judges.
export function outsideCheck({ results = RESULTS, as }) {
  const keyPath = join(results, `blind-key-${as}.json`)
  const rows = readJson(join(results, `judge-${as}.json`))
  const key = readJson(keyPath)
  if (Object.keys(key).length === 0) throw new Error(`${keyPath} has no pairs: import the held-out verdicts first`)
  const quality = judgeScores(rows, key)
  const gaps = Object.keys(key).map(pair => {
    const [task, rep] = pair.split('-')
    const team = quality[`${task}-team-ho-${rep}`]?.quality
    const solo = quality[`${task}-solo-ho-${rep}`]?.quality
    if (!Number.isFinite(team) || !Number.isFinite(solo)) throw new Error(`${pair} has no team-ho and solo-ho quality in judge-${as}.json`)
    return team - solo
  })
  const gap = round2(gaps.reduce((sum, g) => sum + g, 0) / gaps.length)
  const outside = pairWinners(rows, key)
  const inside = pairWinners(readJson(join(results, 'judge-ho.json')), readJson(join(results, 'blind-key-ho.json')))
  const pairs = Object.keys(outside)
  const same = pairs.filter(pair => outside[pair] === inside[pair]).length
  return { gap, same, pairs: pairs.length, passed: gap >= 0.5 && same >= 7 }
}

// The held-out check is recorded once, before any mode-round verdict of the same judge is imported, and never rewritten.
export function recordCheck({ results = RESULTS, as, outside }) {
  const path = join(results, `outside-check-ho-${as}.json`)
  if (existsSync(path)) throw new Error(`${path} exists: the held-out check is recorded once`)
  const judge = outsideJudgesOf(outside).find(entry => entry.heldOut === as)
  if (judge && existsSync(join(results, `judge-${judge.round}.json`))) {
    throw new Error(`mode-round verdicts for ${judge.round} were imported before the held-out check; the check no longer counts`)
  }
  const result = outsideCheck({ results, as })
  writeFileSync(path, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
  return result
}

function main(options) {
  const { command } = options
  if (command === 'prepare') prepare(options)
  else if (command === 'import') importRound(options)
  else if (command === 'copy') console.log(`${copyCaseSet(options)} cases copied to ${options.to}`)
  else if (command === 'rebuild-heldout') console.log(`${rebuildHeldOut(options)} held-out cases in ${options.out}`)
  else if (command === 'check') {
    const { gap, same, pairs, passed } = recordCheck(options)
    console.log(`Held-out check for ${options.as}: gap ${gap >= 0 ? '+' : ''}${gap.toFixed(2)}, same winner ${same} of ${pairs}: ${passed ? 'passed' : 'not passed'}.`)
  }
}

if (isMainModule(import.meta.url)) {
  try {
    main(externalOptions(process.argv.slice(2)))
  } catch (err) {
    console.error(`external-judge: ${err.code === 'ENOENT' ? `missing ${err.path}` : err.message}`)
    process.exitCode = 1
  }
}
