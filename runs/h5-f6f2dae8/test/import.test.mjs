import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs, { readFileSync, statSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { startApp, tempDataFile, withApp } from './helpers.mjs'

const members = ['Ann', 'Ben', 'Cara']
const trip = { id: 'trip', name: 'Ski trip', members }
const hotel = { type: 'expense', description: 'Hotel', payer: 'Ann', amount: 90 }
const taxi = { type: 'expense', description: 'Taxi', payer: 'Ben', amount: 12.5, split: ['Ben', 'Cara'] }
const payBack = { type: 'payment', from: 'Ben', to: 'Ann', amount: 30 }
const ENTRIES = 'entries must be an array of 1 to 50 items'

const withoutType = ({ type, ...fields }) => fields
const importInto = (call, body, group = 'trip') => call('POST', `/groups/${group}/import`, body)
const routeOf = entry => (entry.type === 'expense' ? 'expenses' : 'payments')

// Runs fn({ call, file }) with a running app on its own data file, then stops it and deletes the file.
async function withFile(fn) {
  const data = tempDataFile()
  const app = await startApp(data.file)
  try {
    await fn({ call: app.call, file: data.file })
  } finally {
    await app.stop()
    data.cleanup()
  }
}

// The data file's text and identity: an atomic save always replaces the file, so ino or mtime change.
const snapshot = file => {
  const { ino, mtimeMs } = statSync(file)
  return { text: readFileSync(file, 'utf8'), ino, mtimeMs }
}

// Counts the saves of file from now on: the store saves by renaming a temp file onto it.
function countSaves(t, file) {
  const rename = t.mock.method(fs, 'renameSync')
  syncBuiltinESMExports()
  t.after(() => {
    rename.mock.restore()
    syncBuiltinESMExports()
  })
  return () => rename.mock.calls.filter(c => c.arguments[1] === file).length
}

async function expectRejected(call, body, problems) {
  const r = await importInto(call, body)
  assert.equal(r.status, 422, JSON.stringify(body))
  assert.deepEqual(r.body, { error: 'import rejected', problems }, JSON.stringify(body))
}

test('import replies 201 with the new expenses, payments, skipped and balances', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const r = await importInto(call, { entries: [{ type: 'expense', description: 'Dinner', payer: 'Ann', amount: 10 }] })
  assert.equal(r.status, 201)
  assert.equal(r.headers.get('content-type'), 'application/json')
  assert.deepEqual(r.body, {
    expenses: [{ id: 1, description: 'Dinner', payer: 'Ann', amount: 10, split: members, shares: { Ann: 3.34, Ben: 3.33, Cara: 3.33 } }],
    payments: [],
    skipped: [],
    balances: { Ann: 6.66, Ben: -3.33, Cara: -3.33 },
  })
}))

test('import makes the same expenses, payments and stored records as the POST routes', () => withFile(async imported => {
  await withFile(async posted => {
    const entries = [
      { ...taxi, description: ' Taxi\t' }, payBack, hotel,
      { type: 'expense', description: 'Café', payer: 'Cara', amount: 4.35, split: ['Cara', 'Ann'] },
      { type: 'payment', from: 'Cara', to: 'Ben', amount: 0.29 },
    ]
    await imported.call('POST', '/groups', trip)
    await posted.call('POST', '/groups', trip)
    const r = await importInto(imported.call, { entries })
    const replies = []
    for (const entry of entries) replies.push(await posted.call('POST', `/groups/trip/${routeOf(entry)}`, withoutType(entry)))
    assert.equal(r.status, 201)
    assert.deepEqual(r.body.expenses, replies.filter((_, i) => entries[i].type === 'expense').map(p => p.body))
    assert.deepEqual(r.body.payments, replies.filter((_, i) => entries[i].type === 'payment').map(p => p.body))
    assert.deepEqual(r.body.balances, (await posted.call('GET', '/groups/trip/balances')).body.balances)
    assert.deepEqual(JSON.parse(readFileSync(imported.file, 'utf8')), JSON.parse(readFileSync(posted.file, 'utf8')))
  })
}))

