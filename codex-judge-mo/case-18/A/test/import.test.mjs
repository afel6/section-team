import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { startApp, tempDataFile, withApp } from './helpers.mjs'

const trip = { id: 'trip', name: 'Ski trip', members: ['Ann', 'Ben', 'Cara'] }
const hotel = { type: 'expense', description: 'Hotel', payer: 'Ann', amount: 90 }
const payBack = { type: 'payment', from: 'Ben', to: 'Ann', amount: 30 }

const importInto = (call, body, group = 'trip') => call('POST', `/groups/${group}/import`, body)

// Runs fn with the app, a trip group and the data file's path, for tests that look at what was written.
async function withTrip(fn) {
  const data = tempDataFile()
  const app = await startApp(data.file)
  try {
    await app.call('POST', '/groups', trip)
    await fn(app.call, data.file)
  } finally {
    await app.stop()
    data.cleanup()
  }
}

const rejected = (r, problems) => {
  assert.equal(r.status, 422)
  assert.deepEqual(r.body, { error: 'import rejected', problems })
}

test('import records expenses and payments, each kind with its own ids in entry order', () => withTrip(async call => {
  await call('POST', '/groups/trip/expenses', { description: 'Lunch', payer: 'Ben', amount: 30 })
  await call('POST', '/groups/trip/payments', { from: 'Cara', to: 'Ben', amount: 10 })
  const fuel = { type: 'expense', description: 'Fuel', payer: 'Cara', amount: 10, split: ['Cara', 'Ben', 'Ann'] }
  const r = await importInto(call, { entries: [hotel, payBack, fuel] })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body, {
    expenses: [
      { id: 2, description: 'Hotel', payer: 'Ann', amount: 90, split: trip.members, shares: { Ann: 30, Ben: 30, Cara: 30 } },
      { id: 3, description: 'Fuel', payer: 'Cara', amount: 10, split: ['Cara', 'Ben', 'Ann'], shares: { Cara: 3.34, Ben: 3.33, Ann: 3.33 } },
    ],
    payments: [{ id: 2, from: 'Ben', to: 'Ann', amount: 30 }],
    skipped: [],
    balances: { Ann: 16.67, Ben: 6.67, Cara: -23.34 },
  })
  assert.deepEqual((await call('GET', '/groups/trip/balances')).body, { balances: r.body.balances })
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body.expenses.map(e => e.id), [1, 2, 3])
  assert.deepEqual((await call('GET', '/groups/trip/payments')).body.payments.map(p => p.id), [1, 2])
  assert.equal((await call('POST', '/groups/trip/expenses', { description: 'Next', payer: 'Ann', amount: 1 })).body.id, 4)
  assert.equal((await call('POST', '/groups/trip/payments', { from: 'Ann', to: 'Ben', amount: 1 })).body.id, 3)
}))

test('import replies with empty lists for the kind it has none of', () => withTrip(async call => {
  const r = await importInto(call, { entries: [payBack, payBack] })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.expenses, [])
  assert.deepEqual(r.body.payments.map(p => p.id), [1, 2], 'identical payments are all imported')
  assert.deepEqual(r.body.skipped, [])
}))

test('import saves the whole import in one write', () => withTrip(async (call, file) => {
  const r = await importInto(call, { entries: [hotel, payBack] })
  assert.equal(r.status, 201)
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(saved.expenses.length, 1)
  assert.equal(saved.payments.length, 1)
  assert.equal(saved.nextExpenseId, 2)
  assert.equal(saved.nextPaymentId, 2)
}))

test('import of an unknown group is 404, before any body check', () => withTrip(async call => {
  for (const body of [{ entries: [hotel] }, { nope: 1 }, { entries: [] }]) {
    const r = await importInto(call, body, 'nope')
    assert.equal(r.status, 404)
    assert.deepEqual(r.body, { error: 'not found' })
  }
}))

