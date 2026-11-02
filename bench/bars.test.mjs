import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { qualities, readBars } from './bars-common.mjs'
import { bars, comparison, main } from './bars.mjs'
import { round, sampleSD, signTestP, tCrit975 } from './stats.mjs'

const CONFIG = readBars()
const cmpOf = name => CONFIG.comparisons.find(c => c.name === name)
const GROUPS = ['h4-r1', 'h4-r2', 'h4-r3', 'h5-r1', 'h5-r2', 'h5-r3', 'h6-r1', 'h6-r2', 'h6-r3']
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} is not ${expected}`)

// One counted run (a summary.json row) of `cond` in `group`.
function runRow(group, cond, { cost = 1, rate = 1, testLines = 100 } = {}) {
  const [task, rep] = group.split('-r')
  return { id: `${task}-${cond}-r${rep}`, task, cond, rep: Number(rep), costUSD: cost, costComputed: false, hidden: { tests: 10, pass: 10 * rate, fail: 10 - 10 * rate, rate }, code: { testLines } }
}

// Qualities and counted runs in every group; each value is one number for all groups or an array with one per group.
function world(conds, groups = GROUPS) {
  const at = (v, i) => (Array.isArray(v) ? v[i] : v)
  const quals = Object.fromEntries(groups.map((g, i) => [g, Object.fromEntries(Object.entries(conds)
    .map(([cond, s]) => [cond, { quality: at(s.q, i), tests: at(s.tests ?? s.q, i), judges: 2 }]))]))
  const summary = groups.flatMap((g, i) => Object.entries(conds).map(([cond, s]) => runRow(g, cond, { cost: at(s.cost ?? 1, i), rate: at(s.rate ?? 1, i) })))
  return { quals, summary }
}
const without = (summary, ...ids) => summary.filter(r => !ids.includes(r.id))
const run = (name, { quals, summary }, faithful = null) => comparison({ cmp: cmpOf(name), quals, summary, faithful, rules: CONFIG })

const DIMS = ['correctness', 'codeQuality', 'tests', 'robustnessSecurity', 'docsUsability']
const scores = digits => ({ ...Object.fromEntries(DIMS.map((d, i) => [d, Number(digits[i])])), overall: Number(digits[0]), notes: '' })
const KEY = Object.fromEntries(GROUPS.map(g => [g, { W: 'lean-mo', X: 'solo-mo' }]))
// Per group: lean's (W) and solo's (X) scores from judges 1 and 2. The group gaps sum to 2.7, so the gap is exactly 27/90.
const JUDGED = [
  [['99998', '99899'], ['99898', '98988']], [['76667', '76766'], ['77666', '76766']], [['88788', '87787'], ['78777', '77778']],
  [['67777', '76766'], ['66676', '76666']], [['67667', '77777'], ['66767', '67767']], [['88888', '87887'], ['87887', '78877']],
  [['77667', '76777'], ['67666', '66666']], [['78788', '78777'], ['88777', '77777']], [['76776', '77777'], ['66767', '77766']],
]
const JUDGE_ROWS = JUDGED.flatMap(([lean, solo], i) => [0, 1].map(j => ({ pair: GROUPS[i], W: scores(lean[j]), X: scores(solo[j]), ranking: ['W', 'X'], judge: j + 1 })))
const LEAN_SOLO_RUNS = GROUPS.flatMap(g => [runRow(g, 'lean-mo'), runRow(g, 'solo-mo')])

test('bench/bars-mo.json holds the pre-registered values exactly', () => {
  assert.deepEqual(CONFIG, {
    round: 'mo', statDecimals: 2, hiddenDecimals: 4, minGroups: 6, confirmShare: 0.75,
    comparisons: [
      { name: 'lean', mode: 'lean-mo', vs: 'solo-mo', minGap: 0.30, usage: { tasks: ['h5', 'h6'], maxRatio: 1.50, reportVs: { task: 'h4', setup: 'team-mo' } } },
      { name: 'balanced', mode: 'team-mo', vs: 'solo-mo', minGap: 0.50 },
      { name: 'max', mode: 'max-mo', vs: 'team-mo', minGap: 0.30, ceiling: { setup: 'team-mo', above: 8.60 } }],
    outside: [
      { name: 'Codex', heldOut: 'hocx', round: 'mocx', set: 'C:/Users/Asus/codex-judge-mo' },
      { name: 'Antigravity', heldOut: 'hoag2', round: 'moag', set: 'C:/Users/Asus/ag-judge-mo' }],
  })
})

test('a gap of exactly 27/90 meets +0.30 after rounding', () => {
  const r = comparison({ cmp: cmpOf('lean'), quals: qualities(JUDGE_ROWS, KEY), summary: LEAN_SOLO_RUNS, rules: CONFIG })
  assert.equal(r.n, 9)
  close(r.gap, 27 / 90)
  assert.ok(r.gap < 0.3, `the summed gap ${r.gap} lands just below 0.3, so only rounding meets the bar`)
  assert.equal(r.status, 'met')
})

test('range uses t(8)=2.306 with 9 groups, and t(4)=2.776 for a 5-group sensitivity check', () => {
  const gaps = [0.2, 0.4, 0.6, 0.2, 0.4, 0.6, 0.2, 0.4, 0.6]
  const w = world({ 'team-mo': { q: gaps.map(g => 7 + g) }, 'solo-mo': { q: 7 } })
  const r = run('balanced', w)
  close(r.sd, Math.sqrt(0.03))
  close(r.lo, 0.4 - 2.306 * Math.sqrt(0.03) / 3)
  close(r.hi, 0.4 + 2.306 * Math.sqrt(0.03) / 3)
  assert.equal(r.includesZero, false)
  // A lower end exactly at 0 includes 0.
  const flat = run('balanced', world({ 'team-mo': { q: 7 }, 'solo-mo': { q: 7 } }))
  assert.deepEqual([flat.lo, flat.includesZero], [0, true])
  const faithful = Object.fromEntries(GROUPS.map((g, i) => [runRow(g, 'team-mo').id, { faithful: i < 5 }]))
  const s = run('balanced', w, faithful)
  assert.equal(s.n, 5)
  close(s.gap, 0.36)
  close(s.hi, 0.36 + 2.776 * Math.sqrt(0.028) / Math.sqrt(5))
  assert.equal(s.status, 'missed')
})

test('tCrit975 is the two-sided 95% table for df 1 to 8 and throws outside it', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(tCrit975), [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306])
  for (const df of [0, 9, 1.5, '3']) assert.throws(() => tCrit975(df), RangeError)
})

test('fewer than 6 headline groups is not measured with no range', () => {
  const w = world({ 'team-mo': { q: 9 }, 'solo-mo': { q: 7 } })
  const drop = groups => without(w.summary, ...groups.map(g => runRow(g, 'team-mo').id))
  const five = run('balanced', { ...w, summary: drop(['h4-r1', 'h4-r2', 'h4-r3', 'h5-r1']) })
  assert.equal(five.n, 5)
  assert.equal(five.status, 'not measured (5 groups)')
  assert.deepEqual([five.sd, five.lo, five.hi, five.includesZero], [null, null, null, null])
  const six = run('balanced', { ...w, summary: drop(['h4-r1', 'h4-r2', 'h4-r3']) })
  assert.equal(six.status, 'met')
  close(six.lo, 2)
  assert.deepEqual(run('balanced', { ...w, summary: [] }), { n: 0, status: 'not measured (0 groups)' })
})

test('sensitivity with 1 or 0 faithful groups reports without throwing', () => {
  const w = world({ 'lean-mo': { q: 8 }, 'solo-mo': { q: 7 } })
  const one = run('lean', w, { 'h5-lean-mo-r1': { faithful: true } })
  assert.equal(one.n, 1)
  close(one.gap, 1)
  assert.deepEqual([one.sd, one.lo, one.hi, one.includesZero], [null, null, null, null])
  assert.equal(one.status, 'met')
  assert.deepEqual(run('lean', w, {}), { n: 0, status: 'too few faithful groups (0)' })
})

test('Balanced at 8.61 makes Max not measurable; at 8.60 it is measured', () => {
  const at860 = [8.4, 8.8, 8.5, 8.7, 8.6, 8.6, 8.6, 8.6, 8.6]
  const w = world({ 'max-mo': { q: at860.map(q => q + 0.5) }, 'team-mo': { q: at860 } })
  // A Balanced quality with no counted run is not one of Balanced's counted runs.
  const quals = { ...w.quals, 'h7-r1': { 'team-mo': { quality: 10, tests: 10, judges: 2 } } }
  const measured = run('max', { quals, summary: w.summary })
  assert.ok(measured.ceiling.mean > 8.6, 'the float mean lands just above 8.60, so only rounding keeps Max measured')
  assert.equal(measured.ceiling.hit, false)
  assert.equal(measured.status, 'met')

  const at861 = [8.7, 8.6, 8.6, 8.6, 8.6, 8.6, 8.6, 8.6, 8.6]
  const high = world({ 'max-mo': { q: at861.map(q => q + 0.5) }, 'team-mo': { q: at861 } })
  // The 8.70 group has no counted Max run: it leaves the comparison and still counts toward Balanced's mean.
  const summary = without(high.summary, 'h4-max-mo-r1')
  const capped = run('max', { quals: high.quals, summary })
  assert.equal(capped.n, 8)
  close(capped.ceiling.mean, 77.5 / 9)
  assert.equal(capped.ceiling.hit, true)
  assert.equal(capped.status, 'not measurable (scale ceiling)')
  // Without the unfaithful 8.70 run Balanced's mean would be 68.8 / 8 = 8.60 and Max measured: the ceiling is decided
  // once, over every counted Balanced run, for the headline and the sensitivity check alike.
  const faithful = Object.fromEntries(summary.map(r => [r.id, { faithful: r.id !== 'h4-team-mo-r1' }]))
  const sensitivity = run('max', { quals: high.quals, summary }, faithful)
  assert.equal(sensitivity.n, 8, 'the h4-r1 group is already out, so every other group is still compared')
  assert.equal(sensitivity.status, 'not measurable (scale ceiling)')
})

test('hidden-test rule fails a mode with a lower pass rate', () => {
  // Solo's rate-0 run sits in a group without a Balanced run, so it is not part of the comparison.
  const w = world({ 'team-mo': { q: 8, rate: 0.9 }, 'solo-mo': { q: 7, rate: [0, 1, 1, 1, 1, 1, 1, 1, 1] } })
  const r = run('balanced', { ...w, summary: without(w.summary, 'h4-team-mo-r1') })
  assert.deepEqual(r.hidden, { mode: 0.9, vs: 1 })
  assert.equal(r.hiddenOk, false)
  assert.equal(r.status, 'missed')
  const near = run('balanced', world({ 'team-mo': { q: 8, rate: 0.66671 }, 'solo-mo': { q: 7, rate: 0.66674 } }))
  assert.deepEqual(near.hidden, { mode: 0.6667, vs: 0.6667 })
  assert.equal(near.hiddenOk, true)
  assert.equal(near.status, 'met')
})

const usageWorld = (lean, { solo = [1, 1, 1, 2, 2, 2, 2, 2, 2], leanH4 = 100 } = {}) => world({
  'lean-mo': { q: 8, cost: [leanH4, leanH4, leanH4, lean, lean, lean, lean, lean, lean] },
  'solo-mo': { q: 7, cost: solo },
  'team-mo': { q: 8, cost: 50 },
})

test('Lean usage 1.50 meets and 1.51 misses', () => {
  const meets = run('lean', usageWorld(3))
  assert.equal(meets.usage.ratio, 1.5)
  assert.equal(meets.usage.ok, true)
  assert.equal(meets.status, 'met')
  assert.deepEqual(meets.usage.reportVs, { task: 'h4', setup: 'team-mo', ratio: 2 })
  assert.equal(run('lean', usageWorld(3.009)).usage.ratio, 1.5)
  const misses = run('lean', usageWorld(3.02))
  assert.equal(misses.usage.ratio, 1.51)
  assert.equal(misses.usage.ok, false)
  assert.equal(misses.status, 'missed')
})

// Float division can land just under a halfway value: 0.54 / 0.48 is 1.1249999999999998, which must round to 1.13.
test('the usage ratio rounds a value that is halfway in decimal up, as the rounding rule says', () => {
  const r = run('lean', usageWorld(0.09, { solo: [1, 1, 1, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08] }))
  assert.equal(r.usage.modeCost / r.usage.vsCost, 1.1249999999999998)
  assert.equal(r.usage.ratio, 1.13)
  // 2.51 / 2 is 1.255 exactly as stored, but 1.255 × 100 is 125.49999999999999: the cut must come after scaling.
  const scaled = run('lean', usageWorld(2.51))
  assert.equal(scaled.usage.modeCost / scaled.usage.vsCost, 1.255)
  assert.equal(scaled.usage.ratio, 1.26)
})

test('the usage reading adds the h4 ratio against Balanced and names the runs priced from transcripts', () => {
  const w = usageWorld(3)
  const computed = ['h5-lean-mo-r2', 'h4-team-mo-r1']
  const summary = w.summary.map(r => (computed.includes(r.id) ? { ...r, costComputed: true } : r))
  const r = run('lean', { ...w, summary })
  assert.equal(r.usage.reading, 'usage 1.50× solo-mo (at most 1.50×)  h4 vs team-mo 2.00× (computed costs: h4-team-mo-r1, h5-lean-mo-r2)')
  assert.deepEqual(r.usage.computedCosts, ['h4-team-mo-r1', 'h5-lean-mo-r2'])
  assert.equal(run('lean', usageWorld(3)).usage.reading, 'usage 1.50× solo-mo (at most 1.50×)  h4 vs team-mo 2.00×')
  const noH4 = run('lean', usageWorld(3, { leanH4: null }))
  assert.equal(noH4.usage.reading, 'usage 1.50× solo-mo (at most 1.50×)')
})

test('an unknown cost leaves the usage not measured instead of pricing it at $0', () => {
  for (const unknown of [null, NaN]) {
    const r = run('lean', usageWorld(3, { solo: [1, 1, 1, unknown, 2, 2, 2, 2, 2] }))
    assert.deepEqual([r.usage.ratio, r.usage.ok, r.usage.reading], [null, null, 'usage not measured  h4 vs team-mo 2.00×'])
    assert.equal(r.status, 'not measured (usage)')
    const h4 = run('lean', usageWorld(3, { leanH4: unknown }))
    assert.equal(h4.usage.ratio, 1.5)
    assert.equal(h4.usage.reportVs.ratio, null)
    assert.equal(h4.status, 'met')
  }
  const weak = world({ 'lean-mo': { q: 7.1, cost: 3 }, 'solo-mo': { q: 7, cost: [1, 1, 1, null, 2, 2, 2, 2, 2] } })
  assert.equal(run('lean', weak).status, 'missed')
})

test('the sensitivity check takes usage and the h4 report over faithful groups only', () => {
  const w = world({ 'lean-mo': { q: 8, cost: [100, 100, 40, 6, 3, 3, 3, 3, 3] }, 'solo-mo': { q: 7, cost: [1, 1, 1, 2, 2, 2, 2, 2, 2] }, 'team-mo': { q: 8, cost: 50 } })
  const unfaithful = ['h5-lean-mo-r1', 'h4-team-mo-r3']
  const modeCheck = Object.fromEntries(w.summary.filter(r => r.cond !== 'solo-mo').map(r => [r.id, { faithful: !unfaithful.includes(r.id) }]))
  const { headline, sensitivity } = bars({ config: CONFIG, ...w, modeCheck }).lean
  assert.deepEqual([headline.usage.ratio, headline.usage.reportVs.ratio, headline.status], [1.75, 1.6, 'missed'])
  assert.deepEqual([sensitivity.usage.ratio, sensitivity.usage.reportVs.ratio, sensitivity.status], [1.5, 2, 'met'])
})

test('testsGap is the same comparison on the tests dimension', () => {
  const r = run('balanced', world({ 'team-mo': { q: 8, tests: [9, 9, 9, 8, 8, 8, 7, 7, 7] }, 'solo-mo': { q: 7, tests: 6 } }))
  close(r.testsGap, 2)
  const sd = sampleSD([3, 3, 3, 2, 2, 2, 1, 1, 1])
  close(r.testsSd, sd)
  close(r.testsLo, 2 - (tCrit975(8) * sd) / 3)
  close(r.testsHi, 2 + (tCrit975(8) * sd) / 3)
  const one = run('balanced', world({ 'team-mo': { q: 8, tests: 9 }, 'solo-mo': { q: 7, tests: 6 } }, ['h4-r1']))
  assert.deepEqual([one.testsGap, one.testsSd, one.testsLo, one.testsHi], [3, null, null, null], 'one group has no spread')
  const judgedTests = comparison({ cmp: cmpOf('lean'), quals: qualities(JUDGE_ROWS, KEY), summary: LEAN_SOLO_RUNS, rules: CONFIG })
  // Tests scores (third digit) summed over both judges and all groups: lean 128, solo 126, so (128 - 126) / 2 / 9.
  close(judgedTests.testsGap, 1 / 9)
})

test('a judged score that is not a number stops the bars with one line', () => {
  const rows = [{ ...JUDGE_ROWS[0], X: { ...JUDGE_ROWS[0].X, tests: 'n/a' } }]
  assert.throws(() => qualities(rows, KEY), { message: 'judge row h4-r1 judge 1: X has a score that is not a number' })
  // Past that check, a gap that is not a number still never meets a bar.
  assert.equal(run('balanced', world({ 'team-mo': { q: NaN }, 'solo-mo': { q: 7 } })).status, 'missed')
})

test('a group with one usable judge counts with that judge', () => {
  const rows = [...JUDGE_ROWS.filter(r => !(r.pair === 'h4-r2' && r.judge === 2)), { pair: 'h9-r1', W: scores('11111'), ranking: ['W'], judge: 1 }]
  const quals = qualities(rows, KEY)
  assert.deepEqual(quals['h4-r1']['lean-mo'], { quality: 8.8, tests: 8.5, judges: 2 })
  assert.deepEqual(quals['h4-r2'], { 'lean-mo': { quality: 6.4, tests: 6, judges: 1 }, 'solo-mo': { quality: 6.4, tests: 6, judges: 1 } })
  assert.equal(quals['h9-r1'], undefined)
  const r = comparison({ cmp: cmpOf('lean'), quals, summary: LEAN_SOLO_RUNS, rules: CONFIG })
  assert.equal(r.n, 9)
  assert.equal(r.groupGaps['h4-r2'], 0)
})

test('a group with a quality but no counted run on one side, or runs but no quality, is left out', () => {
  const w = world({ 'lean-mo': { q: 8 }, 'solo-mo': { q: 7 } })
  const { 'h6-r3': _gone, ...rest } = w.quals
  const quals = { ...rest, 'h5-r2': { 'solo-mo': w.quals['h5-r2']['solo-mo'] } }
  const r = run('lean', { quals, summary: without(w.summary, 'h4-solo-mo-r1') })
  assert.deepEqual(r.groups, ['h4-r2', 'h4-r3', 'h5-r1', 'h5-r3', 'h6-r1', 'h6-r2'])
  assert.equal(r.status, 'met')
})

test('sensitivity drops groups with an unfaithful run and leaves the headline unchanged', () => {
  const w = world({ 'solo-mo': { q: 7 }, 'lean-mo': { q: 8 }, 'team-mo': { q: 8 }, 'max-mo': { q: 8.5 } })
  // Solo runs need no mode-check row: solo is always faithful.
  const allFaithful = Object.fromEntries(w.summary.filter(r => r.cond !== 'solo-mo').map(r => [r.id, { faithful: true }]))
  const { 'h6-lean-mo-r2': _missing, ...rest } = allFaithful
  const some = { ...rest, 'h5-lean-mo-r1': { faithful: false } }
  const before = bars({ config: CONFIG, ...w, modeCheck: allFaithful })
  const after = bars({ config: CONFIG, ...w, modeCheck: some })
  assert.deepEqual(after.lean.headline, before.lean.headline)
  assert.equal(before.lean.sensitivity.n, 9)
  assert.equal(after.lean.sensitivity.n, 7)
  assert.equal(after.lean.sensitivity.groups.includes('h5-r1'), false)
  assert.equal(after.balanced.sensitivity.n, 9)
})

test('signTestP(8,1) === 0.0390625', () => {
  assert.equal(signTestP(8, 1), 0.0390625)
  assert.equal(signTestP(1, 8), 0.0390625)
  assert.equal(signTestP(3, 0), 0.25)
  assert.equal(signTestP(5, 5), 1)
  assert.equal(signTestP(0, 0), 1)
  for (const bad of [[-1, 2], [1.5, 2], [2, '1']]) assert.throws(() => signTestP(...bad), RangeError)
})

test('sampleSD divides by n-1 and round rounds half-up to d decimals', () => {
  close(sampleSD([2, 4, 4, 4, 5, 5, 7, 9]), Math.sqrt(32 / 7))
  assert.throws(() => sampleSD([1]), RangeError)
  assert.equal(round(0.29999999999999993, 2), 0.3)
  assert.equal(round(0.66671, 4), 0.6667)
  assert.equal(round(1.5045, 2), 1.5)
})

const CLI_CONDS = { W: 'solo-mo', X: 'lean-mo', Y: 'team-mo', Z: 'max-mo' }
const CLI_KEY = Object.fromEntries(GROUPS.map(g => [g, CLI_CONDS]))
const CLI_DIGITS = { W: '77777', X: '88888', Y: '88888', Z: '99999' }
const CLI_ROWS = GROUPS.flatMap(pair => [1, 2].map(judge => ({ pair, judge, ranking: ['Z', 'Y', 'X', 'W'], ...Object.fromEntries(Object.entries(CLI_DIGITS).map(([l, d]) => [l, scores(d)])) })))

// A round where every judge scores max 9, lean and team 8, solo 7; max-mo runs have 200 test lines, the rest 100.
function resultsDir(t, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bench-bars-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const summary = GROUPS.flatMap(g => Object.values(CLI_CONDS).map(cond => runRow(g, cond, { cost: 2, testLines: cond === 'max-mo' ? 200 : 100 })))
  const modeCheck = Object.fromEntries(summary.map(r => [r.id, { cond: r.cond, task: r.task, faithful: r.id !== 'h4-max-mo-r1', broken: [], tier: null }]))
  const files = { 'summary.json': summary, 'judge-mo.json': CLI_ROWS, 'blind-key-mo.json': CLI_KEY, 'mode-check-mo.json': modeCheck, ...extra }
  for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(data))
  return dir
}

function runMain(t, argv, results) {
  const logs = []
  const errors = []
  t.mock.method(console, 'log', line => logs.push(line))
  t.mock.method(console, 'error', line => errors.push(line))
  const before = process.exitCode
  main(argv, { results })
  const exitCode = process.exitCode
  process.exitCode = before
  return { logs, errors, exitCode }
}

test('the CLI writes results/bars-mo.json with headline and sensitivity per comparison', t => {
  const results = resultsDir(t)
  const { logs, errors, exitCode } = runMain(t, ['--round=mo'], results)
  assert.deepEqual([errors, exitCode], [[], undefined])
  const out = JSON.parse(readFileSync(join(results, 'bars-mo.json'), 'utf8'))
  assert.deepEqual(Object.keys(out), ['lean', 'balanced', 'max', 'outside'])
  assert.deepEqual(['lean', 'balanced', 'max'].map(name => out[name]).map(c => [c.headline.status, c.headline.n, c.sensitivity.n]), [['met', 9, 9], ['met', 9, 9], ['met', 9, 8]])
  assert.equal(logs.length, 10)
  assert.match(logs[0], /^lean +headline +met, not outside-confirmed \(no outside judge passed its held-out check\) +n 9 +gap \+1\.00/)
  assert.match(logs[1], /^lean +sensitivity +met +n 9 +gap \+1\.00/)
})

test('the CLI adds each headline label, outside confirmation, rank wins and size effect, and the outside judges', t => {
  const PASSED = { gap: 0.93, same: 8, pairs: 9, passed: true }
  const cases = Array.from({ length: 18 }, (_, i) => ({ case: `case-${String(i + 1).padStart(2, '0')}`, pair: GROUPS[i >> 1], judge: (i % 2) + 1 }))
  const codexRows = CLI_ROWS.map((row, i) => ({ ...row, case: cases[i].case }))
  const results = resultsDir(t, { 'outside-check-ho-hocx.json': PASSED, 'judge-mocx.json': codexRows, 'blind-key-mocx.json': CLI_KEY, 'external-key-mo.json': cases })
  const { logs, errors, exitCode } = runMain(t, ['--round=mo'], results)
  assert.deepEqual([errors, exitCode], [[], undefined])
  const out = JSON.parse(readFileSync(join(results, 'bars-mo.json'), 'utf8'))
  const lean = out.lean.headline
  assert.equal(lean.label, 'met, outside-confirmed')
  assert.deepEqual(lean.outside, {
    Codex: { status: 'usable', passedHeldOut: true, counts: true, gap: 1, n: 9, agree: 9, needed: 7, gapsSameSign: true, confirmed: true },
    Antigravity: { status: 'not used', passedHeldOut: false, counts: false },
  })
  assert.deepEqual(lean.rankWins, { for: 9, against: 0, split: 0, marked: [], p: 0.00390625, judgments: { for: 18, against: 0 } })
  assert.deepEqual([lean.sizeEffect, out.max.headline.sizeEffect], [{ agree: 0, n: 9 }, { agree: 9, n: 9 }])
  assert.deepEqual(['label', 'outside', 'rankWins', 'sizeEffect'].filter(k => k in out.lean.sensitivity), [])
  assert.deepEqual(out.outside, {
    judges: [
      { name: 'Codex', passedHeldOut: true, status: 'usable', usableCases: 18, total: 18, check: PASSED },
      { name: 'Antigravity', passedHeldOut: false, status: 'not used', usableCases: 0, total: null, check: null }],
    sizeEffectHeldOut: { agree: 8, pairs: 9 },
  })
  assert.equal(logs.length, 10)
  assert.match(logs[0], /^lean +headline +met, outside-confirmed +n 9 +gap \+1\.00/)
  assert.match(logs[0], / +usage 1\.00× solo-mo \(at most 1\.50×\) +h4 vs team-mo 1\.00×$/)
  assert.match(logs[2], /^lean +secondary +rank wins 9-0, 0 split, p 0\.0039 +judgments 18-0 +more test lines 0 of 9 +tests gap \+1\.00 \[\+1\.00, \+1\.00\] +Codex 9 of 9 groups, gap \+1\.00$/)
  assert.match(logs[8], /^max +secondary +rank wins 9-0, 0 split, p 0\.0039 +judgments 18-0 +more test lines 9 of 9 +tests gap \+1\.00 \[\+1\.00, \+1\.00\] +Codex 9 of 9 groups, gap \+1\.00$/)
  assert.equal(logs[9], 'outside              Codex held-out passed (gap +0.93, same winner 8 of 9), usable; Antigravity no held-out check, not used; more test lines 8 of 9 (held-out)')
})

test('the CLI names the step that makes a missing input, and refuses a bad round', t => {
  const results = resultsDir(t)
  rmSync(join(results, 'mode-check-mo.json'))
  const missing = runMain(t, ['--round=mo'], results)
  assert.equal(missing.exitCode, 1)
  assert.equal(missing.errors.length, 1)
  assert.match(missing.errors[0], /^bars: missing .*mode-check-mo\.json: run node bench\/mode-check\.mjs --round=mo first$/)
  const bad = runMain(t, ['--round=../x'], results)
  assert.equal(bad.exitCode, 1)
  assert.match(bad.errors[0], /^usage: node bench\/bars\.mjs --round=<tag>/)
})

test('the CLI stops with one line on broken JSON, a folder in place of a file, or the wrong JSON shape', t => {
  const results = resultsDir(t)
  writeFileSync(join(results, 'summary.json'), '{"rows":\n[')
  const broken = runMain(t, ['--round=mo'], results)
  assert.equal(broken.exitCode, 1)
  assert.match(broken.errors.join('\n'), /^bars: .*summary\.json is not valid JSON$/)
  writeFileSync(join(results, 'summary.json'), '{}')
  assert.match(runMain(t, ['--round=mo'], results).errors.join('\n'), /^bars: .*summary\.json is not a JSON array$/)
  writeFileSync(join(results, 'summary.json'), '[]')
  rmSync(join(results, 'judge-mo.json'))
  mkdirSync(join(results, 'judge-mo.json'))
  const folder = runMain(t, ['--round=mo'], results)
  assert.equal(folder.exitCode, 1)
  assert.match(folder.errors.join('\n'), /^bars: cannot read .*judge-mo\.json \(EISDIR\)$/)
})
