import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { startApp, tempDataFile, withApp } from './helpers.mjs'

const trip = { id: 'trip', name: 'Ski trip', members: ['Ann', 'Ben', 'Cara'] }
const hotel = { type: 'expense', description: 'Hotel', payer: 'Ann', amount: 90 }
const payBack = { type: 'payment', from: 'Ben', to: 'Ann', amount: 30 }

const withTrip = fn => withApp(async call => {
  await call('POST', '/groups', trip)
  await fn(call)
})

const listed = async call => ({
  expenses: (await call('GET', '/groups/trip/expenses')).body.expenses,
  payments: (await call('GET', '/groups/trip/payments')).body.payments,
})

test('POST /groups/:id/import records expenses and payments like the POST routes', () => withTrip(async call => {
  const taxi = { type: 'expense', description: 'Taxi', payer: 'Ann', amount: 10, split: ['Ann', 'Ben', 'Cara'] }
  const r = await call('POST', '/groups/trip/import', { entries: [hotel, payBack, taxi] })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body, {
    expenses: [
      { id: 1, description: 'Hotel', payer: 'Ann', amount: 90, split: trip.members, shares: { Ann: 30, Ben: 30, Cara: 30 } },
      { id: 2, description: 'Taxi', payer: 'Ann', amount: 10, split: trip.members, shares: { Ann: 3.34, Ben: 3.33, Cara: 3.33 } },
    ],
    payments: [{ id: 1, from: 'Ben', to: 'Ann', amount: 30 }],
    skipped: [],
    balances: { Ann: 36.66, Ben: -3.33, Cara: -33.33 },
  })
  assert.deepEqual(await listed(call), { expenses: r.body.expenses, payments: r.body.payments })
  assert.deepEqual((await call('GET', '/groups/trip/balances')).body, { balances: r.body.balances })
}))

test('import ids follow on from the POST routes, per kind, and skipped entries take none', () => withTrip(async call => {
  await call('POST', '/groups/trip/expenses', { description: 'Fuel', payer: 'Ben', amount: 20 })
  await call('POST', '/groups/trip/payments', { from: 'Cara', to: 'Ben', amount: 5 })
  const fuel = { type: 'expense', description: '  FUEL ', payer: 'Ben', amount: 20.0, split: ['Ben'] }
  const r = await call('POST', '/groups/trip/import', { entries: [hotel, fuel, payBack, { ...hotel, description: 'Skis' }], skip_recorded: true })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.expenses.map(e => e.id), [2, 3])
  assert.deepEqual(r.body.payments.map(p => p.id), [2])
  assert.deepEqual(r.body.skipped, [1])
  assert.equal((await call('POST', '/groups/trip/expenses', { description: 'Lift', payer: 'Ann', amount: 1 })).body.id, 4)
  assert.equal((await call('POST', '/groups/trip/payments', { from: 'Ann', to: 'Ben', amount: 1 })).body.id, 3)
}))

test('a dry run answers 200 with the same body and saves nothing', () => withTrip(async call => {
  const dry = await call('POST', '/groups/trip/import', { entries: [hotel, payBack], dry_run: true })
  assert.equal(dry.status, 200)
  assert.deepEqual(await listed(call), { expenses: [], payments: [] })
  const real = await call('POST', '/groups/trip/import', { entries: [hotel, payBack], dry_run: false })
  assert.equal(real.status, 201)
  assert.deepEqual(real.body, dry.body)
}))

test('an import whose entries are all skipped succeeds and writes nothing', async t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  const app = await startApp(data.file)
  t.after(app.stop)
  await app.call('POST', '/groups', trip)
  await app.call('POST', '/groups/trip/expenses', hotel)
  const before = readFileSync(data.file, 'utf8')
  const r = await app.call('POST', '/groups/trip/import', { entries: [hotel], skip_recorded: true })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body, { expenses: [], payments: [], skipped: [0], balances: { Ann: 60, Ben: -30, Cara: -30 } })
  assert.equal(readFileSync(data.file, 'utf8'), before)
  const dry = await app.call('POST', '/groups/trip/import', { entries: [hotel], skip_recorded: true, dry_run: true })
  assert.equal(dry.status, 200)
  assert.deepEqual(dry.body, r.body)
})

test('import: 404 for an unknown group comes before body checks', () => withApp(async call => {
  const r = await call('POST', '/groups/nope/import', { bogus: 1 })
  assert.equal(r.status, 404)
  assert.deepEqual(r.body, { error: 'not found' })
}))

