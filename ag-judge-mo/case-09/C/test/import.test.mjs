import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { startApp, tempDataFile } from './helpers.mjs'

const trip = { id: 'trip', name: 'Ski trip', members: ['Ann', 'Ben', 'Cara'] }
const hotel = { description: 'Hotel', payer: 'Ann', amount: 90 }
const exp = (fields = {}) => ({ type: 'expense', ...hotel, ...fields })
const pay = (fields = {}) => ({ type: 'payment', from: 'Ben', to: 'Ann', amount: 30, ...fields })

// Runs fn with a running app holding the trip group. fn gets call and fileText(), the data file as it is now.
async function withTrip(fn) {
  const data = tempDataFile()
  const app = await startApp(data.file)
  try {
    await app.call('POST', '/groups', trip)
    await fn(app.call, () => readFileSync(data.file, 'utf8'))
  } finally {
    await app.stop()
    data.cleanup()
  }
}

const importInto = (call, body, group = 'trip') => call('POST', `/groups/${group}/import`, body)

// Expects a 422 with these problems, and the data file as it was.
async function assertRejected(call, fileText, body, problems) {
  const before = fileText()
  const r = await importInto(call, body)
  assert.equal(r.status, 422, JSON.stringify(body))
  assert.deepEqual(r.body, { error: 'import rejected', problems }, JSON.stringify(body))
  assert.equal(fileText(), before)
}

test('import records expenses and payments with consecutive ids, in one write', () => withTrip(async (call, fileText) => {
  await call('POST', '/groups/trip/expenses', { ...hotel, description: 'Old' })
  await call('POST', '/groups/trip/payments', { from: 'Cara', to: 'Ann', amount: 1 })
  const r = await importInto(call, { entries: [
    exp({ amount: 10 }),
    pay(),
    exp({ description: 'Fuel', payer: 'Ben', amount: 12.5, split: ['Cara', 'Ben'] }),
  ] })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body, {
    expenses: [
      { id: 2, description: 'Hotel', payer: 'Ann', amount: 10, split: trip.members, shares: { Ann: 3.34, Ben: 3.33, Cara: 3.33 } },
      { id: 3, description: 'Fuel', payer: 'Ben', amount: 12.5, split: ['Cara', 'Ben'], shares: { Cara: 6.25, Ben: 6.25 } },
    ],
    payments: [{ id: 2, from: 'Ben', to: 'Ann', amount: 30 }],
    skipped: [],
    balances: (await call('GET', '/groups/trip/balances')).body.balances,
  })
  assert.deepEqual(r.body.balances, { Ann: 35.66, Ben: 2.92, Cara: -38.58 })
  const expenses = (await call('GET', '/groups/trip/expenses')).body.expenses
  assert.deepEqual(expenses.slice(1), r.body.expenses)
  assert.equal((await call('POST', '/groups/trip/expenses', { ...hotel, description: 'Next' })).body.id, 4)
  assert.equal((await call('POST', '/groups/trip/payments', pay({ type: undefined }))).body.id, 3)
  const saved = JSON.parse(fileText())
  assert.equal(saved.expenses.length, 4)
  assert.equal(saved.payments.length, 3)
}))

test('import with only payments gives expenses [] and identical payments are all recorded', () => withTrip(async call => {
  const r = await importInto(call, { entries: [pay(), pay()] })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.expenses, [])
  assert.deepEqual(r.body.payments.map(p => p.id), [1, 2])
  assert.deepEqual(r.body.balances, { Ann: -60, Ben: 60, Cara: 0 })
}))

test('import on an unknown group is 404, even with a bad body', () => withTrip(async call => {
  const r = await importInto(call, { bogus: 1 }, 'nope')
  assert.equal(r.status, 404)
  assert.deepEqual(r.body, { error: 'not found' })
}))

