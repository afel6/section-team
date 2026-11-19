import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LogError, parseLog } from '../lib/parse.mjs'
import { dayNumber, isDate } from '../lib/dates.mjs'

test('parses entries, skipping blank lines and comments', () => {
  const text = '# March\n\n2026-03-02 09:00-10:30 client-a call with Bo\r\n  \t\n\t2026-03-02\t13:00-13:45   admin\n'
  const entries = parseLog(text)
  assert.deepEqual(entries.map(e => [e.line, e.date, e.start, e.end, e.project, e.minutes]), [
    [3, '2026-03-02', 540, 630, 'client-a', 90],
    [5, '2026-03-02', 780, 825, 'admin', 45],
  ])
})

test('reports the first bad line with the first reason that applies', () => {
  const cases = [
    ['2026-03-02 09:00-10:00', 'missing fields'],
    ['2026-02-29 09:00-10:00 a', 'bad date'],
    ['2026-3-2 09:00-10:00 a', 'bad date'],
    ['2026-03-02 9:00-10:00 a', 'bad time'],
    ['2026-03-02 09:00-24:00 a', 'bad time'],
    ['2026-03-02 09:60-10:00 a', 'bad time'],
    ['2026-03-02 09:00-09:00 a', 'zero-length entry'],
    ['2026-03-02 09:00-10:00 Admin', 'bad project'],
    ['2026-03-02 09:00-10:00 1st', 'bad project'],
    ['2026-03-02 09:00-10:00 ' + 'a'.repeat(31), 'bad project'],
  ]
  for (const [line, reason] of cases) {
    assert.throws(() => parseLog(`# ok\n${line}\nbad line`), e => e instanceof LogError && e.message === `line 2: ${reason}`, line)
  }
})

test('dates: leap years and day numbers', () => {
  assert.equal(isDate('2024-02-29'), true)
  assert.equal(isDate('2100-02-29'), false)
  assert.equal(isDate('2000-02-29'), true)
  assert.equal(isDate('2026-04-31'), false)
  assert.equal(dayNumber('2026-03-01') - dayNumber('2026-02-28'), 1)
  assert.equal(dayNumber('2025-01-01') - dayNumber('2024-01-01'), 366)
})
