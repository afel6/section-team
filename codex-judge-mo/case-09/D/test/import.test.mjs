import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { startApp, tempDataFile, withApp } from './helpers.mjs'

const trip = { id: 'trip', name: 'Ski trip', members: ['Ann', 'Ben', 'Cara'] }
const hotel = { type: 'expense', description: 'Hotel', payer: 'Ann', amount: 90 }
const pay = { type: 'payment', from: 'Ben', to: 'Ann', amount: 30 }
const exp = { type: 'expense', description: 'Taxi', payer: 'Ben', amount: 12 }
const pmt = { type: 'payment', from: 'Cara', to: 'Ann', amount: 5 }
const hotelPlain = { description: 'Hotel', payer: 'Ann', amount: 90 }

const MSG_ENTRIES = 'entries must be an array of 1 to 50 items'
const MSG_OBJECT = 'body must be a JSON object'
const MSG_DRY = 'dry_run must be true or false'
const MSG_SKIP = 'skip_recorded must be true or false'

const importInto = (call, entries, opts = {}, id = 'trip') => call('POST', `/groups/${id}/import`, { entries, ...opts })
const omit = (obj, key) => Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key))
const rejected = problems => ({ error: 'import rejected', problems })
const dup = index => ({ index, rule: 'duplicate' })

async function setup(call, extra = []) {
  await call('POST', '/groups', trip)
  for (const group of extra) await call('POST', '/groups', group)
}

async function assertNothingSaved(call) {
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body, { expenses: [] })
  assert.deepEqual((await call('GET', '/groups/trip/payments')).body, { payments: [] })
}

async function expectRejected(call, entries, problems, opts = {}, id = 'trip') {
  const r = await importInto(call, entries, opts, id)
  assert.equal(r.status, 422, JSON.stringify(entries))
  assert.deepEqual(r.body, rejected(problems), JSON.stringify(entries))
}

function jsonOfSize(size, entries) {
  const json = JSON.stringify({ entries })
  return json + ' '.repeat(size - Buffer.byteLength(json))
}

// A. Body limits

test('a body of exactly 10240 bytes is accepted, 10241 bytes is 413', () => withApp(async call => {
  await setup(call)
  const ok = jsonOfSize(10240, [pay])
  assert.equal(Buffer.byteLength(ok), 10240)
  assert.equal((await call('POST', '/groups/trip/import', ok)).status, 201)
  const big = jsonOfSize(10241, [pay])
  assert.equal(Buffer.byteLength(big), 10241)
  const r = await call('POST', '/groups/trip/import', big)
  assert.equal(r.status, 413)
  assert.deepEqual(r.body, { error: 'body too large' })
  assert.equal((await call('GET', '/groups/trip/payments')).body.payments.length, 1)
}))

test('the body limit counts bytes, not characters', () => withApp(async call => {
  await setup(call)
  const body = JSON.stringify({ entries: [{ ...hotel, description: 'é'.repeat(6000) }] })
  assert.ok(body.length < 10240 && Buffer.byteLength(body) > 10240)
  const r = await call('POST', '/groups/trip/import', body)
  assert.equal(r.status, 413)
  assert.deepEqual(r.body, { error: 'body too large' })
}))

test('a body over 10KB to an unknown group is 413, before the group lookup', () => withApp(async call => {
  const r = await call('POST', '/groups/nope/import', jsonOfSize(10241, [pay]))
  assert.equal(r.status, 413)
  assert.deepEqual(r.body, { error: 'body too large' })
}))

test('a body that is not a JSON object is 400, also for an unknown group', () => withApp(async call => {
  await setup(call)
  for (const id of ['trip', 'nope']) {
    for (const raw of ['[1]', 'null', '"x"', '5']) {
      const r = await call('POST', `/groups/${id}/import`, raw)
      assert.equal(r.status, 400, `${id} ${raw}`)
      assert.deepEqual(r.body, { error: MSG_OBJECT }, `${id} ${raw}`)
    }
    const bad = await call('POST', `/groups/${id}/import`, '{"entries":')
    assert.equal(bad.status, 400)
    assert.deepEqual(bad.body, { error: 'invalid JSON' })
  }
}))

