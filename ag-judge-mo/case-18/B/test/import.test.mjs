import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { startApp, tempDataFile, withApp } from './helpers.mjs'

const trip = { id: 'trip', name: 'Ski trip', members: ['Ann', 'Ben', 'Cara'] }
const coffee = { type: 'expense', description: 'Coffee', payer: 'Ann', amount: 4.35 }
const payback = { type: 'payment', from: 'Ben', to: 'Ann', amount: 5 }

const importInto = (call, body) => call('POST', '/groups/trip/import', body)

test('import records expenses and payments with consecutive ids, in entry order', () => withApp(async call => {
  await call('POST', '/groups', trip)
  await call('POST', '/groups/trip/expenses', { description: 'Hotel', payer: 'Ann', amount: 90 })
  await call('POST', '/groups/trip/payments', { from: 'Cara', to: 'Ann', amount: 1 })
  const r = await importInto(call, { entries: [
    coffee,
    payback,
    { type: 'expense', description: 'Taxi', payer: 'Ben', amount: 10, split: ['Ben', 'Cara'] },
  ] })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body, {
    expenses: [
      { id: 2, description: 'Coffee', payer: 'Ann', amount: 4.35, split: trip.members, shares: { Ann: 1.45, Ben: 1.45, Cara: 1.45 } },
      { id: 3, description: 'Taxi', payer: 'Ben', amount: 10, split: ['Ben', 'Cara'], shares: { Ben: 5, Cara: 5 } },
    ],
    payments: [{ id: 2, from: 'Ben', to: 'Ann', amount: 5 }],
    skipped: [],
    balances: (await call('GET', '/groups/trip/balances')).body.balances,
  })
  assert.deepEqual(r.body.balances, { Ann: 56.9, Ben: -21.45, Cara: -35.45 })
  assert.equal((await call('GET', '/groups/trip/expenses')).body.expenses.length, 3)
  assert.equal((await call('POST', '/groups/trip/expenses', coffee)).body.id, 4)
  assert.equal((await call('POST', '/groups/trip/payments', payback)).body.id, 3)
}))

test('import checks the group, then the body fields, in order', () => withApp(async call => {
  assert.deepEqual((await importInto(call, { entries: 'x', bogus: 1 })).body, { error: 'not found' })
  await call('POST', '/groups', trip)
  const cases = [
    [{ entries: [coffee], zeta: 1, alpha: 2 }, 'unknown field zeta'],
    [{ dry_run: 'yes' }, 'entries must be an array of 1 to 50 items'],
    [{ entries: [] }, 'entries must be an array of 1 to 50 items'],
    [{ entries: Array(51).fill(payback) }, 'entries must be an array of 1 to 50 items'],
    [{ entries: [coffee], dry_run: null, skip_recorded: 1 }, 'dry_run must be true or false'],
    [{ entries: [coffee], skip_recorded: 'true' }, 'skip_recorded must be true or false'],
  ]
  for (const [body, error] of cases) {
    const r = await importInto(call, body)
    assert.equal(r.status, 400, error)
    assert.deepEqual(r.body, { error })
  }
  assert.deepEqual((await importInto(call, '[1]')).body, { error: 'body must be a JSON object' })
  assert.equal((await importInto(call, { entries: [{ ...coffee, description: 'x'.repeat(11 * 1024) }] })).status, 413)
}))

test('import rejects every bad entry with its first broken rule, and saves nothing', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const entries = [
    null,
    [coffee],
    { ...coffee, type: 'Expense' },
    { ...coffee, from: 'Ben' },
    { ...payback, split: ['Ann'] },
    { ...coffee, description: ' ', payer: 'Dan' },
    { ...coffee, payer: 'Dan', amount: 0 },
    { ...coffee, amount: 1.234 },
    { ...coffee, split: null },
    { ...payback, from: 'Dan', to: 'Dan' },
    { ...payback, to: 'Ben' },
    { ...payback, to: 'Dan', amount: -1 },
    { ...payback, amount: '5' },
    coffee,
    payback,
    { type: 'payment', from: 'Ben', to: 'Ann' },
    { type: 'expense' },
  ]
  const r = await importInto(call, { entries })
  assert.equal(r.status, 422)
  assert.deepEqual(r.body, { error: 'import rejected', problems: [
    { index: 0, rule: 'not-an-object' },
    { index: 1, rule: 'not-an-object' },
    { index: 2, rule: 'bad-type' },
    { index: 3, rule: 'unknown-field' },
    { index: 4, rule: 'unknown-field' },
    { index: 5, rule: 'bad-description' },
    { index: 6, rule: 'bad-payer' },
    { index: 7, rule: 'bad-amount' },
    { index: 8, rule: 'bad-split' },
    { index: 9, rule: 'bad-from' },
    { index: 10, rule: 'bad-to' },
    { index: 11, rule: 'bad-to' },
    { index: 12, rule: 'bad-amount' },
    { index: 15, rule: 'bad-amount' },
    { index: 16, rule: 'bad-description' },
  ] })
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body, { expenses: [] })
  assert.deepEqual((await call('GET', '/groups/trip/payments')).body, { payments: [] })
  assert.equal((await call('POST', '/groups/trip/expenses', coffee)).body.id, 1)
}))

