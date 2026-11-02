// The mode round's pre-registered bars (spec "Bars and rules", values in bench/bars-<round>.json). Per comparison:
// - headline: every group where both setups have a counted run (a results/summary.json row) and a judged quality;
// - sensitivity: only the groups whose two runs are faithful (results/mode-check-<round>.json; solo always is).
// Gaps, Balanced's mean and usage ratios are rounded to statDecimals before a bar sees them, hidden-test rates to
// hiddenDecimals; ranges stay unrounded.
// The CLI adds each headline's published label, outside confirmation and secondary measures (bars-outside.mjs).
// Usage: node bench/bars.mjs --round=mo   (writes results/bars-mo.json)
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { configPath, groupOf, mean, qualities, readBars, readInput, shown } from './bars-common.mjs'
import { outsideJudges, outsideLine, outsideReport, secondaryLine } from './bars-outside.mjs'
import { NAME, RESULTS } from './run.mjs'
import { round, sampleSD, tCrit975 } from './stats.mjs'

// Solo runs always count as faithful; a mode run only with a faithful mode-check row.
const isFaithful = (modeCheck, run) => run.cond.startsWith('solo-') || modeCheck[run.id]?.faithful === true
const HELDOUT = fileURLToPath(new URL('./data/heldout/', import.meta.url))

// The groups, sorted, where both setups have a counted run and a quality; with a mode check, two faithful runs.
function pairedGroups({ mode, vs, quals, summary, modeCheck }) {
  const runs = new Map(summary.map(run => [`${groupOf(run)} ${run.cond}`, run]))
  return Object.keys(quals).sort().flatMap(group => {
    const side = cond => ({ run: runs.get(`${group} ${cond}`), q: quals[group][cond] })
    const pair = { group, mode: side(mode), vs: side(vs) }
    const usable = [pair.mode, pair.vs].every(s => s.run && s.q && (!modeCheck || isFaithful(modeCheck, s.run)))
    return usable ? [{ ...pair, task: pair.mode.run.task }] : []
  })
}

// Gap, SD and the unrounded 95% range of the group gaps; no range with one group or below `floor` groups.
function spread(gaps, floor) {
  const n = gaps.length
  const gap = mean(gaps)
  if (n < 2 || n < floor) return { gap, sd: null, lo: null, hi: null, includesZero: null }
  const sd = sampleSD(gaps)
  const half = (tCrit975(n - 1) * sd) / Math.sqrt(n)
  return { gap, sd, lo: gap - half, hi: gap + half, includesZero: gap - half <= 0 }
}

// Mean cost of the mode's runs over the comparator's on `tasks`, and the ids of the priced runs whose cost was computed
// from transcripts; all null when a cost is unknown (never priced at $0). The ratio is cut to 12 significant digits
// before rounding, so a decimal halfway value that division leaves just under it (1.1249999999999998) rounds up.
function costRatio(groups, tasks, decimals) {
  const runs = groups.filter(g => tasks.includes(g.task))
  const costs = side => runs.map(g => g[side].run.costUSD)
  const known = runs.length > 0 && [...costs('mode'), ...costs('vs')].every(Number.isFinite) && mean(costs('vs')) > 0
  if (!known) return { modeCost: null, vsCost: null, ratio: null, computed: [] }
  const [modeCost, vsCost] = [mean(costs('mode')), mean(costs('vs'))]
  const computed = runs.flatMap(g => [g.mode.run, g.vs.run]).filter(run => run.costComputed === true).map(run => run.id)
  return { modeCost, vsCost, ratio: round(Number((modeCost / vsCost).toPrecision(12)), decimals), computed }
}

// Lean's usage half on usage.tasks, plus its reportVs ratio (reported only) under the same group rule. The reading is
// the printed line: both ratios and the runs priced from transcripts (spec: marked in the table).
function usageOf(cmp, groups, pairs, decimals) {
  const { tasks, maxRatio, reportVs } = cmp.usage
  const { computed: ownComputed, ...own } = costRatio(groups, tasks, decimals)
  const report = costRatio(pairs(cmp.mode, reportVs.setup), [reportVs.task], decimals)
  const measured = own.ratio !== null
  const computedCosts = [...new Set([...ownComputed, ...report.computed])].sort()
  const parts = [
    measured ? `usage ${own.ratio.toFixed(2)}× ${cmp.vs} (at most ${maxRatio.toFixed(2)}×)` : 'usage not measured',
    ...(report.ratio === null ? [] : [`${reportVs.task} vs ${reportVs.setup} ${report.ratio.toFixed(2)}×`]),
  ]
  return {
    ...own, maxRatio, ok: measured ? own.ratio <= maxRatio : null,
    reading: parts.join('  ') + (computedCosts.length ? ` (computed costs: ${computedCosts.join(', ')})` : ''),
    reportVs: { ...reportVs, ratio: report.ratio }, computedCosts,
  }
}

// The setup's mean quality over all its counted runs that have one, decided once for headline and sensitivity.
function ceilingOf({ setup, above }, quals, summary, decimals) {
  const qs = summary.filter(run => run.cond === setup).map(run => quals[groupOf(run)]?.[setup]?.quality).filter(q => q !== undefined)
  const meanQ = qs.length ? mean(qs) : null
  return { setup, above, mean: meanQ, runs: qs.length, hit: meanQ !== null && round(meanQ, decimals) > above }
}

function statusOf({ cmp, n, floor, gap, hiddenOk, usage, ceiling, decimals }) {
  if (n < floor) return `not measured (${n} groups)`
  if (ceiling?.hit) return 'not measurable (scale ceiling)'
  if (!(round(gap, decimals) >= cmp.minGap) || !hiddenOk) return 'missed'
  if (usage?.ok === null) return 'not measured (usage)'
  return usage?.ok === false ? 'missed' : 'met'
}

