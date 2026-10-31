// Hidden tests for held-out task h3 (cron library). Each test runs `${TARGET_DIR}/cron.mjs` in a
// child process with a time limit and TZ set off UTC: an endless loop fails one test, not the
// whole file, and code that reads local time instead of UTC fails on any machine.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const LIMIT_MS = 10_000
const MARK = '@@h3-result@@'
const FROM = '2026-01-01T00:00:00Z'

// Runs in the child (serialized with String()): imports cron.mjs, makes each call, prints JSON after the mark.
async function child () {
  const { url, calls, mark } = JSON.parse(process.env.H3_PAYLOAD)
  const kind = e => ['TypeError', 'SyntaxError', 'RangeError'].find(k => e instanceof globalThis[k]) ?? (e instanceof Error ? 'Error' : typeof e)
  const iso = d => (d instanceof Date ? (Number.isNaN(d.getTime()) ? 'Invalid Date' : d.toISOString()) : `not a Date: ${typeof d}`)
  const plain = v => { try { return JSON.parse(JSON.stringify(v ?? null)) } catch { return 'not serializable' } }
  const revive = a => (a !== null && typeof a === 'object' && '$date' in a ? new Date(a.$date) : a)
  const one = (m, [fn, ...args]) => {
    let v
    try { v = m[fn](...args.map(revive)) } catch (e) { return { error: kind(e), message: String(e?.message ?? e) } }
    if (fn !== 'next') return { value: plain(v) }
    return { value: Array.isArray(v) ? v.map(iso) : `not an array: ${typeof v}` }
  }
  let out
  try {
    const m = await import(url)
    out = typeof m.parse === 'function' && typeof m.next === 'function'
      ? calls.map(c => one(m, c))
      : { fatal: 'cron.mjs does not export the functions parse and next' }
  } catch (e) {
    out = { fatal: `cannot import cron.mjs: ${e?.message ?? e}` }
  }
  process.stdout.write(`\n${mark}${JSON.stringify(out)}\n`, () => process.exit(0))
}

const show = a => (a instanceof Date ? (Number.isNaN(a.getTime()) ? 'Invalid Date' : a.toISOString()) : JSON.stringify(a))
const encode = a => (a instanceof Date ? { $date: Number.isNaN(a.getTime()) ? 'invalid' : a.toISOString() } : a)

// Each call is [fnName, ...args]; returns one outcome per call: { value } or { error, message }, plus a label.
function run (...calls) {
  const dir = process.env.TARGET_DIR
  assert.ok(dir, 'TARGET_DIR is not set')
  const payload = JSON.stringify({ url: pathToFileURL(join(dir, 'cron.mjs')).href, mark: MARK, calls: calls.map(c => c.map(encode)) })
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), TZ: 'Asia/Kolkata', H3_PAYLOAD: payload }
  const r = spawnSync(process.execPath, ['-e', `(${child})()`], { env, encoding: 'utf8', timeout: LIMIT_MS, windowsHide: true })
  if (r.error?.code === 'ETIMEDOUT') assert.fail(`cron.mjs gave no answer within ${LIMIT_MS / 1000} s (endless loop?)`)
  const stdout = r.stdout ?? ''
  const at = stdout.lastIndexOf(MARK)
  if (at < 0) assert.fail(`cron.mjs run ended without a result (exit ${r.status}): ${(r.stderr ?? '').trim().slice(0, 300)}`)
  const out = JSON.parse(stdout.slice(at + MARK.length).split('\n')[0])
  if (out.fatal) assert.fail(out.fatal)
  return out.map((o, i) => ({ ...o, label: `${calls[i][0]}(${calls[i].slice(1).map(show).join(', ')})` }))
}

const value = o => {
  if ('error' in o) assert.fail(`${o.label} threw ${o.error}: ${o.message}`)
  return o.value
}
const throwsLike = (o, kind, re) => {
  assert.ok('error' in o, `${o.label} should throw ${kind} but returned ${String(JSON.stringify(o.value)).slice(0, 200)}`)
  assert.equal(o.error, kind, `${o.label} should throw ${kind}, threw ${o.error}: ${o.message}`)
  if (re) assert.match(o.message, re, `${o.label} message`)
}
const parse = (...exprs) => run(...exprs.map(e => ['parse', e])).map(value)
const next = (expr, from, ...n) => value(run(['next', expr, new Date(from), ...n])[0])
const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)

test('*/15 from 00:07 with n = 3 gives 00:15, 00:30, 00:45', () => {
  assert.deepEqual(next('*/15 * * * *', '2026-01-01T00:07:00Z', 3),
    ['2026-01-01T00:15:00.000Z', '2026-01-01T00:30:00.000Z', '2026-01-01T00:45:00.000Z'])
})

test('next is strictly after from (n defaults to 1)', () => {
  assert.deepEqual(next('0 12 * * *', '2026-03-01T12:00:00Z'), ['2026-03-02T12:00:00.000Z'])
})

test('seconds and milliseconds of results are 0', () => {
  assert.deepEqual(next('* * * * *', '2026-01-01T00:07:30.500Z'), ['2026-01-01T00:08:00.000Z'])
})

test('day of month and day of week both restricted: either one matches (OR)', () => {
  // 2026-01-02 and 2026-01-09 are Fridays; 2026-01-13 is a Tuesday.
  assert.deepEqual(next('0 0 13 * FRI', FROM, 3),
    ['2026-01-02T00:00:00.000Z', '2026-01-09T00:00:00.000Z', '2026-01-13T00:00:00.000Z'])
})

