// POST /groups/:id/import: the per-entry rules and their order, and that a 422 saves nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertNextIdsAreOne, assertNothingSaved, expense, payment, importInto, withTrip, snapshot, rejected,
} from './import-fixtures.mjs'

const omit = (entry, key) => {
  const { [key]: _gone, ...rest } = entry
  return rest
}
const ok = description => expense({ description })

// Sends cases [[entry, rule], ...] plus one valid expense; expects exactly one problem per case.
async function expectRules(call, cases, label) {
  const entries = [...cases.map(([entry]) => entry), ok('OK')]
  const res = await importInto(call, { entries })
  const problems = cases.map(([, rule], index) => ({ index, rule }))
  assert.equal(res.status, 422, label)
  assert.deepEqual(res.body, rejected(problems), label)
}

// Pairs every entry with the one rule it breaks.
const sameRule = (rule, entries) => entries.map(entry => [entry, rule])

test('not-an-object: values that are not JSON objects', () => withTrip(async ({ call }) => {
  const values = [null, [], ['expense'], [expense()], 'expense', 5, true, false]
  await expectRules(call, sameRule('not-an-object', values), 'not-an-object')
}))

test('bad-type: wrong or missing type', () => withTrip(async ({ call }) => {
  const types = ['Expense', 'payments', ' expense', 'expense ', ['expense'], ['payment'], null, 1, {}]
  const cases = types.map(type => expense({ type, description: `T${String(JSON.stringify(type))}` }))
  cases.push(omit(expense(), 'type'))
  await expectRules(call, sameRule('bad-type', cases), 'bad-type')
}))

test('bad-type beats unknown-field', () => withTrip(async ({ call }) => {
  await expectRules(call, [[{ type: 'refund', foo: 1 }, 'bad-type']], 'refund')
}))

test('unknown-field: expense fields', () => withTrip(async ({ call }) => {
  const cases = [
    expense({ from: 'Ben' }),
    expense({ description: 'B', Amount: 1 }),
    expense({ description: 'C', toString: 'x' }),
    expense({ description: 'D', constructor: 'x' }),
    expense({ description: 'E', hasOwnProperty: 'x' }),
  ]
  await expectRules(call, sameRule('unknown-field', cases), 'expense unknown field')
}))

test('unknown-field: __proto__ key in raw JSON', () => withTrip(async ({ call }) => {
  const raw = '{"entries":[{"type":"expense","description":"A","payer":"Ann","amount":1,"__proto__":{}}]}'
  const res = await call('POST', '/groups/trip/import', raw)
  assert.equal(res.status, 422)
  assert.deepEqual(res.body, rejected([{ index: 0, rule: 'unknown-field' }]))
}))

test('unknown-field: payment fields', () => withTrip(async ({ call }) => {
  const cases = [
    payment({ description: 'x' }),
    payment({ split: ['Ann'] }),
    payment({ payer: 'Ann' }),
  ]
  await expectRules(call, sameRule('unknown-field', cases), 'payment unknown field')
}))

test('unknown-field beats every field rule', () => withTrip(async ({ call }) => {
  const cases = [
    [expense({ description: '', foo: 1 }), 'unknown-field'],
    [payment({ from: 'Dan', foo: 1 }), 'unknown-field'],
  ]
  await expectRules(call, cases, 'unknown first')
}))

test('expense with and without split is fine', () => withTrip(async ({ call }) => {
  const withSplit = await importInto(call, { entries: [expense({ split: ['Ann', 'Ben'] })] })
  assert.equal(withSplit.status, 201)
  assert.deepEqual(withSplit.body.expenses, [
    { id: 1, description: 'Hotel', payer: 'Ann', amount: 90, split: ['Ann', 'Ben'], shares: { Ann: 45, Ben: 45 } },
  ])
  const without = await importInto(call, { entries: [expense({ description: 'Other' })] })
  assert.equal(without.status, 201)
  assert.deepEqual(without.body.expenses, [
    { id: 2, description: 'Other', payer: 'Ann', amount: 90, split: ['Ann', 'Ben', 'Cara'], shares: { Ann: 30, Ben: 30, Cara: 30 } },
  ])
}))

test('bad-description', () => withTrip(async ({ call }) => {
  const bad = ['', '   ', 'x'.repeat(201), null, 5, ['Hotel']].map(description => expense({ description }))
  bad.push(omit(expense(), 'description'))
  await expectRules(call, sameRule('bad-description', bad), 'bad-description')
  const fine = await importInto(call, { entries: [ok('x'.repeat(200))] })
  assert.equal(fine.status, 201)
  assert.deepEqual(fine.body.expenses, [
    { id: 1, description: 'x'.repeat(200), payer: 'Ann', amount: 90, split: ['Ann', 'Ben', 'Cara'], shares: { Ann: 30, Ben: 30, Cara: 30 } },
  ])
}))

test('bad-payer', () => withTrip(async ({ call }) => {
  const bad = ['Dan', 'ann', null, 1].map(payer => expense({ payer }))
  bad.push(omit(expense(), 'payer'))
  await expectRules(call, sameRule('bad-payer', bad), 'bad-payer')
}))

