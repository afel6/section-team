// bench/data/nx/recompute.mjs on a fixture round: it reads only the folder it is given and prints the published tables.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { linesOf, tablesOf } from './data/nx/recompute.mjs'

const SCRIPT = fileURLToPath(new URL('./data/nx/recompute.mjs', import.meta.url))
const SETUPS = ['solo', 'base', 'team']
// Per task and setup: cost, minutes, tests passed of 20, near-misses caught of 4, mainPeak and judged quality.
const CELLS = {
  h8: { solo: [0.5, 10, 20, 2, 40_000, 7], base: [1.5, 30, 20, 3, 80_000, 8], team: [1.0, 20, 19, 3, 60_000, 7.75] },
  h9: { solo: [1.0, 20, 38, 4, 50_000, 7], base: [3.0, 50, 40, 6, 90_000, 8], team: [3.0, 50, 40, 5, 90_000, 8] },
  h10: { solo: [1.0, 30, 36, 3, 60_000, 6], base: [6.0, 90, 40, 6, 100_000, 8], team: [6.6, 99, 39, 6, 110_000, 7.5] },
}
const REPS = { h8: 2, h9: 1, h10: 1 }
const dims = q => ({ correctness: q, codeQuality: q, tests: q, robustnessSecurity: q, docsUsability: q, overall: 1 })

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'bench-nx-data-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const groups = Object.entries(REPS).flatMap(([task, reps]) => Array.from({ length: reps }, (_, i) => [task, i + 1]))
  const summary = groups.flatMap(([task, rep]) => SETUPS.map(setup => {
    const [costUSD, minutes, pass, , mainPeak] = CELLS[task][setup]
    return { id: `${task}-${setup}-nx-r${rep}`, task, cond: `${setup}-nx`, rep, costUSD, wallMs: minutes * 60_000, hidden: { tests: 40, pass }, mainPeak }
  }))
  const strength = Object.fromEntries(summary.map(run => [run.id, { task: run.task, cond: run.cond, caught: CELLS[run.task][run.cond.split('-')[0]][3], total: 6, reason: null }]))
  strength['h8-team-nx-r2'] = { task: 'h8', cond: 'team-nx', caught: null, total: null, reason: 'no valid test file' }
  const key = Object.fromEntries(groups.map(([task, rep]) => [`${task}-r${rep}`, { X: 'solo-nx', Y: 'base-nx', Z: 'team-nx' }]))
  const judge = groups.flatMap(([task, rep]) => [1, 2].map(n => ({ pair: `${task}-r${rep}`, judge: n, X: dims(CELLS[task].solo[5]), Y: dims(CELLS[task].base[5]), Z: dims(CELLS[task].team[5]), ranking: ['Y', 'Z', 'X'] })))
  const roles = { h8: { base: { runs: 2, meanUSD: 1.5, roles: [{ role: 'section-team:backend', n: 1, meanUSD: 1, share: 2 / 3 }, { role: 'main', n: 1, meanUSD: 0.5, share: 1 / 3 }], missing: [] } } }
  const files = { 'summary.json': summary, 'test-strength-nx.json': strength, 'blind-key-nxcx.json': key, 'judge-nxcx.json': judge, 'cost-by-role-nx.json': roles }
  for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(data))
  return dir
}

test('tablesOf computes cost, wall time, Codex means, hidden tests, near-misses and mainPeak per tier, with ratios to solo and base', t => {
  const tables = tablesOf(fixture(t))
  assert.deepEqual(tables.cost.h8, { solo: 0.5, base: 1.5, team: 1, teamSolo: 2, teamBase: 0.67, baseSolo: 3 })
  assert.deepEqual(tables.cost.equal, { solo: 2.5, base: 10.5, team: 10.6, teamSolo: 4.24, teamBase: 1.01, baseSolo: 4.2 }, 'overall with the tiers weighted equally: sums of the task means')
  assert.deepEqual(tables.cost.allRuns, { solo: 3, base: 12, team: 11.6, teamSolo: 3.87, teamBase: 0.97, baseSolo: 4 }, 'overall over all runs: h8 counts twice')
  assert.deepEqual(tables.wall.h10, { solo: 30, base: 90, team: 99, teamSolo: 3.3, teamBase: 1.1, baseSolo: 3 })
  assert.deepEqual(tables.quality.h8, { solo: 7, base: 8, team: 7.75, teamBase: -0.25, teamSolo: 0.75, groups: 2 })
  assert.deepEqual(tables.hidden.h9, { solo: 38, base: 40, team: 40, tests: 40 })
  assert.deepEqual(tables.nearMiss.h8, { solo: 2, base: 3, team: 1.5, total: 6, notMeasured: 0 }, 'a suite with no valid test file catches none')
  assert.deepEqual(tables.mainPeak.h8, { solo: 40_000, base: 80_000, team: 60_000 })
})

test('linesOf prints every table, and the CLI on a folder prints the same lines and reads nothing else', t => {
  const dir = fixture(t)
  const lines = linesOf(tablesOf(dir))
  const has = pattern => assert.ok(lines.some(line => pattern.test(line)), `${pattern} in\n${lines.join('\n')}`)
  assert.equal(lines[0], 'round nx, recomputed from summary.json, judge-nxcx.json, blind-key-nxcx.json, test-strength-nx.json and cost-by-role-nx.json')
  assert.ok(lines.includes('cost (USD per run)'))
  has(/^ +solo +base +team +team×solo +team×base +base×solo$/)
  has(/^ +solo +base +team +team−base +team−solo$/)
  has(/^ {2}h8 +\$0\.50 +\$1\.50 +\$1\.00 +2\.00× +0\.67× +3\.00×$/)
  has(/^ {2}overall, tiers weighted equally +\$2\.50 +\$10\.50 +\$10\.60 +4\.24× +1\.01× +4\.20×$/)
  has(/^ {2}overall, all runs \(total\) +\$3\.00 +\$12\.00 +\$11\.60 +3\.87× +0\.97× +4\.00×$/)
  has(/^ {2}h10 +30\.0 +90\.0 +99\.0 +3\.30× +1\.10× +3\.00×$/)
  has(/^ {2}h8 +7\.00 +8\.00 +7\.75 +-0\.25 +\+0\.75 +\(2 groups\)$/)
  has(/^ {2}h9 +38\.0 +40\.0 +40\.0 +of 40$/)
  has(/^ {2}h8 +2\.0 +3\.0 +1\.5 +of 6$/)
  has(/^ {2}h8 +40000 +80000 +60000$/)
  has(/^ {2}h8 base: section-team:backend \$1\.00 \(67%\), main \$0\.50 \(33%\)$/)
  const r = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.stdout.trimEnd().split('\n'), lines)
  const missing = spawnSync(process.execPath, [SCRIPT, join(dir, 'none')], { encoding: 'utf8' })
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /^recompute: cannot read .*summary\.json/)
})