test('import refuses a bad body with 400, first message first', () => withTrip(async call => {
  const cases = [
    [{ entries: [hotel], extra: 1, other: 2 }, 'unknown field extra'],
    [{ dry_run: 'x', zz: 1, entries: 'x' }, 'unknown field zz'],
    [{ entries: [hotel], Dry_run: true }, 'unknown field Dry_run'],
    [{}, 'entries must be an array of 1 to 50 items'],
    [{ entries: [] }, 'entries must be an array of 1 to 50 items'],
    [{ entries: null }, 'entries must be an array of 1 to 50 items'],
    [{ entries: { 0: hotel } }, 'entries must be an array of 1 to 50 items'],
    [{ entries: Array(51).fill(payBack) }, 'entries must be an array of 1 to 50 items'],
    [{ entries: [], dry_run: 'yes' }, 'entries must be an array of 1 to 50 items'],
    [{ entries: [hotel], dry_run: null }, 'dry_run must be true or false'],
    [{ entries: [hotel], dry_run: 1 }, 'dry_run must be true or false'],
    [{ entries: [hotel], dry_run: 'true', skip_recorded: 1 }, 'dry_run must be true or false'],
    [{ entries: [hotel], skip_recorded: null }, 'skip_recorded must be true or false'],
    [{ entries: [hotel], skip_recorded: 0 }, 'skip_recorded must be true or false'],
    [{ entries: [5], skip_recorded: 0 }, 'skip_recorded must be true or false'],
  ]
  for (const [body, error] of cases) {
    const r = await importInto(call, body)
    assert.equal(r.status, 400, JSON.stringify(body))
    assert.deepEqual(r.body, { error }, JSON.stringify(body))
  }
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body, { expenses: [] })
}))

test('import takes 50 entries', () => withTrip(async call => {
  const r = await importInto(call, { entries: Array(50).fill(payBack) })
  assert.equal(r.status, 201)
  assert.equal(r.body.payments.length, 50)
}))

test('import refuses a body that is not a JSON object, or is over 10 KB', () => withTrip(async call => {
  assert.equal((await importInto(call, '[]')).status, 400)
  assert.equal((await importInto(call, '{"entries":')).status, 400)
  assert.equal((await importInto(call, 'null', 'nope')).status, 400)
  const big = { entries: [{ ...hotel, description: 'x'.repeat(11 * 1024) }] }
  assert.equal((await importInto(call, big)).status, 413)
  assert.equal((await importInto(call, big, 'nope')).status, 413)
}))

test('import names the first rule each bad entry breaks, sorted by index', () => withTrip(async call => {
  const entries = [
    null, // 0
    [hotel], // 1
    'expense', // 2
    { ...hotel, type: 'Expense' }, // 3
    { description: 'Hotel', payer: 'Ann', amount: 90 }, // 4: no type
    { ...hotel, from: 'Ann' }, // 5
    { ...payBack, split: ['Ann'] }, // 6
    { ...hotel, description: '  ', payer: 'Dan' }, // 7
    { ...hotel, payer: 'ann', amount: 0 }, // 8
    { ...hotel, amount: 1.234, split: [] }, // 9
    { ...hotel, amount: '90' }, // 10
    { ...hotel, split: null }, // 11
    { ...hotel, split: ['Ann', 'Ann'] }, // 12
    { ...payBack, from: 'Dan', to: 'Dan', amount: -1 }, // 13
    { ...payBack, to: 'Ben' }, // 14
    { ...payBack, to: 'Dan', amount: 0 }, // 15
    { ...payBack, amount: 1000000.01 }, // 16
    { ...payBack, from: null }, // 17
    { ...hotel, description: null }, // 18
    { type: 'expense', description: 'Hotel', payer: 'Ann' }, // 19: no amount
    hotel, // 20: fine
    { ...hotel, description: 'x'.repeat(201) }, // 21
    { type: 'payment', from: 'Ben', to: 'Ann' }, // 22
  ]
  const r = await importInto(call, { entries })
  rejected(r, [
    { index: 0, rule: 'not-an-object' },
    { index: 1, rule: 'not-an-object' },
    { index: 2, rule: 'not-an-object' },
    { index: 3, rule: 'bad-type' },
    { index: 4, rule: 'bad-type' },
    { index: 5, rule: 'unknown-field' },
    { index: 6, rule: 'unknown-field' },
    { index: 7, rule: 'bad-description' },
    { index: 8, rule: 'bad-payer' },
    { index: 9, rule: 'bad-amount' },
    { index: 10, rule: 'bad-amount' },
    { index: 11, rule: 'bad-split' },
    { index: 12, rule: 'bad-split' },
    { index: 13, rule: 'bad-from' },
    { index: 14, rule: 'bad-to' },
    { index: 15, rule: 'bad-to' },
    { index: 16, rule: 'bad-amount' },
    { index: 17, rule: 'bad-from' },
    { index: 18, rule: 'bad-description' },
    { index: 19, rule: 'bad-amount' },
    { index: 21, rule: 'bad-description' },
    { index: 22, rule: 'bad-amount' },
  ])
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body, { expenses: [] }, 'nothing is saved')
}))