// One comparison's result: the headline (faithful null) or the sensitivity check (faithful = the mode-check rows).
export function comparison({ cmp, quals, summary, faithful = null, rules = readBars() }) {
  const pairs = (mode, vs) => pairedGroups({ mode, vs, quals, summary, modeCheck: faithful })
  const groups = pairs(cmp.mode, cmp.vs)
  const n = groups.length
  if (n === 0) return { n: 0, status: faithful ? 'too few faithful groups (0)' : 'not measured (0 groups)' }
  const groupGaps = Object.fromEntries(groups.map(g => [g.group, g.mode.q.quality - g.vs.q.quality]))
  const stats = spread(Object.values(groupGaps), faithful ? 0 : rules.minGroups)
  const rate = side => round(mean(groups.map(g => g[side].run.hidden?.rate)), rules.hiddenDecimals)
  const hidden = { mode: rate('mode'), vs: rate('vs') }
  const hiddenOk = hidden.mode >= hidden.vs
  const usage = cmp.usage ? usageOf(cmp, groups, pairs, rules.statDecimals) : undefined
  const ceiling = cmp.ceiling ? ceilingOf(cmp.ceiling, quals, summary, rules.statDecimals) : undefined
  const status = statusOf({ cmp, n, floor: faithful ? 0 : rules.minGroups, gap: stats.gap, hiddenOk, usage, ceiling, decimals: rules.statDecimals })
  // The same comparison on the tests dimension: gap, SD and range, reported only.
  const tests = spread(groups.map(g => g.mode.q.tests - g.vs.q.tests), 0)
  return {
    mode: cmp.mode, vs: cmp.vs, n, groups: groups.map(g => g.group), groupGaps, ...stats,
    testsGap: tests.gap, testsSd: tests.sd, testsLo: tests.lo, testsHi: tests.hi,
    hidden, hiddenOk, ...(usage && { usage }), ...(ceiling && { ceiling }), status,
  }
}

// { [comparison name]: { headline, sensitivity } } for every comparison in the round's config.
export function bars({ config, quals, summary, modeCheck }) {
  return Object.fromEntries(config.comparisons.map(cmp => [cmp.name, {
    headline: comparison({ cmp, quals, summary, rules: config }),
    sensitivity: comparison({ cmp, quals, summary, faithful: modeCheck, rules: config }),
  }]))
}

const INPUTS = roundTag => [
  ['summary.json', 'node bench/score.mjs', 'array'],
  [`judge-${roundTag}.json`, `node bench/judge.mjs --round=${roundTag}`, 'array'],
  [`blind-key-${roundTag}.json`, `node bench/anonymize.mjs --round=${roundTag}`, 'object'],
  [`mode-check-${roundTag}.json`, `node bench/mode-check.mjs --round=${roundTag}`, 'object'],
]

function lineOf(name, kind, r) {
  const head = `${name.padEnd(9)}${kind.padEnd(12)}${r.label ?? r.status}`
  if (r.n === 0) return head
  const range = r.lo === null ? '' : ` [${shown(r.lo)}, ${shown(r.hi)}]`
  const ceiling = r.ceiling && `${r.ceiling.setup} mean ${r.ceiling.mean === null ? '–' : round(r.ceiling.mean, 2).toFixed(2)} (scale ceiling above ${r.ceiling.above.toFixed(2)})`
  const extra = [r.usage?.reading, ceiling].filter(Boolean).map(text => `  ${text}`).join('')
  return `${head}  n ${r.n}  gap ${shown(r.gap)}${range}  hidden ${r.hidden.mode} vs ${r.hidden.vs}${extra}`
}

// The committed held-out round, for its "more test lines" agreement.
function heldOutInputs(dir) {
  const read = (file, shape) => readInput(join(dir, file), 'the held-out data is committed in bench/data/heldout/', shape)
  return { summary: read('summary.json', 'array'), judgeRows: read('judge-ho.json', 'array'), key: read('blind-key-ho.json', 'object') }
}

export function main(argv = process.argv.slice(2), { results = RESULTS, heldout = HELDOUT } = {}) {
  const roundTag = argv.find(a => a.startsWith('--round='))?.slice(8) ?? ''
  if (!NAME.test(roundTag)) {
    console.error('usage: node bench/bars.mjs --round=<tag>   (letters and digits only)')
    process.exitCode = 1
    return
  }
  try {
    const config = readInput(configPath(roundTag), `round ${roundTag} has no pre-registered bars`, 'object')
    const [summary, judgeRows, key, modeCheck] = INPUTS(roundTag).map(([file, step, shape]) => readInput(join(results, file), `run ${step} first`, shape))
    const out = bars({ config, quals: qualities(judgeRows, key), summary, modeCheck })
    const judges = outsideJudges({ config, results })
    const report = outsideReport({ out, config, judges, judgeRows, key, summary, heldOut: heldOutInputs(heldout) })
    writeFileSync(join(results, `bars-${roundTag}.json`), JSON.stringify(report, null, 2) + '\n')
    for (const { name } of config.comparisons) {
      for (const kind of ['headline', 'sensitivity']) console.log(lineOf(name, kind, report[name][kind]))
      console.log(secondaryLine(name, report[name].headline))
    }
    console.log(outsideLine(report.outside))
  } catch (err) {
    console.error(`bars: ${err.message}`)
    process.exitCode = 1
  }
}

if (isMainModule(import.meta.url)) main()
