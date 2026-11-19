import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CronError, nextRuns, parseCron } from '../cron.mjs'

const CLI = fileURLToPath(new URL('../cron-cli.mjs', import.meta.url))
const cli = args => {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

test('parseCron: steps, names and Sunday as 7', () => {
  const p = parseCron('5/20 */6 1-10/3 jan,MAR 5-7')
  assert.deepEqual([p.minute, p.hour, p.dayOfMonth, p.month, p.dayOfWeek], [[5, 25, 45], [0, 6, 12, 18], [1, 4, 7, 10], [1, 3], [0, 5, 6]])
  assert.deepEqual([p.dayOfMonthStar, p.dayOfWeekStar], [false, false])
})

test('parseCron: errors', () => {
  assert.throws(() => parseCron('* * *'), { name: 'CronError', message: 'expected 5 fields, got 3' })
  assert.throws(() => parseCron('0 24 * * *'), e => e instanceof CronError && e.field === 'hour' && e.message === 'invalid hour field: 24')
  assert.throws(() => parseCron(5), { name: 'TypeError', message: 'expression must be a string' })
})

test('nextRuns: OR and AND day rules', () => {
  const from = new Date('2026-03-01T00:00:00Z')
  assert.deepEqual(nextRuns('0 0 13 * FRI', from, 2).map(d => d.toISOString()), ['2026-03-06T00:00:00.000Z', '2026-03-13T00:00:00.000Z'])
  assert.deepEqual(nextRuns('0 0 */2 * FRI', from, 1).map(d => d.toISOString()), ['2026-03-13T00:00:00.000Z'])
})

test('nextRuns: impossible dates and the 100-year limit', () => {
  assert.deepEqual(nextRuns('0 0 30 2 *', new Date(0), 5), [])
  assert.equal(nextRuns('0 0 1 1 *', new Date('2026-06-01T00:00:00Z'), 1000).length, 100)
  assert.throws(() => nextRuns('* * * * *', new Date(0), 0), RangeError)
})

test('cli: output and exit codes', () => {
  assert.deepEqual(cli(['0 9 * * MON-FRI', '--from', '2026-11-19T09:00Z', '--count', '1']), { code: 0, out: '2026-11-20 09:00 Fri\n', err: '' })
  assert.equal(cli(['0 0 30 2 *', '--from', '2026-01-01T00:00Z']).code, 1)
  assert.equal(cli(['* * * * *', '--count', '0']).code, 2)
  assert.equal(cli(['60 * * * *']).code, 3)
})