test('import saves the whole import in one write that survives a restart', async t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  const first = await startApp(data.file)
  t.after(first.stop)
  await first.call('POST', '/groups', trip)
  const saves = countSaves(t, data.file)
  const r = await importInto(first.call, { entries: [hotel, payBack, taxi, payBack] })
  assert.equal(r.status, 201)
  assert.equal(saves(), 1)
  await first.stop()
  const second = await startApp(data.file)
  t.after(second.stop)
  assert.deepEqual((await second.call('GET', '/groups/trip/expenses')).body, { expenses: r.body.expenses })
  assert.deepEqual((await second.call('GET', '/groups/trip/payments')).body, { payments: r.body.payments })
  assert.equal((await second.call('POST', '/groups/trip/expenses', withoutType(hotel))).body.id, 3)
  assert.equal((await second.call('POST', '/groups/trip/payments', withoutType(payBack))).body.id, 3)
})

test('balances are the flat member map of GET balances, in group member order', () => withApp(async call => {
  const order = ['Cara', 'Ann', 'Ben']
  await call('POST', '/groups', { ...trip, members: order })
  await call('POST', '/groups/trip/expenses', { description: 'Fuel', payer: 'Cara', amount: 3 })
  const r = await importInto(call, { entries: [{ type: 'expense', description: 'Gum', payer: 'Ben', amount: 10, split: ['Ann', 'Ben'] }] })
  assert.deepEqual(r.body.balances, { Cara: 2, Ann: -6, Ben: 4 })
  assert.deepEqual(Object.keys(r.body.balances), order)
  assert.deepEqual({ balances: r.body.balances }, (await call('GET', '/groups/trip/balances')).body)
}))

test('ids count on per kind in entry order; skipped entries and the other kind take none', () => withApp(async call => {
  await call('POST', '/groups', trip)
  await call('POST', '/groups', { ...trip, id: 'flat' })
  await call('POST', '/groups/trip/expenses', withoutType(hotel))
  await call('POST', '/groups/flat/expenses', { ...withoutType(hotel), description: 'Rent' })
  await call('POST', '/groups/trip/expenses', { ...withoutType(hotel), description: 'Skis' })
  await call('DELETE', '/groups/trip/expenses/3')
  await call('POST', '/groups/trip/payments', withoutType(payBack))
  const lunch = { type: 'expense', description: 'Lunch', payer: 'Cara', amount: 8.2 }
  const r = await importInto(call, { entries: [taxi, hotel, payBack, lunch], skip_recorded: true })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.expenses.map(e => [e.id, e.description]), [[4, 'Taxi'], [5, 'Lunch']])
  assert.deepEqual(r.body.payments.map(p => p.id), [2])
  assert.deepEqual(r.body.skipped, [1])
  assert.equal((await call('POST', '/groups/trip/expenses', withoutType(lunch))).body.id, 6)
  assert.equal((await call('POST', '/groups/trip/payments', withoutType(payBack))).body.id, 3)
}))

test('an import whose entries are all skipped replies 201, 200 on a dry run, and writes nothing', t => withFile(async ({ call, file }) => {
  await call('POST', '/groups', trip)
  await call('POST', '/groups/trip/expenses', withoutType(hotel))
  await call('POST', '/groups/trip/expenses', withoutType(taxi))
  const before = snapshot(file)
  const saves = countSaves(t, file)
  const entries = [hotel, { ...taxi, description: 'TAXI ', split: ['Ann'] }]
  const expected = { expenses: [], payments: [], skipped: [0, 1], balances: (await call('GET', '/groups/trip/balances')).body.balances }
  const r = await importInto(call, { entries, skip_recorded: true })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body, expected)
  const dry = await importInto(call, { entries, skip_recorded: true, dry_run: true })
  assert.equal(dry.status, 200)
  assert.deepEqual(dry.body, expected)
  assert.equal(saves(), 0)
  assert.deepEqual(snapshot(file), before)
  assert.equal((await call('POST', '/groups/trip/expenses', { ...withoutType(hotel), description: 'Bar' })).body.id, 3)
}))

