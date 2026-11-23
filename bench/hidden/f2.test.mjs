// Hidden tests for held-out task f2 (cron.mjs and cron-cli.mjs). The library is imported into this process; the CLI is
// spawned and compared on exit code, stdout and stderr exactly. All times are UTC.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

const DIR = process.env.TARGET_DIR
if (!DIR) throw new Error('TARGET_DIR is not set')
const CLI = join(DIR, 'cron-cli.mjs')
const USAGE = 'usage: node cron-cli.mjs <expression> [--from <time>] [--count <n>]\n'
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'))
let lib
const m = async () => (lib ??= await import(pathToFileURL(join(DIR, 'cron.mjs')).href))

const range = (a, b, s = 1) => { const r = []; for (let v = a; v <= b; v += s) r.push(v); return r }
const at = iso => new Date(iso)
const isos = dates => dates.map(d => d.toISOString())
const parsed = (minute, hour, dayOfMonth, month, dayOfWeek, dayOfMonthStar, dayOfWeekStar) => ({ minute, hour, dayOfMonth, month, dayOfWeek, dayOfMonthStar, dayOfWeekStar })
const ALL = { minute: range(0, 59), hour: range(0, 23), dayOfMonth: range(1, 31), month: range(1, 12), dayOfWeek: range(0, 6) }
async function cronError(expr, message, field) {
  const { parseCron, CronError } = await m()
  assert.throws(() => parseCron(expr), e => {
    assert.ok(e instanceof CronError, `${JSON.stringify(expr)}: not a CronError: ${e}`)
    assert.ok(e instanceof Error)
    assert.deepEqual([e.name, e.message, e.field], ['CronError', message, field], JSON.stringify(expr))
    return true
  })
}
const fieldError = (expr, name, text) => cronError(expr, `invalid ${name} field: ${text}`, name)
async function runs(expr, from, count) { const { nextRuns } = await m(); return isos(nextRuns(expr, at(from), count)) }

function cli(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: DIR, env, encoding: 'utf8', timeout: 15_000, windowsHide: true })
  if (r.error) throw r.error
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const lines = (...l) => l.map(x => `${x}\n`).join('')
const fail = (code, err) => ({ code, out: '', err })
function expectCli(...cases) { for (const [args, want] of cases) assert.deepEqual(cli(args), want, JSON.stringify(args)) }

