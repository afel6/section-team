// Hidden tests for held-out task f1: the timelog tool in bench/seeds/f1, three bugs (entries past midnight, --to not
// inclusive, minutes not padded) and the new check command. The tool is run as a process only; every case compares
// exit code, stdout and stderr exactly. Log files are written to a fresh temp folder, which is the process's cwd.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const DIR = process.env.TARGET_DIR
if (!DIR) throw new Error('TARGET_DIR is not set')
const CLI = join(DIR, 'timelog.mjs')
const USAGE = 'usage: node timelog.mjs report <file> [--from <date>] [--to <date>]\n'
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'))

let root
let count = 0
before(() => { root = mkdtempSync(join(tmpdir(), 'f1-')) })
after(() => { if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5 }) })

// A fresh folder holding files { name: text | Buffer }; returns its path.
function setup(files = {}) {
  const dir = join(root, `case${++count}`)
  mkdirSync(dir)
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  return dir
}
function run(dir, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env, encoding: 'utf8', timeout: 15_000, windowsHide: true })
  if (r.error) throw r.error
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const ok = out => ({ code: 0, out, err: '' })
const overlapping = out => ({ code: 1, out, err: '' })
const error = (code, err) => ({ code, out: '', err })
const lines = (...l) => l.map(x => `${x}\n`).join('')
// Runs each [args, want] in one folder holding files.
function expect(files, ...cases) {
  const dir = setup(files)
  for (const [args, want] of cases) assert.deepEqual(run(dir, args), want, args.join(' '))
}
const log = (...entries) => entries.join('\n') + '\n'

// --- Bug 1: an entry whose end is earlier than its start runs past midnight ---
test('bug 1: 23:30-00:30 is one hour, not -23:0', () => expect(
  { 'w.log': log('2026-03-06 23:30-00:30 release') },
  [['report', 'w.log'], ok(lines('release\t1:00', 'total\t1:00'))]))
test('bug 1: past-midnight lengths at the edges: 23:59-00:00, 00:01-00:00, 12:00-11:59', () => expect(
  { 'w.log': log('2026-03-06 23:59-00:00 a', '2026-03-06 00:01-00:00 b', '2026-03-07 12:00-11:59 c', '2026-03-07 08:00-09:00 a') },
  [['report', 'w.log'], ok(lines('b\t23:59', 'c\t23:59', 'a\t1:01', 'total\t48:59'))]))
test('bug 1: an entry past midnight belongs to its start date for --from and --to', () => expect(
  { 'w.log': log('2026-03-04 23:00-01:00 a', '2026-03-05 10:00-10:30 b') },
  [['report', 'w.log', '--to', '2026-03-04'], ok(lines('a\t2:00', 'total\t2:00'))],
  [['report', 'w.log', '--from', '2026-03-05'], ok(lines('b\t0:30', 'total\t0:30'))]))
test('bug 1: totals with past-midnight entries sort by their real length', () => expect(
  { 'w.log': log('2026-03-01 22:00-02:00 night', '2026-03-01 09:00-12:00 day', '2026-03-02 23:50-00:10 night') },
  [['report', 'w.log'], ok(lines('night\t4:20', 'day\t3:00', 'total\t7:20'))]))

// --- Bug 2: --to includes its own date ---
test('bug 2: --to 2026-03-05 keeps the entries of March 5', () => expect(
  { 'w.log': log('2026-03-04 09:00-10:00 a', '2026-03-05 09:00-09:45 b', '2026-03-05 11:00-11:30 a', '2026-03-06 09:00-12:00 c') },
  [['report', 'w.log', '--to', '2026-03-05'], ok(lines('a\t1:30', 'b\t0:45', 'total\t2:15'))]))
test('bug 2: --from and --to on the same date give that date only; both bounds are included', () => expect(
  { 'w.log': log('2026-03-04 09:00-10:00 a', '2026-03-05 09:00-09:45 b', '2026-03-06 09:00-12:00 c') },
  [['report', 'w.log', '--from', '2026-03-05', '--to', '2026-03-05'], ok(lines('b\t0:45', 'total\t0:45'))],
  [['report', 'w.log', '--to', '2026-03-06', '--from', '2026-03-04'], ok(lines('c\t3:00', 'a\t1:00', 'b\t0:45', 'total\t4:45'))],
  [['report', 'w.log', '--to', '2026-03-03'], ok(lines('total\t0:00'))]))