test('import: split may be left out, and an expense with every field is fine', () => withTrip(async call => {
  const r = await importInto(call, { entries: [{ ...hotel, split: ['Ben'] }, { ...hotel, payer: 'Ben' }] })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.expenses.map(e => e.split), [['Ben'], trip.members])
}))

test('import: an amount such as 4.35 is kept to the cent', () => withTrip(async call => {
  const r = await importInto(call, { entries: [{ ...hotel, amount: 4.35 }, { ...payBack, amount: 0.29 }] })
  assert.equal(r.body.expenses[0].amount, 4.35)
  assert.equal(r.body.payments[0].amount, 0.29)
}))

test('import: a repeated expense is duplicate, matched on payer, cents and trimmed lower-case description', () => withTrip(async call => {
  const entries = [
    hotel, // 0
    { ...hotel, description: '  hOTEL\t', amount: 90.0, split: ['Ben'] }, // 1: duplicate of 0
    { ...hotel, payer: 'Ben' }, // 2: other payer
    { ...hotel, amount: 90.01 }, // 3: other amount
    { ...hotel, description: 'Hotels' }, // 4: other description
    { ...hotel, description: 'Ho tel' }, // 5: inner space counts
    { ...hotel, amount: 'x' }, // 6: bad, so it does not count for later entries
    { ...hotel, payer: 'Ben', amount: 'x' }, // 7
    { ...hotel, payer: 'Ben', description: 'hotel' }, // 8: duplicate of 2
  ]
  rejected(await importInto(call, { entries }), [
    { index: 1, rule: 'duplicate' },
    { index: 6, rule: 'bad-amount' },
    { index: 7, rule: 'bad-amount' },
    { index: 8, rule: 'duplicate' },
  ])
}))

test('import: an entry that broke a rule does not make a later one duplicate', () => withTrip(async call => {
  const r = await importInto(call, { entries: [{ ...hotel, split: ['Dan'] }, hotel] })
  rejected(r, [{ index: 0, rule: 'bad-split' }])
}))

test('import: an expense the group already has is already-recorded; other groups do not count', () => withTrip(async call => {
  await call('POST', '/groups', { ...trip, id: 'flat' })
  await call('POST', '/groups/trip/expenses', { description: ' HOTEL ', payer: 'Ann', amount: 90, split: ['Ben'] })
  await call('POST', '/groups/flat/expenses', { description: 'Fuel', payer: 'Ann', amount: 10 })
  const fuel = { type: 'expense', description: 'Fuel', payer: 'Ann', amount: 10 }
  const r = await importInto(call, { entries: [fuel, hotel, { ...hotel, payer: 'Cara', amount: 'x' }] })
  rejected(r, [{ index: 1, rule: 'already-recorded' }, { index: 2, rule: 'bad-amount' }])
}))

test('import: duplicate comes before already-recorded, with or without skip_recorded', () => withTrip(async call => {
  await call('POST', '/groups/trip/expenses', { description: 'Hotel', payer: 'Ann', amount: 90 })
  rejected(await importInto(call, { entries: [hotel, hotel], skip_recorded: true }), [{ index: 1, rule: 'duplicate' }])
  rejected(await importInto(call, { entries: [hotel, hotel] }), [
    { index: 0, rule: 'already-recorded' },
    { index: 1, rule: 'duplicate' },
  ])
  rejected(await importInto(call, { entries: [hotel, hotel], skip_recorded: false }), [
    { index: 0, rule: 'already-recorded' },
    { index: 1, rule: 'duplicate' },
  ])
}))

test('import with skip_recorded leaves out recorded expenses and takes no ids for them', () => withTrip(async call => {
  await call('POST', '/groups/trip/expenses', { description: 'Hotel', payer: 'Ann', amount: 90 })
  await call('POST', '/groups/trip/payments', { from: 'Cara', to: 'Ann', amount: 5 })
  const fuel = { type: 'expense', description: 'Fuel', payer: 'Ben', amount: 30 }
  const snack = { type: 'expense', description: 'Snack', payer: 'Cara', amount: 3 }
  const r = await importInto(call, { entries: [fuel, hotel, payBack, snack], skip_recorded: true })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.expenses.map(e => [e.id, e.description]), [[2, 'Fuel'], [3, 'Snack']])
  assert.deepEqual(r.body.payments.map(p => p.id), [2])
  assert.deepEqual(r.body.skipped, [1])
  assert.deepEqual((await call('GET', '/groups/trip/balances')).body, { balances: r.body.balances })
  assert.equal((await call('POST', '/groups/trip/expenses', { description: 'X', payer: 'Ann', amount: 1 })).body.id, 4)
  assert.equal((await call('POST', '/groups/trip/payments', { from: 'Ann', to: 'Ben', amount: 1 })).body.id, 3)
}))

