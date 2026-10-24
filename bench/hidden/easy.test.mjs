import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const TARGET = process.env.TARGET_DIR
const mod = await import(pathToFileURL(join(TARGET, 'src', 'text.mjs')).href)
const { slugify, truncate } = mod

test('slugify: spec examples', () => {
  assert.equal(slugify('  Hello, World!  '), 'hello-world')
  assert.equal(slugify('a--b__c'), 'a-b-c')
  assert.equal(slugify('!!!'), '')
})

test('slugify: accents removed', () => {
  assert.equal(slugify('Crème Brûlée'), 'creme-brulee')
  assert.equal(slugify('ÄÖÜ äöü'), 'aou-aou')
})

test('slugify: digits, dots and mixed runs', () => {
  assert.equal(slugify('Node.js 26 Release'), 'node-js-26-release')
  assert.equal(slugify('123 Go'), '123-go')
  assert.equal(slugify('--x--'), 'x')
  assert.equal(slugify(''), '')
})

test('slugify: non-string throws TypeError', () => {
  for (const bad of [42, null, undefined, {}, ['a']]) assert.throws(() => slugify(bad), TypeError)
})

test('truncate: unchanged when short enough', () => {
  assert.equal(truncate('hello world', 20), 'hello world')
  assert.equal(truncate('hello world', 11), 'hello world')
})

test('truncate: cuts with ellipsis and trims trailing space', () => {
  assert.equal(truncate('hello world', 6), 'hello…')
  assert.equal(truncate('hello world', 7), 'hello…')
  assert.equal(truncate('hello world', 10), 'hello wor…')
  assert.equal(truncate('ab', 1), '…')
})

test('truncate: bad max throws RangeError', () => {
  for (const bad of [0, -1, 1.5, Number.NaN]) assert.throws(() => truncate('hello', bad), RangeError)
})

test('truncate: non-string throws TypeError', () => {
  assert.throws(() => truncate(12345, 3), TypeError)
})
