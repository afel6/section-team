import { test } from 'node:test'
import assert from 'node:assert/strict'
import { judgeScores, composite } from './aggregate.mjs'

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