// --- parseCron ---
test('parseCron("* * * * *") gives every value, day-of-week 0 to 6, and both star flags', async () => {
  const { parseCron } = await m()
  assert.deepEqual(parseCron('* * * * *'), { ...ALL, dayOfMonthStar: true, dayOfWeekStar: true })
})
test('lists, ranges and steps; a single value with a step runs to the field maximum', async () => {
  const { parseCron } = await m()
  assert.deepEqual(parseCron('5/20 */6 1-10/3 2-11/4 1-5/2'), parsed([5, 25, 45], [0, 6, 12, 18], [1, 4, 7, 10], [2, 6, 10], [1, 3, 5], false, false))
  assert.deepEqual(parseCron('59,0,30,0 23,0-2 31,1 12,1 3'), parsed([0, 30, 59], [0, 1, 2, 23], [1, 31], [1, 12], [3], false, false))
  assert.deepEqual(parseCron('*/60 */23 */31 */12 */7'), parsed([0], [0, 23], [1], [1], [0], true, true))
  assert.deepEqual(parseCron('05 09 07/10 1/5 0'), parsed([5], [9], [7, 17, 27], [1, 6, 11], [0], false, false))
  assert.deepEqual(parseCron('0-59/1 7-7 */99 * *'), { ...ALL, minute: range(0, 59), hour: [7], dayOfMonth: [1], dayOfMonthStar: true, dayOfWeekStar: true })
})
test('day-of-week: 7 counts as 0 and never appears; * runs over 0 to 7', async () => {
  const { parseCron } = await m()
  const dow = async f => parseCron(`0 0 * * ${f}`).dayOfWeek
  assert.deepEqual(await Promise.all(['7', '0,7', '5-7', '1/3', '*/2', '*/3', '6-7/1', '7-7', 'SUN-SAT', 'sat,7,0', '*/7'].map(dow)),
    [[0], [0], [0, 5, 6], [0, 1, 4], [0, 2, 4, 6], [0, 3, 6], [0, 6], [0], range(0, 6), [0, 6], [0]])
})
test('month and weekday names, in any letter case, also as range ends', async () => {
  const { parseCron } = await m()
  const p = parseCron('0 0 1 jan,Mar-MAY,dEc mon-Fri,SUN')
  assert.deepEqual([p.month, p.dayOfWeek], [[1, 3, 4, 5, 12], [0, 1, 2, 3, 4, 5]])
  assert.deepEqual(parseCron('0 0 1 FEB-12/3 TUE-7/2').month, [2, 5, 8, 11])
  assert.deepEqual(parseCron('0 0 1 FEB-12/3 TUE-7/2').dayOfWeek, [2, 4, 6])
})
test('star flags follow the first character of the field text', async () => {
  const { parseCron } = await m()
  const flags = e => { const p = parseCron(e); return [p.dayOfMonthStar, p.dayOfWeekStar] }
  assert.deepEqual(['0 0 */2 * 1', '0 0 1-31 * *', '0 0 *,5 * 0-7', '0 0 1 * */1', '0 0 1 * MON'].map(flags), [[true, false], [false, true], [true, false], [false, true], [false, false]])
})
test('spaces and tabs separate fields and are trimmed; other white space belongs to a field', async () => {
  const { parseCron } = await m()
  assert.deepEqual(parseCron(' \t 1\t\t2   3 \t4 5\t '), parsed([1], [2], [3], [4], [5], false, false))
  await cronError('* * * *\n*', 'expected 5 fields, got 4', null)
  await fieldError('* * * * *\n', 'day-of-week', '*\n')
  await fieldError('* * * * * *', 'minute', '* *')
  await fieldError('　* * * * *', 'minute', '　*')
})
test('not exactly 5 fields: CronError expected 5 fields, got <n>, with field null', async () => {
  for (const [expr, n] of [['', 0], [' \t ', 0], ['*', 1], ['* * * *', 4], ['* * * * * *', 6], ['1 2 3 4 5 6 7', 7], ['\n', 1]]) await cronError(expr, `expected 5 fields, got ${n}`, null)
})
test('invalid fields name the field and quote its text exactly', async () => {
  const cases = [['60 * * * *', 'minute', '60'], ['1,,2 * * * *', 'minute', '1,,2'], ['1, * * * *', 'minute', '1,'], [',1 * * * *', 'minute', ',1'],
    ['*/0 * * * *', 'minute', '*/0'], ['*/100 * * * *', 'minute', '*/100'], ['1/2/3 * * * *', 'minute', '1/2/3'], ['*-5 * * * *', 'minute', '*-5'],
    ['5- * * * *', 'minute', '5-'], ['-5 * * * *', 'minute', '-5'], ['10-5 * * * *', 'minute', '10-5'], ['005 * * * *', 'minute', '005'], ['1-2-3 * * * *', 'minute', '1-2-3'],
    ['*/ * * * *', 'minute', '*/'], ['/5 * * * *', 'minute', '/5'], ['+5 * * * *', 'minute', '+5'], ['1.5 * * * *', 'minute', '1.5'], ['JAN * * * *', 'minute', 'JAN'],
    ['0 24 * * *', 'hour', '24'], ['0 */0 * * *', 'hour', '*/0'], ['0 MON * * *', 'hour', 'MON'], ['0 0 0 * *', 'day-of-month', '0'], ['0 0 32 * *', 'day-of-month', '32'],
    ['0 0 L * *', 'day-of-month', 'L'], ['0 0 ? * *', 'day-of-month', '?'], ['0 0 1W * *', 'day-of-month', '1W'], ['0 0 * 0 *', 'month', '0'], ['0 0 * 13 *', 'month', '13'],
    ['0 0 * January *', 'month', 'January'], ['0 0 * MON *', 'month', 'MON'], ['0 0 * JA *', 'month', 'JA'], ['0 0 * */JAN *', 'month', '*/JAN'], ['0 0 * DEC-JAN *', 'month', 'DEC-JAN'],
    ['0 0 * * 8', 'day-of-week', '8'], ['0 0 * * 7-SUN', 'day-of-week', '7-SUN'], ['0 0 * * FRI-MON', 'day-of-week', 'FRI-MON'], ['0 0 * * JAN', 'day-of-week', 'JAN'],
    ['0 0 * * 1#2', 'day-of-week', '1#2'], ['0 0 * * MONDAY', 'day-of-week', 'MONDAY'], ['0 0 * * 5L', 'day-of-week', '5L'], ['0 0 * * ١', 'day-of-week', '١']]
  for (const [expr, name, text] of cases) await fieldError(expr, name, text)
})
test('the first bad field, in field order, decides the error', async () => {
  await fieldError('60 24 0 13 8', 'minute', '60')
  await fieldError('0 24 0 13 8', 'hour', '24')
  await fieldError('0 0 0 13 8', 'day-of-month', '0')
  await fieldError('0 0 1 13 8', 'month', '13')
})
test('a non-string expression, a String object included, is a TypeError: expression must be a string', async () => {
  const { parseCron, nextRuns } = await m()
  for (const v of [undefined, null, 5, ['* * * * *'], new String('* * * * *'), { toString: () => '* * * * *' }]) {
    assert.throws(() => parseCron(v), e => e instanceof TypeError && e.message === 'expression must be a string')
    assert.throws(() => nextRuns(v, 'bad', 0), e => e instanceof TypeError && e.message === 'expression must be a string')
  }
})
test('parseCron returns new arrays on every call', async () => {
  const { parseCron } = await m()
  const a = parseCron('1 2 3 4 5')
  a.minute.push(9)
  a.dayOfWeek.length = 0
  assert.deepEqual(parseCron('1 2 3 4 5'), parsed([1], [2], [3], [4], [5], false, false))
})

