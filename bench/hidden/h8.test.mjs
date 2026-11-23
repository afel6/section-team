// Hidden tests for held-out task h8: the loans CLI in bench/seeds/h8, two bugs in shared code (impossible dates roll over
// into the next month, and loan numbers come from the list length, so a remove makes the next add reuse a number).
// Every case runs loans.mjs as a child process in its own temp folder with its own LOANS_FILE; some data files are
// written first in the seed's format. Outputs, exit codes and data file contents are compared exactly.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const TARGET = process.env.TARGET_DIR
if (!TARGET) throw new Error('TARGET_DIR is not set')
const CLI = join(TARGET, 'loans.mjs')
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !['NODE_TEST_CONTEXT', 'LOANS_FILE'].includes(k)))
let root
before(() => { root = mkdtempSync(join(tmpdir(), 'h8-')) })
after(() => { if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5 }) })

// A temp folder with its own data file; run(...args) runs one command there. file: null means LOANS_FILE is left unset.
function box({ file = 'data.json', store } = {}) {
  const dir = mkdtempSync(join(root, 'b-'))
  const path = file === null ? join(dir, 'loans.json') : join(dir, file)
  if (store) writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`)
  const run = (...args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env: file === null ? env : { ...env, LOANS_FILE: path }, encoding: 'utf8', timeout: 20_000, windowsHide: true })
    return { code: r.status ?? `no exit (${r.error?.code ?? r.signal})`, out: r.stdout, err: r.stderr }
  }
  return { dir, path, run, text: () => (existsSync(path) ? readFileSync(path, 'utf8') : null) }
}
const OK = (...lines) => ({ code: 0, out: lines.map(l => `${l}\n`).join(''), err: '' })
const ERR = message => ({ code: 1, out: '', err: `error: ${message}\n` })
const DATE_ERR = ERR('due date must be a real date as YYYY-MM-DD')
const same = (label, got, want) => assert.deepEqual({ label, ...got }, { label, ...want })
const show = (n, item, person, due, returned = false) => OK(`loan #${n}`, `item: ${item}`, `to: ${person}`, `due: ${due ?? '-'}`, `returned: ${returned ? 'yes' : 'no'}`)
// Runs each [args, want] in order, checking the reply of each.
const script = (b, steps) => { for (const [args, want] of steps) same(args.join(' '), b.run(...args), want) }
// The seed's store layout: { loans: [{ number, item, person, due, returned }] }.
const loan = (number, item, person, due = null, returned = false) => ({ number, item, person, due, returned })

const IMPOSSIBLE = ['2026-02-29', '2026-02-30', '2026-02-31', '2026-04-31', '2026-06-31', '2026-09-31', '2026-11-31', '2027-02-29', '2025-02-29', '2100-02-29', '1900-02-29', '2026-01-32', '2026-13-01', '2026-00-10', '2026-01-00']
const REAL = ['2024-02-29', '2000-02-29', '2400-02-29', '2028-02-29', '2026-02-28', '2026-01-31', '2026-03-31', '2026-04-30', '2026-06-30', '2026-09-30', '2026-11-30', '2026-12-31', '1999-12-31', '2099-12-31']
const MISSHAPEN = ['2026-2-03', '26-02-03', '2026/02/03', '20260203', '2026-02-3', '2026-02-03T00:00', '2026-02-03 ', ' 2026-02-03', 'tomorrow', '', '２０２６-02-03']

// --- Problem 1: dates that do not exist ---
test('problem 1: add --due 2026-02-30 is refused with the date error, nothing is saved, and no loan shows up due 2026-03-02', () => {
  const b = box()
  script(b, [[['add', 'Drill', '--to', 'Sam', '--due', '2026-02-30'], DATE_ERR], [['list'], OK('no loans')], [['list', '--all'], OK('no loans')]])
  assert.equal(b.text(), null, 'a refused add must not write the data file')
})
test('add --due refuses every day its month does not have, with leap years as the calendar has them, and changes nothing', () => {
  const b = box()
  script(b, [[['add', 'Drill', '--to', 'Sam', '--due', '2026-03-01'], OK('added #1')]])
  const was = b.text()
  for (const due of IMPOSSIBLE) same(due, b.run('add', 'Tent', '--to', 'Kim', '--due', due), DATE_ERR)
  assert.equal(b.text(), was, 'refused adds must not change the data file')
  script(b, [[['list', '--all'], OK('#1 Drill -> Sam (due 2026-03-01)')], [['add', 'Tent', '--to', 'Kim'], OK('added #2')]])
})
test('add --due keeps every real date exactly as typed: month ends and leap days included', () => {
  const b = box()
  for (const [i, due] of REAL.entries()) {
    same(due, b.run('add', `Item ${i}`, '--to', 'Kim', '--due', due), OK(`added #${i + 1}`))
    same(due, b.run('show', String(i + 1)), show(i + 1, `Item ${i}`, 'Kim', due))
  }
  same('list', b.run('list'), OK(...REAL.map((due, i) => [due, `#${i + 1} Item ${i} -> Kim (due ${due})`]).sort().map(([, line]) => line)))
})
test('edit --due refuses an impossible date and keeps the loan as it was, other changes in the same edit included', () => {
  const b = box()
  script(b, [[['add', 'Drill', '--to', 'Sam', '--due', '2026-02-10'], OK('added #1')]])
  const was = b.text()
  for (const due of IMPOSSIBLE) same(due, b.run('edit', '1', '--due', due), DATE_ERR)
  script(b, [[['edit', '1', '--item', 'Big drill', '--due', '2026-02-30'], DATE_ERR], [['edit', '1', '--due', '2100-02-29', '--to', 'Kim'], DATE_ERR]])
  assert.equal(b.text(), was, 'refused edits must not change the data file')
  script(b, [[['show', '1'], show(1, 'Drill', 'Sam', '2026-02-10')], [['edit', '1', '--due', '2028-02-29'], OK('updated #1')], [['show', '1'], show(1, 'Drill', 'Sam', '2028-02-29')],
    [['edit', '1', '--due', '2026-04-30'], OK('updated #1')], [['show', '1'], show(1, 'Drill', 'Sam', '2026-04-30')]])
})
test('list --due-before refuses an impossible date, with or without other options, and prints nothing on stdout', () => {
  const b = box()
  for (const due of ['2026-02-27', '2026-03-01', '2026-03-02', '2026-03-03']) b.run('add', `Due ${due}`, '--to', 'Sam', '--due', due)
  for (const date of ['2026-02-30', '2026-02-31', '2026-02-29', '2026-04-31', '2100-02-29', '2027-02-29']) {
    for (const extra of [[], ['--all'], ['--to', 'Sam']]) same(`${date} ${extra.join(' ')}`, b.run('list', '--due-before', date, ...extra), DATE_ERR)
  }
})
test('list --due-before with a real date keeps the loans due strictly before it', () => {
  const b = box()
  for (const due of ['2026-03-02', '2026-02-27', '2026-03-01', '2026-02-28']) b.run('add', `Due ${due}`, '--to', 'Sam', '--due', due)
  b.run('add', 'No date', '--to', 'Sam')
  const line = (n, due) => `#${n} Due ${due} -> Sam (due ${due})`
  script(b, [[['list', '--due-before', '2026-03-01'], OK(line(2, '2026-02-27'), line(4, '2026-02-28'))], [['list', '--due-before', '2026-02-28'], OK(line(2, '2026-02-27'))],
    [['list', '--due-before', '2026-03-02'], OK(line(2, '2026-02-27'), line(4, '2026-02-28'), line(3, '2026-03-01'))], [['list', '--due-before', '2024-02-29'], OK('no loans')],
    [['list', '--due-before', '2028-02-29'], OK(line(2, '2026-02-27'), line(4, '2026-02-28'), line(3, '2026-03-01'), line(1, '2026-03-02'))]])
})
test('dates in any other shape are still refused by add --due, edit --due and list --due-before', () => {
  const b = box()
  script(b, [[['add', 'Drill', '--to', 'Sam', '--due', '2026-02-03'], OK('added #1')]])
  for (const date of MISSHAPEN) {
    same(`add ${date}`, b.run('add', 'Tent', '--to', 'Kim', '--due', date), DATE_ERR)
    same(`edit ${date}`, b.run('edit', '1', '--due', date), DATE_ERR)
    same(`list ${date}`, b.run('list', '--due-before', date), DATE_ERR)
  }
  script(b, [[['list'], OK('#1 Drill -> Sam (due 2026-02-03)')]])
})

// --- Problem 2: loan numbers are never given twice ---
test('problem 2: after #2 of three loans is removed, the next loan is #4, and back 3 returns only the ladder', () => {
  const b = box()
  script(b, [[['add', 'Drill', '--to', 'Sam'], OK('added #1')], [['add', 'Sw', '--to', 'Kim'], OK('added #2')], [['add', 'Ladder', '--to', 'Lee'], OK('added #3')],
    [['remove', '2'], OK('removed #2')], [['add', 'Saw', '--to', 'Kim'], OK('added #4')], [['list'], OK('#1 Drill -> Sam', '#3 Ladder -> Lee', '#4 Saw -> Kim')],
    [['back', '4'], OK('returned #4')], [['list'], OK('#1 Drill -> Sam', '#3 Ladder -> Lee')], [['show', '3'], show(3, 'Ladder', 'Lee', null)],
    [['back', '3'], OK('returned #3')], [['list', '--all'], OK('#1 Drill -> Sam', '#3 Ladder -> Lee [returned]', '#4 Saw -> Kim [returned]')]])
})
test('removing the newest loan does not free its number for the next one', () => {
  const b = box()
  script(b, [[['add', 'A', '--to', 'Sam'], OK('added #1')], [['add', 'B', '--to', 'Sam'], OK('added #2')], [['remove', '2'], OK('removed #2')],
    [['add', 'C', '--to', 'Sam'], OK('added #3')], [['remove', '3'], OK('removed #3')], [['remove', '1'], OK('removed #1')], [['add', 'D', '--to', 'Sam'], OK('added #4')],
    [['show', '3'], ERR('no loan #3')], [['show', '4'], show(4, 'D', 'Sam', null)], [['list', '--all'], OK('#4 D -> Sam')]])
})
test('numbers keep counting after every loan is removed, and stay unique over many adds and removes', () => {
  const b = box()
  for (let i = 1; i <= 10; i += 1) same(`add ${i}`, b.run('add', `Thing ${i}`, '--to', 'Sam'), OK(`added #${i}`))
  for (const n of [10, 1, 3, 5, 7, 9]) same(`remove ${n}`, b.run('remove', String(n)), OK(`removed #${n}`))
  for (let i = 11; i <= 14; i += 1) same(`add ${i}`, b.run('add', `Thing ${i}`, '--to', 'Kim'), OK(`added #${i}`))
  const numbers = b.run('list', '--all').out.trim().split('\n').map(l => l.split(' ')[0])
  assert.deepEqual(numbers, ['#2', '#4', '#6', '#8', '#11', '#12', '#13', '#14'])
  for (const n of [2, 4, 6, 8, 11, 12, 13, 14]) b.run('remove', String(n))
  script(b, [[['list', '--all'], OK('no loans')], [['add', 'Last', '--to', 'Lee'], OK('added #15')]])
})
test('a data file saved before the fix keeps working: its loans are shown as they are, and the next number follows the highest', () => {
  const old = [loan(1, 'Drill', 'Sam', '2026-03-01'), loan(2, 'Tent', 'Kim', null, true), loan(4, 'Ladder', 'Lee', '2026-02-20')]
  const b = box({ store: { loans: old } })
  script(b, [[['list', '--all'], OK('#4 Ladder -> Lee (due 2026-02-20)', '#1 Drill -> Sam (due 2026-03-01)', '#2 Tent -> Kim [returned]')], [['show', '2'], show(2, 'Tent', 'Kim', null, true)],
    [['people'], OK('Lee: 1', 'Sam: 1')], [['add', 'Saw', '--to', 'Kim'], OK('added #5')], [['back', '4'], OK('returned #4')],
    [['list', '--all'], OK('#4 Ladder -> Lee (due 2026-02-20) [returned]', '#1 Drill -> Sam (due 2026-03-01)', '#2 Tent -> Kim [returned]', '#5 Saw -> Kim')],
    [['remove', '5'], OK('removed #5')], [['add', 'Rake', '--to', 'Sam'], OK('added #6')]])
})
test('an old data file whose loans are out of number order: the next number still follows the highest', () => {
  const b = box({ store: { loans: [loan(3, 'Drill', 'Sam'), loan(1, 'Tent', 'Kim')] } })
  script(b, [[['add', 'Saw', '--to', 'Lee'], OK('added #4')], [['list'], OK('#1 Tent -> Kim', '#3 Drill -> Sam', '#4 Saw -> Lee')], [['back', '3'], OK('returned #3')],
    [['list'], OK('#1 Tent -> Kim', '#4 Saw -> Lee')]])
})
test('a refused add does not use up a number: the next loan gets the number it would have had', () => {
  const b = box()
  script(b, [[['add', 'Drill', '--to', 'Sam', '--due', '2026-02-30'], DATE_ERR], [['add', 'Drill', '--to', 'Sam'], OK('added #1')], [['add', 'Tent'], ERR('--to is required')],
    [['add', 'Tent', '--to', 'Kim', '--due', '2026-04-31'], DATE_ERR], [['add', 'Tent', '--to', 'Kim'], OK('added #2')]])
})
test('each data file counts its own numbers', () => {
  const a = box({ file: 'a.json' })
  const b = { ...a, run: (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: a.dir, env: { ...env, LOANS_FILE: join(a.dir, 'b.json') }, encoding: 'utf8', timeout: 20_000, windowsHide: true }).stdout }
  script(a, [[['add', 'A', '--to', 'Sam'], OK('added #1')], [['add', 'B', '--to', 'Sam'], OK('added #2')], [['remove', '2'], OK('removed #2')]])
  assert.deepEqual([b.run('add', 'C', '--to', 'Kim'), b.run('add', 'D', '--to', 'Kim')], ['added #1\n', 'added #2\n'])
  script(a, [[['add', 'E', '--to', 'Sam'], OK('added #3')]])
})
test('an old data file with no loans starts at #1 and then counts on', () => {
  const b = box({ store: { loans: [] } })
  script(b, [[['add', 'Drill', '--to', 'Sam'], OK('added #1')], [['remove', '1'], OK('removed #1')], [['add', 'Tent', '--to', 'Kim'], OK('added #2')]])
})