test('a rejected import saves nothing and uses up no ids', t => withFile(async ({ call, file }) => {
  await call('POST', '/groups', trip)
  const kept = (await call('POST', '/groups/trip/expenses', withoutType(hotel))).body
  await call('POST', '/groups/trip/payments', withoutType(payBack))
  const before = snapshot(file)
  const saves = countSaves(t, file)
  await expectRejected(call, { entries: [taxi, payBack, { ...taxi, amount: 0 }] }, [{ index: 2, rule: 'bad-amount' }])
  assert.equal(saves(), 0)
  assert.deepEqual(snapshot(file), before)
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body, { expenses: [kept] })
  assert.equal((await call('GET', '/groups/trip/payments')).body.payments.length, 1)
  assert.equal((await call('POST', '/groups/trip/expenses', withoutType(taxi))).body.id, 2)
  assert.equal((await call('POST', '/groups/trip/payments', withoutType(payBack))).body.id, 2)
}))

test('a dry run replies 200 with the body a real import gets, and saves nothing', t => withFile(async ({ call, file }) => {
  await call('POST', '/groups', trip)
  await call('POST', '/groups/trip/expenses', withoutType(hotel))
  const before = snapshot(file)
  const saves = countSaves(t, file)
  const body = { entries: [taxi, hotel, payBack], skip_recorded: true }
  const dry = await importInto(call, { ...body, dry_run: true })
  assert.equal(dry.status, 200)
  assert.equal(saves(), 0)
  assert.deepEqual(snapshot(file), before)
  assert.equal((await call('GET', '/groups/trip/expenses')).body.expenses.length, 1)
  assert.deepEqual((await call('GET', '/groups/trip/payments')).body, { payments: [] })
  const real = await importInto(call, { ...body, dry_run: false })
  assert.equal(real.status, 201)
  assert.deepEqual(real.body, dry.body)
  assert.equal(saves(), 1)
}))

test('after a dry run the next expense and payment still get its first ids', () => withApp(async call => {
  await call('POST', '/groups', trip)
  await call('POST', '/groups/trip/expenses', withoutType(hotel))
  const dry = await importInto(call, { entries: [taxi, payBack, { ...taxi, description: 'Bus' }], dry_run: true })
  assert.deepEqual(dry.body.expenses.map(e => e.id), [2, 3])
  assert.deepEqual(dry.body.payments.map(p => p.id), [1])
  assert.equal((await call('POST', '/groups/trip/expenses', withoutType(taxi))).body.id, 2)
  assert.equal((await call('POST', '/groups/trip/payments', withoutType(payBack))).body.id, 1)
}))

test('a dry run gets the same error replies as a real import', () => withApp(async call => {
  await call('POST', '/groups', trip)
  await call('POST', '/groups/trip/expenses', withoutType(hotel))
  const cases = [
    ['nope', { entries: [hotel] }, 404],
    ['trip', { entries: [hotel], skip_recorded: 'yes' }, 400],
    ['trip', { entries: [] }, 400],
    ['trip', { entries: [hotel, hotel, null] }, 422],
    ['trip', { entries: [hotel, hotel], skip_recorded: true }, 422],
  ]
  for (const [group, body, status] of cases) {
    const real = await importInto(call, body, group)
    const dry = await importInto(call, { ...body, dry_run: true }, group)
    assert.equal(real.status, status, JSON.stringify(body))
    assert.equal(dry.status, status, JSON.stringify(body))
    assert.deepEqual(dry.body, real.body, JSON.stringify(body))
  }
}))