test('7 is Sunday and is stored as 0', () => {
  const [seven, fiveToSeven] = parse('0 0 * * 7', '0 0 * * 5-7')
  assert.deepEqual(seven.dayOfWeek, [0])
  assert.deepEqual(fiveToSeven.dayOfWeek, [0, 5, 6])
})

test('Feb 29 is found in the next leap year', () => {
  assert.deepEqual(next('0 0 29 2 *', FROM), ['2028-02-29T00:00:00.000Z'])
})

test('day 31 skips months that are shorter', () => {
  assert.deepEqual(next('0 0 31 * *', '2026-04-01T00:00:00Z'), ['2026-05-31T00:00:00.000Z'])
})

test('steps: a-b/s from a, n/s from n to the maximum, */s on day of week', () => {
  const [ab, ns, dow] = parse('1-10/3 * * * *', '5/20 * * * *', '0 0 * * */2')
  assert.deepEqual(ab.minute, [1, 4, 7, 10])
  assert.deepEqual(ns.minute, [5, 25, 45])
  assert.deepEqual(dow.dayOfWeek, [0, 2, 4, 6])
})

test('month and day names work in any letter case, also in ranges', () => {
  const [p] = parse('* * * jan-MAR mon,Fri')
  assert.deepEqual(p.month, [1, 2, 3])
  assert.deepEqual(p.dayOfWeek, [1, 5])
})

test('duplicate values are listed once', () => {
  assert.deepEqual(parse('1,1,2 * * * *')[0].minute, [1, 2])
})

test('extra and surrounding spaces are ignored', () => {
  const [p] = parse('  0   0 * * *  ')
  assert.deepEqual(p.minute, [0])
  assert.deepEqual(p.hour, [0])
})

test('invalid expressions throw SyntaxError starting with "Invalid cron expression"', () => {
  const bad = ['60 * * * *', '* * * *', '5-1 * * * *', '*/0 * * * *', '1,,2 * * * *', '* * * FOO *', '* * 0 * *']
  for (const o of run(...bad.map(e => ['parse', e]))) throwsLike(o, 'SyntaxError', /^Invalid cron expression/)
})

test('wrong argument types throw TypeError', () => {
  const ok = new Date(FROM)
  const outcomes = run(
    ['parse', 5],
    ['next', '* * * * *', 'x'],
    ['next', '* * * * *', new Date('bad')],
    ['next', '* * * * *', ok, 0],
    ['next', '* * * * *', ok, 1001],
    ['next', '* * * * *', ok, 1.5],
  )
  for (const o of outcomes) throwsLike(o, 'TypeError')
})

test('no match within 5 years throws RangeError starting with "No match"', () => {
  throwsLike(run(['next', '0 0 30 2 *', new Date(FROM)])[0], 'RangeError', /^No match/)
})

// The tests below cover spec lines that the examples above leave open.

test('parse returns exactly the five fields, day of week as 0-6', () => {
  assert.deepEqual({ ...parse('* * * * *')[0] }, {
    minute: range(0, 59), hour: range(0, 23), dayOfMonth: range(1, 31), month: range(1, 12), dayOfWeek: range(0, 6),
  })
})

test('*/s counts from the field minimum (1 for day of month and month)', () => {
  const [p] = parse('0 0 */10 */3 *')
  assert.deepEqual(p.dayOfMonth, [1, 11, 21, 31])
  assert.deepEqual(p.month, [1, 4, 7, 10])
})

test('day of week n/s stops at 6', () => {
  assert.deepEqual(parse('0 0 * * 1/3')[0].dayOfWeek, [1, 4])
})

test('a range a-b with a = b is one value', () => {
  assert.deepEqual(parse('5-5 * * * *')[0].minute, [5])
})

test('when only one day field is restricted, only that one counts', () => {
  const [domOnly, dowOnly] = run(['next', '0 0 13 * *', new Date(FROM), 2], ['next', '0 0 * * FRI', new Date(FROM), 2]).map(value)
  assert.deepEqual(domOnly, ['2026-01-13T00:00:00.000Z', '2026-02-13T00:00:00.000Z'])
  assert.deepEqual(dowOnly, ['2026-01-02T00:00:00.000Z', '2026-01-09T00:00:00.000Z'])
})

test('a day field is unrestricted only when it is exactly *: */1 still takes part in the OR', () => {
  assert.deepEqual(next('0 0 13 * */1', FROM, 2), ['2026-01-02T00:00:00.000Z', '2026-01-03T00:00:00.000Z'])
})

test('out-of-range values, wrong field count and malformed numbers throw SyntaxError', () => {
  const bad = ['* 24 * * *', '* * 32 * *', '* * * 0 *', '* * * 13 *', '* * * * 8', '* * * * * *', '', '   ', '-5 * * * *', '1.5 * * * *', '5x * * * *']
  for (const o of run(...bad.map(e => ['parse', e]))) throwsLike(o, 'SyntaxError', /^Invalid cron expression/)
})

test('n = 1000 is allowed', () => {
  const start = Date.parse(FROM)
  const expected = Array.from({ length: 1000 }, (_, i) => new Date(start + (i + 1) * 60_000).toISOString())
  assert.deepEqual(next('* * * * *', FROM, 1000), expected)
})

test('next checks expr like parse does', () => {
  const [notString, invalid] = run(['next', 5, new Date(FROM)], ['next', '60 * * * *', new Date(FROM)])
  throwsLike(notString, 'TypeError')
  throwsLike(invalid, 'SyntaxError', /^Invalid cron expression/)
})