// --- nextRuns ---
test('runs are strictly after from, at whole minutes', async () => {
  assert.deepEqual(await runs('* * * * *', '2026-03-01T10:00:00.000Z', 2), ['2026-03-01T10:01:00.000Z', '2026-03-01T10:02:00.000Z'])
  assert.deepEqual(await runs('* * * * *', '2026-03-01T10:00:00.001Z', 1), ['2026-03-01T10:01:00.000Z'])
  assert.deepEqual(await runs('* * * * *', '2026-03-01T09:59:59.999Z', 1), ['2026-03-01T10:00:00.000Z'])
  assert.deepEqual(await runs('0 10 * * *', '2026-03-01T10:00:00.000Z', 1), ['2026-03-02T10:00:00.000Z'])
  assert.deepEqual(await runs('0 10 * * *', '2026-03-01T09:59:30.000Z', 1), ['2026-03-01T10:00:00.000Z'])
})
test('runs roll over hours, days, months, years and leap days in order', async () => {
  assert.deepEqual(await runs('30 23 * * *', '2025-12-30T23:30:00Z', 3), ['2025-12-31T23:30:00.000Z', '2026-01-01T23:30:00.000Z', '2026-01-02T23:30:00.000Z'])
  assert.deepEqual(await runs('0 0 31 * *', '2026-01-31T00:00:00Z', 4), ['2026-03-31T00:00:00.000Z', '2026-05-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z'])
  assert.deepEqual(await runs('15 6 29 2 *', '2023-01-01T00:00:00Z', 3), ['2024-02-29T06:15:00.000Z', '2028-02-29T06:15:00.000Z', '2032-02-29T06:15:00.000Z'])
  assert.deepEqual(await runs('0 0 29 FEB *', '2096-03-01T00:00:00Z', 2), ['2104-02-29T00:00:00.000Z', '2108-02-29T00:00:00.000Z'])
  assert.deepEqual(await runs('0 0 29 2 *', '1999-03-01T00:00:00Z', 1), ['2000-02-29T00:00:00.000Z'])
  assert.deepEqual(await runs('0,30 9-10 * * *', '2026-03-01T09:15:00Z', 5),
    ['2026-03-01T09:30:00.000Z', '2026-03-01T10:00:00.000Z', '2026-03-01T10:30:00.000Z', '2026-03-02T09:00:00.000Z', '2026-03-02T09:30:00.000Z'])
})
test('day rule: both restricted means either matches; a field starting with * means both must match', async () => {
  // 2026-03-13 is a Friday; 2026-02-13 is a Friday too.
  assert.deepEqual(await runs('0 0 13 * FRI', '2026-03-01T00:00:00Z', 4), ['2026-03-06T00:00:00.000Z', '2026-03-13T00:00:00.000Z', '2026-03-20T00:00:00.000Z', '2026-03-27T00:00:00.000Z'])
  assert.deepEqual(await runs('0 0 1 * MON', '2026-03-01T00:00:00Z', 3), ['2026-03-02T00:00:00.000Z', '2026-03-09T00:00:00.000Z', '2026-03-16T00:00:00.000Z'])
  assert.deepEqual(await runs('0 0 15 * 0', '2026-03-08T00:00:00Z', 3), ['2026-03-15T00:00:00.000Z', '2026-03-22T00:00:00.000Z', '2026-03-29T00:00:00.000Z'])
  assert.deepEqual(await runs('0 0 */2 * FRI', '2026-03-01T00:00:00Z', 3), ['2026-03-13T00:00:00.000Z', '2026-03-27T00:00:00.000Z', '2026-04-03T00:00:00.000Z'])
  assert.deepEqual(await runs('0 0 1-7 * */1', '2026-03-31T00:00:00Z', 2), ['2026-04-01T00:00:00.000Z', '2026-04-02T00:00:00.000Z'])
  assert.deepEqual(await runs('0 0 1,15 * *', '2026-03-31T00:00:00Z', 2), ['2026-04-01T00:00:00.000Z', '2026-04-15T00:00:00.000Z'])
  assert.deepEqual(await runs('0 0 * * 7', '2026-03-01T00:00:00Z', 2), ['2026-03-08T00:00:00.000Z', '2026-03-15T00:00:00.000Z'])
  assert.deepEqual(await runs('0 12 * * SAT,SUN', '2026-03-06T12:00:00Z', 3), ['2026-03-07T12:00:00.000Z', '2026-03-08T12:00:00.000Z', '2026-03-14T12:00:00.000Z'])
})
test('impossible days give [] and the 100-year limit stops the search', async () => {
  assert.deepEqual(await runs('0 0 30 2 *', '2026-03-01T00:00:00Z', 5), [])
  assert.deepEqual(await runs('0 0 31 4,6,9,11 *', '2026-03-01T00:00:00Z', 1), [])
  const leap = await runs('0 0 29 2 *', '2026-01-01T00:00:00Z', 30)
  const want = range(2028, 2124, 4).filter(y => y !== 2100).map(y => `${y}-02-29T00:00:00.000Z`)
  assert.deepEqual(leap, want)
  assert.equal(leap.length, 24)
  const yearly = await runs('0 0 1 1 *', '2026-11-19T08:00:00Z', 1000)
  assert.deepEqual([yearly.length, yearly[0], yearly.at(-1)], [100, '2027-01-01T00:00:00.000Z', '2126-01-01T00:00:00.000Z'])
  assert.deepEqual(await runs('59 23 31 12 *', '2026-12-31T23:59:00Z', 1000).then(r => [r.length, r.at(-1)]), [100, '2126-12-31T23:59:00.000Z'])
  assert.deepEqual(await runs('0 0 1 1 *', '2026-01-01T00:00:00Z', 1000).then(r => [r.length, r[0], r.at(-1)]), [100, '2027-01-01T00:00:00.000Z', '2126-01-01T00:00:00.000Z'])
})
test('count 1000 of every minute gives 1000 consecutive minutes; count 1 gives one', async () => {
  const all = await runs('* * * * *', '2026-03-01T23:30:00Z', 1000)
  assert.equal(all.length, 1000)
  assert.deepEqual([all[0], all[29], all[30], all[999]], ['2026-03-01T23:31:00.000Z', '2026-03-02T00:00:00.000Z', '2026-03-02T00:01:00.000Z', '2026-03-02T16:10:00.000Z'])
  assert.deepEqual(await runs('*/15 * * * *', '2026-03-01T23:50:00Z', 1), ['2026-03-02T00:00:00.000Z'])
})
test('nextRuns returns new Dates and does not change from', async () => {
  const { nextRuns } = await m()
  const from = at('2026-03-01T10:00:00Z')
  const [a] = nextRuns('* * * * *', from, 1)
  const [b] = nextRuns('* * * * *', from, 1)
  assert.ok(a instanceof Date && b instanceof Date && a !== b && a !== from)
  assert.equal(from.toISOString(), '2026-03-01T10:00:00.000Z')
  assert.deepEqual([a.getUTCSeconds(), a.getUTCMilliseconds()], [0, 0])
})
test('nextRuns checks expr, then from, then count', async () => {
  const { nextRuns, CronError } = await m()
  const throwsAs = (fn, type, message) => assert.throws(fn, e => e instanceof type && e.message === message, message)
  const FROM = 'from must be a valid Date'
  const COUNT = 'count must be an integer from 1 to 1000'
  throwsAs(() => nextRuns('60 * * * *', 'bad', 0), CronError, 'invalid minute field: 60')
  throwsAs(() => nextRuns('* * *', new Date(NaN), 0), CronError, 'expected 5 fields, got 3')
  for (const from of [new Date(NaN), '2026-03-01T00:00:00Z', 1772323200000, null, undefined, { getTime: () => 0 }]) throwsAs(() => nextRuns('* * * * *', from, 0), TypeError, FROM)
  for (const count of [0, 1001, -1, 1.5, '5', NaN, Infinity, null, undefined, 5n]) throwsAs(() => nextRuns('* * * * *', new Date(0), count), RangeError, COUNT)
  assert.equal(nextRuns('* * * * *', new Date(0), 1000.0).length, 1000)
})
test('every call returns within 2 seconds, also when few or no runs exist', async () => {
  const { nextRuns } = await m()
  for (const [expr, count, want] of [['0 0 30 2 *', 1000, 0], ['59 23 31 12 *', 1000, 101], ['0 0 29 2 *', 1000, 24], ['* * * * *', 1000, 1000], ['0 0 31 2 1', 1000, 407],
    ['0 0 */31 2 */7', 1000, 15]]) {
    const t = performance.now()
    const got = nextRuns(expr, at('2025-01-01T00:00:00Z'), count)
    const ms = performance.now() - t
    assert.ok(ms < 2000, `${expr} took ${Math.round(ms)} ms`)
    assert.equal(got.length, want, expr)
  }
})