test('a body over 10 KB gets 413, counted in bytes, even for an unknown group', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const text = JSON.stringify({ entries: [hotel] })
  const padTo = bytes => text + ' '.repeat(bytes - text.length)
  const tooBig = { status: 413, body: { error: 'body too large' } }
  const reply = async (group, body) => {
    const r = await importInto(call, body, group)
    return { status: r.status, body: r.body }
  }
  assert.deepEqual(await reply('trip', padTo(10 * 1024 + 1)), tooBig)
  assert.deepEqual(await reply('nope', padTo(10 * 1024 + 1)), tooBig)
  assert.deepEqual(await reply('trip', `{"x": "${'é'.repeat(5200)}"}`), tooBig)
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body, { expenses: [] })
  assert.equal((await importInto(call, padTo(10 * 1024))).status, 201)
}))

test('a body that is not a JSON object gets 400, before the group is looked up', () => withApp(async call => {
  await call('POST', '/groups', trip)
  for (const group of ['trip', 'nope']) {
    for (const text of ['[]', 'null', '"entries"', '7', 'true', '[{"entries": []}]']) {
      const r = await importInto(call, text, group)
      assert.equal(r.status, 400, text)
      assert.deepEqual(r.body, { error: 'body must be a JSON object' }, text)
    }
    assert.deepEqual((await importInto(call, '{"entries": ', group)).body, { error: 'invalid JSON' })
  }
}))

test('an unknown group gets 404 before any 400 or 422 check', () => withApp(async call => {
  await call('POST', '/groups', trip)
  for (const [group, body] of [['nope', { foo: 1 }], ['nope', { entries: [] }], ['nope', {}], ['nope', { entries: [null] }], ['Trip', { entries: [hotel] }]]) {
    const r = await importInto(call, body, group)
    assert.equal(r.status, 404, JSON.stringify(body))
    assert.deepEqual(r.body, { error: 'not found' })
  }
}))

test('bad body fields get 400 with the first message that applies', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const fifty = Array.from({ length: 50 }, (_, i) => ({ ...hotel, description: `Item ${i}` }))
  const cases = [
    [{ entries: [hotel], foo: 1 }, 'unknown field foo'],
    [{ zeta: 1, entries: [hotel], alpha: 2 }, 'unknown field zeta'],
    [`{"entries": [${JSON.stringify(hotel)}], "b": 1, "1": 2}`, 'unknown field 1'],
    [{ Entries: [hotel] }, 'unknown field Entries'],
    [`{"entries": [${JSON.stringify(hotel)}], "__proto__": {}}`, 'unknown field __proto__'],
    [{ entries: [hotel], dryRun: true }, 'unknown field dryRun'],
    [{ foo: 1 }, 'unknown field foo'],
    [{ entries: [], dry_run: 'x', foo: null }, 'unknown field foo'],
    [{}, ENTRIES],
    [{ dry_run: true }, ENTRIES],
    [{ entries: null }, ENTRIES],
    [{ entries: {} }, ENTRIES],
    [{ entries: hotel }, ENTRIES],
    [{ entries: 'Hotel' }, ENTRIES],
    [{ entries: [] }, ENTRIES],
    [{ entries: [...fifty, hotel] }, ENTRIES],
    [{ entries: [], dry_run: 'x' }, ENTRIES],
    ...[null, 'true', 1, 0, 'false', [], {}].map(v => [{ entries: [hotel], dry_run: v }, 'dry_run must be true or false']),
    [{ skip_recorded: 'x', entries: [hotel], dry_run: null }, 'dry_run must be true or false'],
    [{ entries: [null], dry_run: 'x' }, 'dry_run must be true or false'],
    ...[null, 'true', 1, []].map(v => [{ entries: [hotel], skip_recorded: v }, 'skip_recorded must be true or false']),
    [{ entries: [null], skip_recorded: null }, 'skip_recorded must be true or false'],
  ]
  for (const [body, error] of cases) {
    const r = await importInto(call, body)
    assert.equal(r.status, 400, JSON.stringify(body))
    assert.deepEqual(r.body, { error }, JSON.stringify(body))
  }
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body, { expenses: [] })
  const ok = await importInto(call, { entries: fifty, dry_run: false, skip_recorded: false })
  assert.equal(ok.status, 201)
  assert.deepEqual(ok.body.expenses.map(e => e.id), Array.from({ length: 50 }, (_, i) => i + 1))
}))