// B. Unknown group

test('an unknown group is 404 not found whatever the body', () => withApp(async call => {
  for (const body of [{ entries: [pay] }, { foo: 1 }, { entries: [] }, { entries: [null] }]) {
    const r = await call('POST', '/groups/nope/import', body)
    assert.equal(r.status, 404, JSON.stringify(body))
    assert.deepEqual(r.body, { error: 'not found' }, JSON.stringify(body))
  }
  assert.equal((await call('GET', '/groups/nope')).status, 404)
}))

// C. 400 messages

test('400 messages for unknown fields, in key order', () => withApp(async call => {
  await setup(call)
  const cases = [
    [{ entries: [hotel], foo: 1 }, 'unknown field foo'],
    [{ foo: 1, bar: 2, entries: [hotel] }, 'unknown field foo'],
    [{ bar: 2, foo: 1, entries: [hotel] }, 'unknown field bar'],
    ['{"z":1,"1":2,"entries":[]}', 'unknown field 1'],
    [{ Entries: [hotel] }, 'unknown field Entries'],
    [{ entries: [hotel], 'dry-run': true }, 'unknown field dry-run'],
    [{ entries: 'x', foo: 1 }, 'unknown field foo'],
    [{ dry_run: 'x', foo: 1, entries: [] }, 'unknown field foo'],
  ]
  for (const [body, error] of cases) {
    const r = await call('POST', '/groups/trip/import', body)
    assert.equal(r.status, 400, JSON.stringify(body))
    assert.deepEqual(r.body, { error }, JSON.stringify(body))
  }
  await assertNothingSaved(call)
}))

test('400 message for entries that are not an array of 1 to 50 items', () => withApp(async call => {
  await setup(call)
  const fifty1 = Array.from({ length: 51 }, () => pay)
  const cases = [{}, { entries: null }, { entries: {} }, { entries: 'x' }, { entries: 5 }, { entries: [] },
    { entries: fifty1 }, { entries: fifty1, dry_run: 'x' }, { entries: [], dry_run: null }]
  for (const body of cases) {
    const r = await call('POST', '/groups/trip/import', body)
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80))
    assert.deepEqual(r.body, { error: MSG_ENTRIES }, JSON.stringify(body).slice(0, 80))
  }
  await assertNothingSaved(call)
}))

test('400 message for a dry_run or skip_recorded that is not a boolean', () => withApp(async call => {
  await setup(call)
  const cases = [
    ...[null, 'true', 1, 0, [], {}].map(v => [{ entries: [hotel], dry_run: v }, MSG_DRY]),
    [{ entries: [hotel], dry_run: null, skip_recorded: null }, MSG_DRY],
    ...[null, 'false', 0].map(v => [{ entries: [hotel], skip_recorded: v }, MSG_SKIP]),
    // the body's 400 checks come before any entry is looked at
    [{ entries: [null], dry_run: 'x' }, MSG_DRY],
    [{ entries: [null], skip_recorded: 1 }, MSG_SKIP],
  ]
  for (const [body, error] of cases) {
    const r = await call('POST', '/groups/trip/import', body)
    assert.equal(r.status, 400, JSON.stringify(body))
    assert.deepEqual(r.body, { error }, JSON.stringify(body))
  }
  await assertNothingSaved(call)
}))

