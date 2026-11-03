// POST /groups/:id/import: the success path (201, dry run, ids, views, balances, persistence).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { expense, expenseBody, importInto, payment, snapshot, trip, withTrip } from './import-fixtures.mjs'

const flat = { id: 'flat', name: 'Flat', members: ['Ann', 'Ben'] }
const flatExpense = { description: 'Rent', payer: 'Ann', amount: 100 }
const flatPayment = { from: 'Ben', to: 'Ann', amount: 5 }

// Makes the next expense id 3 and the next payment id 2, with Hotel recorded in trip.
async function recordEarlier(call) {
  assert.equal((await call('POST', '/groups', flat)).status, 201)
  assert.equal(await postedId(call, '/groups/flat/expenses', flatExpense), 1)
  assert.equal(await postedId(call, '/groups/trip/expenses', expenseBody()), 2)
  assert.equal(await postedId(call, '/groups/flat/payments', flatPayment), 1)
}

// POSTs a record, checks the 201 and returns the id it was given.
async function postedId(call, path, body) {
  const reply = await call('POST', path, body)
  assert.equal(reply.status, 201)
  return reply.body.id
}

async function getOk(call, path) {
  const reply = await call('GET', path)
  assert.equal(reply.status, 200)
  return reply.body
}

const mixedEntries = () => [
  expense({ description: 'Taxi', amount: 12 }),
  expense(),
  payment(),
  expense({ description: 'Fuel', payer: 'Ben', amount: 10, split: ['Cara', 'Ben'] }),
]
const mixedImport = { entries: mixedEntries(), skip_recorded: true }

const mixedBody = {
  expenses: [
    { id: 3, description: 'Taxi', payer: 'Ann', amount: 12, split: ['Ann', 'Ben', 'Cara'], shares: { Ann: 4, Ben: 4, Cara: 4 } },
    { id: 4, description: 'Fuel', payer: 'Ben', amount: 10, split: ['Cara', 'Ben'], shares: { Cara: 5, Ben: 5 } },
  ],
  payments: [{ id: 2, from: 'Ben', to: 'Ann', amount: 30 }],
  skipped: [1],
  balances: { Ann: 38, Ben: 1, Cara: -39 },
}

const lists = async call => ({
  expenses: await getOk(call, '/groups/trip/expenses'),
  payments: await getOk(call, '/groups/trip/payments'),
  balances: await getOk(call, '/groups/trip/balances'),
})

test('import: ids continue each kind\'s own count across groups; a skipped entry takes no id', () => withTrip(async ({ call }) => {
  await recordEarlier(call)
  const reply = await importInto(call, mixedImport)
  assert.equal(reply.status, 201)
  assert.deepEqual(reply.body, mixedBody)
  assert.equal(await postedId(call, '/groups/trip/expenses', expenseBody({ description: 'Lunch' })), 5)
  assert.equal(await postedId(call, '/groups/trip/payments', payment()), 3)
}))

test('import: reply and views keep their key order', () => withTrip(async ({ call }) => {
  await recordEarlier(call)
  const reply = await importInto(call, mixedImport)
  assert.equal(reply.status, 201)
  const { body } = reply
  assert.deepEqual(Object.keys(body), ['expenses', 'payments', 'skipped', 'balances'])
  assert.deepEqual(Object.keys(body.expenses[0]), ['id', 'description', 'payer', 'amount', 'split', 'shares'])
  assert.deepEqual(Object.keys(body.payments[0]), ['id', 'from', 'to', 'amount'])
}))

test('import: views equal the GET lists after the import', () => withTrip(async ({ call }) => {
  const reply = await importInto(call, { entries: mixedEntries() })
  assert.equal(reply.status, 201)
  const { body } = reply
  const after = await lists(call)
  assert.equal(body.expenses.length, 3)
  assert.deepEqual(after.expenses.expenses, body.expenses)
  assert.deepEqual(after.payments.payments, body.payments)
}))

test('import: an expense is shown as POST shows it, split defaulting to every member', () => withTrip(async ({ call }) => {
  const importReply = await importInto(call, { entries: [expense({ description: 'Taxi', amount: 12.5 })] })
  assert.equal(importReply.status, 201)
  const postReply = await call('POST', '/groups/trip/expenses', expenseBody({ description: 'Taxi', amount: 12.5 }))
  assert.equal(postReply.status, 201)
  const imported = importReply.body.expenses[0]
  const posted = postReply.body
  const literal = {
    id: 1, description: 'Taxi', payer: 'Ann', amount: 12.5,
    split: ['Ann', 'Ben', 'Cara'], shares: { Ann: 4.17, Ben: 4.17, Cara: 4.16 },
  }
  assert.deepEqual(imported, literal)
  assert.deepEqual(posted, { ...literal, id: 2 })
  assert.deepEqual({ ...imported, id: 0 }, { ...posted, id: 0 })
  assert.deepEqual(Object.keys(imported), Object.keys(posted))
}))