// Short names for the dense rule table below.
const exp = hotel
const pay = payBack
const RULE_CASES = [
  ...[null, [], [exp], 5, 'expense', true, false].map(entry => [entry, 'not-an-object']),
  ...[{}, withoutType(exp), { ...exp, type: 'Expense' }, { ...exp, type: null }, { ...exp, type: ' expense' },
    { ...exp, type: ['expense'] }, { ...pay, type: 'refund' }, { ...pay, type: 'payment ' }, { type: 'x', foo: 1 }]
    .map(entry => [entry, 'bad-type']),
  ...[{ ...exp, from: 'Ben' }, { ...exp, id: 1 }, { ...exp, group: 'trip' }, { ...exp, Amount: 90 },
    { ...pay, split: ['Ann', 'Ben'] }, { ...pay, description: 'Back' }, { ...pay, payer: 'Ben' },
    { ...exp, description: '', extra: null }, { ...pay, from: 'Dan', note: 'x' }].map(entry => [entry, 'unknown-field']),
  ...['', '   ', '\t\n', 'x'.repeat(201), null, 5, ['Hotel']].map(description => [{ ...exp, description }, 'bad-description']),
  [{ type: 'expense', payer: 'Ann', amount: 90 }, 'bad-description'],
  [{ ...exp, description: '', payer: 'Dan' }, 'bad-description'],
  ...['Dan', 'ann', ' Ann', null, 7].map(payer => [{ ...exp, payer }, 'bad-payer']),
  [{ type: 'expense', description: 'Hotel', amount: 90 }, 'bad-payer'],
  [{ ...exp, payer: 'Dan', amount: 0 }, 'bad-payer'],
  ...[0, -5, 1.234, 0.001, '90', null, 1000000.01, true].map(amount => [{ ...exp, amount }, 'bad-amount']),
  [{ type: 'expense', description: 'Hotel', payer: 'Ann' }, 'bad-amount'],
  [{ ...exp, amount: 0, split: null }, 'bad-amount'],
  ...[null, [], ['Ann', 'Ann'], ['Dan'], ['ann'], 'Ann', {}].map(split => [{ ...exp, split }, 'bad-split']),
  ...['Dan', 'ben', null].map(from => [{ ...pay, from }, 'bad-from']),
  [{ type: 'payment', to: 'Ann', amount: 30 }, 'bad-from'],
  [{ ...pay, from: 'Dan', to: 'Dan' }, 'bad-from'],
  [{ ...pay, from: 'Dan', amount: 0 }, 'bad-from'],
  ...['Dan', 'ann', null, 'Ben'].map(to => [{ ...pay, to }, 'bad-to']),
  [{ type: 'payment', from: 'Ben', amount: 30 }, 'bad-to'],
  [{ ...pay, from: 'Ann', to: 'Ann', amount: 0 }, 'bad-to'],
  [{ ...pay, to: 'Dan', amount: '30' }, 'bad-to'],
  ...[0, '30', null, 1.005, -30].map(amount => [{ ...pay, amount }, 'bad-amount']),
  [{ type: 'payment', from: 'Ben', to: 'Ann' }, 'bad-amount'],
]

test('each broken entry gets 422 with the first rule it breaks', () => withApp(async call => {
  await call('POST', '/groups', trip)
  for (const [entry, rule] of RULE_CASES) await expectRejected(call, { entries: [entry] }, [{ index: 0, rule }])
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body, { expenses: [] })
}))

test('problems list every broken entry once, sorted by index', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const entries = [hotel, null, payBack, { ...hotel, type: 'bill' }, { ...payBack, to: 'Ben' }, taxi, { ...taxi, split: [] }]
  await expectRejected(call, { entries }, [
    { index: 1, rule: 'not-an-object' }, { index: 3, rule: 'bad-type' }, { index: 4, rule: 'bad-to' }, { index: 6, rule: 'bad-split' },
  ])
  const ownProto = `{"type": "expense", "description": "Hotel", "payer": "Ann", "amount": 90, "__proto__": {}}`
  await expectRejected(call, `{"entries": [${ownProto}]}`, [{ index: 0, rule: 'unknown-field' }])
}))