// --- Command line ---
test('cli: prints runs as YYYY-MM-DD HH:MM Ddd, 5 by default, exit 0', () => expectCli(
  [['0 9 * * MON-FRI', '--from', '2026-11-19T09:00Z'], { code: 0, out: lines('2026-11-20 09:00 Fri', '2026-11-23 09:00 Mon', '2026-11-24 09:00 Tue', '2026-11-25 09:00 Wed', '2026-11-26 09:00 Thu'), err: '' }],
  [['--count', '3', '--from', '2026-12-31T23:58:30Z', '* * * * *'], { code: 0, out: lines('2026-12-31 23:59 Thu', '2027-01-01 00:00 Fri', '2027-01-01 00:01 Fri'), err: '' }],
  [['5 4 * * SUN', '--count', '0002', '--from', '2026-03-01T04:05:00Z'], { code: 0, out: lines('2026-03-08 04:05 Sun', '2026-03-15 04:05 Sun'), err: '' }],
  [['  0  0  1  1  * ', '--from', '1970-01-01T00:00Z', '--count', '1'], { code: 0, out: lines('1971-01-01 00:00 Fri'), err: '' }],
  [['0 0 * * 3', '--from', '2026-03-03T00:00:59Z', '--count', '1'], { code: 0, out: lines('2026-03-04 00:00 Wed'), err: '' }]))
