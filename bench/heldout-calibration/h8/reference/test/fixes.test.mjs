// Regression tests for the two problems users ran into: impossible due dates, and loan numbers given twice.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { failed, ok, withLoans } from './helpers.mjs'

const DATE_ERROR = failed('due date must be a real date as YYYY-MM-DD')

test('a day the month does not have is refused by add --due, edit --due and list --due-before', () => withLoans((loans, file) => {
  loans('add', 'Drill', '--to', 'Sam', '--due', '2026-02-10')
  const before = readFileSync(file, 'utf8')
  for (const date of ['2026-02-30', '2026-04-31', '2026-02-29', '2100-02-29']) {
    assert.deepEqual(loans('add', 'Tent', '--to', 'Kim', '--due', date), DATE_ERROR, date)
    assert.deepEqual(loans('edit', '1', '--due', date), DATE_ERROR, date)
    assert.deepEqual(loans('list', '--due-before', date), DATE_ERROR, date)
  }
  assert.equal(readFileSync(file, 'utf8'), before)
}))

test('real dates are kept as typed, leap days included', () => withLoans(loans => {
  for (const [i, date] of ['2024-02-29', '2000-02-29', '2026-04-30', '2026-12-31'].entries()) {
    loans('add', 'Thing', '--to', 'Kim', '--due', date)
    assert.match(loans('show', String(i + 1)).stdout, new RegExp(`due: ${date}\n`))
  }
}))

test('removing a loan never frees its number', () => withLoans(loans => {
  loans('add', 'Drill', '--to', 'Sam')
  loans('add', 'Saw', '--to', 'Kim')
  loans('add', 'Ladder', '--to', 'Lee')
  loans('remove', '2')
  assert.deepEqual(loans('add', 'Saw', '--to', 'Kim'), ok('added #4\n'))
  loans('remove', '4')
  assert.deepEqual(loans('add', 'Rake', '--to', 'Kim'), ok('added #5\n'))
  assert.deepEqual(loans('back', '3'), ok('returned #3\n'))
  assert.deepEqual(loans('list'), ok('#1 Drill -> Sam\n#5 Rake -> Kim\n'))
}))

test('a data file saved without a next number goes on after its highest loan number', () => withLoans((loans, file) => {
  const old = [{ number: 4, item: 'Drill', person: 'Sam', due: null, returned: false }, { number: 1, item: 'Tent', person: 'Kim', due: null, returned: true }]
  writeFileSync(file, `${JSON.stringify({ loans: old }, null, 2)}\n`)
  assert.deepEqual(loans('list', '--all'), ok('#1 Tent -> Kim [returned]\n#4 Drill -> Sam\n'))
  assert.deepEqual(loans('add', 'Saw', '--to', 'Lee'), ok('added #5\n'))
}))
