// Hands a round's anonymized pairs to an outside judge (a non-Claude model, for example Antigravity's agent) and
// reads its verdicts back, so the round can be judged by a model that did not build the solutions.
// prepare: each pair becomes two cases, one per label order, numbered in shuffled order, with fresh labels A and B
//   (the round's own X/Y key may already be public). Each case folder holds A/, B/, SEED/ (seeded tasks), an empty
//   scratch/ and JUDGE.md: the committed judge prompt for that pair, plus how to hand in verdict.json.
//   The case → pair map is written to results/external-key-<round>.json and stays there.
// import: reads every case's verdict.json, checks it like an Opus verdict, maps A/B back to X/Y and writes
//   results/judge-<as>.json plus blind-key-<as>.json, so `node bench/aggregate.mjs --round=<as>` scores it.
//   It never overwrites a judged round, and writes nothing unless every case is usable.
// Usage: node bench/external-judge.mjs prepare --round=ho --out=C:/Users/Asus/ag-judge
//        node bench/external-judge.mjs import --round=ho --out=C:/Users/Asus/ag-judge --as=hoag
import { randomInt } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { judgeDirFor } from './anonymize.mjs'
import { fillPrompt, parseVerdict, subfolders } from './judge.mjs'
import { NAME, RESULTS } from './run.mjs'

const BENCH = dirname(fileURLToPath(import.meta.url))
const USAGE = 'usage: node bench/external-judge.mjs prepare|import --round=<name> --out=<folder> [--as=<name>]'
const HAND_IN = `
## How to hand in your verdict

- This folder is the whole case: judge only what is in it. Do not open other case folders, any repository or the web.
- Put probes only in the \`scratch\` folder here.
- When you are done, also write your final JSON object (the same one, without the fence) to \`verdict.json\` in this folder.
`

