import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { judgeScores, composite, loadJudged, opusShare, reportMarkdown, reportTable } from './aggregate.mjs'

const scores = n => ({ correctness: n, codeQuality: n, tests: n, robustnessSecurity: n, docsUsability: n, overall: n })

test('judge scores map X/Y/Z back to conditions per pair, ranking → wins/losses/points', () => {
  const key = { 'easy-r1': { X: 'team', Y: 'solo', Z: 'forced' }, 'easy-r2': { X: 'solo', Y: 'forced', Z: 'team' } }
  const rows = [
    { pair: 'easy-r1', X: scores(9), Y: scores(5), Z: scores(7), ranking: ['X', 'Z', 'Y'] },
    { pair: 'easy-r2', X: scores(4), Y: scores(6), Z: scores(8), ranking: ['Z', 'Y', 'X'] },
  ]
  const j = judgeScores(rows, key)
  assert.equal(j['easy-team-r1'].quality, 9)
  assert.equal(j['easy-solo-r1'].quality, 5)
  assert.equal(j['easy-forced-r1'].quality, 7)
  assert.equal(j['easy-solo-r2'].quality, 4)
  assert.equal(j['easy-forced-r2'].quality, 6)
  assert.equal(j['easy-team-r2'].quality, 8)
  assert.equal(j['easy-team-r1'].wins, 1)
  assert.equal(j['easy-team-r1'].rankPoints, 2)
  assert.equal(j['easy-forced-r1'].rankPoints, 1)
  assert.equal(j['easy-solo-r1'].losses, 1)
  assert.equal(j['easy-solo-r2'].losses, 1)
})

test('composite: perfect correctness/quality, cheapest and fastest → 100', () => {
  const rows = [
    { id: 'easy-team-r1', task: 'easy', costUSD: 1, wallMs: 1000, hidden: { rate: 1 } },
    { id: 'easy-solo-r1', task: 'easy', costUSD: 2, wallMs: 4000, hidden: { rate: 0.5 } },
  ]
  const g = composite(rows, { 'easy-team-r1': { quality: 10 }, 'easy-solo-r1': { quality: 5 } })
  assert.equal(g[0].grade.total, 100)
  assert.equal(g[1].grade.total, 20 + 15 + 7.5 + 3.75)
})

test('opusShare: opus cost over the run total, null when the run has no cost', () => {
  const run = { costUSD: 4, modelUsage: { 'claude-opus-5-5': { costUSD: 3 }, 'claude-sonnet-5-5': { costUSD: 1 } } }
  assert.equal(opusShare(run), 0.75)
  assert.equal(opusShare({ costUSD: 1, modelUsage: { 'claude-haiku-5': { costUSD: 1 } } }), 0)
  assert.equal(opusShare({ costUSD: null, modelUsage: {} }), null)
})

// A graded run as summary.json and composite leave it.
const gradedRun = (task, fields) => ({ id: `${task}-solo-r1`, task, cond: 'solo', costUSD: 1, wallMs: 60000, tokens: { total: 2e6, output: 3000 }, grade: { total: 50 }, ...fields })
const rowOf = (table, task) => table.find(row => row.task === task && row.cond === 'solo')

test('reportTable shows mean hidden failures and how many runs are incomplete, and the printed table has them', () => {
  const twoStage = { stage2: { change: null, calls: null } }
  const table = reportTable([
    gradedRun('h7', { hidden: { fail: 4, rate: 0.5, incomplete: [] }, ...twoStage }),
    gradedRun('h7', { hidden: { fail: 1, rate: 0, incomplete: ['s2'] }, ...twoStage }),
    gradedRun('easy', { hidden: { fail: 2, rate: 0.5 } }),
  ])
  assert.deepEqual([rowOf(table, 'h7').hiddenFail, rowOf(table, 'h7').incompleteRuns], [2.5, 1])
  assert.deepEqual([rowOf(table, 'easy').hiddenFail, rowOf(table, 'easy').incompleteRuns], [2, 0])
  assert.deepEqual([rowOf(table, 'all').hiddenFail, rowOf(table, 'all').incompleteRuns], [2.33, 1])
  const [header, , ...rows] = reportMarkdown(table).split('\n')
  const cells = row => row.split('|').map(text => text.trim())
  const h7Line = cells(rows.find(row => row.startsWith('| h7 ')))
  const printed = name => h7Line[cells(header).indexOf(name)]
  assert.deepEqual([printed('hiddenFail'), printed('incompleteRuns')], ['2.5', '1'])
})

test('reportTable leaves a two-stage run\'s tokens out, since they are only its last stage\'s', () => {
  const table = reportTable([
    gradedRun('h7', { hidden: { fail: 0, rate: 1, incomplete: [] }, stage2: { change: null, calls: null }, tokens: { total: 9e6, output: 9000 } }),
    gradedRun('easy', { hidden: { fail: 0, rate: 1 } }),
  ])
  assert.deepEqual([rowOf(table, 'h7').tokensM, rowOf(table, 'h7').outputK], [null, null])
  assert.deepEqual([rowOf(table, 'easy').tokensM, rowOf(table, 'easy').outputK], [2, 3])
  assert.deepEqual([rowOf(table, 'all').tokensM, rowOf(table, 'all').outputK], [2, 3], 'nor do they move the mean over all tasks')
})

test('reportTable leaves a two-stage run\'s opus share out, since its model usage is only its last stage\'s', () => {
  const opusCost = costUSD => ({ costUSD: 1, modelUsage: { 'claude-opus-5-5': { costUSD } } })
  const table = reportTable([
    gradedRun('h7', { hidden: { fail: 0, rate: 1, incomplete: [] }, stage2: { change: null, calls: null }, ...opusCost(0.1) }),
    gradedRun('easy', { hidden: { fail: 0, rate: 1 }, ...opusCost(0.5) }),
  ])
  assert.equal(rowOf(table, 'h7').opusSharePct, null, 'none, not 0')
  assert.equal(rowOf(table, 'easy').opusSharePct, 50)
  assert.equal(rowOf(table, 'all').opusSharePct, 50, 'nor does it move the mean over all tasks')
})

test('the CLI refuses a --round that is not letters and digits, before reading or writing anything', () => {
  const cli = new URL('./aggregate.mjs', import.meta.url)
  const res = spawnSync(process.execPath, [fileURLToPath(cli), '--round=../x'], { encoding: 'utf8' })
  assert.equal(res.status, 1)
  assert.match(res.stderr, /round/)
  assert.equal(res.stdout, '')
})

test('loadJudged: no judge file is no scores; a judge file without its blind key names the anonymize step', t => {
  const results = mkdtempSync(join(tmpdir(), 'bench-agg-'))
  t.after(() => rmSync(results, { recursive: true, force: true }))
  assert.deepEqual(loadJudged(results, 'ho'), {})
  writeFileSync(join(results, 'judge-ho.json'), '[]')
  assert.throws(() => loadJudged(results, 'ho'), /blind-key-ho\.json: run node bench\/anonymize\.mjs --round=ho first/)
  writeFileSync(join(results, 'blind-key-ho.json'), '{}')
  assert.deepEqual(loadJudged(results, 'ho'), {})
})
