import { test } from 'node:test'
import assert from 'node:assert/strict'
import { balances, expenseView, paymentView, settleUp, splitEvenly } from '../lib/ledger.mjs'

const group = { id: 'trip', name: 'Trip', members: ['Ann', 'Ben', 'Cara'] }

test('splitEvenly gives everyone the same part, in the order given', () => {
  assert.deepEqual(splitEvenly(900, ['Cara', 'Ann', 'Ben']), [['Cara', 300], ['Ann', 300], ['Ben', 300]])
  assert.deepEqual(splitEvenly(1250, ['Ann']), [['Ann', 1250]])
})

test('splitEvenly gives the remainder cents one each to the first people', () => {
  const three = ['Ann', 'Ben', 'Cara']
  assert.deepEqual(splitEvenly(1000, three), [['Ann', 334], ['Ben', 333], ['Cara', 333]])
  assert.deepEqual(splitEvenly(1100, three), [['Ann', 367], ['Ben', 367], ['Cara', 366]])
  assert.deepEqual(splitEvenly(1000, ['Cara', 'Ann', 'Ben']), [['Cara', 334], ['Ann', 333], ['Ben', 333]])
  assert.deepEqual(splitEvenly(1, three), [['Ann', 1], ['Ben', 0], ['Cara', 0]])
  assert.deepEqual(splitEvenly(2, three), [['Ann', 1], ['Ben', 1], ['Cara', 0]])
  for (let cents = 1; cents <= 1000; cents++) {
    for (let count = 1; count <= 7; count++) {
      const people = Array.from({ length: count }, (_, i) => `P${i}`)
      const parts = splitEvenly(cents, people).map(([, part]) => part)
      assert.equal(parts.reduce((a, b) => a + b, 0), cents, `${cents} between ${count}`)
      assert.ok(Math.max(...parts) - Math.min(...parts) <= 1, `${cents} between ${count}`)
      assert.ok(parts.every((part, i) => i === 0 || part <= parts[i - 1]), `${cents} between ${count}`)
    }
  }
})

test('balances of an uneven split add up to 0', () => {
  const expense = { id: 1, group: 'trip', description: 'Taxi', payer: 'Ann', amount: 1000, split: ['Ann', 'Ben', 'Cara'] }
  const state = { groups: [group], expenses: [expense], payments: [] }
  assert.deepEqual(balances(state, group), { Ann: 6.66, Ben: -3.33, Cara: -3.33 })
  assert.deepEqual(expenseView(expense).shares, { Ann: 3.34, Ben: 3.33, Cara: 3.33 })
})

test('expenseView shows amounts as numbers with each share', () => {
  const expense = { id: 4, group: 'trip', description: 'Fuel', payer: 'Ben', amount: 1250, split: ['Ann', 'Ben'] }
  assert.deepEqual(expenseView(expense), {
    id: 4, description: 'Fuel', payer: 'Ben', amount: 12.5, split: ['Ann', 'Ben'], shares: { Ann: 6.25, Ben: 6.25 },
  })
})

test('paymentView shows the amount as a number', () => {
  assert.deepEqual(paymentView({ id: 2, group: 'trip', from: 'Ben', to: 'Ann', amount: 725 }), { id: 2, from: 'Ben', to: 'Ann', amount: 7.25 })
})

test('balances starts every member at 0', () => {
  const state = { groups: [group], expenses: [], payments: [] }
  assert.deepEqual(balances(state, group), { Ann: 0, Ben: 0, Cara: 0 })
})

test('balances: the payer is owed the others\' shares, and payments move money back', () => {
  const state = {
    groups: [group],
    expenses: [
      { id: 1, group: 'trip', description: 'Hotel', payer: 'Ann', amount: 9000, split: ['Ann', 'Ben', 'Cara'] },
      { id: 2, group: 'trip', description: 'Taxi', payer: 'Ben', amount: 2000, split: ['Ben', 'Cara'] },
      { id: 3, group: 'other', description: 'Elsewhere', payer: 'Ann', amount: 5000, split: ['Ann', 'Ben'] },
    ],
    payments: [{ id: 1, group: 'trip', from: 'Cara', to: 'Ann', amount: 3000 }],
  }
  assert.deepEqual(balances(state, group), { Ann: 30, Ben: -20, Cara: -10 })
})

test('settleUp is empty when everyone is square', () => {
  const state = { groups: [group], expenses: [], payments: [] }
  assert.deepEqual(settleUp(state, group), [])
})

test('settleUp: whoever owes the most pays whoever is owed the most, until all are square', () => {
  const four = { ...group, members: ['Ann', 'Ben', 'Cara', 'Dev'] }
  const pay = (id, from, to, amount) => ({ id, group: 'trip', from, to, amount })
  // Balances: Ann 50, Ben 30, Cara -60, Dev -20.
  const state = { groups: [four], expenses: [], payments: [pay(1, 'Ann', 'Cara', 5000), pay(2, 'Ben', 'Dev', 2000), pay(3, 'Ben', 'Cara', 1000)] }
  assert.deepEqual(settleUp(state, four), [
    { from: 'Cara', to: 'Ann', amount: 50 },
    { from: 'Dev', to: 'Ben', amount: 20 },
    { from: 'Cara', to: 'Ben', amount: 10 },
  ])
})