test('cli: without --from it starts from the current time', () => {
  const before = Date.now()
  const { code, out, err } = cli(['* * * * *'])
  assert.deepEqual([code, err], [0, ''])
  const got = out.split('\n')
  assert.equal(got.pop(), '')
  assert.equal(got.length, 5)
  const times = got.map(l => Date.parse(`${l.slice(0, 10)}T${l.slice(11, 16)}Z`))
  assert.ok(times[0] > before - 60_000 && times[0] <= before + 120_000, `first run ${got[0]} is not near now`)
  assert.deepEqual(times.slice(1).map((t, i) => t - times[i]), [60_000, 60_000, 60_000, 60_000])
})
test('cli: argument errors print the usage line and exit 2', () => expectCli(...[
  [], ['* * * * *', '0 * * * *'], ['--from', '2026-01-01T00:00Z'], ['* * * * *', '--from'], ['* * * * *', '--count'], ['* * * * *', '--every', '5'],
  ['* * * * *', '--count=5'], ['* * * * *', '--'], ['* * * * *', '--count', '1', '--count', '2'], ['* * * * *', '--from', 'x', '--from', 'y'], ['--help'],
  ['* * * * *', '--from', '2026-01-01T00:00Z', 'extra'], ['--COUNT', '5', '* * * * *'],
].map(args => [args, fail(2, USAGE)])))
test('cli: --from and --count take the next argument as their value, whatever it is', () => expectCli(
  [['* * * * *', '--from', '--count'], fail(2, 'error: invalid --from: --count\n')],
  [['* * * * *', '--count', '--from'], fail(2, 'error: invalid --count: --from\n')],
  [['--count', '1', '-1 * * * *'], fail(3, 'error: invalid minute field: -1\n')],
  [['', '--count', '1'], fail(3, 'error: expected 5 fields, got 0\n')]))