test('bug 2: --to across month and year ends, and a --from after --to', () => expect(
  { 'w.log': log('2025-12-31 10:00-11:00 a', '2026-01-01 10:00-10:10 b', '2024-02-29 10:00-10:20 c', '2024-03-01 10:00-10:30 d') },
  [['report', 'w.log', '--to', '2025-12-31'], ok(lines('a\t1:00', 'd\t0:30', 'c\t0:20', 'total\t1:50'))],
  [['report', 'w.log', '--from', '2024-02-29', '--to', '2024-02-29'], ok(lines('c\t0:20', 'total\t0:20'))],
  [['report', 'w.log', '--from', '2026-01-02', '--to', '2026-01-01'], ok(lines('total\t0:00'))]))

// --- Bug 3: minutes always have two digits ---
test('bug 3: 65 minutes is 1:05 and an empty log is total 0:00', () => expect(
  { 'w.log': log('2026-03-01 09:00-10:05 a'), 'empty.log': '', 'notes.log': '# nothing yet\n\n  \t\n' },
  [['report', 'w.log'], ok(lines('a\t1:05', 'total\t1:05'))], [['report', 'empty.log'], ok(lines('total\t0:00'))],
  [['report', 'notes.log'], ok(lines('total\t0:00'))]))
test('bug 3: every duration is H:MM with two-digit minutes, hours as long as needed', () => {
  const many = Array.from({ length: 5 }, (_, i) => `2026-04-0${i + 1} 00:00-23:59 big`)
  expect({ 'w.log': log('2026-03-01 09:00-09:01 a', '2026-03-01 09:00-09:09 b', '2026-03-01 09:00-09:10 c', '2026-03-01 09:00-11:00 d', ...many) },
    [['report', 'w.log'], ok(lines('big\t119:55', 'd\t2:00', 'c\t0:10', 'b\t0:09', 'a\t0:01', 'total\t122:15'))])
})

// --- Behaviour the README already had, which must not change ---
test('report: ties sort by project name; notes are ignored; CRLF, tabs and a BOM are accepted', () => expect(
  { 'w.log': Buffer.from(`﻿# log\r\n2026-03-01\t09:00-10:00\tb  with a note\r\n  2026-03-01 11:00-12:00 a-b\r\n2026-03-01 13:00-14:00 ab\r\n2026-03-01 14:00-14:05 a\r\n`) },
  [['report', 'w.log'], ok(lines('a-b\t1:00', 'ab\t1:00', 'b\t1:00', 'a\t0:05', 'total\t3:05'))]))
test('report: usage errors, then option dates (--from first), exit 2', () => expect(
  { 'w.log': log('2026-03-01 09:00-10:00 a') },
  ...[[], ['list', 'w.log'], ['report'], ['report', 'w.log', '--from'], ['report', 'w.log', '--since', '2026-03-01'],
    ['report', 'w.log', '--to', '2026-03-01', '--to', '2026-03-02'], ['REPORT', 'w.log']].map(a => [a, error(2, USAGE)]),
  [['report', 'w.log', '--to', 'soon', '--from', '2026-02-29'], error(2, 'error: bad date for --from: 2026-02-29\n')],
  [['report', 'w.log', '--to', '2026-3-5'], error(2, 'error: bad date for --to: 2026-3-5\n')],
  [['report', 'nope.log', '--to', 'x'], error(2, 'error: bad date for --to: x\n')]))
test('report: read, encoding and line errors keep their messages and exit codes', () => {
  const dir = setup({ 'bad.log': Buffer.from([0x32, 0x30, 0xc3, 0x28]), 'line.log': log('2026-03-01 09:00-10:00 a', '# c', '2026-03-01 23:00-23:00 a', 'x') })
  mkdirSync(join(dir, 'folder'))
  for (const [args, want] of [[['report', 'nope.log'], error(3, 'error: cannot read nope.log\n')], [['report', 'folder'], error(3, 'error: cannot read folder\n')],
    [['report', 'bad.log'], error(3, 'error: bad.log is not valid UTF-8\n')], [['report', 'line.log'], error(4, 'error: line 3: zero-length entry\n')]]) {
    assert.deepEqual(run(dir, args), want, args.join(' '))
  }
})

// --- Feature: check ---
test('check: no overlaps prints the entry count and exits 0', () => expect(
  { 'w.log': log('# day', '2026-03-01 09:00-10:00 a', '2026-03-01 10:00-11:00 b', '', '2026-03-01 11:00-12:00 a') },
  [['check', 'w.log'], ok(lines('no overlaps in 3 entries'))]))
