import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withApp } from './helpers.mjs'

const trip = { id: 'trip', name: 'Ski trip', members: ['Ann', 'Ben', 'Cara'] }
const amountError = 'amount must be a number from 0.01 to 1000000 with at most 2 decimals'

async function setup(call) {
  await call('POST', '/groups', trip)
}

function add(call, fields) {
  return call('POST', '/groups/trip/expenses', { description: 'Item', payer: 'Ann', ...fields })
}

test('amounts with two decimals are stored and shown exactly', () => withApp(async call => {
  await setup(call)
  const amounts = [4.35, 0.29, 1.13, 8.2, 0.57, 1.15, 9.95, 1000000, 0.01, 12]
  for (const amount of amounts) {
    const r = await add(call, { amount, split: ['Ann'] })
    assert.equal(r.status, 201, String(amount))
    assert.equal(r.body.amount, amount)
    assert.deepEqual(r.body.shares, { Ann: amount })
  }
  const list = await call('GET', '/groups/trip/expenses')
  assert.deepEqual(list.body.expenses.map(e => e.amount), amounts)
}))

test('amount boundaries and wrong types are still refused with 400', () => withApp(async call => {
  await setup(call)
  for (const amount of [0, 1000000.01, 0.001, -1, '4.35']) {
    const r = await add(call, { amount })
    assert.equal(r.status, 400, String(amount))
    assert.deepEqual(r.body, { error: amountError })
  }
}))

test('balances after 4.35 split between two people', () => withApp(async call => {
  await setup(call)
  await add(call, { amount: 4.35, split: ['Ann', 'Ben'] })
  const r = await call('GET', '/groups/trip/balances')
  assert.deepEqual(r.body, { balances: { Ann: 2.17, Ben: -2.17, Cara: 0 } })
}))

test('leftover cents go to the first people in order', () => withApp(async call => {
  await setup(call)
  const r = await add(call, { description: 'Taxi', amount: 10 })
  assert.deepEqual(r.body.shares, { Ann: 3.34, Ben: 3.33, Cara: 3.33 })
  assert.deepEqual(Object.entries(r.body.shares), [['Ann', 3.34], ['Ben', 3.33], ['Cara', 3.33]])
  const b = await call('GET', '/groups/trip/balances')
  assert.deepEqual(b.body, { balances: { Ann: 6.66, Ben: -3.33, Cara: -3.33 } })
}))

test('the order of the split decides who gets the leftover cent', () => withApp(async call => {
  await setup(call)
  const r = await add(call, { amount: 10, split: ['Cara', 'Ann', 'Ben'] })
  assert.deepEqual(Object.entries(r.body.shares), [['Cara', 3.34], ['Ann', 3.33], ['Ben', 3.33]])
  const b = await call('GET', '/groups/trip/balances')
  assert.deepEqual(b.body, { balances: { Ann: 6.67, Ben: -3.33, Cara: -3.34 } })
}))

test('two leftover cents go to the first two people', () => withApp(async call => {
  await setup(call)
  const r = await add(call, { amount: 0.05, payer: 'Cara' })
  assert.deepEqual(Object.entries(r.body.shares), [['Ann', 0.02], ['Ben', 0.02], ['Cara', 0.01]])
  const b = await call('GET', '/groups/trip/balances')
  assert.deepEqual(b.body, { balances: { Ann: -0.02, Ben: -0.02, Cara: 0.04 } })
}))

test('balances always sum to zero cents', () => withApp(async call => {
  await setup(call)
  await add(call, { amount: 10 })
  await add(call, { amount: 0.05 })
  await add(call, { amount: 7.01, split: ['Ben', 'Cara'] })
  await add(call, { amount: 100 })
  const b = (await call('GET', '/groups/trip/balances')).body.balances
  const sum = Object.values(b).reduce((total, v) => total + Math.round(v * 100), 0)
  assert.equal(sum, 0)
}))

test('PATCH keeps an amount like 4.35 exact', () => withApp(async call => {
  await setup(call)
  await add(call, { description: 'Hotel', amount: 90 })
  const r = await call('PATCH', '/groups/trip/expenses/1', { amount: 4.35 })
  assert.equal(r.status, 200)
  assert.equal(r.body.amount, 4.35)
}))