test('import refuses a bad body with 400, in order', () => withTrip(async call => {
  const cases = [
    [{ entries: [hotel], zeta: 1, alpha: 2 }, 'unknown field zeta'],
    [{ dry_run: 'x', extra: 1 }, 'unknown field extra'],
    [{ dry_run: 'x' }, 'entries must be an array of 1 to 50 items'],
    [{ entries: [] }, 'entries must be an array of 1 to 50 items'],
    [{ entries: Array(51).fill(payBack) }, 'entries must be an array of 1 to 50 items'],
    [{ entries: { 0: hotel } }, 'entries must be an array of 1 to 50 items'],
    [{ entries: [hotel], dry_run: null, skip_recorded: 1 }, 'dry_run must be true or false'],
    [{ entries: [hotel], skip_recorded: null }, 'skip_recorded must be true or false'],
  ]
  for (const [body, error] of cases) {
    const r = await call('POST', '/groups/trip/import', body)
    assert.equal(r.status, 400, JSON.stringify(body))
    assert.deepEqual(r.body, { error })
  }
  assert.equal((await call('POST', '/groups/trip/import', '[1]')).status, 400)
  const big = await call('POST', '/groups/trip/import', { entries: [{ ...hotel, description: 'x'.repeat(11 * 1024) }] })
  assert.equal(big.status, 413)
  assert.deepEqual(await listed(call), { expenses: [], payments: [] })
}))

test('import refuses the whole list with 422 and names the first rule each bad entry breaks', () => withTrip(async call => {
  const entries = [
    hotel,
    null,
    [hotel],
    { ...hotel, type: 'refund' },
    { description: 'Hotel', payer: 'Ann', amount: 90 },
    { ...hotel, from: 'Ben' },
    { ...payBack, split: ['Ann'] },
    { ...hotel, description: ' ', payer: 'Dan' },
    { ...hotel, payer: 'Dan', amount: 0 },
    { ...hotel, amount: 1.234, split: [] },
    { ...hotel, split: null },
    { ...payBack, from: 'Dan', to: 'Dan' },
    { ...payBack, to: 'Ben', amount: 0 },
    { ...payBack, to: 'Dan' },
    { ...payBack, amount: '30' },
    payBack,
  ]
  const r = await call('POST', '/groups/trip/import', { entries })
  assert.equal(r.status, 422)
  assert.deepEqual(r.body, { error: 'import rejected', problems: [
    { index: 1, rule: 'not-an-object' },
    { index: 2, rule: 'not-an-object' },
    { index: 3, rule: 'bad-type' },
    { index: 4, rule: 'bad-type' },
    { index: 5, rule: 'unknown-field' },
    { index: 6, rule: 'unknown-field' },
    { index: 7, rule: 'bad-description' },
    { index: 8, rule: 'bad-payer' },
    { index: 9, rule: 'bad-amount' },
    { index: 10, rule: 'bad-split' },
    { index: 11, rule: 'bad-from' },
    { index: 12, rule: 'bad-to' },
    { index: 13, rule: 'bad-to' },
    { index: 14, rule: 'bad-amount' },
  ] })
  assert.deepEqual(await listed(call), { expenses: [], payments: [] })
}))

test('import finds duplicates within the list and expenses already recorded', () => withTrip(async call => {
  await call('POST', '/groups/trip/expenses', { description: 'Hotel', payer: 'Ann', amount: 90 })
  const same = { ...hotel, description: ' hOTEL', split: ['Ben'] }
  const fresh = { ...hotel, description: 'Skis' }
  const bad = { ...fresh, payer: 'Dan' }
  const body = { entries: [hotel, same, bad, fresh, fresh, { ...fresh, payer: 'Ben' }, payBack, payBack] }
  const r = await call('POST', '/groups/trip/import', body)
  assert.equal(r.status, 422)
  assert.deepEqual(r.body.problems, [
    { index: 0, rule: 'already-recorded' },
    { index: 1, rule: 'duplicate' },
    { index: 2, rule: 'bad-payer' },
    { index: 4, rule: 'duplicate' },
  ])
  const skip = await call('POST', '/groups/trip/import', { ...body, skip_recorded: true })
  assert.equal(skip.status, 422)
  assert.deepEqual(skip.body.problems, [{ index: 1, rule: 'duplicate' }, { index: 2, rule: 'bad-payer' }, { index: 4, rule: 'duplicate' }])
}))

test('identical payments are all imported; a skipped expense still counts for duplicate', () => withTrip(async call => {
  const r = await call('POST', '/groups/trip/import', { entries: [payBack, payBack] })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.payments.map(p => p.id), [1, 2])
  await call('POST', '/groups/trip/expenses', { description: 'Hotel', payer: 'Ann', amount: 90 })
  const twice = await call('POST', '/groups/trip/import', { entries: [hotel, hotel], skip_recorded: true })
  assert.equal(twice.status, 422)
  assert.deepEqual(twice.body.problems, [{ index: 1, rule: 'duplicate' }])
}))
