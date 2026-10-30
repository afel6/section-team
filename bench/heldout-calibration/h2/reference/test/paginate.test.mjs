import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paginate } from '../lib/paginate.mjs'

test('paginate returns the first page with the paging fields', () => {
  assert.deepEqual(paginate(['a', 'b', 'c'], 1, 20), { items: ['a', 'b', 'c'], page: 1, per_page: 20, total: 3 })
})

test('paginate returns an empty page past the end', () => {
  assert.deepEqual(paginate(['a', 'b', 'c'], 2, 20), { items: [], page: 2, per_page: 20, total: 3 })
})

test('paginate gives full pages of perPage entries, then the rest', () => {
  const list = Array.from({ length: 25 }, (_, i) => i)
  assert.deepEqual([1, 2, 3].map(p => paginate(list, p, 10).items.length), [10, 10, 5])
  assert.deepEqual(paginate(list, 2, 10).items, [10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
  assert.deepEqual(paginate(list, 1, 1).items, [0])
})

test('paginate leaves the list unchanged', () => {
  const list = Object.freeze(['b', 'a'])
  assert.deepEqual(paginate(list, 1, 20).items, ['b', 'a'])
})