test('the entry count and flag boundaries are accepted', () => withApp(async call => {
  await setup(call)
  assert.equal((await importInto(call, [hotel])).status, 201)
  const r = await importInto(call, Array.from({ length: 50 }, () => pay))
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.payments.map(p => p.id), Array.from({ length: 50 }, (_, i) => i + 1))
  assert.deepEqual(r.body.balances, { Ann: -1500 + 60, Ben: 1500 - 30, Cara: -30 })
  await call('POST', '/groups', { ...trip, id: 'flat' })
  const flags = await importInto(call, [hotel], { dry_run: false, skip_recorded: false }, 'flat')
  assert.equal(flags.status, 201)
}))

// D. 422 single rules

const rejectCases = () => [
  ...[null, [], [exp], 'expense', 5, true].map(e => [e, 'not-an-object']),
  ...[{}, { ...exp, type: 'Expense' }, { ...exp, type: null }, omit(exp, 'type'), { ...exp, type: 'payments' }].map(e => [e, 'bad-type']),
  ...[{ ...exp, note: 'x' }, { ...exp, from: 'Ann' }, { ...pmt, split: ['Ann'] }, { ...pmt, description: 'x' },
    { ...exp, Type: 'expense' }, { ...exp, note: 'x', description: '' }].map(e => [e, 'unknown-field']),
  ...[omit(exp, 'description'), { ...exp, description: '' }, { ...exp, description: '   ' }, { ...exp, description: 'x'.repeat(201) },
    { ...exp, description: 5 }, { ...exp, description: null }, { ...exp, description: '', payer: 'Dan' }].map(e => [e, 'bad-description']),
  ...[omit(exp, 'payer'), { ...exp, payer: 'Dan' }, { ...exp, payer: 'ann' }, { ...exp, payer: null }, { ...exp, payer: 'Dan', amount: 0 }].map(e => [e, 'bad-payer']),
  ...[0, -1, 1.234, '10', null, 1000000.01].map(a => [{ ...exp, amount: a }, 'bad-amount']),
  [omit(exp, 'amount'), 'bad-amount'], [{ ...exp, amount: 0, split: [] }, 'bad-amount'],
  ...[null, [], ['Ann', 'Ann'], ['Dan'], 'Ann', [1]].map(s => [{ ...exp, split: s }, 'bad-split']),
  ...[omit(pmt, 'from'), { ...pmt, from: 'Dan' }, { ...pmt, from: null }, { ...pmt, from: 'ann' },
    { ...pmt, from: 'Dan', to: 'Dan' }, { ...pmt, from: 'Dan', amount: 0 }].map(e => [e, 'bad-from']),
  ...[omit(pmt, 'to'), { ...pmt, to: 'Dan' }, { ...pmt, to: 'Cara' }, { ...pmt, to: 'Cara', amount: 0 }].map(e => [e, 'bad-to']),
  ...[0, '5', 1.001].map(a => [{ ...pmt, amount: a }, 'bad-amount']),
  [omit(pmt, 'amount'), 'bad-amount'],
]

test('each broken entry is reported at its index with the first rule it breaks', () => withApp(async call => {
  await setup(call)
  for (const [entry, rule] of rejectCases()) {
    const r = await importInto(call, [hotel, entry])
    assert.equal(r.status, 422, JSON.stringify(entry))
    assert.deepEqual(r.body, rejected([{ index: 1, rule }]), JSON.stringify([entry, rule]))
    assert.deepEqual(Object.keys(r.body.problems[0]), ['index', 'rule'])
  }
  await assertNothingSaved(call)
  const next = await call('POST', '/groups/trip/expenses', hotelPlain)
  assert.equal(next.body.id, 1)
}))

test('entries at the edge of the rules are accepted', () => withApp(async call => {
  await setup(call)
  const cases = [
    { ...exp, description: 'x'.repeat(200) }, { ...exp, description: 'Café ☕' },
    { ...exp, amount: 0.01 }, { ...exp, amount: 1000000 }, { ...exp, split: ['Ben'] },
  ]
  for (const [i, entry] of cases.entries()) {
    await call('POST', '/groups', { ...trip, id: `g${i}` })
    const r = await importInto(call, [entry], {}, `g${i}`)
    assert.equal(r.status, 201, JSON.stringify(entry))
    assert.equal(r.body.expenses.length, 1, JSON.stringify(entry))
  }
}))