test('cli: a bad --from value exits 2', () => expectCli(...[
  '2026-01-01T00:00', '2026-01-01T00:00:00', '2026-01-01 00:00Z', '2026-01-01T00:00:00.000Z', '2026-1-01T00:00Z', '2026-02-29T00:00Z', '2026-04-31T00:00Z',
  '2026-13-01T00:00Z', '2026-00-10T00:00Z', '2026-01-00T00:00Z', '2026-01-01T24:00Z', '2026-01-01T00:60Z', '2026-01-01T00:00:60Z', '1969-12-31T23:59Z',
  '9900-01-01T00:00Z', '2026-01-01t00:00z', '2026-01-01T00:00+00:00', '', 'now', '+2026-01-01T00:00Z', '2026-01-01T00:00Z ',
].map(v => [['* * * * *', '--from', v], fail(2, `error: invalid --from: ${v}\n`)])))
test('cli: --from accepts leap days, seconds and the year limits', () => expectCli(
  [['0 0 * * *', '--from', '2024-02-29T00:00:00Z', '--count', '1'], { code: 0, out: lines('2024-03-01 00:00 Fri'), err: '' }],
  [['* * * * *', '--from', '9899-12-31T23:58:59Z', '--count', '1'], { code: 0, out: lines('9899-12-31 23:59 Sun'), err: '' }],
  [['59 23 * * *', '--from', '2000-02-29T23:59Z', '--count', '1'], { code: 0, out: lines('2000-03-01 23:59 Wed'), err: '' }]))