test('expense bad-amount', () => withTrip(async ({ call }) => {
  const values = [0, -1, 1.234, 0.001, '12', null, 1000000.01, true]
  const bad = values.map(amount => expense({ amount }))
  bad.push(omit(expense(), 'amount'))
  await expectRules(call, sameRule('bad-amount', bad), 'bad-amount')
  const entries = [expense({ description: 'Low', amount: 0.01 }), expense({ description: 'High', amount: 1000000 })]
  const fine = await importInto(call, { entries })
  assert.equal(fine.status, 201)
  const everyone = ['Ann', 'Ben', 'Cara']
  assert.deepEqual(fine.body.expenses, [
    { id: 1, description: 'Low', payer: 'Ann', amount: 0.01, split: everyone, shares: { Ann: 0.01, Ben: 0, Cara: 0 } },
    {
      id: 2, description: 'High', payer: 'Ann', amount: 1000000, split: everyone,
      shares: { Ann: 333333.34, Ben: 333333.33, Cara: 333333.33 },
    },
  ])
}))

test('bad-split', () => withTrip(async ({ call }) => {
  const values = [null, [], ['Ann', 'Ann'], ['Dan'], ['ann'], 'Ann', {}, [1]]
  const bad = values.map(split => expense({ split }))
  await expectRules(call, sameRule('bad-split', bad), 'bad-split')
}))

test('expense rule precedence', () => withTrip(async ({ call }) => {
  const cases = [
    [expense({ description: '', payer: 'Dan' }), 'bad-description'],
    [expense({ payer: 'Dan', amount: 0 }), 'bad-payer'],
    [expense({ amount: 0, split: [] }), 'bad-amount'],
    [expense({ description: '', payer: 'Dan', amount: 0, split: [] }), 'bad-description'],
  ]
  await expectRules(call, cases, 'precedence')
}))

test('payment bad-from', () => withTrip(async ({ call }) => {
  const bad = ['Dan', null, 'ben'].map(from => payment({ from }))
  bad.push(omit(payment(), 'from'))
  await expectRules(call, sameRule('bad-from', bad), 'bad-from')
}))

test('payment bad-to', () => withTrip(async ({ call }) => {
  const bad = ['Dan', null].map(to => payment({ to }))
  bad.push(omit(payment(), 'to'), payment({ from: 'Ann', to: 'Ann' }))
  await expectRules(call, sameRule('bad-to', bad), 'bad-to')
}))

test('payment bad-amount', () => withTrip(async ({ call }) => {
  const bad = [0, '5', 1.234].map(amount => payment({ amount }))
  bad.push(omit(payment(), 'amount'))
  await expectRules(call, sameRule('bad-amount', bad), 'payment bad-amount')
}))

test('payment rule precedence', () => withTrip(async ({ call }) => {
  const cases = [
    [payment({ from: 'Dan', to: 'Zed' }), 'bad-from'],
    [payment({ from: 'Ann', to: 'Ann', amount: 0 }), 'bad-to'],
    [payment({ to: 'Dan', amount: 0 }), 'bad-to'],
  ]
  await expectRules(call, cases, 'precedence')
}))

test('problems: one per failing entry, in index order, first rule only', () => withTrip(async ({ call }) => {
  const entries = [ok('A'), expense({ description: 'B', amount: 0 }), null, payment(), { type: 'x' }]
  const res = await importInto(call, { entries })
  assert.equal(res.status, 422)
  assert.deepEqual(res.body, rejected([
    { index: 1, rule: 'bad-amount' },
    { index: 2, rule: 'not-an-object' },
    { index: 4, rule: 'bad-type' },
  ]))
}))

test('problems: a duplicate is listed by its index among the other rules', () => withTrip(async ({ call }) => {
  const entries = [ok('A'), ok('A'), null, ok('B'), ok('b '), { type: 'x' }]
  const res = await importInto(call, { entries })
  assert.equal(res.status, 422)
  assert.deepEqual(res.body, rejected([
    { index: 1, rule: 'duplicate' },
    { index: 2, rule: 'not-an-object' },
    { index: 4, rule: 'duplicate' },
    { index: 5, rule: 'bad-type' },
  ]))
}))

test('a 422 saves nothing', () => withTrip(async ({ call, file }) => {
  const before = snapshot(file)
  const res = await importInto(call, { entries: [expense(), payment(), null] })
  assert.equal(res.status, 422)
  assert.deepEqual(res.body, rejected([{ index: 2, rule: 'not-an-object' }]))
  await assertNothingSaved({ call, file }, before)
  await assertNextIdsAreOne(call)
}))

test('dry_run and skip_recorded give the same 422', () => withTrip(async ({ call }) => {
  const entries = [ok('A'), expense({ description: 'B', amount: 0 }), null, { type: 'x' }]
  const plain = await importInto(call, { entries })
  assert.equal(plain.status, 422)
  assert.deepEqual(plain.body, rejected([
    { index: 1, rule: 'bad-amount' },
    { index: 2, rule: 'not-an-object' },
    { index: 3, rule: 'bad-type' },
  ]))
  for (const flags of [{ dry_run: true }, { skip_recorded: true }, { dry_run: true, skip_recorded: true }]) {
    const res = await importInto(call, { entries, ...flags })
    assert.equal(res.status, plain.status, JSON.stringify(flags))
    assert.deepEqual(res.body, plain.body, JSON.stringify(flags))
  }
}))
