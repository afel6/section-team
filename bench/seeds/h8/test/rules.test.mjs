import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UserError, parseDate, parseItem, parseNumber, parsePerson } from '../lib/rules.mjs'

const refused = (fn, value, message) => assert.throws(() => fn(value), e => e instanceof UserError && e.message === message, JSON.stringify(value))

test('items and people are trimmed and limited in length', () => {
  assert.equal(parseItem('  Drill '), 'Drill')
  assert.equal(parseItem('x'.repeat(100)), 'x'.repeat(100))
  refused(parseItem, '   ', 'item must be 1 to 100 characters')
  refused(parseItem, 'x'.repeat(101), 'item must be 1 to 100 characters')
  assert.equal(parsePerson(' Sam '), 'Sam')
  refused(parsePerson, 'x'.repeat(41), 'person must be 1 to 40 characters')
})

test('dates are YYYY-MM-DD', () => {
  assert.equal(parseDate('2026-03-01'), '2026-03-01')
  assert.equal(parseDate('2024-02-29'), '2024-02-29')
  for (const bad of ['2026-3-01', '26-03-01', '2026/03/01', '20260301', '2026-13-01', '2026-03-32', 'soon', '']) {
    refused(parseDate, bad, 'due date must be a real date as YYYY-MM-DD')
  }
})

test('loan numbers are whole numbers in digits', () => {
  assert.equal(parseNumber('3'), 3)
  assert.equal(parseNumber('120'), 120)
  for (const bad of ['0', '01', '-1', '1.5', '1e2', 'x', ' 1', '']) {
    refused(parseNumber, bad, 'loan number must be a whole number like 3')
  }
})
