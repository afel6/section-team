import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLog } from '../lib/parse.mjs'
import { checkLines, overlaps } from '../lib/check.mjs'
import { totals } from '../lib/report.mjs'
import { formatDuration } from '../lib/format.mjs'
import { cli, withDir } from './helpers.mjs'

test('fix: an entry past midnight ends on the next day', () => {
  const [e] = parseLog('2026-03-06 23:30-00:30 release')
  assert.equal(e.minutes, 60)
  assert.equal(parseLog('2026-03-06 00:01-00:00 a')[0].minutes, 1439)
})

test('fix: --to includes its own date', () => {
  const log = parseLog('2026-03-05 09:00-10:00 a\n2026-03-06 09:00-10:00 a')
  assert.deepEqual(totals(log, { to: '2026-03-05' }), [['a', 60]])
})

test('fix: minutes always have two digits', () => {
  assert.deepEqual([0, 5, 65, 6000].map(formatDuration), ['0:00', '0:05', '1:05', '100:00'])
})

test('overlaps: touching entries do not overlap; midnight entries reach the next day', () => {
  const log = parseLog('2026-03-01 09:00-10:00 a\n2026-03-01 10:00-11:00 b\n2026-03-01 23:00-01:00 c\n2026-03-02 00:30-02:00 d')
  assert.deepEqual(overlaps(log), [{ a: 3, b: 4, minutes: 30 }])
})

test('checkLines: none, singular, and the 50-line limit', () => {
  assert.deepEqual(checkLines([]), { code: 0, lines: ['no overlaps in 0 entries'] })
  assert.deepEqual(checkLines(parseLog('2026-03-01 09:00-10:00 a')), { code: 0, lines: ['no overlaps in 1 entry'] })
  const same = parseLog(Array(11).fill('2026-03-01 09:00-09:05 a').join('\n'))
  const { code, lines } = checkLines(same)
  assert.equal(code, 1)
  assert.equal(lines.length, 51)
  assert.equal(lines[0], 'line 1 overlaps line 2 by 0:05')
  assert.equal(lines[50], 'and 5 more')
})

test('check command: exit codes and usage', () => withDir((dir, write) => {
  write('a.log', '# x\n2026-03-01 09:00-10:00 a\n2026-03-01 09:45-10:30 b\n')
  assert.deepEqual(cli(['check', 'a.log'], dir), { code: 1, out: 'line 2 overlaps line 3 by 0:15\n', err: '' })
  const usage = 'usage: node timelog.mjs report <file> [--from <date>] [--to <date>]\n'
  assert.deepEqual(cli(['check'], dir), { code: 2, out: '', err: usage })
  assert.deepEqual(cli(['check', 'a.log', '--to', '2026-03-01'], dir), { code: 2, out: '', err: usage })
}))