test('import refuses a bad body with 400, in the documented order', () => withTrip(async (call, fileText) => {
  const before = fileText()
  const entries = [exp()]
  const cases = [
    [{ entries, zeta: 1, alpha: 2 }, 'unknown field zeta'],
    [{ dry_run: 'x', extra: 1 }, 'unknown field extra'],
    [{ dry_run: 'x' }, 'entries must be an array of 1 to 50 items'],
    [{ entries: [] }, 'entries must be an array of 1 to 50 items'],
    [{ entries: Array.from({ length: 51 }, () => pay()) }, 'entries must be an array of 1 to 50 items'],
    [{ entries: { 0: exp() } }, 'entries must be an array of 1 to 50 items'],
    [{ entries: null }, 'entries must be an array of 1 to 50 items'],
    [{ entries, dry_run: null, skip_recorded: 'x' }, 'dry_run must be true or false'],
    [{ entries, dry_run: 'true' }, 'dry_run must be true or false'],
    [{ entries, dry_run: 0 }, 'dry_run must be true or false'],
    [{ entries: [5], skip_recorded: null }, 'skip_recorded must be true or false'],
    [{ entries, skip_recorded: 1 }, 'skip_recorded must be true or false'],
  ]
  for (const [body, error] of cases) {
    const r = await importInto(call, body)
    assert.equal(r.status, 400, JSON.stringify(body))
    assert.deepEqual(r.body, { error }, JSON.stringify(body))
  }
  assert.equal(fileText(), before)
}))

test('import takes 50 entries', () => withTrip(async call => {
  const r = await importInto(call, { entries: Array.from({ length: 50 }, () => pay()) })
  assert.equal(r.status, 201)
  assert.equal(r.body.payments.length, 50)
}))

test('import answers 413 for a body over 10 KB and 400 for a non-object body', () => withTrip(async call => {
  const big = await importInto(call, { entries: [exp({ description: 'x'.repeat(11 * 1024) })] })
  assert.equal(big.status, 413)
  assert.deepEqual((await importInto(call, '[]')).body, { error: 'body must be a JSON object' })
  assert.deepEqual((await importInto(call, 'null')).body, { error: 'body must be a JSON object' })
  assert.equal((await importInto(call, '{')).status, 400)
}))

test('import names the first rule each bad entry breaks, sorted by index, and saves nothing', () => withTrip(async (call, fileText) => {
  const entries = [
    exp(), // fine
    null,
    [exp()],
    'expense',
    { ...exp(), type: 'Expense' },
    { description: 'Hotel', payer: 'Ann', amount: 90 },
    exp({ from: 'Ben' }),
    pay({ payer: 'Ann' }),
    exp({ description: '  ', payer: 'Dan' }),
    exp({ description: 5 }),
    exp({ description: 'x'.repeat(201) }),
    exp({ payer: 'ann', amount: 0 }),
    exp({ amount: 1.234, split: [] }),
    exp({ amount: '90' }),
    exp({ amount: null }),
    exp({ split: null }),
    exp({ split: ['Ann', 'Ann'] }),
    exp({ split: ['Dan'] }),
    pay({ from: 'Dan', to: 'Dan', amount: 0 }),
    pay({ to: 'Ben', amount: 0 }),
    pay({ to: 'Dan' }),
    pay({ to: null }),
    pay({ amount: 0.001 }),
    pay({ amount: 1000000.01 }),
    { type: 'expense', payer: 'Ann', amount: 90 },
    { type: 'payment', to: 'Ann', amount: 1 },
  ]
  await assertRejected(call, fileText, { entries }, [
    { index: 1, rule: 'not-an-object' },
    { index: 2, rule: 'not-an-object' },
    { index: 3, rule: 'not-an-object' },
    { index: 4, rule: 'bad-type' },
    { index: 5, rule: 'bad-type' },
    { index: 6, rule: 'unknown-field' },
    { index: 7, rule: 'unknown-field' },
    { index: 8, rule: 'bad-description' },
    { index: 9, rule: 'bad-description' },
    { index: 10, rule: 'bad-description' },
    { index: 11, rule: 'bad-payer' },
    { index: 12, rule: 'bad-amount' },
    { index: 13, rule: 'bad-amount' },
    { index: 14, rule: 'bad-amount' },
    { index: 15, rule: 'bad-split' },
    { index: 16, rule: 'bad-split' },
    { index: 17, rule: 'bad-split' },
    { index: 18, rule: 'bad-from' },
    { index: 19, rule: 'bad-to' },
    { index: 20, rule: 'bad-to' },
    { index: 21, rule: 'bad-to' },
    { index: 22, rule: 'bad-amount' },
    { index: 23, rule: 'bad-amount' },
    { index: 24, rule: 'bad-description' },
    { index: 25, rule: 'bad-from' },
  ])
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body, { expenses: [] })
}))

