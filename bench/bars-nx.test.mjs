// The nx round's pre-registered bars (bench/bars-nx.json) and its keep rule: each bar met on a world that meets them all,
// and missed on a world broken in that bar alone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { qualities, readBars } from './bars-common.mjs'
import { barsNx, main } from './bars.mjs'

const CONFIG = readBars(new URL('./bars-nx.json', import.meta.url))
const SETUPS = { solo: 'solo-nx', base: 'base-nx', team: 'team-nx' }
const GROUPS = [...[1, 2, 3, 4, 5].map(r => `h8-r${r}`), 'h9-r1', 'h9-r2', 'h10-r1', 'h10-r2']
const COST = { h8: { solo: 0.5, base: 1.5, team: 1.0 }, h9: { solo: 0.9, base: 2.7, team: 2.7 }, h10: { solo: 0.9, base: 6.4, team: 6.4 } }
const taskOf = group => group.slice(0, group.lastIndexOf('-r'))
const idOf = (group, setup) => `${taskOf(group)}-${SETUPS[setup]}-r${group.slice(group.lastIndexOf('-r') + 2)}`
const GOOD_VALIDITY = { spawned: [], leverFired: null, wokeBuilder: false, nonBuiltin: null, void: null, kept: null, commit: { ok: true, want: null, got: null }, offModel: [], timedOut: false }

// A world where every bar is met; change(world) breaks it.
function world() {
  const summary = GROUPS.flatMap(group => Object.keys(SETUPS).map(setup => ({
    id: idOf(group, setup), task: taskOf(group), cond: SETUPS[setup], rep: Number(group.split('-r')[1]), costUSD: COST[taskOf(group)][setup], hidden: { tests: 20, pass: 20, rate: 1 },
  })))
  const quals = Object.fromEntries(GROUPS.map(group => [group, { 'solo-nx': { quality: 7.5 }, 'base-nx': { quality: 8.0 }, 'team-nx': { quality: 8.0 } }]))
  const modeCheck = Object.fromEntries(summary.map(run => {
    const setup = run.cond.split('-')[0]
    const validity = { ...GOOD_VALIDITY, leverFired: setup === 'team' && run.task === 'h8' ? true : null, nonBuiltin: setup === 'solo' ? [] : null, wokeBuilder: setup === 'base' }
    return [run.id, { cond: run.cond, task: run.task, faithful: true, broken: [], tier: null, validity }]
  }))
  const strength = Object.fromEntries(summary.map(run => [run.id, { task: run.task, cond: run.cond, caught: 3, total: 4, share: 0.75, reason: null }]))
  const pin = { configDir: 'C:/bench-profile-nx', runsRoot: 'C:/bench-runs-nx', conds: ['solo', 'base', 'team'] }
  return { config: CONFIG, summary, quals, modeCheck, strength, pin }
}
const statuses = out => Object.fromEntries(Object.entries(out.bars).map(([id, bar]) => [id, bar.status]))
const ALL_MET = Object.fromEntries(CONFIG.bars.map(bar => [bar.id, 'met']))
const h8 = (w, setup) => w.summary.filter(run => run.task === 'h8' && run.cond === SETUPS[setup])

