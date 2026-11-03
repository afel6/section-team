import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { startApp, tempDataFile, withApp } from './helpers.mjs'

const trip = { id: 'trip', name: 'Ski trip', members: ['Ann', 'Ben', 'Cara'] }
const taxi = { type: 'expense', description: 'Taxi', payer: 'Ann', amount: 10 }
const payBack = { type: 'payment', from: 'Ben', to: 'Ann', amount: 3.33 }

const importInto = (call, body) => call('POST', '/groups/trip/import', body)

async function withTrip(fn) {
  return withApp(async call => {
    await call('POST', '/groups', trip)
    await fn(call)
  })
}

// Asserts a 422 import rejected reply with exactly these problems.
function assertRejected(r, problems) {
  assert.equal(r.status, 422, r.text)
  assert.deepEqual(r.body, { error: 'import rejected', problems })
}

test('import records expenses and payments with their own consecutive ids, in entry order', () => withTrip(async call => {
  await call('POST', '/groups/trip/expenses', { description: 'Hotel', payer: 'Cara', amount: 30 })
  const r = await importInto(call, { entries: [taxi, { ...payBack }, { ...taxi, description: 'Fuel', split: ['Ben', 'Cara'] }] })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body, {
    expenses: [
      { id: 2, description: 'Taxi', payer: 'Ann', amount: 10, split: ['Ann', 'Ben', 'Cara'], shares: { Ann: 3.34, Ben: 3.33, Cara: 3.33 } },
      { id: 3, description: 'Fuel', payer: 'Ann', amount: 10, split: ['Ben', 'Cara'], shares: { Ben: 5, Cara: 5 } },
    ],
    payments: [{ id: 1, from: 'Ben', to: 'Ann', amount: 3.33 }],
    skipped: [],
    balances: { Ann: 3.33, Ben: -15, Cara: 11.67 },
  })
  assert.deepEqual((await call('GET', '/groups/trip/balances')).body, { balances: r.body.balances })
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body.expenses.slice(1), r.body.expenses)
  assert.deepEqual((await call('GET', '/groups/trip/payments')).body.payments, r.body.payments)
}))

test('import gives the same shape as the POST routes for the same fields', () => withTrip(async call => {
  const imported = (await importInto(call, { entries: [taxi, payBack] })).body
  const { type: _e, ...expense } = taxi
  const { type: _p, ...payment } = payBack
  assert.deepEqual((await call('POST', '/groups/trip/expenses', expense)).body, { ...imported.expenses[0], id: 2 })
  assert.deepEqual((await call('POST', '/groups/trip/payments', payment)).body, { ...imported.payments[0], id: 2 })
}))

test('skipped entries take no id; each kind keeps its own counter', () => withTrip(async call => {
  await call('POST', '/groups/trip/expenses', { description: 'Hotel', payer: 'Ann', amount: 90 })
  await call('POST', '/groups/trip/payments', { from: 'Cara', to: 'Ann', amount: 1 })
  const entries = [taxi, { type: 'expense', description: ' hotel ', payer: 'Ann', amount: 90 }, payBack, { ...taxi, description: 'Bus' }]
  const r = await importInto(call, { entries, skip_recorded: true })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.expenses.map(e => [e.id, e.description]), [[2, 'Taxi'], [3, 'Bus']])
  assert.deepEqual(r.body.payments.map(p => p.id), [2])
  assert.deepEqual(r.body.skipped, [1])
  assert.equal((await call('POST', '/groups/trip/expenses', { description: 'Next', payer: 'Ann', amount: 1 })).body.id, 4)
  assert.equal((await call('POST', '/groups/trip/payments', { from: 'Cara', to: 'Ann', amount: 1 })).body.id, 3)
}))

test('import counts ids across groups, as the POST routes do', () => withTrip(async call => {
  await call('POST', '/groups', { ...trip, id: 'flat' })
  await call('POST', '/groups/flat/expenses', { description: 'Rent', payer: 'Ann', amount: 5 })
  const r = await importInto(call, { entries: [taxi] })
  assert.equal(r.body.expenses[0].id, 2)
}))

