import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseAmount, parseDescription, parseGroupId, parseGroupName, parseMember, parseMembers, parseSplit, ValidationError,
} from '../lib/validate.mjs'

const members = ['Ann', 'Ben', 'Cara']

test('parseGroupId accepts lower-case letters, digits and dashes, starting with a letter', () => {
  assert.equal(parseGroupId('trip-2025'), 'trip-2025')
  assert.equal(parseGroupId('a'.repeat(30)), 'a'.repeat(30))
  for (const v of ['', 'Trip', '2trip', '-trip', 'trip 1', 'a'.repeat(31), 7, undefined]) {
    assert.throws(() => parseGroupId(v), ValidationError, `id ${JSON.stringify(v)}`)
  }
})

test('parseGroupName and parseDescription want non-empty text within their limits', () => {
  assert.equal(parseGroupName('Ski trip'), 'Ski trip')
  assert.equal(parseDescription('Dinner, day 1'), 'Dinner, day 1')
  for (const v of ['', '   ', 'x'.repeat(101), 3, null]) assert.throws(() => parseGroupName(v), ValidationError)
  for (const v of ['', ' ', 'x'.repeat(201), [], undefined]) assert.throws(() => parseDescription(v), ValidationError)
  assert.equal(parseDescription('x'.repeat(200)).length, 200)
})

test('parseMembers accepts 2 to 20 different valid names', () => {
  assert.deepEqual(parseMembers(['Ann', 'ann']), ['Ann', 'ann'])
  assert.equal(parseMembers(Array.from({ length: 20 }, (_, i) => `P${i}`)).length, 20)
})

test('parseMembers rejects short, long, repeated or badly named lists', () => {
  const tooMany = Array.from({ length: 21 }, (_, i) => `P${i}`)
  for (const v of [['Ann'], tooMany, ['Ann', 'Ann'], ['Ann', '1st'], ['Ann', 'B c'], ['Ann', 5], 'Ann,Ben']) {
    assert.throws(() => parseMembers(v), ValidationError, JSON.stringify(v))
  }
})

test('parseAmount turns an amount into whole cents', () => {
  assert.equal(parseAmount(12.5), 1250)
  assert.equal(parseAmount(30), 3000)
  assert.equal(parseAmount(0.25), 25)
  assert.equal(parseAmount(0.01), 1)
  assert.equal(parseAmount(1000000), 100000000)
})

test('parseAmount keeps the exact cents of amounts that floating point cannot hold', () => {
  for (const [v, cents] of [[4.35, 435], [0.29, 29], [1.15, 115], [8.7, 870], [999999.99, 99999999]]) {
    assert.equal(parseAmount(v), cents, String(v))
  }
})

test('parseAmount rejects zero, negatives, extra decimals, strings and too much', () => {
  for (const v of [0, -5, 1.234, '12', 1000000.01, NaN, Infinity, 1e21, null, undefined]) {
    assert.throws(() => parseAmount(v), ValidationError, `amount ${String(v)}`)
  }
})

test('parseMember accepts only names of the group, and says which field is wrong', () => {
  assert.equal(parseMember('Ben', members, 'payer is wrong'), 'Ben')
  assert.throws(() => parseMember('Dan', members, 'payer is wrong'), { message: 'payer is wrong' })
  assert.throws(() => parseMember('ben', members, 'payer is wrong'), ValidationError)
})

test('parseSplit defaults to every member and checks a given list', () => {
  assert.deepEqual(parseSplit(undefined, members), members)
  assert.deepEqual(parseSplit(['Cara', 'Ann'], members), ['Cara', 'Ann'])
  for (const v of [[], ['Ann', 'Ann'], ['Dan'], 'Ann', null]) {
    assert.throws(() => parseSplit(v, members), ValidationError, JSON.stringify(v))
  }
})