test('bench/bars-nx.json holds the plan\'s bars and keep rule', () => {
  assert.deepEqual(CONFIG.bars.map(bar => bar.id), ['C1', 'Q1', 'H1', 'T1', 'V1', 'V1b', 'V2', 'V3', 'V4', 'V5', 'V6'])
  assert.deepEqual(CONFIG.keep, ['C1', 'Q1', 'H1', 'T1', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'], 'V1b never counts against L1')
  const bar = id => CONFIG.bars.find(b => b.id === id)
  assert.deepEqual([bar('C1').maxRatio, bar('Q1').minGap, bar('T1').minus, bar('V6').min, bar('V6').minTask], [0.75, -0.25, 1, 8, 4])
  assert.deepEqual(bar('H1').atLeast, [{ vs: 'solo', minus: 0 }, { vs: 'base', minus: 1 }])
  assert.deepEqual(CONFIG.tasks, { h8: { reps: 5 }, h9: { reps: 2 }, h10: { reps: 2 } })
})

test('a world that meets every bar keeps L1, and reports h9 and h10', () => {
  const out = barsNx(world())
  assert.deepEqual(statuses(out), ALL_MET)
  assert.deepEqual(out.keep, { decision: 'keep L1', missed: [] })
  assert.equal(out.bars.C1.ratio, 0.67)
  assert.equal(out.bars.Q1.gap, 0)
  assert.deepEqual(out.reported.map(r => [r.task, r.costRatio, r.gap, r.costInRange, r.gapOk]), [['h9', 1, 0, true, true], ['h10', 1, 0, true, true]])
})

// Each case breaks one bar; that bar alone is missed, and a keep bar sends L1 back.
const BROKEN = {
  C1: w => h8(w, 'team').forEach(run => { run.costUSD = 1.2 }),
  Q1: w => GROUPS.filter(g => g.startsWith('h8-')).forEach(g => { w.quals[g]['team-nx'].quality = 7.6 }),
  H1: w => h8(w, 'team').forEach(run => { run.hidden = { tests: 20, pass: 19, rate: 0.95 } }),
  T1: w => h8(w, 'team').forEach(run => { w.strength[run.id] = { ...w.strength[run.id], caught: 1 } }),
  V1: w => { w.modeCheck['h8-team-nx-r3'].validity.leverFired = false },
  V1b: w => { w.modeCheck['h8-base-nx-r2'].validity.void = 'V1b' },
  V2: w => { w.modeCheck['h9-solo-nx-r1'].validity.nonBuiltin = ['code-reviewer'] },
  V3: w => { w.modeCheck['h10-base-nx-r1'].validity.commit = { ok: false, want: 'b51', got: 'rc1' } },
  V4: w => { w.modeCheck['h9-team-nx-r2'].validity.offModel = [{ role: 'main', model: 'claude-sonnet-5-5' }] },
  V5: w => { w.modeCheck['h10-team-nx-r2'].validity.timedOut = true },
  V6: w => { delete w.quals['h8-r4']; delete w.quals['h9-r2'] },
}

for (const [id, breakIt] of Object.entries(BROKEN)) {
  test(`${id} is missed on its broken fixture, and only ${id}`, () => {
    const w = world()
    breakIt(w)
    const out = barsNx(w)
    const expected = { ...ALL_MET, [id]: 'missed' }
    // Removing judged groups (V6) also takes them out of Q1's mean, which stays met.
    assert.deepEqual(statuses(out), expected)
    const keepMissed = CONFIG.keep.includes(id) ? [id] : []
    assert.deepEqual(out.keep, { decision: keepMissed.length ? 'revert L1 (merge revert/l1)' : 'keep L1', missed: keepMissed })
  })
}

test('a bar that cannot be measured is missed, never met', () => {
  const unknownCost = world()
  h8(unknownCost, 'base')[0].costUSD = null
  assert.equal(barsNx(unknownCost).bars.C1.status, 'missed')
  assert.match(barsNx(unknownCost).bars.C1.reading, /not measured/)
  const noJudge = world()
  for (const g of GROUPS) delete noJudge.quals[g]
  assert.deepEqual([barsNx(noJudge).bars.Q1.status, barsNx(noJudge).bars.V6.status], ['missed', 'missed'])
  const unmeasuredStrength = world()
  unmeasuredStrength.strength['h8-team-nx-r1'] = { caught: null, total: null, share: null, reason: 'no run.json' }
  assert.equal(barsNx(unmeasuredStrength).bars.T1.status, 'missed')
  const missingRun = world()
  missingRun.summary = missingRun.summary.filter(run => run.id !== 'h8-team-nx-r5')
  assert.equal(barsNx(missingRun).bars.V1.status, 'missed', 'all 5 team h8 runs must be there')
  const noValidity = world()
  delete noValidity.modeCheck['h9-base-nx-r1'].validity
  assert.equal(barsNx(noValidity).bars.V3.status, 'missed')
  const noProfile = world()
  noProfile.pin = { ...noProfile.pin, configDir: null }
  assert.equal(barsNx(noProfile).bars.V2.status, 'missed', 'a preflight that checked no profile is no plain baseline')
})

// The command line on a temp results folder: the judge's verdicts under their letters, mapped back by the key.
test('node bench/bars.mjs --round=nx reads its six inputs, writes results/bars-nx.json and prints every bar and the keep rule', t => {
  const results = mkdtempSync(join(tmpdir(), 'bench-bars-nx-'))
  t.after(() => rmSync(results, { recursive: true, force: true }))
  const w = world()
  const scores = q => ({ correctness: q, codeQuality: q, tests: q, robustnessSecurity: q, docsUsability: q, overall: q })
  const key = Object.fromEntries(GROUPS.map(g => [g, { A: 'solo-nx', B: 'base-nx', C: 'team-nx' }]))
  const judgeRows = GROUPS.flatMap(g => [1, 2].map(judge => ({ pair: g, A: scores(7.5), B: scores(8), C: scores(8), ranking: ['B', 'C', 'A'], judge })))
  const files = { 'summary.json': w.summary, 'judge-nxcx.json': judgeRows, 'blind-key-nxcx.json': key, 'mode-check-nx.json': w.modeCheck, 'test-strength-nx.json': w.strength, 'preflight-nx.json': w.pin }
  for (const [name, data] of Object.entries(files)) writeFileSync(join(results, name), JSON.stringify(data))
  const logs = []
  t.mock.method(console, 'log', line => logs.push(line))
  main(['--round=nx'], { results })
  assert.equal(process.exitCode, undefined)
  const out = JSON.parse(readFileSync(join(results, 'bars-nx.json'), 'utf8'))
  assert.deepEqual(statuses(out), ALL_MET)
  assert.equal(logs.length, CONFIG.bars.length + 1 + CONFIG.reported.length)
  assert.match(logs[0], /^C1   met     h8 cost team\/base 0\.67× \(at most 0\.75×\): \$1\.00 vs \$1\.50$/)
  assert.equal(logs[CONFIG.bars.length], 'keep rule: keep L1')
  assert.equal(logs.at(-1), 'reported h10: cost 1.00× base, quality +0.00')
  rmSync(join(results, 'test-strength-nx.json'))
  const errors = []
  t.mock.method(console, 'error', line => errors.push(line))
  main(['--round=nx'], { results })
  assert.match(errors[0], /^bars: missing .*test-strength-nx\.json: run node bench\/test-strength\.mjs --round=nx first$/)
  process.exitCode = undefined
})

test('T1 counts a suite with no valid test file as catching none; H1 compares mean tests passed, not rates', () => {
  const noValid = world()
  h8(noValid, 'team').forEach(run => { noValid.strength[run.id] = { caught: null, total: null, share: null, reason: 'no valid test file' } })
  h8(noValid, 'base').forEach(run => { noValid.strength[run.id] = { ...noValid.strength[run.id], caught: 1 } })
  assert.equal(barsNx(noValid).bars.T1.status, 'met', '0 caught is at least base 1 minus 1')
  const tie = world()
  h8(tie, 'team').forEach(run => { run.hidden = { tests: 20, pass: 19, rate: 0.95 } })
  h8(tie, 'solo').forEach(run => { run.hidden = { tests: 20, pass: 19, rate: 0.95 } })
  assert.equal(barsNx(tie).bars.H1.status, 'met', 'team 19 is at least solo 19 and base 20 minus 1')
})

// Plan §3 W8 item 7: the bars score the mean of the five dimension scores, never the judge's overall field.
test('a group\'s quality is the five-dimension mean, whatever overall says', () => {
  const row = { pair: 'h8-r1', A: { correctness: 9, codeQuality: 8, tests: 7, robustnessSecurity: 8, docsUsability: 8, overall: 2 }, ranking: ['A'], judge: 1 }
  assert.equal(qualities([row], { 'h8-r1': { A: 'team-nx' } })['h8-r1']['team-nx'].quality, 8)
})