test('import: balances follow the group member order and include earlier records', () =>
  withTrip(async ({ call }) => {
    const hotel = await call('POST', '/groups/trip/expenses', expenseBody())
    assert.equal(hotel.status, 201)
    const entries = [expense({ description: 'Taxi', payer: 'Ben', amount: 12 }), payment()]
    const reply = await importInto(call, { entries })
    assert.equal(reply.status, 201)
    assert.deepEqual(Object.keys(reply.body.balances), ['Cara', 'Ann', 'Ben'])
    assert.deepEqual(reply.body.balances, { Cara: -34, Ann: 26, Ben: 8 })
    assert.deepEqual(reply.body.balances, (await getOk(call, '/groups/trip/balances')).balances)
  }, { id: 'trip', name: 'Ski trip', members: ['Cara', 'Ann', 'Ben'] }))

test('import: a remainder goes to the first people in split', () => withTrip(async ({ call }) => {
  const entry = expense({ description: 'Dinner', amount: 10, split: ['Ann', 'Ben', 'Cara'] })
  const reply = await importInto(call, { entries: [entry] })
  assert.equal(reply.status, 201)
  assert.deepEqual(reply.body.expenses[0].shares, { Ann: 3.34, Ben: 3.33, Cara: 3.33 })
  assert.deepEqual(reply.body.balances, { Ann: 6.66, Ben: -3.33, Cara: -3.33 })
}))

test('import: a 201 reply is application/json', () => withTrip(async ({ call }) => {
  const reply = await importInto(call, { entries: [expense()] })
  assert.equal(reply.status, 201)
  assert.equal(reply.headers.get('content-type'), 'application/json')
}))

test('import: a single payment gives empty expenses and skipped', () => withTrip(async ({ call }) => {
  const reply = await importInto(call, { entries: [payment()] })
  assert.equal(reply.status, 201)
  assert.deepEqual(reply.body, {
    expenses: [],
    payments: [{ id: 1, from: 'Ben', to: 'Ann', amount: 30 }],
    skipped: [],
    balances: { Ann: -30, Ben: 30, Cara: 0 },
  })
}))

test('import: saved data survives a restart and ids continue', () => withTrip(async ({ call, restart }) => {
  await recordEarlier(call)
  assert.equal((await importInto(call, mixedImport)).status, 201)
  const before = await lists(call)
  await restart()
  assert.deepEqual(await lists(call), before)
  assert.equal(await postedId(call, '/groups/trip/expenses', expenseBody({ description: 'Lunch' })), 5)
  assert.equal(await postedId(call, '/groups/trip/payments', payment()), 3)
}))

test('import: the data file holds the records in cents and no temp file is left', () => withTrip(async ({ call, file }) => {
  await recordEarlier(call)
  assert.equal((await importInto(call, mixedImport)).status, 201)
  const data = JSON.parse(readFileSync(file, 'utf8'))
  const taxi = data.expenses.find(e => e.id === 3)
  assert.deepEqual(taxi, { id: 3, group: 'trip', description: 'Taxi', payer: 'Ann', amount: 1200, split: ['Ann', 'Ben', 'Cara'] })
  assert.deepEqual(data.expenses.map(e => e.id), [1, 2, 3, 4])
  assert.deepEqual(data.payments.find(p => p.id === 2), { id: 2, group: 'trip', from: 'Ben', to: 'Ann', amount: 3000 })
  assert.equal(data.nextExpenseId, 5)
  assert.equal(data.nextPaymentId, 3)
  assert.deepEqual(snapshot(file).folder, ['groups.json'])
}))

test('import dry run: answers 200 with the real body and saves nothing', () => withTrip(async ({ call, file }) => {
  await recordEarlier(call)
  const before = snapshot(file)
  const listsBefore = await lists(call)
  const dry = await importInto(call, { ...mixedImport, dry_run: true })
  assert.equal(dry.status, 200)
  assert.deepEqual(dry.body, mixedBody)
  assert.deepEqual(snapshot(file), before)
  assert.deepEqual(await lists(call), listsBefore)
  const real = await importInto(call, mixedImport)
  assert.equal(real.status, 201)
  assert.deepEqual(real.body, dry.body)
}))

test('import dry run: the next POST still gets the ids the reply showed', () => withTrip(async ({ call }) => {
  await recordEarlier(call)
  const dry = await importInto(call, { ...mixedImport, dry_run: true })
  assert.equal(dry.status, 200)
  const exp = await call('POST', '/groups/trip/expenses', expenseBody({ description: 'Lunch' }))
  assert.equal(exp.status, 201)
  const pay = await call('POST', '/groups/trip/payments', payment())
  assert.equal(pay.status, 201)
  assert.equal(exp.body.id, dry.body.expenses[0].id)
  assert.equal(pay.body.id, dry.body.payments[0].id)
}))

test('import dry run: dry_run false saves, and nothing of a dry run survives a restart', () => withTrip(async ({ call, restart }) => {
  const saved = await importInto(call, { entries: [payment()], dry_run: false })
  assert.equal(saved.status, 201)
  const dry = await importInto(call, { entries: [expense({ description: 'Taxi' })], dry_run: true })
  assert.equal(dry.status, 200)
  const before = await lists(call)
  await restart()
  assert.deepEqual(await lists(call), before)
  assert.deepEqual(before.expenses, { expenses: [] })
  assert.deepEqual(before.payments, { payments: saved.body.payments })
}))