test('check: one entry is "1 entry"; an empty or comment-only file is "0 entries"', () => expect(
  { 'one.log': log('2026-03-01 23:00-01:00 a'), 'empty.log': '', 'notes.log': '# a\n\n\t \n# b' },
  [['check', 'one.log'], ok(lines('no overlaps in 1 entry'))], [['check', 'empty.log'], ok(lines('no overlaps in 0 entries'))],
  [['check', 'notes.log'], ok(lines('no overlaps in 0 entries'))]))
test('check: an overlapping pair prints line <a> overlaps line <b> by <H:MM> and exits 1', () => expect(
  { 'w.log': log('# x', '2026-03-01 09:00-10:00 a', '2026-03-01 09:45-10:30 b') },
  [['check', 'w.log'], overlapping(lines('line 2 overlaps line 3 by 0:15'))]))
test('check: touching entries do not overlap; one shared minute does', () => expect(
  { 'touch.log': log('2026-03-01 09:00-10:00 a', '2026-03-01 10:00-11:00 a', '2026-03-01 08:00-09:00 b'),
    'one.log': log('2026-03-01 09:00-10:00 a', '2026-03-01 09:59-11:00 a') },
  [['check', 'touch.log'], ok(lines('no overlaps in 3 entries'))], [['check', 'one.log'], overlapping(lines('line 1 overlaps line 2 by 0:01'))]))
test('check: the shared time is printed as H:MM; identical entries overlap for their whole length; projects do not matter', () => expect(
  { 'w.log': log('2026-03-01 08:00-12:00 a', '2026-03-01 08:00-12:00 b', '2026-03-01 10:55-13:00 c', '2026-03-02 00:00-23:59 d', '2026-03-02 00:00-23:59 d') },
  [['check', 'w.log'], overlapping(lines('line 1 overlaps line 2 by 4:00', 'line 1 overlaps line 3 by 1:05', 'line 2 overlaps line 3 by 1:05',
    'line 4 overlaps line 5 by 23:59'))]))
test('check: pairs are sorted by the first line, then the second, whatever order the file has', () => expect(
  { 'w.log': log('2026-03-02 09:00-10:00 a', '2026-03-01 09:00-10:00 b', '2026-03-02 09:30-09:40 c', '2026-03-01 09:50-11:00 d', '2026-03-02 08:00-09:10 e') },
  [['check', 'w.log'], overlapping(lines('line 1 overlaps line 3 by 0:10', 'line 1 overlaps line 5 by 0:10', 'line 2 overlaps line 4 by 0:10'))]))
test('check: line numbers count blank lines and comments, and CRLF files work', () => expect(
  { 'w.log': Buffer.from('﻿# a\r\n\r\n2026-03-01 09:00-10:00 a\r\n# b\r\n\r\n2026-03-01 09:30-10:00 b\r\n') },
  [['check', 'w.log'], overlapping(lines('line 3 overlaps line 6 by 0:30'))]))
test('check: an entry past midnight overlaps entries of the next day, also across months, years and leap days', () => expect(
  { 'w.log': log('2026-03-01 23:00-01:00 a', '2026-03-02 00:30-02:00 b', '2025-12-31 23:30-00:45 c', '2026-01-01 00:15-03:00 d',
    '2024-02-28 23:00-00:20 e', '2024-02-29 00:00-01:00 f', '2025-02-28 23:00-00:20 g', '2025-03-01 00:00-01:00 h', '2024-03-01 00:00-01:00 i') },
  [['check', 'w.log'], overlapping(lines('line 1 overlaps line 2 by 0:30', 'line 3 overlaps line 4 by 0:30', 'line 5 overlaps line 6 by 0:20',
    'line 7 overlaps line 8 by 0:20'))]))
test('check: entries on different dates at the same times do not overlap; a past-midnight entry does not reach the day before', () => expect(
  { 'w.log': log('2026-03-01 09:00-10:00 a', '2026-03-02 09:00-10:00 a', '2026-03-02 23:00-00:30 b', '2026-03-02 00:00-00:30 c', '2026-03-04 00:00-00:30 d') },
  [['check', 'w.log'], ok(lines('no overlaps in 5 entries'))]))
