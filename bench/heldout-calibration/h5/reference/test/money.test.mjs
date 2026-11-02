import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withApp } from './helpers.mjs'

const trip = { id: 'trip', name: 'Ski trip', members: ['Ann', 'Ben', 'Cara'] }

test('an amount such as 4.35 is shown back as 4.35 on expenses, edits and payments', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const coffee = await call('POST', '/groups/trip/expenses', { description: 'Coffee', payer: 'Ann', amount: 4.35, split: ['Ann'] })
  assert.equal(coffee.body.amount, 4.35)
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body.expenses.map(e => e.amount), [4.35])
  assert.equal((await call('PATCH', '/groups/trip/expenses/1', { amount: 0.29 })).body.amount, 0.29)
  assert.equal((await call('POST', '/groups/trip/payments', { from: 'Ben', to: 'Ann', amount: 8.2 })).body.amount, 8.2)
  assert.deepEqual((await call('GET', '/groups/trip/balances')).body, { balances: { Ann: -8.2, Ben: 8.2, Cara: 0 } })
}))

test('10.00 split three ways is 3.34, 3.33 and 3.33, and the balances add up to 0', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const taxi = await call('POST', '/groups/trip/expenses', { description: 'Taxi', payer: 'Ann', amount: 10 })
  assert.deepEqual(taxi.body.shares, { Ann: 3.34, Ben: 3.33, Cara: 3.33 })
  assert.deepEqual((await call('GET', '/groups/trip/balances')).body, { balances: { Ann: 6.66, Ben: -3.33, Cara: -3.33 } })
  assert.deepEqual((await call('GET', '/groups/trip/settle-up')).body, { payments: [
    { from: 'Ben', to: 'Ann', amount: 3.33 },
    { from: 'Cara', to: 'Ann', amount: 3.33 },
  ] })
}))
