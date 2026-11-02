import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { startApp, tempDataFile, withApp } from './helpers.mjs'

const trip = { id: 'trip', name: 'Ski trip', members: ['Ann', 'Ben', 'Cara'] }
const coffee = { type: 'expense', description: 'Coffee', payer: 'Ann', amount: 4.35 }
const taxi = { type: 'expense', description: 'Taxi', payer: 'Ann', amount: 10 }
const payBack = { type: 'payment', from: 'Ben', to: 'Ann', amount: 3.33 }
const hotel = { description: 'Hotel', payer: 'Ann', amount: 90 }

const importInto = (call, body, group = 'trip') => call('POST', `/groups/${group}/import`, body)

// A group with one expense (id 1) and one payment (id 1) already recorded.
async function setUp(call) {
  await call('POST', '/groups', trip)
  await call('POST', '/groups/trip/expenses', hotel)
  await call('POST', '/groups/trip/payments', { from: 'Cara', to: 'Ann', amount: 30 })
}

test('import records expenses and payments with consecutive ids per kind, in entry order', () => withApp(async call => {
  await setUp(call)
  const r = await importInto(call, { entries: [taxi, payBack, { ...coffee, split: ['Ben', 'Cara'] }] })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body, {
    expenses: [
      { id: 2, description: 'Taxi', payer: 'Ann', amount: 10, split: trip.members, shares: { Ann: 3.34, Ben: 3.33, Cara: 3.33 } },
      { id: 3, description: 'Coffee', payer: 'Ann', amount: 4.35, split: ['Ben', 'Cara'], shares: { Ben: 2.18, Cara: 2.17 } },
    ],
    payments: [{ id: 2, from: 'Ben', to: 'Ann', amount: 3.33 }],
    skipped: [],
    balances: { Ann: 37.68, Ben: -32.18, Cara: -5.5 },
  })
  assert.deepEqual((await call('GET', '/groups/trip/balances')).body, { balances: r.body.balances })
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body.expenses.slice(1), r.body.expenses)
  assert.deepEqual((await call('GET', '/groups/trip/payments')).body.payments.slice(1), r.body.payments)
}))

test('skipped entries take no id, and an entry takes no id of the other kind', () => withApp(async call => {
  await setUp(call)
  const r = await importInto(call, { entries: [taxi, { ...hotel, type: 'expense' }, payBack, coffee], skip_recorded: true })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.expenses.map(e => e.id), [2, 3])
  assert.deepEqual(r.body.payments.map(p => p.id), [2])
  assert.deepEqual(r.body.skipped, [1])
  assert.equal((await call('POST', '/groups/trip/expenses', { ...hotel, description: 'Skis' })).body.id, 4)
  assert.equal((await call('POST', '/groups/trip/payments', { from: 'Ben', to: 'Ann', amount: 1 })).body.id, 3)
}))

test('expense and payment fields follow the POST routes: default split, amounts in cents', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const r = await importInto(call, { entries: [{ ...coffee, split: ['Cara'] }, { ...payBack, amount: 0.29 }] })
  assert.deepEqual(r.body.expenses[0], { id: 1, description: 'Coffee', payer: 'Ann', amount: 4.35, split: ['Cara'], shares: { Cara: 4.35 } })
  assert.deepEqual(r.body.payments[0], { id: 1, from: 'Ben', to: 'Ann', amount: 0.29 })
}))

test('identical payments are all imported', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const r = await importInto(call, { entries: [payBack, payBack, payBack] })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.payments.map(p => p.id), [1, 2, 3])
  assert.deepEqual(r.body.balances, { Ann: -9.99, Ben: 9.99, Cara: 0 })
}))

test('dry_run replies 200 with the same body and saves nothing', () => withApp(async call => {
  await setUp(call)
  const body = { entries: [taxi, payBack] }
  const dry = await importInto(call, { ...body, dry_run: true })
  assert.equal(dry.status, 200)
  assert.deepEqual(dry.body.expenses.map(e => e.id), [2])
  assert.deepEqual(dry.body.payments.map(p => p.id), [2])
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body.expenses.length, 1)
  assert.deepEqual((await call('GET', '/groups/trip/payments')).body.payments.length, 1)
  assert.deepEqual((await call('GET', '/groups/trip/balances')).body, { balances: { Ann: 30, Ben: -30, Cara: 0 } })
  const real = await importInto(call, { ...body, dry_run: false })
  assert.equal(real.status, 201)
  assert.deepEqual(real.body, dry.body)
}))