test('fields at their limits and a missing split are accepted', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const entries = [
    { ...exp, description: 'x'.repeat(200) }, { ...exp, amount: 0.01 }, { ...exp, amount: 1000000 },
    { ...exp, split: ['Cara'] }, { ...pay, amount: 0.01 }, { ...pay, amount: 1000000 },
  ]
  const r = await importInto(call, { entries })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.expenses.map(e => [e.amount, e.split]), [[90, members], [0.01, members], [1000000, members], [90, ['Cara']]])
  assert.deepEqual(r.body.expenses[1].shares, { Ann: 0.01, Ben: 0, Cara: 0 })
  assert.deepEqual(r.body.payments.map(p => p.amount), [0.01, 1000000])
}))

test('duplicate: same payer, amount in cents and trimmed lower-cased description; split is not compared', () => withApp(async call => {
  const pairs = [
    [hotel, { ...hotel, description: '  hOTEL\t' }, true],
    [hotel, { ...hotel, description: ' Hotel' }, true],
    [hotel, { ...hotel, description: 'Hotel\n' }, true],
    [hotel, { ...hotel, split: ['Ben'] }, true],
    [{ ...hotel, description: 'ÉTÉ' }, { ...hotel, description: 'été' }, true],
    [hotel, { ...hotel, payer: 'Ben' }, false],
    [hotel, { ...hotel, amount: 90.01 }, false],
    [hotel, { ...hotel, description: 'Hotel room' }, false],
    [{ ...hotel, description: 'Hotel  room' }, { ...hotel, description: 'Hotel room' }, false],
    [{ ...hotel, description: 'Straße' }, { ...hotel, description: 'STRASSE' }, false],
    [{ ...hotel, description: 'Café' }, { ...hotel, description: 'Café' }, false],
    [{ ...hotel, description: 'Ｈｏｔｅｌ' }, hotel, false],
  ]
  for (const [i, [first, second, same]] of pairs.entries()) {
    await call('POST', '/groups', { ...trip, id: `g${i}` })
    const r = await importInto(call, { entries: [first, second] }, `g${i}`)
    if (same) assert.deepEqual(r.body, { error: 'import rejected', problems: [{ index: 1, rule: 'duplicate' }] }, JSON.stringify(second))
    else assert.equal(r.status, 201, JSON.stringify(second))
  }
  await call('POST', '/groups', trip)
  const raw = '{"type": "expense", "description": "Fuel", "payer": "Ann", "amount": '
  await expectRejected(call, `{"entries": [${raw}12.5}, ${raw}12.50}]}`, [{ index: 1, rule: 'duplicate' }])
}))

test('duplicate and already-recorded compare payers with letter case', () => withApp(async call => {
  await call('POST', '/groups', { ...trip, members: ['Ann', 'ann', 'Ben'] })
  await call('POST', '/groups/trip/expenses', withoutType(hotel))
  const r = await importInto(call, { entries: [{ ...hotel, payer: 'ann' }, { ...hotel, payer: 'Ben' }] })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.expenses.map(e => e.payer), ['ann', 'Ben'])
}))

test('only an earlier entry that broke no rule counts for duplicate, and every later copy is one', () => withApp(async call => {
  await call('POST', '/groups', trip)
  await expectRejected(call, { entries: [{ ...hotel, split: null }, hotel] }, [{ index: 0, rule: 'bad-split' }])
  await expectRejected(call, { entries: [{ ...hotel, extra: 1 }, hotel] }, [{ index: 0, rule: 'unknown-field' }])
  await expectRejected(call, { entries: [{ ...hotel, amount: '90' }, hotel] }, [{ index: 0, rule: 'bad-amount' }])
  await expectRejected(call, { entries: [hotel, { ...hotel, split: null }] }, [{ index: 1, rule: 'bad-split' }])
  await expectRejected(call, { entries: [hotel, payBack, hotel, { ...hotel, description: 'HOTEL' }] }, [
    { index: 2, rule: 'duplicate' }, { index: 3, rule: 'duplicate' },
  ])
}))