function shuffleRandom(list) {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

// [{ case: 'case-NN', pair, judge: 1|2, A: 'X'|'Y', B }] — two cases per pair, numbered after shuffling.
export function planCases(pairs, shuffle = shuffleRandom) {
  const all = pairs.flatMap(pair => [{ pair, judge: 1, A: 'X', B: 'Y' }, { pair, judge: 2, A: 'Y', B: 'X' }])
  return shuffle(all).map((c, i) => ({ case: `case-${String(i + 1).padStart(2, '0')}`, ...c }))
}

// The prompt's own example answer uses X and Y, and it says scratch/ is deleted for the judge: here an A/B judge
// must see A and B, and its scratch/ stays.
const relabel = text => text.replaceAll('"X"', '"A"').replaceAll('"Y"', '"B"')
  .replace('It is deleted for you when you finish; do not delete anything yourself.', 'It is not deleted for you here; leaving it is fine. Do not delete anything yourself.')

export function prepareCases({ judgeDir, out, cases, template, taskText }) {
  if (existsSync(out) && readdirSync(out).length > 0) throw new Error(`${out} is not empty: pick a new folder`)
  for (const c of cases) {
    const source = join(judgeDir, c.pair)
    const dir = join(out, c.case)
    for (const label of ['A', 'B']) cpSync(join(source, c[label]), join(dir, label), { recursive: true, verbatimSymlinks: true })
    const seed = existsSync(join(source, 'SEED'))
    if (seed) cpSync(join(source, 'SEED'), join(dir, 'SEED'), { recursive: true, verbatimSymlinks: true })
    mkdirSync(join(dir, 'scratch'))
    writeFileSync(join(dir, 'JUDGE.md'), fillPrompt(relabel(template), { labels: ['A', 'B'], task: taskText(c.pair), seed }) + HAND_IN)
  }
  const range = `${cases[0].case} .. ${cases.at(-1).case}`
  writeFileSync(join(out, 'README.md'), `# Blind code review\n\nJudge every case folder (${range}) on its own, by the JUDGE.md inside it. Treat each case as new: do not compare cases, and open nothing outside the case you are judging.\n`)
}

// A verdict.json as an outside judge may write it: plain JSON, maybe with a byte-order mark or still in its fence.
function verdictText(text) {
  const plain = text.replace(/^\uFEFF/, '')
  return plain.includes('```json') ? plain : '```json\n' + plain + '\n```'
}

function rowFor(c, verdict) {
  const row = { pair: c.pair, [c.A]: verdict.A, [c.B]: verdict.B, ranking: verdict.ranking.map(label => c[label]), judge: c.judge, case: c.case }
  return c.A === 'Y' ? { ...row, swapped: true } : row
}

// Every case's verdict, back under the round's real labels; problems name the cases that could not be used.
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
      rows.push(rowFor(c, parseVerdict(verdictText(readFileSync(path, 'utf8')), c.pair, ['A', 'B'])))
    } catch (err) {
      problems.push(`${c.case}: ${err.message}`)
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

function readJson(path) {
  const text = readFileSync(path, 'utf8')
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${err.message}`, { cause: err })
  }
}

// Each pair's task text, read before anything is copied; a pair must hold exactly the solutions X and Y.
function checkPairs(judgeDir, pairs, bench) {
  return Object.fromEntries(pairs.map(pair => {
    const labels = subfolders(join(judgeDir, pair)).filter(name => /^[A-Z]$/.test(name))
    if (labels.join() !== 'X,Y') throw new Error(`${pair} has solutions ${labels.join(', ') || 'none'}: an outside judge takes pairs of X and Y only`)
    return [pair, readFileSync(join(bench, 'tasks', `${pair.split('-')[0]}.md`), 'utf8')]
  }))
}

export function externalOptions(argv) {
  const opt = name => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
  const [command] = argv
  const round = opt('round') ?? ''
  const out = opt('out') ?? ''
  const as = opt('as') ?? ''
  const ok = ['prepare', 'import'].includes(command) && NAME.test(round) && out !== '' && (command === 'prepare' || NAME.test(as))
  if (!ok) throw new Error(USAGE)
  return { command, round, out, as }
}

// Returns the number of cases written.
export function prepare({ round, out, results = RESULTS, judgeDir = judgeDirFor(round), bench = BENCH, log = console.log }) {
  const keyPath = join(results, `external-key-${round}.json`)
  if (existsSync(keyPath)) throw new Error(`${keyPath} exists: round ${round} was already prepared; delete it to start over`)
  if (!existsSync(judgeDir)) throw new Error(`no folder ${judgeDir}: anonymize round ${round} first`)
  const pairs = subfolders(judgeDir)
  if (pairs.length === 0) throw new Error(`no pairs in ${judgeDir}: anonymize round ${round} first`)
  const tasks = checkPairs(judgeDir, pairs, bench)
  const template = readFileSync(join(bench, 'judge-prompt.md'), 'utf8')
  const cases = planCases(pairs)
  prepareCases({ judgeDir, out, cases, template, taskText: pair => tasks[pair] })
  writeFileSync(keyPath, JSON.stringify(cases, null, 2) + '\n')
  log(`${cases.length} cases in ${out}; key in ${keyPath}`)
  return cases.length
}

// Reads everything first, writes only when every case is usable, and never over an existing round.
export function importRound({ round, out, as, results = RESULTS, log = console.log }) {
  const targets = [join(results, `judge-${as}.json`), join(results, `blind-key-${as}.json`)]
  const taken = targets.find(existsSync)
  if (taken) throw new Error(`${taken}: importing as round ${as} would overwrite it; pick another --as`)
  const keyPath = join(results, `blind-key-${round}.json`)
  const key = readJson(keyPath)
  const inside = pairWinners(readJson(join(results, `judge-${round}.json`)), key)
  const { rows, problems } = importVerdicts({ out, cases: readJson(join(results, `external-key-${round}.json`)) })
  const unknown = [...new Set(rows.map(row => row.pair))].filter(pair => !key[pair]).map(pair => `${pair} is not in ${keyPath}`)
  const all = [...problems, ...unknown]
  if (all.length > 0) throw new Error(`${all.length} case(s) not usable, nothing written:\n  ${all.join('\n  ')}`)
  const outside = pairWinners(rows, key)
  writeFileSync(targets[0], JSON.stringify(rows, null, 2) + '\n')
  writeFileSync(targets[1], JSON.stringify(key, null, 2) + '\n')
  const pairs = Object.keys(outside)
  const same = pairs.filter(pair => outside[pair] === inside[pair]).length
  log(`${rows.length} verdicts imported as round ${as}. Same pair winner as the round's own judges: ${same} of ${pairs.length}.`)
  for (const pair of pairs) log(`  ${pair}: outside ${outside[pair]}, inside ${inside[pair] ?? '–'}`)
  log(`Scores: node bench/aggregate.mjs --round=${as}`)
  return { same, pairs: pairs.length }
}

if (isMainModule(import.meta.url)) {
  try {
    const options = externalOptions(process.argv.slice(2))
    if (options.command === 'prepare') prepare(options)
    else importRound(options)
  } catch (err) {
    console.error(`external-judge: ${err.code === 'ENOENT' ? `missing ${err.path}` : err.message}`)
    process.exitCode = 1
  }
}