test('an unknown group is 404, before any body check', () => withTrip(async call => {
  const r = await call('POST', '/groups/nope/import', { bogus: 1 })
  assert.equal(r.status, 404)
  assert.deepEqual(r.body, { error: 'not found' })
}))

test('body over 10 KB is 413 and a body that is not an object is 400', () => withTrip(async call => {
  const big = await importInto(call, { entries: [{ ...taxi, description: 'x'.repeat(11 * 1024) }] })
  assert.equal(big.status, 413)
  for (const text of ['[]', 'null', '"x"', '{"entries":']) {
    const r = await importInto(call, text)
    assert.equal(r.status, 400, text)
  }
}))

test('body checks give 400 with the first failing message, in order', () => withTrip(async call => {
  const cases = [
    [{ entries: [taxi], zeta: 1, alpha: 2 }, 'unknown field zeta'],
    [{ dry_run: 'x', extra: 1 }, 'unknown field extra'],
    [{ entries: [taxi], Dry_run: true }, 'unknown field Dry_run'],
    [{}, 'entries must be an array of 1 to 50 items'],
    [{ entries: [] }, 'entries must be an array of 1 to 50 items'],
    [{ entries: null }, 'entries must be an array of 1 to 50 items'],
    [{ entries: { 0: taxi } }, 'entries must be an array of 1 to 50 items'],
    [{ entries: Array(51).fill(payBack) }, 'entries must be an array of 1 to 50 items'],
    [{ entries: [], dry_run: 'yes' }, 'entries must be an array of 1 to 50 items'],
    [{ entries: [taxi], dry_run: null }, 'dry_run must be true or false'],
    [{ entries: [taxi], dry_run: 0, skip_recorded: 'no' }, 'dry_run must be true or false'],
    [{ entries: [taxi], dry_run: 'true' }, 'dry_run must be true or false'],
    [{ entries: [taxi], skip_recorded: null }, 'skip_recorded must be true or false'],
    [{ entries: [taxi], skip_recorded: 1 }, 'skip_recorded must be true or false'],
    [{ entries: [null], skip_recorded: 1 }, 'skip_recorded must be true or false'],
  ]
  for (const [body, error] of cases) {
    const r = await importInto(call, body)
    assert.equal(r.status, 400, JSON.stringify(body))
    assert.deepEqual(r.body, { error }, JSON.stringify(body))
  }
  assert.equal((await importInto(call, { entries: Array(50).fill(payBack) })).status, 201)
}))

test('each broken entry rule is reported with its index', () => withTrip(async call => {
  const cases = [
    [null, 'not-an-object'],
    [[taxi], 'not-an-object'],
    ['expense', 'not-an-object'],
    [7, 'not-an-object'],
    [{ description: 'Taxi', payer: 'Ann', amount: 10 }, 'bad-type'],
    [{ ...taxi, type: 'Expense' }, 'bad-type'],
    [{ ...taxi, type: ['expense'] }, 'bad-type'],
    [{ ...taxi, type: null }, 'bad-type'],
    [{ ...taxi, from: 'Ann' }, 'unknown-field'],
    [{ ...taxi, note: 'x', description: '' }, 'unknown-field'],
    [{ ...payBack, split: ['Ann'] }, 'unknown-field'],
    [{ ...payBack, payer: 'Ann' }, 'unknown-field'],
    [{ ...taxi, description: '  ', payer: 'Dan' }, 'bad-description'],
    [{ ...taxi, description: 'x'.repeat(201) }, 'bad-description'],
    [{ type: 'expense', payer: 'Ann', amount: 10 }, 'bad-description'],
    [{ ...taxi, payer: 'ann', amount: 0 }, 'bad-payer'],
    [{ ...taxi, payer: null }, 'bad-payer'],
    [{ ...taxi, amount: 4.351, split: [] }, 'bad-amount'],
    [{ ...taxi, amount: '10' }, 'bad-amount'],
    [{ ...taxi, amount: 1000000.01 }, 'bad-amount'],
    [{ ...taxi, split: null }, 'bad-split'],
    [{ ...taxi, split: [] }, 'bad-split'],
    [{ ...taxi, split: ['Ann', 'Ann'] }, 'bad-split'],
    [{ ...taxi, split: ['Dan'] }, 'bad-split'],
    [{ ...payBack, from: 'Dan', to: 'Dan', amount: 0 }, 'bad-from'],
    [{ type: 'payment', to: 'Ann', amount: 1 }, 'bad-from'],
    [{ ...payBack, to: 'Dan', amount: 0 }, 'bad-to'],
    [{ ...payBack, to: 'Ben', amount: 0 }, 'bad-to'],
    [{ ...payBack, amount: 0 }, 'bad-amount'],
    [{ ...payBack, amount: null }, 'bad-amount'],
  ]
  const r = await importInto(call, { entries: [taxi, ...cases.map(([entry]) => entry), payBack] })
  assertRejected(r, cases.map(([, rule], i) => ({ index: i + 1, rule })))
}))