test('the spec examples: two copies of a recorded expense, with and without skip_recorded', () => withApp(async call => {
  await call('POST', '/groups', trip)
  await call('POST', '/groups/trip/expenses', withoutType(hotel))
  await expectRejected(call, { entries: [hotel, hotel], skip_recorded: true }, [{ index: 1, rule: 'duplicate' }])
  await expectRejected(call, { entries: [hotel, hotel], skip_recorded: false }, [
    { index: 0, rule: 'already-recorded' }, { index: 1, rule: 'duplicate' },
  ])
  await expectRejected(call, { entries: [hotel, hotel] }, [{ index: 0, rule: 'already-recorded' }, { index: 1, rule: 'duplicate' }])
}))

test('already-recorded matches the group\'s current expenses only', () => withApp(async call => {
  await call('POST', '/groups', trip)
  await call('POST', '/groups', { ...trip, id: 'flat' })
  await call('POST', '/groups/trip/expenses', { ...withoutType(hotel), description: ' HOTEL ', split: ['Ann'] })
  await call('POST', '/groups/flat/expenses', withoutType(taxi))
  await call('POST', '/groups/trip/expenses', { ...withoutType(hotel), description: 'Skis' })
  await call('DELETE', '/groups/trip/expenses/3')
  await call('POST', '/groups/trip/expenses', { ...withoutType(hotel), description: 'Bar' })
  await call('PATCH', '/groups/trip/expenses/4', { amount: 60 })
  await expectRejected(call, { entries: [hotel] }, [{ index: 0, rule: 'already-recorded' }])
  for (const amount of [4.35, 0.29, 1.15]) {
    await call('POST', '/groups/trip/expenses', { description: 'Cake', payer: 'Ann', amount })
    await expectRejected(call, { entries: [{ ...hotel, description: 'Cake', amount }] }, [{ index: 0, rule: 'already-recorded' }])
  }
  await expectRejected(call, { entries: [{ ...hotel, description: 'Bar', amount: 60 }] }, [{ index: 0, rule: 'already-recorded' }])
  await expectRejected(call, { entries: [{ ...hotel, split: null }], skip_recorded: true }, [{ index: 0, rule: 'bad-split' }])
  const fresh = [taxi, { ...hotel, description: 'Skis' }, { ...hotel, description: 'Bar' }]
  const r = await importInto(call, { entries: fresh })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.expenses.map(e => e.id), [8, 9, 10])
}))

test('skip_recorded skips recorded entries but still rejects other problems', () => withApp(async call => {
  await call('POST', '/groups', trip)
  await call('POST', '/groups/trip/expenses', withoutType(hotel))
  await expectRejected(call, { entries: [hotel, null], skip_recorded: true }, [{ index: 1, rule: 'not-an-object' }])
  const r = await importInto(call, { entries: [taxi, hotel, payBack], skip_recorded: true })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.expenses.map(e => [e.id, e.description]), [[2, 'Taxi']])
  assert.deepEqual(r.body.skipped, [1])
}))

test('identical payments are all imported, also when one is already recorded', () => withApp(async call => {
  await call('POST', '/groups', trip)
  await call('POST', '/groups/trip/payments', withoutType(payBack))
  const r = await importInto(call, { entries: [payBack, payBack, payBack], skip_recorded: true })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.payments, [2, 3, 4].map(id => ({ id, ...withoutType(payBack) })))
  assert.deepEqual(r.body.skipped, [])
  assert.deepEqual(r.body.balances, { Ann: -120, Ben: 120, Cara: 0 })
  assert.equal((await call('GET', '/groups/trip/payments')).body.payments.length, 4)
}))
