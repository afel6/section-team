// Recomputes round nx's published tables from the files in this folder (or the folder named on the command line).
// Read-only: it reads only <folder>/*.json, writes nothing and never touches bench/results. The judge math is the
// harness's own (bench/bars-common.mjs qualities: the mean of the five dimension scores, never the overall field).
// Usage: node bench/data/nx/recompute.mjs [folder]
// Prints, per tier (h8 direct job, h9 single-area, h10 multi-area) and setup (solo, base = v0.5.1, team = the release):
// cost per run with team×solo, team×base and base×solo, and overall two ways (the tiers weighted equally, and the round's
// total spend); wall time; Codex five-dimension means and gaps; hidden tests passed; near-misses caught by each run's own
// suite (one with no valid test file catches none); mainPeak; and each setup's cost by role. A cost, wall time, hidden
// count or mainPeak mean with any run's value missing prints –, as the bars read it "not measured"; near-misses and
// Codex means leave unmeasured runs and groups out and print their count.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const { qualities } = await import(pathToFileURL(join(here, '..', '..', 'bars-common.mjs')).href)
const SETUPS = ['solo', 'base', 'team']
const TASKS = ['h8', 'h9', 'h10']
const FILES = ['summary.json', 'judge-nxcx.json', 'blind-key-nxcx.json', 'test-strength-nx.json', 'cost-by-role-nx.json']
const condOf = setup => `${setup}-nx`
const setupOf = cond => cond.split('-')[0]
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
// The bars' rule (bars.mjs costBar, meanPassed): a mean or total over runs is unknown (null, printed –) unless every
// value is known, so a run with no cost is never priced at $0.
const known = xs => xs.length > 0 && xs.every(Number.isFinite)
const meanKnown = xs => (known(xs) ? mean(xs) : null)
const r2 = n => (n === null ? null : Math.round(n * 100) / 100)
const ratio = (a, b) => (a === null || b === null || b === 0 ? null : r2(a / b))

function read(dir, file) {
  try {
    return JSON.parse(readFileSync(join(dir, file), 'utf8'))
  } catch (err) {
    throw new Error(`cannot read ${join(dir, file)} (${err.code ?? err.name})`, { cause: err })
  }
}

const runsOf = (summary, setup, task) => summary.filter(run => run.cond === condOf(setup) && run.task === task)
// { solo, base, team } of fn(setup), plus team×solo, team×base and base×solo.
const withRatios = values => ({ ...values, teamSolo: ratio(values.team, values.solo), teamBase: ratio(values.team, values.base), baseSolo: ratio(values.base, values.solo) })
const perSetup = fn => Object.fromEntries(SETUPS.map(setup => [setup, fn(setup)]))

function costTable(summary) {
  const task = Object.fromEntries(TASKS.map(t => [t, withRatios(perSetup(setup => r2(meanKnown(runsOf(summary, setup, t).map(run => run.costUSD)))))]))
  const sum = xs => (known(xs) ? r2(xs.reduce((a, b) => a + b, 0)) : null)
  const equal = withRatios(perSetup(setup => sum(TASKS.map(t => task[t][setup]))))
  const allRuns = withRatios(perSetup(setup => sum(summary.filter(run => run.cond === condOf(setup)).map(run => run.costUSD))))
  return { ...task, equal, allRuns }
}

const wallTable = summary => Object.fromEntries(TASKS.map(t => [t, withRatios(perSetup(setup => {
  const ms = meanKnown(runsOf(summary, setup, t).map(run => run.wallMs))
  return ms === null ? null : Math.round(ms / 6_000) / 10
}))]))

// Means over the task's groups judged for every setup, and the mean of the paired group gaps.
function qualityTable(judge, key) {
  const quals = qualities(judge, key)
  return Object.fromEntries(TASKS.map(t => {
    const groups = Object.keys(quals).filter(group => group.slice(0, group.lastIndexOf('-r')) === t && SETUPS.every(setup => Number.isFinite(quals[group][condOf(setup)]?.quality)))
    const q = setup => groups.map(group => quals[group][condOf(setup)].quality)
    const gap = other => r2(mean(groups.map(group => quals[group][condOf('team')].quality - quals[group][condOf(other)].quality)))
    return [t, { ...perSetup(setup => r2(mean(q(setup)))), teamBase: gap('base'), teamSolo: gap('solo'), groups: groups.length }]
  }))
}

const hiddenTable = summary => Object.fromEntries(TASKS.map(t => [t, {
  ...perSetup(setup => r2(meanKnown(runsOf(summary, setup, t).map(run => run.hidden?.pass)))),
  tests: runsOf(summary, 'team', t)[0]?.hidden?.tests ?? null,
}]))