test('an unknown group is 404 before any check of the body', () => withApp(async call => {
  await call('POST', '/groups', trip)
  for (const body of [{ entries: [taxi] }, { nope: 1 }, { entries: [null] }]) {
    const r = await importInto(call, body, 'nope')
    assert.equal(r.status, 404)
    assert.deepEqual(r.body, { error: 'not found' })
  }
}))

test('a body over 10 KB is 413, and a body that is not a JSON object is 400', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const big = await importInto(call, { entries: [{ ...taxi, description: 'x'.repeat(11 * 1024) }] })
  assert.equal(big.status, 413)
  assert.deepEqual((await importInto(call, '[]')).body, { error: 'body must be a JSON object' })
  assert.deepEqual((await importInto(call, '{')).body, { error: 'invalid JSON' })
}))

test('a bad body gets 400 with the first message that applies', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const entries = [taxi]
  const fifty = Array.from({ length: 50 }, () => payBack)
  const cases = [
    [{ entries, b: 1, a: 2, dry_run: 'x' }, 'unknown field b'],
    [{ entries: [], extra: true }, 'unknown field extra'],
    [{}, 'entries must be an array of 1 to 50 items'],
    [{ entries: [], dry_run: 'x' }, 'entries must be an array of 1 to 50 items'],
    [{ entries: [...fifty, payBack] }, 'entries must be an array of 1 to 50 items'],
    [{ entries: { 0: taxi } }, 'entries must be an array of 1 to 50 items'],
    [{ entries, dry_run: null, skip_recorded: 'x' }, 'dry_run must be true or false'],
    [{ entries, dry_run: 'true' }, 'dry_run must be true or false'],
    [{ entries, skip_recorded: null }, 'skip_recorded must be true or false'],
    [{ entries, skip_recorded: 1 }, 'skip_recorded must be true or false'],
  ]
  for (const [body, error] of cases) {
    const r = await importInto(call, body)
    assert.equal(r.status, 400, JSON.stringify(body))
    assert.deepEqual(r.body, { error })
  }
  assert.equal((await importInto(call, { entries: fifty })).status, 201)
}))

// Each case is [entry, rule] for an entry that breaks only that rule first.
const ruleCases = [
  [null, 'not-an-object'],
  [[taxi], 'not-an-object'],
  ['taxi', 'not-an-object'],
  [7, 'not-an-object'],
  [{ ...taxi, type: 'Expense' }, 'bad-type'],
  [{ description: 'Taxi', payer: 'Ann', amount: 10 }, 'bad-type'],
  [{ ...taxi, from: 'Ann' }, 'unknown-field'],
  [{ ...payBack, split: ['Ann'] }, 'unknown-field'],
  [{ ...payBack, description: 'Back' }, 'unknown-field'],
  [{ ...taxi, description: '  ', payer: 'Dan' }, 'bad-description'],
  [{ type: 'expense', payer: 'Ann', amount: 10 }, 'bad-description'],
  [{ ...taxi, payer: 'ann', amount: 0 }, 'bad-payer'],
  [{ ...taxi, amount: 1.234, split: [] }, 'bad-amount'],
  [{ ...taxi, amount: '10' }, 'bad-amount'],
  [{ ...taxi, split: null }, 'bad-split'],
  [{ ...taxi, split: ['Ann', 'Ann'] }, 'bad-split'],
  [{ ...payBack, from: 'Dan', to: 'Dan' }, 'bad-from'],
  [{ type: 'payment', to: 'Ann', amount: 1 }, 'bad-from'],
  [{ ...payBack, to: 'Ben', amount: 0 }, 'bad-to'],
  [{ ...payBack, to: 'Dan' }, 'bad-to'],
  [{ ...payBack, amount: 1000000.01 }, 'bad-amount'],
  [{ ...hotel, type: 'expense', description: ' HOTEL ', split: ['Ben'] }, 'already-recorded'],
]

test('an entry that breaks a rule gets 422 with the first rule it breaks, and nothing is saved', () => withApp(async call => {
  await setUp(call)
  for (const [entry, rule] of ruleCases) {
    const r = await importInto(call, { entries: [taxi, entry] })
    assert.equal(r.status, 422, JSON.stringify(entry))
    assert.deepEqual(r.body, { error: 'import rejected', problems: [{ index: 1, rule }] }, JSON.stringify(entry))
  }
  assert.equal((await call('GET', '/groups/trip/expenses')).body.expenses.length, 1)
  assert.equal((await call('POST', '/groups/trip/expenses', taxi)).body.id, 2)
}))