// E. Several problems

test('every broken entry is listed, in index order', () => withApp(async call => {
  await setup(call)
  await expectRejected(call, [null, hotel, { type: 'x' }, pay, { ...hotel, description: 'Bus', amount: 0 }], [
    { index: 0, rule: 'not-an-object' }, { index: 2, rule: 'bad-type' }, { index: 4, rule: 'bad-amount' },
  ])
  await assertNothingSaved(call)
}))

// F. Duplicates

test('a repeated expense is a duplicate from its second appearance', () => withApp(async call => {
  await setup(call, [{ ...trip, id: 'g2' }, { ...trip, id: 'g3' }])
  await expectRejected(call, [hotel, hotel], [dup(1)])
  await expectRejected(call, [hotel, hotel, hotel], [dup(1), dup(2)], {}, 'g2')
  await expectRejected(call, [hotel, { ...hotel, description: 'Skis' }, hotel], [dup(2)], {}, 'g3')
}))

test('duplicates ignore case and surrounding whitespace in the description', () => withApp(async call => {
  const cases = [['Hotel', '  hotel', true], ['Hotel', 'HOTEL\t\n', true], ['CAFÉ', 'café', true],
    ['Ho tel', 'Hotel', false], ['Hotel', 'Hotels', false]]
  for (const [i, [a, b, isDup]] of cases.entries()) {
    await call('POST', '/groups', { ...trip, id: `g${i}` })
    const entries = [{ ...hotel, description: a }, { ...hotel, description: b }]
    if (isDup) await expectRejected(call, entries, [dup(1)], {}, `g${i}`)
    else {
      const r = await importInto(call, entries, {}, `g${i}`)
      assert.equal(r.status, 201, JSON.stringify(cases[i]))
      assert.equal(r.body.expenses.length, 2, JSON.stringify(cases[i]))
    }
  }
}))

test('duplicates compare the amount as a number', () => withApp(async call => {
  await setup(call, [{ ...trip, id: 'g2' }, { ...trip, id: 'g3' }])
  const tea = a => `{"type":"expense","description":"Tea","payer":"Ann","amount":${a}}`
  const raw = (a, b) => `{"entries":[${tea(a)},${tea(b)}]}`
  const first = await call('POST', '/groups/trip/import', raw('4.35', '4.350'))
  assert.equal(first.status, 422)
  assert.deepEqual(first.body, rejected([dup(1)]))
  const second = await call('POST', '/groups/g2/import', raw('90', '90.0'))
  assert.equal(second.status, 422)
  assert.deepEqual(second.body, rejected([dup(1)]))
  const third = await call('POST', '/groups/g3/import', raw('4.35', '4.36'))
  assert.equal(third.status, 201)
  assert.equal(third.body.expenses.length, 2)
}))

test('a different split is still a duplicate; payers are case-sensitive', () => withApp(async call => {
  await setup(call, [{ id: 'pair', name: 'Pair', members: ['Ann', 'ann'] }])
  await expectRejected(call, [hotel, { ...hotel, split: ['Ben'] }], [dup(1)])
  const r = await importInto(call, [{ ...hotel, payer: 'Ann' }, { ...hotel, payer: 'ann' }], {}, 'pair')
  assert.equal(r.status, 201)
  assert.equal(r.body.expenses.length, 2)
}))

test('an earlier invalid entry does not make a later one a duplicate', () => withApp(async call => {
  await setup(call)
  await expectRejected(call, [{ ...hotel, split: null }, hotel], [{ index: 0, rule: 'bad-split' }])
}))

test('payments are never duplicates', () => withApp(async call => {
  await setup(call)
  const r = await importInto(call, [pay, pay, pay])
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.payments.map(p => p.id), [1, 2, 3])
  assert.deepEqual(r.body.balances, { Ann: -90, Ben: 90, Cara: 0 })
}))

