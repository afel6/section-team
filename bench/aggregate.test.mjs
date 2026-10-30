import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { judgeScores, composite, opusShare } from './aggregate.mjs'

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

test('the CLI refuses a --round that is not letters and digits, before reading or writing anything', () => {
  const cli = new URL('./aggregate.mjs', import.meta.url)
  const res = spawnSync(process.execPath, [fileURLToPath(cli), '--round=../x'], { encoding: 'utf8' })
  assert.equal(res.status, 1)
  assert.match(res.stderr, /round/)
  assert.equal(res.stdout, '')
})
