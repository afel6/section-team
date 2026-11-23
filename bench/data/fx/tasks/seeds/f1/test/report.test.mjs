import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLog } from '../lib/parse.mjs'
import { reportLines, totals } from '../lib/report.mjs'
import { formatDuration } from '../lib/format.mjs'

const LOG = parseLog([
  '2026-03-01 09:00-10:00 admin',
  '2026-03-02 09:00-11:30 client-a',
  '2026-03-02 13:00-13:45 admin',
  '2026-03-03 10:00-10:45 client-b',
  '2026-03-04 08:00-08:45 client-a',
].join('\n'))

test('totals per project, most first, then by name', () => {
  assert.deepEqual(totals(LOG), [['client-a', 195], ['admin', 105], ['client-b', 45]])
  assert.deepEqual(totals(parseLog('2026-03-01 09:00-10:00 b\n2026-03-01 11:00-12:00 a')), [['a', 60], ['b', 60]])
})

test('--from leaves out earlier dates', () => {
  assert.deepEqual(totals(LOG, { from: '2026-03-02' }), [['client-a', 195], ['admin', 45], ['client-b', 45]])
})

test('report lines end with the total', () => {
  assert.deepEqual(reportLines(LOG), ['client-a\t3:15', 'admin\t1:45', 'client-b\t0:45', 'total\t5:45'])
})

test('formatDuration prints hours and minutes', () => {
  assert.equal(formatDuration(90), '1:30')
  assert.equal(formatDuration(6000 + 45), '100:45')
})