test('check: exactly 50 overlapping pairs prints 50 lines and no more line', () => {
  const entries = Array.from({ length: 50 }, (_, i) => [`2026-01-${String((i % 28) + 1).padStart(2, '0')} ${String(Math.floor(i / 28) * 2).padStart(2, '0')}:00-${String(Math.floor(i / 28) * 2).padStart(2, '0')}:30 a`])
    .flatMap(([e]) => [e, e])
  const want = Array.from({ length: 50 }, (_, i) => `line ${2 * i + 1} overlaps line ${2 * i + 2} by 0:30`)
  expect({ 'w.log': log(...entries) }, [['check', 'w.log'], overlapping(lines(...want))])
})
test('check: 51 pairs print the first 50 and "and 1 more"; 435 pairs print 50 and "and 385 more"', () => {
  const pairs = Array.from({ length: 51 }, (_, i) => `2026-0${Math.floor(i / 28) + 1}-${String((i % 28) + 1).padStart(2, '0')} 10:00-10:30 a`).flatMap(e => [e, e])
  const want51 = [...Array.from({ length: 50 }, (_, i) => `line ${2 * i + 1} overlaps line ${2 * i + 2} by 0:30`), 'and 1 more']
  const same = Array(30).fill('2026-03-01 09:00-09:05 a')
  const want435 = [...Array.from({ length: 29 }, (_, j) => `line 1 overlaps line ${j + 2} by 0:05`),
    ...Array.from({ length: 21 }, (_, j) => `line 2 overlaps line ${j + 3} by 0:05`), 'and 385 more']
  expect({ 'p.log': log(...pairs), 's.log': log(...same) }, [['check', 'p.log'], overlapping(lines(...want51))], [['check', 's.log'], overlapping(lines(...want435))])
})
test('check: a file with 300 entries and no overlaps finishes and counts them all', () => {
  const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const entries = Array.from({ length: 300 }, (_, i) => `2026-03-01 ${hhmm(i * 4)}-${hhmm(i * 4 + 4)} a`).reverse()
  expect({ 'w.log': log(...entries) }, [['check', 'w.log'], ok(lines('no overlaps in 300 entries'))])
})
test('check: without a file, or with anything after it, is the usage error, exit 2', () => expect(
  { 'w.log': log('2026-03-01 09:00-10:00 a') },
  ...[['check'], ['check', 'w.log', 'x.log'], ['check', 'w.log', '--from', '2026-03-01'], ['check', 'w.log', '--to', '2026-03-01'], ['check', 'w.log', ''],
    ['Check', 'w.log'], ['check', 'nope.log', '--to', 'x']].map(a => [a, error(2, USAGE)])))
test('check: read, encoding and line errors are those of report, with the same exit codes', () => {
  const dir = setup({ 'bad.log': Buffer.from([0xff]), 'line.log': log('2026-03-01 09:00-10:00 a', '2026-03-01 09:00-10:00 a', '2026-02-30 09:00-10:00 a'),
    'proj.log': log('2026-03-01 09:00-10:00 Admin'), 'few.log': '\n\n2026-03-01 09:00-10:00\n' })
  mkdirSync(join(dir, 'folder'))
  for (const [args, want] of [[['check', 'nope.log'], error(3, 'error: cannot read nope.log\n')], [['check', 'folder'], error(3, 'error: cannot read folder\n')],
    [['check', 'bad.log'], error(3, 'error: bad.log is not valid UTF-8\n')], [['check', 'line.log'], error(4, 'error: line 3: bad date\n')],
    [['check', 'proj.log'], error(4, 'error: line 1: bad project\n')], [['check', 'few.log'], error(4, 'error: line 3: missing fields\n')]]) {
    assert.deepEqual(run(dir, args), want, args.join(' '))
  }
})

// --- Deliverables ---
test('the README documents check', () => {
  const readme = readFileSync(join(DIR, 'README.md'), 'utf8')
  for (const text of ['node timelog.mjs check <file>', 'line <a> overlaps line <b> by <H:MM>', 'and <k> more']) assert.ok(readme.includes(text), `README lacks ${text}`)
})
test('package.json keeps a test script, and the solution has node:test tests beyond the seed', () => {
  const pkg = JSON.parse(readFileSync(join(DIR, 'package.json'), 'utf8'))
  assert.ok(typeof pkg.scripts?.test === 'string' && pkg.scripts.test.trim() !== '', 'no test script')
  const sources = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.isDirectory()) return ['node_modules', '.git'].includes(e.name) ? [] : sources(join(dir, e.name))
    return /\.[cm]?js$/.test(e.name) ? [join(dir, e.name)] : []
  })
  const tests = sources(DIR).filter(f => /['"]node:test['"]/.test(readFileSync(f, 'utf8')))
  assert.ok(tests.some(f => /check/.test(readFileSync(f, 'utf8'))), 'no node:test file mentions check')
})