// --- Everything else still works as README.md says ---
test('the commands still work as README.md says: add, list, show, back, edit, remove, rename and people', () => {
  const b = box()
  script(b, [[['add', 'Blue', 'umbrella', '--to', 'Kim'], OK('added #1')], [['add', '--to', 'Sam', 'Drill', '--due', '2026-03-01'], OK('added #2')],
    [['add', '  Tent  ', '--to', ' Sammy ', '--due', '2026-02-15'], OK('added #3')],
    [['list'], OK('#3 Tent -> Sammy (due 2026-02-15)', '#2 Drill -> Sam (due 2026-03-01)', '#1 Blue umbrella -> Kim')],
    [['back', '2'], OK('returned #2')], [['people'], OK('Kim: 1', 'Sammy: 1')], [['rename', 'Sammy', '--to', 'Sam'], OK('renamed 1 loan')],
    [['edit', '1', '--due', '2026-02-15', '--item', 'Red umbrella'], OK('updated #1')], [['edit', '3', '--no-due'], OK('updated #3')],
    [['list', '--all'], OK('#1 Red umbrella -> Kim (due 2026-02-15)', '#2 Drill -> Sam (due 2026-03-01) [returned]', '#3 Tent -> Sam')],
    [['list', '--to', 'Sam', '--all'], OK('#2 Drill -> Sam (due 2026-03-01) [returned]', '#3 Tent -> Sam')], [['list', '--to', 'sam'], OK('no loans')],
    [['remove', '1'], OK('removed #1')], [['show', '3'], show(3, 'Tent', 'Sam', null)], [['people'], OK('Sam: 1')]])
})
test('errors print "error: <message>", exit 1 and leave the data file as it was', () => {
  const b = box()
  script(b, [[['add', 'Drill', '--to', 'Sam'], OK('added #1')], [['back', '1'], OK('returned #1')]])
  const was = b.text()
  script(b, [[['back', '1'], ERR('loan #1 is already returned')], [['back', '9'], ERR('no loan #9')], [['remove', '1x'], ERR('loan number must be a whole number like 3')],
    [['edit', '01', '--item', 'X'], ERR('loan number must be a whole number like 3')], [['edit', '1'], ERR('nothing to change')], [['add', 'Tent'], ERR('--to is required')],
    [['add', 'Tent', '--to', 'x'.repeat(41)], ERR('person must be 1 to 40 characters')], [['add', '--to', 'Kim'], ERR('item must be 1 to 100 characters')],
    [['list', '--late'], ERR('unknown option --late')], [['edit', '1', '--due', '2026-03-01', '--no-due'], ERR('--due and --no-due cannot be used together')],
    [['show'], ERR('expected one loan number')], [['rename', 'Kim', '--to', 'Sam'], ERR('nobody called Kim')]])
  assert.equal(b.text(), was)
})
test('a missing or unknown command prints the usage to stderr and exits 2', () => {
  const b = box()
  for (const args of [[], ['lend'], ['ADD', 'x', '--to', 'y']]) {
    const r = b.run(...args)
    same(args.join(' '), { code: r.code, out: r.out, usage: /^usage: node loans\.mjs <command>/.test(r.err) }, { code: 2, out: '', usage: true })
  }
  assert.equal(b.text(), null)
})
test('without LOANS_FILE the data file is loans.json in the current folder, and no temp file is left behind', () => {
  const b = box({ file: null })
  script(b, [[['add', 'Drill', '--to', 'Sam'], OK('added #1')], [['add', 'Tent', '--to', 'Kim'], OK('added #2')], [['remove', '1'], OK('removed #1')], [['add', 'Saw', '--to', 'Lee'], OK('added #3')]])
  assert.deepEqual(readdirSync(b.dir), ['loans.json'])
  script(b, [[['list'], OK('#2 Tent -> Kim', '#3 Saw -> Lee')]])
})
test('a damaged data file is refused and left as it was', () => {
  const b = box()
  for (const text of ['{"loans": ', '[]', '{"loans": 5}', 'null']) {
    writeFileSync(b.path, text)
    same(text, b.run('add', 'Drill', '--to', 'Sam'), ERR(`data file ${b.path} is damaged`))
    assert.equal(b.text(), text)
  }
})