test('a field set to null counts as given; type and every field are own keys only', () => withTrip(async (call, fileText) => {
  const oddTypes = ['constructor', 'toString', ['expense'], ['payment'], null, 1, { expense: 1 }]
  await assertRejected(call, fileText, { entries: [exp({ split: null }), ...oddTypes.map(type => ({ ...pay(), type }))] }, [
    { index: 0, rule: 'bad-split' },
    ...oddTypes.map((_, i) => ({ index: i + 1, rule: 'bad-type' })),
  ])
  const proto = '{"entries": [{"type": "payment", "from": "Ben", "to": "Ann", "amount": 1, "__proto__": {}}]}'
  await assertRejected(call, fileText, proto, [{ index: 0, rule: 'unknown-field' }])
}))

test('duplicate: same payer, cents and trimmed lower-case description as an earlier valid expense entry', () => withTrip(async (call, fileText) => {
  await assertRejected(call, fileText, { entries: [
    exp({ description: ' Hotel ', amount: 90, split: ['Ann'] }),
    exp({ description: 'HOTEL', amount: 90.0, split: ['Ben'] }),
    exp({ description: 'Hotel', payer: 'Ben' }),
    exp({ description: 'Hotel', amount: 90.01 }),
    exp({ description: 'Hotel ', amount: 90 }),
    exp({ description: 'Hotels' }),
  ] }, [{ index: 1, rule: 'duplicate' }, { index: 4, rule: 'duplicate' }])
}))

test('a bad entry does not count as an earlier entry for duplicate, a duplicate one does', () => withTrip(async (call, fileText) => {
  await assertRejected(call, fileText, { entries: [
    exp({ split: ['Dan'] }),
    pay({ amount: 90 }),
    exp(),
    exp(),
    exp(),
  ] }, [{ index: 0, rule: 'bad-split' }, { index: 3, rule: 'duplicate' }, { index: 4, rule: 'duplicate' }])
}))

test('already-recorded matches the group\'s own expenses only, and comes after duplicate', () => withTrip(async (call, fileText) => {
  await call('POST', '/groups', { ...trip, id: 'flat' })
  await call('POST', '/groups/flat/expenses', { ...hotel, description: 'Rent' })
  await call('POST', '/groups/trip/expenses', { ...hotel, description: '  Hotel' })
  await assertRejected(call, fileText, { entries: [exp(), exp(), exp({ description: 'Rent' })] }, [
    { index: 0, rule: 'already-recorded' },
    { index: 1, rule: 'duplicate' },
  ])
  await assertRejected(call, fileText, { entries: [exp(), exp()], skip_recorded: true }, [{ index: 1, rule: 'duplicate' }])
  await assertRejected(call, fileText, { entries: [exp(), exp()], skip_recorded: false }, [
    { index: 0, rule: 'already-recorded' },
    { index: 1, rule: 'duplicate' },
  ])
}))

test('an already-recorded match uses the expense as it is now, after a PATCH or DELETE', () => withTrip(async (call, fileText) => {
  await call('POST', '/groups/trip/expenses', hotel)
  await call('PATCH', '/groups/trip/expenses/1', { amount: 50 })
  assert.equal((await importInto(call, { entries: [exp()], dry_run: true })).status, 200)
  await assertRejected(call, fileText, { entries: [exp({ amount: 50 })] }, [{ index: 0, rule: 'already-recorded' }])
  await call('DELETE', '/groups/trip/expenses/1')
  assert.equal((await importInto(call, { entries: [exp({ amount: 50 })] })).status, 201)
}))