test('cli: a bad --count value exits 2', () => expectCli(...['0', '1001', '00', '-1', '+5', '1.0', '1e2', '', ' 5', 'five', '0x10', '٥', '99999999999999999999']
  .map(v => [['* * * * *', '--count', v, '--from', '2026-01-01T00:00Z'], fail(2, `error: invalid --count: ${v}\n`)]),
  [['* * * * *', '--count', '1000', '--from', '2026-01-01T00:00Z'], { code: 0, out: lines(...Array.from({ length: 1000 }, (_, i) => `2026-01-01 ${String(Math.floor((i + 1) / 60)).padStart(2, '0')}:${String((i + 1) % 60).padStart(2, '0')} Thu`)), err: '' }]))
test('cli: a bad expression prints error: <CronError message> and exits 3', () => expectCli(
  [['0 24 * * *', '--from', '2026-01-01T00:00Z'], fail(3, 'error: invalid hour field: 24\n')],
  [['* * * *'], fail(3, 'error: expected 5 fields, got 4\n')],
  [['0 0 * jan-feb,smarch *'], fail(3, 'error: invalid month field: jan-feb,smarch\n')],
  [['0 0 * * 1-8'], fail(3, 'error: invalid day-of-week field: 1-8\n')]))
test('cli: checks run in order: arguments, --from, --count, expression', () => expectCli(
  [['60 * * * *', '--from', 'x', '--count', '0', '--bogus'], fail(2, USAGE)],
  [['60 * * * *', '--count', '0', '--from', 'x'], fail(2, 'error: invalid --from: x\n')],
  [['60 * * * *', '--count', '0', '--from', '2026-01-01T00:00Z'], fail(2, 'error: invalid --count: 0\n')],
  [['60 * * * *', '--count', '1', '--from', '2026-01-01T00:00Z'], fail(3, 'error: invalid minute field: 60\n')]))
test('cli: fewer runs than the count prints the ones found, then the error line, and exits 1', () => expectCli(
  [['0 0 30 2 *', '--from', '2026-01-01T00:00Z'], fail(1, 'error: only 0 of 5 runs within 100 years\n')],
  [['0 0 29 2 *', '--from', '2026-01-01T00:00Z', '--count', '25'],
    { code: 1, out: lines(...range(2028, 2124, 4).filter(y => y !== 2100).map(y => `${y}-02-29 00:00 ${new Date(Date.UTC(y, 1, 29)).toUTCString().slice(0, 3)}`)), err: 'error: only 24 of 25 runs within 100 years\n' }],
  [['0 0 29 2 *', '--from', '2026-01-01T00:00Z', '--count', '24'],
    { code: 0, out: lines(...range(2028, 2124, 4).filter(y => y !== 2100).map(y => `${y}-02-29 00:00 ${new Date(Date.UTC(y, 1, 29)).toUTCString().slice(0, 3)}`)), err: '' }]))

// --- Deliverables ---
test('the solution has a package.json (type module, a test script), a README and node:test tests', () => {
  const pkg = JSON.parse(readFileSync(join(DIR, 'package.json'), 'utf8'))
  assert.equal(pkg.type, 'module')
  assert.ok(typeof pkg.scripts?.test === 'string' && pkg.scripts.test.trim() !== '', 'no test script')
  const readme = readdirSync(DIR).find(f => /^readme(\.[a-z]+)?$/i.test(f))
  assert.ok(readme, 'no README file')
  assert.match(readFileSync(join(DIR, readme), 'utf8'), /cron-cli/)
  const sources = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.isDirectory()) return ['node_modules', '.git'].includes(e.name) ? [] : sources(join(dir, e.name))
    return /\.[cm]?js$/.test(e.name) ? [join(dir, e.name)] : []
  })
  assert.ok(sources(DIR).some(f => /['"]node:test['"]/.test(readFileSync(f, 'utf8'))), 'no source file imports node:test')
})