test('problems list every bad entry by index; the 422 check comes after the 400 checks', () => withApp(async call => {
  await setUp(call)
  const entries = [null, taxi, { ...taxi, type: 'other' }, payBack, { ...payBack, to: 'Ben' }]
  const r = await importInto(call, { entries, dry_run: true })
  assert.equal(r.status, 422)
  assert.deepEqual(r.body.problems, [{ index: 0, rule: 'not-an-object' }, { index: 2, rule: 'bad-type' }, { index: 4, rule: 'bad-to' }])
  assert.equal((await importInto(call, { entries, dry_run: 1 })).status, 400)
}))

test('a later expense with the same payer, amount and description is a duplicate; split is not compared', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const entries = [taxi, { ...taxi, description: ' taxi', split: ['Ben'] }, { ...taxi, amount: 10.01 }, { ...taxi, payer: 'Ben' }, { ...taxi, description: 'TAXI ' }]
  const r = await importInto(call, { entries })
  assert.equal(r.status, 422)
  assert.deepEqual(r.body.problems, [{ index: 1, rule: 'duplicate' }, { index: 4, rule: 'duplicate' }])
}))

test('an entry that broke a rule does not count for duplicate', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const r = await importInto(call, { entries: [{ ...taxi, split: [] }, taxi] })
  assert.deepEqual(r.body.problems, [{ index: 0, rule: 'bad-split' }])
}))

test('identical entries matching a recorded expense: duplicate counts the earlier one, skipped or not', () => withApp(async call => {
  await setUp(call)
  const entry = { ...hotel, type: 'expense' }
  const kept = await importInto(call, { entries: [entry, entry] })
  assert.equal(kept.status, 422)
  assert.deepEqual(kept.body.problems, [{ index: 0, rule: 'already-recorded' }, { index: 1, rule: 'duplicate' }])
  const skipping = await importInto(call, { entries: [entry, entry], skip_recorded: true })
  assert.equal(skipping.status, 422)
  assert.deepEqual(skipping.body.problems, [{ index: 1, rule: 'duplicate' }])
}))

test('already-recorded compares with the group\'s own expenses only, amounts in cents', () => withApp(async call => {
  await setUp(call)
  await call('POST', '/groups', { ...trip, id: 'flat' })
  const r = await importInto(call, { entries: [{ ...hotel, type: 'expense' }, { ...hotel, type: 'expense', amount: 90.01 }] }, 'flat')
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.expenses.map(e => e.id), [2, 3])
}))

test('an import whose entries are all skipped replies with the current balances and writes nothing', async t => {
  const data = tempDataFile()
  const app = await startApp(data.file)
  t.after(async () => {
    await app.stop()
    data.cleanup()
  })
  await setUp(app.call)
  const before = readFileSync(data.file, 'utf8')
  const written = statSync(data.file).mtimeMs
  const entries = [{ ...hotel, type: 'expense' }, { ...hotel, type: 'expense', description: 'hotel ' }]
  for (const [dry_run, status] of [[false, 201], [true, 200]]) {
    const r = await importInto(app.call, { entries: entries.slice(0, 1), skip_recorded: true, dry_run })
    assert.equal(r.status, status)
    assert.deepEqual(r.body, { expenses: [], payments: [], skipped: [0], balances: { Ann: 30, Ben: -30, Cara: 0 } })
  }
  const two = await importInto(app.call, { entries, skip_recorded: true })
  assert.deepEqual(two.body.problems, [{ index: 1, rule: 'duplicate' }])
  assert.equal(readFileSync(data.file, 'utf8'), before)
  assert.equal(statSync(data.file).mtimeMs, written)
})

test('an import is saved to the data file and survives a restart', async t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  const first = await startApp(data.file)
  await first.call('POST', '/groups', trip)
  await importInto(first.call, { entries: [coffee, payBack] })
  await first.stop()
  const saved = JSON.parse(readFileSync(data.file, 'utf8'))
  assert.deepEqual(saved.expenses, [{ id: 1, group: 'trip', description: 'Coffee', payer: 'Ann', amount: 435, split: trip.members }])
  assert.deepEqual(saved.payments, [{ id: 1, group: 'trip', from: 'Ben', to: 'Ann', amount: 333 }])
  assert.deepEqual([saved.nextExpenseId, saved.nextPaymentId], [2, 2])
  const second = await startApp(data.file)
  t.after(second.stop)
  assert.equal((await second.call('POST', '/groups/trip/expenses', hotel)).body.id, 2)
})
