import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cli, withDir } from './helpers.mjs'

const USAGE = 'usage: node timelog.mjs report <file> [--from <date>] [--to <date>]\n'

test('report prints totals', () => withDir((dir, write) => {
  write('a.log', '\uFEFF2026-03-02 09:00-11:15 client-a\n2026-03-02 13:00-13:40 admin\n')
  assert.deepEqual(cli(['report', 'a.log'], dir), { code: 0, out: 'client-a\t2:15\nadmin\t0:40\ntotal\t2:55\n', err: '' })
}))

test('usage errors exit 2', () => withDir((dir, write) => {
  write('a.log', '')
  for (const args of [['list', 'a.log'], ['report'], ['report', 'a.log', '--from'], ['report', 'a.log', '--since', '2026-01-01'],
    ['report', 'a.log', '--to', '2026-01-01', '--to', '2026-01-02']]) {
    assert.deepEqual(cli(args, dir), { code: 2, out: '', err: USAGE }, args.join(' '))
  }
  assert.deepEqual(cli(['report', 'a.log', '--to', 'x', '--from', '2026-02-30'], dir), { code: 2, out: '', err: 'error: bad date for --from: 2026-02-30\n' })
}))

test('read, encoding and line errors', () => withDir((dir, write) => {
  write('bad.log', Buffer.from([0x32, 0xff]))
  write('line.log', '2026-03-02 09:00-10:00 a\n2026-03-02 09:00 a\n')
  assert.deepEqual(cli(['report', 'nope.log'], dir), { code: 3, out: '', err: 'error: cannot read nope.log\n' })
  assert.deepEqual(cli(['report', 'bad.log'], dir), { code: 3, out: '', err: 'error: bad.log is not valid UTF-8\n' })
  assert.deepEqual(cli(['report', 'line.log'], dir), { code: 4, out: '', err: 'error: line 2: bad time\n' })
}))
