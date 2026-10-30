import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSku, parseName, parseQuantity, parsePage, ValidationError } from '../lib/validate.mjs'

test('parseSku accepts upper-case letters, digits and dashes, up to 20 characters', () => {
  assert.equal(parseSku('WIDGET-1'), 'WIDGET-1')
  assert.equal(parseSku('A'.repeat(20)), 'A'.repeat(20))
})

test('parseSku rejects anything else', () => {
  for (const v of ['', 'widget-1', 'A B', 'A.1', 'A'.repeat(21), 42, undefined]) {
    assert.throws(() => parseSku(v), ValidationError, `sku ${JSON.stringify(v)}`)
  }
})

test('parseName accepts a non-empty string of at most 200 characters', () => {
  assert.equal(parseName('Widget, large'), 'Widget, large')
  for (const v of ['', '   ', 'x'.repeat(201), 5, null]) {
    assert.throws(() => parseName(v), ValidationError, `name ${JSON.stringify(v)}`)
  }
})

test('parseQuantity accepts whole numbers from 1', () => {
  assert.equal(parseQuantity(1), 1)
  assert.equal(parseQuantity(250), 250)
})

test('parseQuantity rejects zero, negatives and non-numbers', () => {
  for (const v of [0, -3, 'many', null, undefined]) {
    assert.throws(() => parseQuantity(v), ValidationError, `qty ${JSON.stringify(v)}`)
  }
})

test('parseQuantity rejects fractions and numbers sent as strings', () => {
  for (const v of [2.5, 0.5, '3', '2.5', '3abc', Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parseQuantity(v), ValidationError, `qty ${String(v)}`)
  }
})

const query = s => new URLSearchParams(s)

test('parsePage defaults to page 1 with 20 per page', () => {
  assert.deepEqual(parsePage(query('')), { page: 1, perPage: 20 })
})

test('parsePage reads page and per_page', () => {
  assert.deepEqual(parsePage(query('page=3&per_page=100')), { page: 3, perPage: 100 })
})

test('parsePage rejects bad values and per_page over 100', () => {
  for (const s of ['page=0', 'page=abc', 'page=-1', 'per_page=0', 'per_page=101', 'per_page=1.5']) {
    assert.throws(() => parsePage(query(s)), ValidationError, s)
  }
})