// G. Already recorded

const recorded = () => ({ index: 0, rule: 'already-recorded' })

async function setupRecorded(call) {
  await setup(call)
  assert.equal((await call('POST', '/groups/trip/expenses', hotelPlain)).status, 201)
}

test('an expense already in the group is already-recorded, whatever its split', () => withApp(async call => {
  await setupRecorded(call)
  await expectRejected(call, [{ ...hotel, description: 'HOTEL ' }], [recorded()])
  await expectRejected(call, [{ ...hotel, split: ['Ben'] }], [recorded()])
}))

test('skip_recorded turns already-recorded into skipped but keeps duplicates', () => withApp(async call => {
  await setupRecorded(call)
  await expectRejected(call, [hotel, hotel], [recorded(), dup(1)], { skip_recorded: false })
  await expectRejected(call, [hotel, hotel], [dup(1)], { skip_recorded: true })
}))

test('an expense recorded only in another group is not already-recorded', () => withApp(async call => {
  await setup(call, [{ ...trip, id: 'flat' }])
  await call('POST', '/groups/flat/expenses', hotelPlain)
  assert.equal((await importInto(call, [hotel])).status, 201)
}))

test('a deleted expense is not already-recorded', () => withApp(async call => {
  await setupRecorded(call)
  assert.equal((await call('DELETE', '/groups/trip/expenses/1')).status, 204)
  assert.equal((await importInto(call, [hotel])).status, 201)
}))

test('a patched expense is compared by its current amount', () => withApp(async call => {
  await setupRecorded(call)
  assert.equal((await call('PATCH', '/groups/trip/expenses/1', { amount: 60 })).status, 200)
  assert.equal((await importInto(call, [hotel])).status, 201)
  await call('DELETE', '/groups/trip/expenses/2')
  await expectRejected(call, [{ ...hotel, amount: 60 }], [recorded()])
}))

test('an existing payment does not make a payment already-recorded', () => withApp(async call => {
  await setup(call)
  await call('POST', '/groups/trip/payments', { from: 'Ben', to: 'Ann', amount: 30 })
  assert.equal((await importInto(call, [pay])).status, 201)
}))

test('skip_recorded imports the rest and lists the skipped indexes', () => withApp(async call => {
  await setupRecorded(call)
  const r = await importInto(call, [{ ...hotel, description: ' hotel' }, { ...hotel, description: 'Skis' }], { skip_recorded: true })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.expenses.map(e => [e.id, e.description]), [[2, 'Skis']])
  assert.deepEqual(r.body.skipped, [0])
  // a skipped entry still counts as seen, so a later copy of it is a duplicate
  await expectRejected(call, [hotel, { ...hotel, description: 'Bus' }, { ...hotel, description: ' hotel' }], [dup(2)], { skip_recorded: true })
}))

test('skip_recorded does not hide other problems', () => withApp(async call => {
  await setupRecorded(call)
  await expectRejected(call, [hotel, { type: 'x' }], [{ index: 1, rule: 'bad-type' }], { skip_recorded: true })
}))

// H. All skipped

const fileState = file => ({ text: readFileSync(file, 'utf8'), mtime: statSync(file).mtimeMs })
const skis = { type: 'expense', description: 'Skis', payer: 'Ben', amount: 60 }

