import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { failed, ok, withLoans } from './helpers.mjs'

test('add records a loan and list shows it', () => withLoans(loans => {
  assert.deepEqual(loans('add', 'Blue', 'umbrella', '--to', 'Kim'), ok('added #1\n'))
  assert.deepEqual(loans('add', '--to', 'Sam', 'Drill', '--due', '2026-03-01'), ok('added #2\n'))
  assert.deepEqual(loans('list'), ok('#2 Drill -> Sam (due 2026-03-01)\n#1 Blue umbrella -> Kim\n'))
}))

test('an empty list says so', () => withLoans(loans => {
  assert.deepEqual(loans('list'), ok('no loans\n'))
  assert.deepEqual(loans('people'), ok('nobody has anything\n'))
}))

test('list sorts by due date, then number, loans without a due date last', () => withLoans(loans => {
  loans('add', 'A', '--to', 'Kim')
  loans('add', 'B', '--to', 'Kim', '--due', '2026-05-01')
  loans('add', 'C', '--to', 'Kim', '--due', '2026-04-15')
  loans('add', 'D', '--to', 'Kim', '--due', '2026-05-01')
  assert.deepEqual(loans('list').stdout.split('\n').map(line => line.split(' ')[0]), ['#3', '#2', '#4', '#1', ''])
}))

test('list filters: --all, --to and --due-before', () => withLoans(loans => {
  loans('add', 'Drill', '--to', 'Sam', '--due', '2026-03-01')
  loans('add', 'Ladder', '--to', 'Kim', '--due', '2026-03-10')
  loans('add', 'Tent', '--to', 'Sam')
  loans('back', '1')
  assert.deepEqual(loans('list'), ok('#2 Ladder -> Kim (due 2026-03-10)\n#3 Tent -> Sam\n'))
  assert.deepEqual(loans('list', '--all', '--to', 'Sam'), ok('#1 Drill -> Sam (due 2026-03-01) [returned]\n#3 Tent -> Sam\n'))
  assert.deepEqual(loans('list', '--all', '--due-before', '2026-03-10'), ok('#1 Drill -> Sam (due 2026-03-01) [returned]\n'))
  assert.deepEqual(loans('list', '--to', 'sam'), ok('no loans\n'))
}))

test('back marks a loan returned, once', () => withLoans(loans => {
  loans('add', 'Drill', '--to', 'Sam')
  assert.deepEqual(loans('back', '1'), ok('returned #1\n'))
  assert.deepEqual(loans('back', '1'), failed('loan #1 is already returned'))
  assert.deepEqual(loans('people'), ok('nobody has anything\n'))
}))

test('edit changes only the fields given', () => withLoans(loans => {
  loans('add', 'Drill', '--to', 'Sam', '--due', '2026-03-01')
  assert.deepEqual(loans('edit', '1', '--item', 'Big drill'), ok('updated #1\n'))
  assert.deepEqual(loans('edit', '1', '--due', '2026-04-01'), ok('updated #1\n'))
  assert.deepEqual(loans('show', '1'), ok('loan #1\nitem: Big drill\nto: Sam\ndue: 2026-04-01\nreturned: no\n'))
  assert.deepEqual(loans('edit', '1', '--no-due', '--to', 'Kim'), ok('updated #1\n'))
  assert.deepEqual(loans('show', '1'), ok('loan #1\nitem: Big drill\nto: Kim\ndue: -\nreturned: no\n'))
  assert.deepEqual(loans('edit', '1'), failed('nothing to change'))
  assert.deepEqual(loans('edit', '1', '--due', '2026-04-01', '--no-due'), failed('--due and --no-due cannot be used together'))
}))

test('remove deletes a loan', () => withLoans(loans => {
  loans('add', 'Drill', '--to', 'Sam')
  assert.deepEqual(loans('remove', '1'), ok('removed #1\n'))
  assert.deepEqual(loans('remove', '1'), failed('no loan #1'))
  assert.deepEqual(loans('list'), ok('no loans\n'))
}))

test('rename moves every loan of a person, returned ones too', () => withLoans(loans => {
  loans('add', 'Drill', '--to', 'Sammy')
  loans('add', 'Tent', '--to', 'Sammy')
  loans('back', '2')
  assert.deepEqual(loans('rename', 'Sammy', '--to', 'Sam'), ok('renamed 2 loans\n'))
  assert.deepEqual(loans('list', '--all'), ok('#1 Drill -> Sam\n#2 Tent -> Sam [returned]\n'))
  assert.deepEqual(loans('rename', 'Sammy', '--to', 'Sam'), failed('nobody called Sammy'))
}))

test('people counts the loans not returned, by name', () => withLoans(loans => {
  loans('add', 'Drill', '--to', 'Sam')
  loans('add', 'Tent', '--to', 'Kim')
  loans('add', 'Saw', '--to', 'Sam')
  assert.deepEqual(loans('people'), ok('Kim: 1\nSam: 2\n'))
}))

test('a failed command changes nothing', () => withLoans((loans, file) => {
  loans('add', 'Drill', '--to', 'Sam')
  const before = readFileSync(file, 'utf8')
  for (const args of [['add', 'Tent'], ['add', '', '--to', 'Kim'], ['edit', '1', '--to', ' '], ['back', '2'], ['remove', 'x']]) {
    assert.equal(loans(...args).code, 1, args.join(' '))
  }
  assert.equal(readFileSync(file, 'utf8'), before)
}))

test('usage errors', () => withLoans(loans => {
  assert.equal(loans().code, 2)
  assert.equal(loans('lend').code, 2)
  assert.deepEqual(loans('list', '--late'), failed('unknown option --late'))
  assert.deepEqual(loans('add', 'Drill', '--to'), failed('--to needs a value'))
  assert.deepEqual(loans('back'), failed('expected one loan number'))
  assert.deepEqual(loans('people', 'Sam'), failed('unexpected argument Sam'))
}))
