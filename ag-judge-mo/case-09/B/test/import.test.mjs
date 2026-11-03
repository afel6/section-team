import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { startApp, tempDataFile, withApp } from './helpers.mjs'

const trip = { id: 'trip', name: 'Ski trip', members: ['Ann', 'Ben', 'Cara'] }
const coffee = { type: 'expense', description: 'Coffee', payer: 'Ann', amount: 4.35 }
const taxi = { type: 'expense', description: 'Taxi', payer: 'Ann', amount: 10 }
const payback = { type: 'payment', from: 'Ben', to: 'Ann', amount: 3.33 }

async function withTrip(fn) {
  await withApp(async call => {
    await call('POST', '/groups', trip)
    await fn(call)
  })
}

test('import records expenses and payments with consecutive ids and replies with balances', () => withTrip(async call => {
  await call('POST', '/groups/trip/expenses', { description: 'Hotel', payer: 'Ben', amount: 90 })
  await call('POST', '/groups/trip/payments', { from: 'Cara', to: 'Ben', amount: 1 })
  const r = await call('POST', '/groups/trip/import', { entries: [taxi, payback, { ...coffee, split: ['Ben', 'Ann'] }] })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body, {
    expenses: [
      { id: 2, description: 'Taxi', payer: 'Ann', amount: 10, split: trip.members, shares: { Ann: 3.34, Ben: 3.33, Cara: 3.33 } },
      { id: 3, description: 'Coffee', payer: 'Ann', amount: 4.35, split: ['Ben', 'Ann'], shares: { Ben: 2.18, Ann: 2.17 } },
    ],
    payments: [{ id: 2, from: 'Ben', to: 'Ann', amount: 3.33 }],
    skipped: [],
    balances: (await call('GET', '/groups/trip/balances')).body.balances,
  })
  assert.equal((await call('GET', '/groups/trip/expenses')).body.expenses.length, 3)
  assert.equal((await call('POST', '/groups/trip/expenses', { description: 'Lunch', payer: 'Ann', amount: 5 })).body.id, 4)
  assert.equal((await call('POST', '/groups/trip/payments', { from: 'Ann', to: 'Ben', amount: 1 })).body.id, 3)
}))

test('import refuses an unknown group with 404 before looking at the body', () => withApp(async call => {
  const r = await call('POST', '/groups/nope/import', { bogus: 1 })
  assert.equal(r.status, 404)
  assert.deepEqual(r.body, { error: 'not found' })
}))

test('import checks the body fields in order with 400', () => withTrip(async call => {
  const cases = [
    [{ entries: [taxi], zz: 1, aa: 2 }, 'unknown field zz'],
    [{ dry_run: 'x', extra: 1 }, 'unknown field extra'],
    [{ dry_run: 'x' }, 'entries must be an array of 1 to 50 items'],
    [{ entries: [] }, 'entries must be an array of 1 to 50 items'],
    [{ entries: Array(51).fill(payback) }, 'entries must be an array of 1 to 50 items'],
    [{ entries: {} }, 'entries must be an array of 1 to 50 items'],
    [{ entries: [taxi], dry_run: null, skip_recorded: 1 }, 'dry_run must be true or false'],
    [{ entries: [taxi], skip_recorded: null }, 'skip_recorded must be true or false'],
  ]
  for (const [body, error] of cases) {
    const r = await call('POST', '/groups/trip/import', body)
    assert.equal(r.status, 400, JSON.stringify(body))
    assert.deepEqual(r.body, { error })
  }
  assert.equal((await call('POST', '/groups/trip/import', '[]')).status, 400)
  assert.equal((await call('POST', '/groups/trip/import', { entries: ['x'.repeat(11000)] })).status, 413)
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body.expenses, [])
}))

test('import lists the first broken rule of every bad entry with 422 and saves nothing', () => withTrip(async call => {
  const entries = [
    taxi,
    null,
    [1],
    'expense',
    { ...taxi, type: 'refund' },
    { description: 'x' },
    { ...taxi, from: 'Ben' },
    { ...payback, payer: 'Ann' },
    { ...taxi, description: '  ' },
    { ...taxi, payer: 'Dan' },
    { ...taxi, amount: 4.355 },
    { ...taxi, split: null },
    { ...taxi, split: ['Ann', 'Ann'] },
    { ...taxi, description: ' TAXI ', split: ['Ben'] },
    { ...payback, from: 'Dan', to: 'Dan', amount: 0 },
    { ...payback, to: 'Ben' },
    { ...payback, to: null },
    { ...payback, amount: '3' },
    payback,
  ]
  const r = await call('POST', '/groups/trip/import', { entries })
  assert.equal(r.status, 422)
  assert.deepEqual(r.body, {
    error: 'import rejected',
    problems: [
      { index: 1, rule: 'not-an-object' },
      { index: 2, rule: 'not-an-object' },
      { index: 3, rule: 'not-an-object' },
      { index: 4, rule: 'bad-type' },
      { index: 5, rule: 'bad-type' },
      { index: 6, rule: 'unknown-field' },
      { index: 7, rule: 'unknown-field' },
      { index: 8, rule: 'bad-description' },
      { index: 9, rule: 'bad-payer' },
      { index: 10, rule: 'bad-amount' },
      { index: 11, rule: 'bad-split' },
      { index: 12, rule: 'bad-split' },
      { index: 13, rule: 'duplicate' },
      { index: 14, rule: 'bad-from' },
      { index: 15, rule: 'bad-to' },
      { index: 16, rule: 'bad-to' },
      { index: 17, rule: 'bad-amount' },
    ],
  })
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body.expenses, [])
  assert.deepEqual((await call('GET', '/groups/trip/payments')).body.payments, [])
  assert.equal((await call('POST', '/groups/trip/expenses', { description: 'Lunch', payer: 'Ann', amount: 5 })).body.id, 1)
}))