test('import finds duplicates by payer, cents and trimmed lower-case description, not split', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const r = await importInto(call, { entries: [
    coffee,
    { ...coffee, description: '  COFFEE ', amount: 4.350, split: ['Ann'] },
    { ...coffee, payer: 'Ben' },
    { ...coffee, amount: 4.36 },
    { ...coffee, amount: 0 },
    { ...coffee, amount: 0 },
    payback,
    payback,
  ] })
  assert.equal(r.status, 422)
  assert.deepEqual(r.body.problems, [{ index: 1, rule: 'duplicate' }, { index: 4, rule: 'bad-amount' }, { index: 5, rule: 'bad-amount' }])
}))

test('already-recorded is a problem, or skipped with skip_recorded; duplicates of skipped entries still count', () => withApp(async call => {
  await call('POST', '/groups', trip)
  await call('POST', '/groups/trip/expenses', { description: 'coffee', payer: 'Ann', amount: 4.35, split: ['Ben'] })
  const twice = { entries: [coffee, coffee] }
  const strict = await importInto(call, twice)
  assert.equal(strict.status, 422)
  assert.deepEqual(strict.body.problems, [{ index: 0, rule: 'already-recorded' }, { index: 1, rule: 'duplicate' }])
  const skipping = await importInto(call, { ...twice, skip_recorded: true })
  assert.equal(skipping.status, 422)
  assert.deepEqual(skipping.body.problems, [{ index: 1, rule: 'duplicate' }])
}))

test('skipped entries take no id', () => withApp(async call => {
  await call('POST', '/groups', trip)
  await call('POST', '/groups/trip/expenses', { description: 'Hotel', payer: 'Ann', amount: 90 })
  const r = await importInto(call, { skip_recorded: true, entries: [
    coffee,
    { type: 'expense', description: 'hotel', payer: 'Ann', amount: 90 },
    payback,
    { ...coffee, description: 'Tea' },
  ] })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.expenses.map(e => e.id), [2, 3])
  assert.deepEqual(r.body.payments.map(p => p.id), [1])
  assert.deepEqual(r.body.skipped, [1])
  assert.equal((await call('POST', '/groups/trip/expenses', { ...coffee, description: 'Cake' })).body.id, 4)
  assert.equal((await call('POST', '/groups/trip/payments', payback)).body.id, 2)
}))

test('an import whose entries are all skipped succeeds and writes nothing', async t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  const app = await startApp(data.file)
  t.after(app.stop)
  await app.call('POST', '/groups', trip)
  await app.call('POST', '/groups/trip/expenses', { description: 'Coffee', payer: 'Ann', amount: 4.35 })
  const before = readFileSync(data.file, 'utf8')
  for (const [dry_run, status] of [[false, 201], [true, 200]]) {
    const r = await app.call('POST', '/groups/trip/import', { entries: [coffee], skip_recorded: true, dry_run })
    assert.equal(r.status, status)
    assert.deepEqual(r.body, { expenses: [], payments: [], skipped: [0], balances: { Ann: 2.9, Ben: -1.45, Cara: -1.45 } })
  }
  assert.equal(readFileSync(data.file, 'utf8'), before)
})

test('dry_run replies 200 with the ids a real import would get, and saves nothing', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const body = { entries: [coffee, payback] }
  const dry = await importInto(call, { ...body, dry_run: true })
  assert.equal(dry.status, 200)
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body, { expenses: [] })
  assert.deepEqual((await call('GET', '/groups/trip/balances')).body, { balances: { Ann: 0, Ben: 0, Cara: 0 } })
  const real = await importInto(call, { ...body, dry_run: false })
  assert.equal(real.status, 201)
  assert.deepEqual(real.body, dry.body)
  const bad = await importInto(call, { entries: [null], dry_run: true })
  assert.equal(bad.status, 422)
}))

test('import is saved to the data file in one go', async t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  const first = await startApp(data.file)
  await first.call('POST', '/groups', trip)
  await first.call('POST', '/groups/trip/import', { entries: [coffee, payback] })
  await first.stop()
  const second = await startApp(data.file)
  t.after(second.stop)
  assert.equal((await second.call('GET', '/groups/trip/expenses')).body.expenses[0].amount, 4.35)
  assert.deepEqual((await second.call('GET', '/groups/trip/payments')).body.payments, [{ id: 1, from: 'Ben', to: 'Ann', amount: 5 }])
})