test('an import where everything is skipped saves nothing', async t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  const app = await startApp(data.file)
  t.after(app.stop)
  const { call } = app
  await setup(call)
  await call('POST', '/groups/trip/expenses', hotelPlain)
  await call('POST', '/groups/trip/expenses', { description: 'Skis', payer: 'Ben', amount: 60 })
  const before = fileState(data.file)
  const expected = { expenses: [], payments: [], skipped: [0, 1], balances: { Ann: 40, Ben: 10, Cara: -50 } }
  assert.deepEqual((await call('GET', '/groups/trip/balances')).body.balances, expected.balances)
  for (const [opts, status] of [[{ skip_recorded: true }, 201], [{ skip_recorded: true, dry_run: true }, 200]]) {
    const r = await importInto(call, [hotel, skis], opts)
    assert.equal(r.status, status, JSON.stringify(opts))
    assert.deepEqual(r.body, expected, JSON.stringify(opts))
    assert.deepEqual(fileState(data.file), before, JSON.stringify(opts))
  }
  assert.equal((await call('POST', '/groups/trip/expenses', { ...hotelPlain, description: 'Bus' })).body.id, 3)
  assert.equal((await call('POST', '/groups/trip/payments', { from: 'Ben', to: 'Ann', amount: 1 })).body.id, 1)
})

// I. Success shape and ids

test('a successful import answers the stored entries, skipped indexes and balances', () => withApp(async call => {
  await call('POST', '/groups', { ...trip, members: ['Cara', 'Ann', 'Ben'] })
  await call('POST', '/groups', { ...trip, id: 'flat' })
  await call('POST', '/groups/trip/expenses', { description: 'Snacks', payer: 'Ann', amount: 30 })
  await call('POST', '/groups/flat/expenses', { description: 'Rent', payer: 'Ann', amount: 30 })
  await call('POST', '/groups/trip/payments', { from: 'Ben', to: 'Ann', amount: 20 })
  assert.equal((await call('POST', '/groups/trip/expenses', hotelPlain)).body.id, 3)
  const entries = [
    { type: 'expense', description: 'Taxi', payer: 'Cara', amount: 10 }, hotel,
    { type: 'payment', from: 'Ben', to: 'Cara', amount: 5 },
    { type: 'expense', description: 'Fuel', payer: 'Ben', amount: 12.5, split: ['Ben', 'Ann'] },
  ]
  const r = await importInto(call, entries, { skip_recorded: true })
  assert.equal(r.status, 201)
  assert.equal(r.headers.get('content-type'), 'application/json')
  assert.deepEqual(r.body.expenses, [
    { id: 4, description: 'Taxi', payer: 'Cara', amount: 10, split: ['Cara', 'Ann', 'Ben'], shares: { Cara: 3.34, Ann: 3.33, Ben: 3.33 } },
    { id: 5, description: 'Fuel', payer: 'Ben', amount: 12.5, split: ['Ben', 'Ann'], shares: { Ben: 6.25, Ann: 6.25 } },
  ])
  assert.deepEqual(r.body.payments, [{ id: 2, from: 'Ben', to: 'Cara', amount: 5 }])
  assert.deepEqual(r.body.skipped, [1])
  assertShapes(r.body)
  const got = (await call('GET', '/groups/trip/balances')).body.balances
  assert.deepEqual(r.body.balances, got)
  assert.deepEqual(Object.keys(r.body.balances), ['Cara', 'Ann', 'Ben'])
  assert.deepEqual(r.body.balances, { Cara: -38.34, Ann: 50.42, Ben: -12.08 })
  const listed = (await call('GET', '/groups/trip/expenses')).body.expenses
  assert.deepEqual(listed.filter(e => e.id >= 4), r.body.expenses)
  assert.equal((await call('POST', '/groups/trip/expenses', { ...hotelPlain, description: 'Bus' })).body.id, 6)
  assert.equal((await call('POST', '/groups/trip/payments', { from: 'Ben', to: 'Ann', amount: 1 })).body.id, 3)
}))

function assertShapes(body) {
  assert.deepEqual(Object.keys(body), ['expenses', 'payments', 'skipped', 'balances'])
  for (const e of body.expenses) {
    assert.deepEqual(Object.keys(e), ['id', 'description', 'payer', 'amount', 'split', 'shares'])
    assert.deepEqual(Object.keys(e.shares), e.split)
  }
  for (const p of body.payments) assert.deepEqual(Object.keys(p), ['id', 'from', 'to', 'amount'])
}