test('import finds already-recorded expenses and duplicates; skip_recorded skips the recorded ones', () => withTrip(async call => {
  await call('POST', '/groups/trip/expenses', { description: 'Coffee', payer: 'Ann', amount: 4.35 })
  const again = { ...coffee, description: 'coffee ', split: ['Ben'] }
  const r = await call('POST', '/groups/trip/import', { entries: [again, coffee] })
  assert.equal(r.status, 422)
  assert.deepEqual(r.body.problems, [{ index: 0, rule: 'already-recorded' }, { index: 1, rule: 'duplicate' }])
  const skipped = await call('POST', '/groups/trip/import', { entries: [again, coffee], skip_recorded: true })
  assert.equal(skipped.status, 422)
  assert.deepEqual(skipped.body.problems, [{ index: 1, rule: 'duplicate' }])
  // A different payer or amount is a different expense, and identical payments are all imported.
  const ok = await call('POST', '/groups/trip/import', {
    entries: [coffee, payback, { ...coffee, payer: 'Ben' }, payback, { ...coffee, amount: 4.36 }],
    skip_recorded: true,
  })
  assert.equal(ok.status, 201)
  assert.deepEqual(ok.body.skipped, [0])
  assert.deepEqual(ok.body.expenses.map(e => e.id), [2, 3])
  assert.deepEqual(ok.body.payments.map(p => p.id), [1, 2])
}))

test('import of only skipped entries succeeds and writes nothing', async () => {
  const data = tempDataFile()
  const app = await startApp(data.file)
  try {
    await app.call('POST', '/groups', trip)
    await app.call('POST', '/groups/trip/expenses', { description: 'Taxi', payer: 'Ann', amount: 10 })
    const before = readFileSync(data.file, 'utf8')
    const r = await app.call('POST', '/groups/trip/import', { entries: [taxi, { ...taxi, description: 'TAXI' }], skip_recorded: true })
    assert.equal(r.status, 422)
    const one = await app.call('POST', '/groups/trip/import', { entries: [taxi], skip_recorded: true })
    assert.equal(one.status, 201)
    assert.deepEqual(one.body, { expenses: [], payments: [], skipped: [0], balances: { Ann: 6.66, Ben: -3.33, Cara: -3.33 } })
    const dry = await app.call('POST', '/groups/trip/import', { entries: [taxi], skip_recorded: true, dry_run: true })
    assert.equal(dry.status, 200)
    assert.deepEqual(dry.body, one.body)
    assert.equal(readFileSync(data.file, 'utf8'), before)
  } finally {
    await app.stop()
    data.cleanup()
  }
})

test('dry_run replies like a real import with 200 but saves nothing', () => withTrip(async call => {
  const body = { entries: [taxi, payback, coffee] }
  const dry = await call('POST', '/groups/trip/import', { ...body, dry_run: true })
  assert.equal(dry.status, 200)
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body.expenses, [])
  assert.deepEqual((await call('GET', '/groups/trip/balances')).body.balances, { Ann: 0, Ben: 0, Cara: 0 })
  const bad = await call('POST', '/groups/trip/import', { entries: [taxi, taxi], dry_run: true })
  assert.equal(bad.status, 422)
  const real = await call('POST', '/groups/trip/import', { ...body, dry_run: false })
  assert.equal(real.status, 201)
  assert.deepEqual(real.body, dry.body)
}))

test('ids skip neither skipped entries nor the other kind of entry', () => withTrip(async call => {
  await call('POST', '/groups/trip/expenses', { description: 'Hotel', payer: 'Ben', amount: 90 })
  const r = await call('POST', '/groups/trip/import', {
    entries: [taxi, { ...taxi, type: 'expense', description: 'hotel', payer: 'Ben', amount: 90 }, payback, coffee],
    skip_recorded: true,
  })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.expenses.map(e => e.id), [2, 3])
  assert.deepEqual(r.body.payments.map(p => p.id), [1])
  assert.deepEqual(r.body.skipped, [1])
  assert.equal((await call('POST', '/groups/trip/expenses', { description: 'Lunch', payer: 'Ann', amount: 5 })).body.id, 4)
  assert.equal((await call('POST', '/groups/trip/payments', { from: 'Ann', to: 'Ben', amount: 1 })).body.id, 2)
}))