test('a rejected import saves nothing, not even its valid entries', () => withTrip(async call => {
  const r = await importInto(call, { entries: [taxi, payBack, { ...taxi, amount: -1 }] })
  assertRejected(r, [{ index: 2, rule: 'bad-amount' }])
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body, { expenses: [] })
  assert.deepEqual((await call('GET', '/groups/trip/payments')).body, { payments: [] })
  assert.equal((await call('POST', '/groups/trip/expenses', { description: 'A', payer: 'Ann', amount: 1 })).body.id, 1)
  assert.equal((await call('POST', '/groups/trip/payments', { from: 'Ben', to: 'Ann', amount: 1 })).body.id, 1)
}))

test('duplicate compares payer, cents and trimmed lower-case description, not split', () => withTrip(async call => {
  const entries = [
    taxi,
    { ...taxi, description: '  TAXI ', amount: 10.0, split: ['Ben'] },
    { ...taxi, payer: 'Ben' },
    { ...taxi, amount: 10.01 },
    { ...taxi, description: 'Taxi 2' },
    { ...taxi, description: 'Taxi ' },
  ]
  assertRejected(await importInto(call, { entries }), [{ index: 1, rule: 'duplicate' }, { index: 5, rule: 'duplicate' }])
}))

test('an entry that breaks a field rule does not count for duplicate', () => withTrip(async call => {
  const r = await importInto(call, { entries: [{ ...taxi, split: ['Dan'] }, taxi, { ...taxi, extra: 1 }, taxi] })
  assertRejected(r, [{ index: 0, rule: 'bad-split' }, { index: 2, rule: 'unknown-field' }, { index: 3, rule: 'duplicate' }])
}))

test('a duplicate entry still counts for later duplicates', () => withTrip(async call => {
  const r = await importInto(call, { entries: [taxi, taxi, taxi] })
  assertRejected(r, [{ index: 1, rule: 'duplicate' }, { index: 2, rule: 'duplicate' }])
}))

test('already-recorded matches the group\'s own expenses only', () => withTrip(async call => {
  await call('POST', '/groups', { ...trip, id: 'flat' })
  await call('POST', '/groups/flat/expenses', { description: 'Bus', payer: 'Ann', amount: 10 })
  await call('POST', '/groups/trip/expenses', { description: 'taxi', payer: 'Ann', amount: 10, split: ['Ann'] })
  const r = await importInto(call, { entries: [{ ...taxi, description: 'Bus' }, { ...taxi, description: ' TAXI' }, { ...taxi, payer: 'Ben' }] })
  assertRejected(r, [{ index: 1, rule: 'already-recorded' }])
}))

test('two copies of a recorded expense: already-recorded then duplicate, or duplicate only when skipping', () => withTrip(async call => {
  await call('POST', '/groups/trip/expenses', { description: 'Taxi', payer: 'Ann', amount: 10 })
  assertRejected(await importInto(call, { entries: [taxi, taxi] }), [
    { index: 0, rule: 'already-recorded' }, { index: 1, rule: 'duplicate' },
  ])
  assertRejected(await importInto(call, { entries: [taxi, taxi], skip_recorded: true }), [{ index: 1, rule: 'duplicate' }])
  assertRejected(await importInto(call, { entries: [taxi, taxi], skip_recorded: false }), [
    { index: 0, rule: 'already-recorded' }, { index: 1, rule: 'duplicate' },
  ])
}))