// J. Uneven split

test('an uneven split gives the extra cent to the first member', () => withApp(async call => {
  await setup(call)
  const r = await importInto(call, [{ type: 'expense', description: 'Taxi', payer: 'Ann', amount: 10 }])
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.expenses[0].shares, { Ann: 3.34, Ben: 3.33, Cara: 3.33 })
  assert.deepEqual(r.body.balances, { Ann: 6.66, Ben: -3.33, Cara: -3.33 })
  const tea = await importInto(call, [{ ...hotel, description: 'Tea', amount: 4.35 }])
  assert.equal(tea.body.expenses[0].amount, 4.35)
}))

// K. Persistence

test('an imported batch survives a restart', async t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  const first = await startApp(data.file)
  let r
  try {
    await first.call('POST', '/groups', trip)
    r = await importInto(first.call, [hotel, pay])
    assert.equal(r.status, 201)
  } finally {
    await first.stop()
  }
  const second = await startApp(data.file)
  t.after(second.stop)
  assert.deepEqual((await second.call('GET', '/groups/trip/expenses')).body.expenses, r.body.expenses)
  assert.deepEqual((await second.call('GET', '/groups/trip/payments')).body.payments, r.body.payments)
  assert.equal((await second.call('POST', '/groups/trip/expenses', { ...hotelPlain, description: 'Bus' })).body.id, 2)
  assert.equal((await second.call('POST', '/groups/trip/payments', { from: 'Ben', to: 'Ann', amount: 1 })).body.id, 2)
})

// L. Dry run

test('a dry run answers what a real import would, and changes nothing', async t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  const app = await startApp(data.file)
  t.after(app.stop)
  const { call } = app
  await setup(call)
  await call('POST', '/groups/trip/expenses', { description: 'Snacks', payer: 'Ann', amount: 30 })
  const snap = async () => ({
    expenses: (await call('GET', '/groups/trip/expenses')).body,
    payments: (await call('GET', '/groups/trip/payments')).body,
    balances: (await call('GET', '/groups/trip/balances')).body,
    file: fileState(data.file),
  })
  const before = await snap()
  const entries = [hotel, pay]
  const dry = await importInto(call, entries, { dry_run: true })
  assert.equal(dry.status, 200)
  assert.equal(dry.body.expenses[0].id, 2)
  assert.equal(dry.body.payments[0].id, 1)
  assert.deepEqual(await snap(), before)
  const real = await importInto(call, entries)
  assert.equal(real.status, 201)
  assert.deepEqual(real.body, dry.body)
})

test('a dry run reports errors like a real import', () => withApp(async call => {
  await setup(call)
  const bad = [hotel, { ...hotel, description: 'Bus', amount: 0 }]
  const real = await importInto(call, bad)
  const dry = await importInto(call, bad, { dry_run: true })
  assert.equal(dry.status, 422)
  assert.deepEqual(dry.body, real.body)
  const real400 = await call('POST', '/groups/trip/import', { entries: [], foo: 1 })
  const dry400 = await call('POST', '/groups/trip/import', { entries: [], foo: 1, dry_run: true })
  assert.equal(dry400.status, 400)
  assert.deepEqual(dry400.body, real400.body)
  const gone = await importInto(call, [hotel], { dry_run: true }, 'nope')
  assert.equal(gone.status, 404)
  assert.deepEqual(gone.body, { error: 'not found' })
}))

test('after a dry run the next expense gets the id the dry reply showed', () => withApp(async call => {
  await setup(call)
  const dry = await importInto(call, [hotel], { dry_run: true })
  const next = await call('POST', '/groups/trip/expenses', { ...hotelPlain, description: 'Bus' })
  assert.equal(next.body.id, dry.body.expenses[0].id)
}))