test('import where every entry is skipped answers 201 and writes nothing', () => withTrip(async (call, file) => {
  await call('POST', '/groups/trip/expenses', { description: 'Hotel', payer: 'Ann', amount: 90 })
  await call('POST', '/groups/trip/expenses', { description: 'Fuel', payer: 'Ben', amount: 10 })
  const before = readFileSync(file, 'utf8')
  const mtime = statSync(file).mtimeMs
  const fuel = { type: 'expense', description: 'fuel', payer: 'Ben', amount: 10 }
  const r = await importInto(call, { entries: [fuel, hotel], skip_recorded: true })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body, { expenses: [], payments: [], skipped: [0, 1], balances: { Ann: 56.66, Ben: -23.33, Cara: -33.33 } })
  assert.equal(readFileSync(file, 'utf8'), before)
  assert.equal(statSync(file).mtimeMs, mtime)
  const dry = await importInto(call, { entries: [fuel, hotel], skip_recorded: true, dry_run: true })
  assert.equal(dry.status, 200)
  assert.deepEqual(dry.body, r.body)
}))

test('a dry run answers 200 with the reply a real import would give, and saves nothing', () => withTrip(async (call, file) => {
  await call('POST', '/groups/trip/expenses', { description: 'Lunch', payer: 'Ben', amount: 30 })
  const before = readFileSync(file, 'utf8')
  const body = { entries: [hotel, payBack], dry_run: true }
  const dry = await importInto(call, body)
  assert.equal(dry.status, 200)
  assert.deepEqual(dry.body.expenses.map(e => e.id), [2])
  assert.deepEqual(dry.body.payments.map(p => p.id), [1])
  assert.deepEqual(dry.body.balances, { Ann: 20, Ben: 20, Cara: -40 })
  assert.equal(readFileSync(file, 'utf8'), before)
  assert.deepEqual((await call('GET', '/groups/trip/balances')).body, { balances: { Ann: -10, Ben: 20, Cara: -10 } })
  assert.equal((await importInto(call, body)).status, 200, 'a repeated dry run sees no recorded expense')

  const real = await importInto(call, { ...body, dry_run: false })
  assert.equal(real.status, 201)
  assert.deepEqual(real.body, dry.body)
}))

test('a dry run gives the same errors as a real import', () => withTrip(async call => {
  await call('POST', '/groups/trip/expenses', { description: 'Hotel', payer: 'Ann', amount: 90 })
  rejected(await importInto(call, { entries: [hotel, null], dry_run: true }), [
    { index: 0, rule: 'already-recorded' },
    { index: 1, rule: 'not-an-object' },
  ])
  assert.equal((await importInto(call, { entries: [], dry_run: true })).status, 400)
  assert.equal((await importInto(call, { entries: [hotel], dry_run: true }, 'nope')).status, 404)
}))

test('a dry run leaves the next ids for the next real expense and payment', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const dry = await importInto(call, { entries: [hotel, payBack], dry_run: true })
  assert.equal((await call('POST', '/groups/trip/expenses', { description: 'Hotel', payer: 'Ann', amount: 90 })).body.id, dry.body.expenses[0].id)
  assert.equal((await call('POST', '/groups/trip/payments', { from: 'Ben', to: 'Ann', amount: 30 })).body.id, dry.body.payments[0].id)
}))

test('import keeps its group: another group\'s entries and balances are untouched', () => withTrip(async call => {
  await call('POST', '/groups', { ...trip, id: 'flat', members: ['Cara', 'Dan'] })
  rejected(await importInto(call, { entries: [{ ...hotel, payer: 'Dan' }, { ...payBack, from: 'Dan', to: 'Cara' }] }), [
    { index: 0, rule: 'bad-payer' },
    { index: 1, rule: 'bad-from' },
  ])
  const r = await importInto(call, { entries: [{ ...hotel, payer: 'Dan', split: ['Cara', 'Dan'] }] }, 'flat')
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.balances, { Cara: -45, Dan: 45 })
  assert.deepEqual((await call('GET', '/groups/trip/balances')).body, { balances: { Ann: 0, Ben: 0, Cara: 0 } })
}))
