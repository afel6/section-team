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
import { anonymizeCommand } from './anonymize.mjs'
import { configPath, groupOf, mean, qualities, readBars, readInput, shown } from './bars-common.mjs'
import { outsideJudges, outsideLine, outsideReport, secondaryLine } from './bars-outside.mjs'
import { NAME, RESULTS } from './run.mjs'
import { required } from './section-memory.mjs'
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

// x half-up to d decimals, scaled first and then cut to 12 significant digits, so a decimal halfway value rounds up even
// when division or the scaling leaves it just under (1.1249999999999998 → 1.13; 1.255 × 100 = 125.49999999999999 → 1.26).
const tieSafeRound = (x, d) => Math.round(Number((x * 10 ** d).toPrecision(12))) / 10 ** d

// Mean cost of the mode's runs over the comparator's on `tasks` (tieSafeRound), and the ids of the priced runs whose
// cost was computed from transcripts; all null when a cost is unknown (never priced at $0).
function costRatio(groups, tasks, decimals) {
  const runs = groups.filter(g => tasks.includes(g.task))
  const costs = side => runs.map(g => g[side].run.costUSD)
  const known = runs.length > 0 && [...costs('mode'), ...costs('vs')].every(Number.isFinite) && mean(costs('vs')) > 0
  if (!known) return { modeCost: null, vsCost: null, ratio: null, computed: [] }
  const [modeCost, vsCost] = [mean(costs('mode')), mean(costs('vs'))]
  const computed = runs.flatMap(g => [g.mode.run, g.vs.run]).filter(run => run.costComputed === true).map(run => run.id)
  return { modeCost, vsCost, ratio: tieSafeRound(modeCost / vsCost, decimals), computed }
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

// ---- The nx round (bench/bars-nx.json, kind "nx"): team against base, point estimates on the bar's task. ----
// A bar that cannot be measured is missed, never met (plan §4).
const met = (ok, reading, extra = {}) => ({ status: ok ? 'met' : 'missed', reading, ...extra })
const unmeasured = why => ({ status: 'missed', reading: `not measured (${why})` })
const taskOfGroup = group => group.slice(0, group.lastIndexOf('-r'))
const runsOf = ({ summary, config }, setup, task) => summary.filter(run => run.cond === config.setups[setup] && (task === undefined || run.task === task))
const fixed = x => x.toFixed(2)

function costBar(bar, w) {
  const [mode, vs] = [bar.mode, bar.vs].map(setup => runsOf(w, setup, bar.task).map(run => run.costUSD))
  if (mode.length === 0 || vs.length === 0 || ![...mode, ...vs].every(Number.isFinite) || !(mean(vs) > 0)) return unmeasured('a cost is unknown')
  const ratio = tieSafeRound(mean(mode) / mean(vs), w.config.statDecimals)
  return met(ratio <= bar.maxRatio, `${bar.task} cost ${bar.mode}/${bar.vs} ${fixed(ratio)}× (at most ${fixed(bar.maxRatio)}×): $${fixed(mean(mode))} vs $${fixed(mean(vs))}`, { ratio })
}

// The bar's task's group gaps of the five-dimension means (bars-common qualities), mode minus vs, where both are judged.
function groupGaps(w, task, mode, vs) {
  const [m, v] = [mode, vs].map(setup => w.config.setups[setup])
  return Object.keys(w.quals).filter(group => taskOfGroup(group) === task).sort()
    .flatMap(group => (Number.isFinite(w.quals[group][m]?.quality) && Number.isFinite(w.quals[group][v]?.quality) ? [w.quals[group][m].quality - w.quals[group][v].quality] : []))
}

function qualityBar(bar, w) {
  const gaps = groupGaps(w, bar.task, bar.mode, bar.vs)
  if (gaps.length === 0) return unmeasured('no judged group')
  const s = spread(gaps, 0)
  const gap = round(s.gap, w.config.statDecimals)
  const range = s.lo === null ? '' : ` [${shown(s.lo)}, ${shown(s.hi)}]`
  return met(gap >= bar.minGap, `${bar.task} ${bar.mode} − ${bar.vs} ${shown(gap)}${range} over ${gaps.length} groups (at least ${shown(bar.minGap)})`, { gap, lo: s.lo, hi: s.hi, n: gaps.length })
}

// Mean hidden tests passed (counts, not rates: "base − 1" is one test).
const meanPassed = (w, setup, task) => {
  const passed = runsOf(w, setup, task).map(run => run.hidden?.pass)
  return passed.length > 0 && passed.every(Number.isFinite) ? mean(passed) : null
}

function hiddenBar(bar, w) {
  const mode = meanPassed(w, bar.mode, bar.task)
  const others = bar.atLeast.map(({ vs, minus }) => ({ vs, minus, value: meanPassed(w, vs, bar.task) }))
  if (mode === null || others.some(o => o.value === null)) return unmeasured('a hidden-test count is missing')
  const ok = others.every(o => mode >= o.value - o.minus)
  return met(ok, `${bar.task} hidden passed ${bar.mode} ${fixed(mode)} vs ${others.map(o => `${o.vs} ${fixed(o.value)}${o.minus ? ` − ${o.minus}` : ''}`).join(', ')}`, { mode, others })
}

// Near-misses its own suite caught (test-strength.mjs). A suite with no valid test file catches none; any other n/a
// (no run.json, no solution folder) leaves the bar not measured.
const caughtOf = row => (row?.reason === 'no valid test file' ? 0 : Number.isFinite(row?.caught) ? row.caught : null)
const meanCaught = (w, setup, task) => {
  const caught = runsOf(w, setup, task).map(run => caughtOf(w.strength[run.id]))
  return caught.length > 0 && caught.every(c => c !== null) ? mean(caught) : null
}

function nearMissBar(bar, w) {
  const [mode, vs] = [meanCaught(w, bar.mode, bar.task), meanCaught(w, bar.vs, bar.task)]
  if (mode === null || vs === null) return unmeasured('a near-miss count is missing')
  return met(mode >= vs - bar.minus, `${bar.task} near-misses caught ${bar.mode} ${fixed(mode)} vs ${bar.vs} ${fixed(vs)} − ${bar.minus}`, { mode, vs })
}

// Every counted run's validity row (mode-check.mjs with the round's pin); null when one has none.
const validities = (w, runs) => {
  const rows = runs.map(run => w.modeCheck[run.id]?.validity)
  return rows.every(Boolean) ? rows : null
}
const idsWhere = (w, runs, test) => runs.filter(run => test(w.modeCheck[run.id].validity)).map(run => run.id)

function validityBar(w, runs, { test, missing, okLine, badLine }) {
  if (validities(w, runs) === null) return unmeasured('a run has no validity row: run node bench/mode-check.mjs with the round\'s pin in results')
  if (missing) return unmeasured(missing)
  const bad = idsWhere(w, runs, test)
  return met(bad.length === 0, bad.length === 0 ? okLine : `${badLine}: ${bad.join(', ')}`, { runs: bad })
}

const allRuns = w => Object.keys(w.config.setups).flatMap(setup => runsOf(w, setup))

const VALIDITY_BARS = {
  leverFired: (bar, w) => {
    const runs = runsOf(w, bar.setup, bar.task)
    const want = w.config.tasks[bar.task].reps
    return validityBar(w, runs, { test: v => v.leverFired !== true, missing: runs.length < want ? `${runs.length} of ${want} ${bar.setup} ${bar.task} runs` : null, okLine: `all ${want} ${bar.setup} ${bar.task} runs spawned only the reviewer and built-ins`, badLine: 'spawned a section' })
  },
  controlValid: (bar, w) => {
    const runs = runsOf(w, bar.setup, bar.task)
    const kept = validities(w, runs) === null ? [] : idsWhere(w, runs, v => v.kept === 'V1b')
    const r = validityBar(w, runs, { test: v => v.void === 'V1b', okLine: `no ${bar.setup} ${bar.task} void is owed a rerun`, badLine: 'woke no builder: rerun once' })
    return kept.length ? { ...r, reading: `${r.reading}; kept after a rerun, reported: ${kept.join(', ')}` } : r
  },
  plainBaseline: (bar, w) => validityBar(w, runsOf(w, bar.setup), {
    test: v => (v.nonBuiltin ?? []).length > 0,
    missing: w.pin?.configDir && w.pin?.runsRoot ? null : 'the pin records no checked profile and runs root',
    okLine: 'profile and runs root checked by the preflight; no solo run spawned a non-built-in agent', badLine: 'spawned a non-built-in agent',
  }),
  commits: (bar, w) => validityBar(w, allRuns(w), { test: v => !v.commit.ok, okLine: 'every run\'s commit and version match its ref', badLine: 'commit or version differs from its ref' }),
  // V4: main and the sections declaring opus or claude-opus-* on the round's model (mode-check modelChecks); unread agent files miss it.
  models: (bar, w) => validityBar(w, allRuns(w), { test: v => v.offModel === null || v.offModel.length > 0, okLine: 'main and every opus section on the round\'s model', badLine: 'a turn on another model, or its agent files unread' }),
  timeLimits: (bar, w) => validityBar(w, allRuns(w), { test: v => v.timedOut, okLine: 'no run past its limit', badLine: 'timed out' }),
}

// Groups judged for every setup of the round, overall and on the bar's task.
function usableBar(bar, w) {
  const conds = Object.values(w.config.setups)
  const usable = Object.keys(w.quals).filter(group => conds.every(cond => Number.isFinite(w.quals[group][cond]?.quality)))
  const onTask = usable.filter(group => taskOfGroup(group) === bar.task).length
  const total = Object.values(w.config.tasks).reduce((sum, task) => sum + task.reps, 0)
  const taskTotal = w.config.tasks[bar.task].reps
  return met(usable.length >= bar.min && onTask >= bar.minTask, `${usable.length} of ${total} groups usable (at least ${bar.min}), ${onTask} of ${taskTotal} on ${bar.task} (at least ${bar.minTask})`, { usable: usable.length, onTask })
}

const BAR_KINDS = { cost: costBar, quality: qualityBar, hidden: hiddenBar, nearMiss: nearMissBar, usableGroups: usableBar, ...VALIDITY_BARS }

// h9 and h10: reported checks of the unchanged paths (team against base), never a bar.
function reportedCheck(entry, w) {
  const cost = costBar({ ...entry, maxRatio: Infinity }, w)
  const quality = qualityBar({ ...entry, minGap: -Infinity }, w)
  const costRatio = cost.ratio ?? null
  const gap = quality.gap ?? null
  return {
    task: entry.task, costRatio, gap, costRange: entry.costRange, minGap: entry.minGap,
    costInRange: costRatio === null ? null : costRatio >= entry.costRange[0] && costRatio <= entry.costRange[1],
    gapOk: gap === null ? null : gap >= entry.minGap,
    hidden: Object.fromEntries(Object.keys(w.config.setups).map(setup => [setup, meanPassed(w, setup, entry.task)])),
    nearMisses: Object.fromEntries(Object.keys(w.config.setups).map(setup => [setup, meanCaught(w, setup, entry.task)])),
  }
}

// { bars: { [id]: { status, reading, ... } }, keep: { decision, missed }, reported: [...] } for the nx round. w holds
// the config, summary.json rows, the judge's qualities, mode-check rows (with validity), test-strength rows and the pin.
export function barsNx(w) {
  const out = Object.fromEntries(w.config.bars.map(bar => [bar.id, { kind: bar.kind, ...BAR_KINDS[bar.kind](bar, w) }]))
  const missed = w.config.keep.filter(id => out[id].status !== 'met')
  return { bars: out, keep: { decision: missed.length === 0 ? 'keep L1' : 'revert L1 (merge revert/l1)', missed }, reported: w.config.reported.map(entry => reportedCheck(entry, w)) }
}

const INPUTS = roundTag => [
  ['summary.json', 'node bench/score.mjs', 'array'],
  [`judge-${roundTag}.json`, `node bench/judge.mjs --round=${roundTag}`, 'array'],
  [`blind-key-${roundTag}.json`, anonymizeCommand(roundTag), 'object'],
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

// The nx round's inputs: the scores, the outside judge's imported verdicts and key, mode-check (with validity), test
// strength and the round's pin; it writes results/bars-<round>.json and prints a line per bar, the keep decision and
// the reported checks.
const NX_INPUTS = (roundTag, judge) => [
  ['summary.json', 'node bench/score.mjs', 'array'],
  [`judge-${judge}.json`, `node bench/external-judge.mjs import --round=${roundTag} --out=<case set> --as=${judge}`, 'array'],
  [`blind-key-${judge}.json`, `node bench/external-judge.mjs import --round=${roundTag} --out=<case set> --as=${judge}`, 'object'],
  [`mode-check-${roundTag}.json`, `node bench/mode-check.mjs --round=${roundTag}`, 'object'],
  [`test-strength-${roundTag}.json`, `node bench/test-strength.mjs --round=${roundTag}`, 'object'],
  [`preflight-${roundTag}.json`, `node bench/preflight.mjs --round=${roundTag}`, 'object'],
]

function nxMain(roundTag, config, results) {
  const [summary, judgeRows, key, modeCheck, strength, pin] = NX_INPUTS(roundTag, config.judge.round).map(([file, step, shape]) => readInput(join(results, file), `run ${step} first`, shape))
  const out = barsNx({ config, summary, quals: qualities(judgeRows, key), modeCheck, strength, pin })
  writeFileSync(join(results, `bars-${roundTag}.json`), JSON.stringify(out, null, 2) + '\n')
  for (const [id, bar] of Object.entries(out.bars)) console.log(`${id.padEnd(5)}${bar.status.padEnd(8)}${bar.reading}`)
  console.log(`keep rule: ${out.keep.decision}${out.keep.missed.length ? ` (missed ${out.keep.missed.join(', ')})` : ''}`)
  for (const r of out.reported) {
    const cost = r.costRatio === null ? 'cost not measured' : `cost ${fixed(r.costRatio)}× base${r.costInRange ? '' : ` (outside ${r.costRange.join('-')})`}`
    const gap = r.gap === null ? 'quality not measured' : `quality ${shown(r.gap)}${r.gapOk ? '' : ` (below ${shown(r.minGap)})`}`
    console.log(`reported ${r.task}: ${cost}, ${gap}`)
  }
}

// The committed held-out round, for its "more test lines" agreement.
function heldOutInputs(dir) {
  const read = (file, shape) => readInput(join(dir, file), 'the held-out data is committed in bench/data/heldout/', shape)
  return { summary: read('summary.json', 'array'), judgeRows: read('judge-ho.json', 'array'), key: read('blind-key-ho.json', 'object') }
}

export function main(argv = process.argv.slice(2), { results, heldout = HELDOUT } = {}) {
  required({ results })
  const roundTag = argv.find(a => a.startsWith('--round='))?.slice(8) ?? ''
  if (!NAME.test(roundTag)) {
    console.error('usage: node bench/bars.mjs --round=<tag>   (letters and digits only)')
    process.exitCode = 1
    return
  }
  try {
    const config = readInput(configPath(roundTag), `round ${roundTag} has no pre-registered bars`, 'object')
    if (config.kind === 'nx') return nxMain(roundTag, config, results)
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

if (isMainModule(import.meta.url)) main(process.argv.slice(2), { results: RESULTS })