// A suite with no valid test file caught none; any other n/a is left out and counted.
function nearMissTable(strength) {
  const rows = Object.values(strength)
  const caught = row => (row.reason === 'no valid test file' ? 0 : Number.isFinite(row.caught) ? row.caught : null)
  return Object.fromEntries(TASKS.map(t => {
    const of = setup => rows.filter(row => row.task === t && setupOf(row.cond) === setup)
    const measured = setup => of(setup).map(caught).filter(c => c !== null)
    return [t, {
      ...perSetup(setup => r2(mean(measured(setup)))),
      total: rows.find(row => row.task === t && Number.isFinite(row.total))?.total ?? null,
      notMeasured: SETUPS.reduce((sum, setup) => sum + of(setup).length - measured(setup).length, 0),
    }]
  }))
}

const peakTable = summary => Object.fromEntries(TASKS.map(t => [t, perSetup(setup => {
  const peak = meanKnown(runsOf(summary, setup, t).map(run => run.mainPeak))
  return peak === null ? null : Math.round(peak)
})]))

export function tablesOf(dir) {
  const [summary, judge, key, strength, roles] = FILES.map(file => read(dir, file))
  return { cost: costTable(summary), wall: wallTable(summary), quality: qualityTable(judge, key), hidden: hiddenTable(summary), nearMiss: nearMissTable(strength), mainPeak: peakTable(summary), roles }
}

// ---- Printing ----
const show = (x, f) => (x === null ? '–' : f(x))
const money = x => show(x, v => `$${v.toFixed(2)}`)
const times = x => show(x, v => `${v.toFixed(2)}×`)
const one = x => show(x, v => v.toFixed(1))
const two = x => show(x, v => v.toFixed(2))
const signed = x => show(x, v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`)
const CELL = 10
const row = (label, width, cells) => `  ${label.padEnd(width)}${cells.map(cell => cell.padStart(CELL)).join('')}`
const RATIO_HEADS = ['team×solo', 'team×base', 'base×solo']

function ratioTable(title, table, labels, cell) {
  const width = Math.max(...labels.map(([, label]) => label.length)) + 1
  return [
    title,
    row('', width, [...SETUPS, ...RATIO_HEADS]),
    ...labels.map(([id, label]) => row(label, width, [...SETUPS.map(setup => cell(table[id][setup])), ...['teamSolo', 'teamBase', 'baseSolo'].map(k => times(table[id][k]))])),
  ]
}

const TIERS = [['h8', 'h8'], ['h9', 'h9'], ['h10', 'h10']]
const plainTable = (title, table, cell, extra, extraHead = '') => [
  title,
  `${row('', 4, SETUPS)}${extraHead}`,
  ...TIERS.map(([id]) => `${row(id, 4, SETUPS.map(setup => cell(table[id][setup])))}${extra ? `  ${extra(table[id])}` : ''}`),
]

const rolesLines = roles => Object.entries(roles).flatMap(([task, setups]) => Object.entries(setups).map(([setup, r]) =>
  `  ${task} ${setup}: ${r.roles.map(role => `${role.role} ${money(role.meanUSD)} (${Math.round(100 * role.share)}%)`).join(', ') || 'no priced run'}`))

export function linesOf(t) {
  return [
    `round nx, recomputed from ${FILES.slice(0, -1).join(', ')} and ${FILES.at(-1)}`,
    ...ratioTable('cost (USD per run)', t.cost, [...TIERS, ['equal', 'overall, tiers weighted equally'], ['allRuns', 'overall, all runs (total)']], money),
    ...ratioTable('wall time (minutes per run)', t.wall, TIERS, one),
    ...plainTable('Codex five-dimension means', t.quality, two, q => `${signed(q.teamBase).padStart(CELL - 2)}${signed(q.teamSolo).padStart(CELL)}  (${q.groups} groups)`, `${'team−base'.padStart(CELL)}${'team−solo'.padStart(CELL)}`),
    ...plainTable('hidden tests passed (mean)', t.hidden, one, h => `of ${h.tests ?? '–'}`),
    ...plainTable('near-misses caught by the run\'s own suite (mean)', t.nearMiss, one, n => `of ${n.total ?? '–'}${n.notMeasured ? `  (${n.notMeasured} not measured)` : ''}`),
    ...plainTable('mainPeak (tokens, mean)', t.mainPeak, x => show(x, String)),
    'cost by role (mean per run)',
    ...rolesLines(t.roles),
  ]
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    for (const line of linesOf(tablesOf(resolve(process.argv[2] ?? here)))) console.log(line)
  } catch (err) {
    console.error(`recompute: ${err.message}`)
    process.exitCode = 1
  }
}