test('skip_recorded leaves recorded entries out; skipped entries take no id', () => withTrip(async (call, fileText) => {
  await call('POST', '/groups/trip/expenses', { ...hotel, description: 'Skis' })
  await call('POST', '/groups/trip/payments', pay())
  const r = await importInto(call, { skip_recorded: true, entries: [
    exp(),
    exp({ description: 'skis' }),
    pay({ from: 'Cara' }),
    exp({ description: 'Fuel' }),
  ] })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.expenses.map(e => [e.id, e.description]), [[2, 'Hotel'], [3, 'Fuel']])
  assert.deepEqual(r.body.payments.map(p => [p.id, p.from]), [[2, 'Cara']])
  assert.deepEqual(r.body.skipped, [1])
  assert.equal((await call('POST', '/groups/trip/expenses', { ...hotel, description: 'Next' })).body.id, 4)
  assert.equal((await call('POST', '/groups/trip/payments', pay())).body.id, 3)
  assert.equal(JSON.parse(fileText()).expenses.length, 4)
}))

test('an import whose entries are all skipped succeeds and writes nothing', () => withTrip(async (call, fileText) => {
  await call('POST', '/groups/trip/expenses', hotel)
  await call('POST', '/groups/trip/expenses', { ...hotel, description: 'Skis' })
  const before = fileText()
  const entries = [exp({ description: 'skis' }), exp()]
  const balances = { Ann: 120, Ben: -60, Cara: -60 }
  const r = await importInto(call, { entries, skip_recorded: true })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body, { expenses: [], payments: [], skipped: [0, 1], balances })
  const dry = await importInto(call, { entries, skip_recorded: true, dry_run: true })
  assert.equal(dry.status, 200)
  assert.deepEqual(dry.body, r.body)
  assert.equal(fileText(), before)
}))

test('dry_run replies 200 with what a real import would give, and saves nothing', () => withTrip(async (call, fileText) => {
  await call('POST', '/groups/trip/expenses', { ...hotel, description: 'Skis' })
  const before = fileText()
  const body = { entries: [exp({ amount: 10 }), pay()], dry_run: true }
  const dry = await importInto(call, body)
  assert.equal(dry.status, 200)
  assert.deepEqual(dry.body.expenses.map(e => e.id), [2])
  assert.deepEqual(dry.body.payments.map(p => p.id), [1])
  assert.deepEqual(dry.body.balances, { Ann: 36.66, Ben: -3.33, Cara: -33.33 })
  assert.equal(fileText(), before)
  assert.equal((await call('GET', '/groups/trip/expenses')).body.expenses.length, 1)
  const real = await importInto(call, { ...body, dry_run: false })
  assert.equal(real.status, 201)
  assert.deepEqual(real.body, dry.body)
}))

test('dry_run keeps every error reply the same', () => withTrip(async (call, fileText) => {
  await assertRejected(call, fileText, { entries: [exp(), exp()], dry_run: true }, [{ index: 1, rule: 'duplicate' }])
  assert.equal((await importInto(call, { entries: [], dry_run: true })).status, 400)
  assert.equal((await importInto(call, { entries: [exp()], dry_run: true }, 'nope')).status, 404)
}))

test('an imported 4.35 expense keeps its amount, and the data on disk survives a restart', async t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  const first = await startApp(data.file)
  await first.call('POST', '/groups', trip)
  const r = await first.call('POST', '/groups/trip/import', { entries: [exp({ description: 'Coffee', amount: 4.35 })] })
  assert.equal(r.body.expenses[0].amount, 4.35)
  await first.stop()
  const second = await startApp(data.file)
  t.after(second.stop)
  assert.deepEqual((await second.call('GET', '/groups/trip/expenses')).body.expenses, r.body.expenses)
})