test('identical payments are all imported', () => withTrip(async call => {
  await call('POST', '/groups/trip/payments', { from: 'Ben', to: 'Ann', amount: 3.33 })
  const r = await importInto(call, { entries: [payBack, payBack], skip_recorded: true })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.payments.map(p => p.id), [2, 3])
  assert.deepEqual(r.body.skipped, [])
}))

test('an import whose entries are all skipped succeeds and writes nothing', async t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  const app = await startApp(data.file)
  t.after(app.stop)
  await app.call('POST', '/groups', trip)
  await app.call('POST', '/groups/trip/expenses', { description: 'Taxi', payer: 'Ann', amount: 10 })
  const before = readFileSync(data.file, 'utf8')
  for (const [dry_run, status] of [[false, 201], [true, 200]]) {
    const r = await app.call('POST', '/groups/trip/import', { entries: [taxi], skip_recorded: true, dry_run })
    assert.equal(r.status, status)
    assert.deepEqual(r.body, { expenses: [], payments: [], skipped: [0], balances: { Ann: 6.66, Ben: -3.33, Cara: -3.33 } })
  }
  assert.equal(readFileSync(data.file, 'utf8'), before)
})

test('dry_run replies 200 with what a real import would give, and saves nothing', async t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  const app = await startApp(data.file)
  t.after(app.stop)
  await app.call('POST', '/groups', trip)
  const before = readFileSync(data.file, 'utf8')
  const body = { entries: [taxi, payBack] }
  const dry = await app.call('POST', '/groups/trip/import', { ...body, dry_run: true })
  assert.equal(dry.status, 200)
  assert.equal(readFileSync(data.file, 'utf8'), before)
  assert.deepEqual((await app.call('GET', '/groups/trip/expenses')).body, { expenses: [] })
  assert.deepEqual((await app.call('GET', '/groups/trip/balances')).body, { balances: { Ann: 0, Ben: 0, Cara: 0 } })
  const real = await app.call('POST', '/groups/trip/import', { ...body, dry_run: false })
  assert.equal(real.status, 201)
  assert.deepEqual(real.body, dry.body)
  assert.deepEqual((await app.call('GET', '/groups/trip/payments')).body.payments, real.body.payments)
})

test('after a dry run the next expense and payment still get the first ids it showed', () => withTrip(async call => {
  const dry = await importInto(call, { entries: [taxi, payBack], dry_run: true })
  assert.deepEqual([dry.body.expenses[0].id, dry.body.payments[0].id], [1, 1])
  assert.equal((await call('POST', '/groups/trip/expenses', { description: 'A', payer: 'Ann', amount: 1 })).body.id, 1)
  assert.equal((await call('POST', '/groups/trip/payments', { from: 'Ben', to: 'Ann', amount: 1 })).body.id, 1)
}))

test('dry_run gives the same error replies', () => withTrip(async call => {
  await call('POST', '/groups/trip/expenses', { description: 'Taxi', payer: 'Ann', amount: 10 })
  assertRejected(await importInto(call, { entries: [taxi], dry_run: true }), [{ index: 0, rule: 'already-recorded' }])
  assert.equal((await importInto(call, { entries: [], dry_run: true })).status, 400)
  assert.equal((await call('POST', '/groups/nope/import', { entries: [taxi], dry_run: true })).status, 404)
}))

test('an import is saved: it survives a restart', async t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  const first = await startApp(data.file)
  await first.call('POST', '/groups', trip)
  await first.call('POST', '/groups/trip/import', { entries: [taxi, payBack] })
  await first.stop()
  const second = await startApp(data.file)
  t.after(second.stop)
  assert.deepEqual((await second.call('GET', '/groups/trip/balances')).body, { balances: { Ann: 3.33, Ben: 0, Cara: -3.33 } })
  assert.equal((await second.call('POST', '/groups/trip/expenses', { description: 'A', payer: 'Ann', amount: 1 })).body.id, 2)
})
