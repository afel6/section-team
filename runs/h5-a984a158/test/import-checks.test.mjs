import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withApp } from './helpers.mjs'

const trip = { id: 'trip', name: 'Ski trip', members: ['Ann', 'Ben', 'Cara'] }
const E = { type: 'expense', description: 'Hotel', payer: 'Ann', amount: 90 }
const P = { type: 'payment', from: 'Ben', to: 'Ann', amount: 30 }
const ENTRIES_MSG = 'entries must be an array of 1 to 50 items'
const NOT_FOUND = { error: 'not found' }

const importTo = (call, body, group = 'trip') => call('POST', `/groups/${group}/import`, body)

// Creates the trip group; with seeded, also one expense (id 1) and one payment (id 1).
async function setup(call, seeded = false) {
  await call('POST', '/groups', trip)
  if (seeded) {
    await call('POST', '/groups/trip/expenses', { description: 'Taxi', payer: 'Ben', amount: 10 })
    await call('POST', '/groups/trip/payments', { from: 'Cara', to: 'Ann', amount: 5 })
  }
}

const snapshot = async call => ({
  expenses: (await call('GET', '/groups/trip/expenses')).body,
  payments: (await call('GET', '/groups/trip/payments')).body,
})

// Nothing changed since `before`, and the next ids are still 2 (creates data: call once at the end).
async function assertNothingSaved(call, before) {
  assert.deepEqual(await snapshot(call), before, 'stored data changed')
  const e = await call('POST', '/groups/trip/expenses', { description: 'Next', payer: 'Ann', amount: 1 })
  assert.equal(e.status, 201)
  assert.equal(e.body.id, 2, 'next expense id')
  const p = await call('POST', '/groups/trip/payments', { from: 'Ann', to: 'Ben', amount: 1 })
  assert.equal(p.status, 201)
  assert.equal(p.body.id, 2, 'next payment id')
}

async function expectError(call, body, status, error, msg, group = 'trip') {
  const r = await importTo(call, body, group)
  assert.equal(r.status, status, msg)
  assert.deepEqual(r.body, { error }, msg)
}

async function expectProblems(call, entries, problems, extra = {}, msg = JSON.stringify(entries)) {
  const r = await importTo(call, { entries, ...extra })
  assert.equal(r.status, 422, msg)
  assert.deepEqual(r.body, { error: 'import rejected', problems }, msg)
}

// Each entry alone gets exactly one problem with this rule.
async function expectRule(call, entries, rule, label) {
  for (const entry of entries) {
    await expectProblems(call, [entry], [{ index: 0, rule }], {}, `${label}: ${JSON.stringify(entry)}`)
  }
}

async function expectCreated(call, entries, counts, msg, extra = {}) {
  const r = await importTo(call, { entries, ...extra })
  assert.equal(r.status, 201, msg)
  assert.deepEqual({ expenses: r.body.expenses.length, payments: r.body.payments.length }, counts, msg)
}

const raw = (entries, tail) => `{"entries":${JSON.stringify(entries)}${tail}}`

test('import: a body over 10 KB is 413 and saves nothing', () => withApp(async call => {
  await setup(call, true)
  const before = await snapshot(call)
  const entries = Array.from({ length: 50 }, (_, i) => ({ ...E, description: `${i}${'x'.repeat(200)}`.slice(0, 200) }))
  assert.ok(JSON.stringify({ entries }).length > 10240)
  await expectError(call, { entries }, 413, 'body too large', 'big body')
  await assertNothingSaved(call, before)
}))

test('import: a body that is not a JSON object is 400', () => withApp(async call => {
  await setup(call, true)
  const before = await snapshot(call)
  for (const text of ['[1]', 'null', '"x"']) {
    await expectError(call, text, 400, 'body must be a JSON object', text)
  }
  await expectError(call, '{"entries": ', 400, 'invalid JSON', 'cut json')
  await assertNothingSaved(call, before)
}))

test('import: an unknown group is 404 before any body check', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const bodies = [{ entries: [E] }, { foo: 1 }, { entries: [] }, { entries: [E], dry_run: 'yes' }, { entries: [null] }]
  for (const group of ['nope', 'NOPE']) {
    for (const body of bodies) {
      await expectError(call, body, 404, 'not found', `${group} ${JSON.stringify(body)}`, group)
    }
  }
}))

test('import: 413 and a non-object body come before the unknown-group 404', () => withApp(async call => {
  const entries = Array.from({ length: 50 }, () => ({ ...E, description: 'x'.repeat(200) }))
  await expectError(call, { entries }, 413, 'body too large', 'big body, unknown group', 'nope')
  await expectError(call, '[1]', 400, 'body must be a JSON object', 'array body, unknown group', 'nope')
  await expectError(call, '{"entries": ', 400, 'invalid JSON', 'cut json, unknown group', 'nope')
}))

test('import 400: unknown field, first in Object.keys order, case sensitive', () => withApp(async call => {
  await setup(call, true)
  const before = await snapshot(call)
  const cases = [
    [{ entries: [E], foo: 1 }, 'unknown field foo'],
    [{ zed: 1, entries: [E], alpha: 2 }, 'unknown field zed'],
    [{ entries: 'x', foo: 1 }, 'unknown field foo'],
    [{ dry_run: 'x', bar: 1 }, 'unknown field bar'],
    [{ Entries: [E] }, 'unknown field Entries'],
    [raw([E], ',"__proto__":1'), 'unknown field __proto__'],
  ]
  for (const [body, message] of cases) await expectError(call, body, 400, message, JSON.stringify(body))
  await assertNothingSaved(call, before)
}))

test('import 400: entries must be an array of 1 to 50 items', () => withApp(async call => {
  await setup(call)
  const many = n => Array.from({ length: n }, () => E)
  const bad = [{}, { entries: null }, { entries: {} }, { entries: 'abc' }, { entries: [] }, { entries: many(51) }]
  for (const body of bad) await expectError(call, body, 400, ENTRIES_MSG, JSON.stringify(body).slice(0, 40))
  await expectError(call, { entries: [], dry_run: 'x' }, 400, ENTRIES_MSG, 'entries beats dry_run')
  await expectCreated(call, [P], { expenses: 0, payments: 1 }, 'one item')
  const fifty = Array.from({ length: 50 }, (_, i) => ({ ...E, description: `Item ${i}` }))
  await expectCreated(call, fifty, { expenses: 50, payments: 0 }, 'fifty items')
}))

test('import 400: dry_run and skip_recorded must be booleans', () => withApp(async call => {
  await setup(call, true)
  const before = await snapshot(call)
  const values = ['true', 1, 0, null, 'false', [], {}]
  for (const v of values) {
    await expectError(call, { entries: [E], dry_run: v }, 400, 'dry_run must be true or false', `dry_run ${JSON.stringify(v)}`)
  }
  for (const v of ['true', 1, null]) {
    await expectError(call, { entries: [E], skip_recorded: v }, 400, 'skip_recorded must be true or false', `skip ${JSON.stringify(v)}`)
  }
  await expectError(call, { entries: [E], dry_run: null, skip_recorded: null }, 400, 'dry_run must be true or false', 'dry_run first')
  await expectError(call, { entries: [null], dry_run: 'x' }, 400, 'dry_run must be true or false', '400 beats 422')
  await assertNothingSaved(call, before)
}))

test('import 422: lists one problem per bad entry, sorted by index', () => withApp(async call => {
  await setup(call, true)
  const before = await snapshot(call)
  await expectProblems(call, [E, null, P, { type: 'x' }], [{ index: 1, rule: 'not-an-object' }, { index: 3, rule: 'bad-type' }])
  await expectProblems(call, [{ ...E, payer: 'Dan' }, E, { ...P, to: 'Ben' }, [], E],
    [{ index: 0, rule: 'bad-payer' }, { index: 2, rule: 'bad-to' }, { index: 3, rule: 'not-an-object' }, { index: 4, rule: 'duplicate' }])
  await assertNothingSaved(call, before)
}))

test('import 422: not-an-object', () => withApp(async call => {
  await setup(call)
  await expectRule(call, [null, [], [E], 5, 'expense', true], 'not-an-object', 'not-an-object')
}))

test('import 422: bad-type', () => withApp(async call => {
  await setup(call)
  const entries = [{}, { type: null }, { type: 'Expense' }, { type: 'refund' }, { type: ['expense'] },
    { description: 'Hotel', payer: 'Ann', amount: 90 }, { type: 'x', foo: 1 }]
  await expectRule(call, entries, 'bad-type', 'bad-type')
}))

test('import 422: unknown-field', () => withApp(async call => {
  await setup(call)
  const entries = [{ ...E, from: 'Ann' }, { ...E, foo: 1 }, { ...P, description: 'x' }, { ...P, split: ['Ann'] },
    { ...P, payer: 'Ann' }, { ...E, description: '', foo: 1 }]
  await expectRule(call, entries, 'unknown-field', 'unknown-field')
  await expectCreated(call, [{ ...E, split: ['Ann', 'Ben'] }, P], { expenses: 1, payments: 1 }, 'all keys valid')
}))

test('import 422: expense rules, each entry alone', () => withApp(async call => {
  await setup(call)
  const without = key => Object.fromEntries(Object.entries(E).filter(([k]) => k !== key))
  const table = {
    'bad-description': [{ ...E, description: '' }, { ...E, description: '   ' }, without('description'),
      { ...E, description: null }, { ...E, description: 5 }, { ...E, description: 'x'.repeat(201) },
      { ...E, description: '', payer: 'Dan' }],
    'bad-payer': [{ ...E, payer: 'Dan' }, { ...E, payer: 'ann' }, without('payer'), { ...E, payer: null },
      { ...E, payer: 'Dan', amount: 0 }],
    'bad-amount': [0, -1, 1.234, '90', null, 1000000.01].map(amount => ({ ...E, amount }))
      .concat([without('amount'), { ...E, amount: 0, split: [] }]),
    'bad-split': [null, [], ['Ann', 'Ann'], ['Dan'], 'Ann', [1]].map(split => ({ ...E, split })),
  }
  for (const [rule, entries] of Object.entries(table)) await expectRule(call, entries, rule, rule)
  const edges = [{ ...E, description: 'x'.repeat(200) }, { ...E, description: 'Low', amount: 0.01 }, { ...E, description: 'High', amount: 1000000 }]
  await expectCreated(call, edges, { expenses: 3, payments: 0 }, 'boundaries')
}))

test('import 422: payment rules, each entry alone', () => withApp(async call => {
  await setup(call)
  const without = key => Object.fromEntries(Object.entries(P).filter(([k]) => k !== key))
  const table = {
    'bad-from': [{ ...P, from: 'Dan' }, { ...P, from: null }, without('from'), { ...P, from: 'ben' }, { ...P, from: 'Dan', to: 'Dan' }],
    'bad-to': [{ ...P, to: 'Dan' }, without('to'), { ...P, to: null }, { ...P, to: 'Ben' }, { ...P, to: 'Ben', amount: 0 }],
    'bad-amount': [0, '30', null, 1.234].map(amount => ({ ...P, amount })).concat([without('amount')]),
  }
  for (const [rule, entries] of Object.entries(table)) await expectRule(call, entries, rule, rule)
}))

const taxi = amount => ({ type: 'expense', description: 'Taxi', payer: 'Ann', amount })

test('import 422: duplicate expenses', () => withApp(async call => {
  await setup(call, true)
  const before = await snapshot(call)
  const dup = [{ index: 1, rule: 'duplicate' }]
  await expectProblems(call, [E, E], dup)
  await expectProblems(call, [E, E, E], [...dup, { index: 2, rule: 'duplicate' }])
  const variants = [['Taxi', '  taxi '], ['Hotel', 'HOTEL'], [' Hotel\t', 'hotel'], [' Hotel\t', 'hotel'], ['Café', 'CAFÉ']]
  for (const [a, b] of variants) {
    await expectProblems(call, [{ ...E, description: a }, { ...E, description: b }], dup, {}, `${a} / ${b}`)
  }
  const rawBody = '{"entries":[{"type":"expense","description":"Taxi","payer":"Ann","amount":4.35},'
    + '{"type":"expense","description":"Taxi","payer":"Ann","amount":4.350}]}'
  const r = await importTo(call, rawBody)
  assert.equal(r.status, 422)
  assert.deepEqual(r.body, { error: 'import rejected', problems: dup })
  await expectProblems(call, [E, { ...E, split: ['Ann'] }], dup, {}, 'split is not compared')
  await assertNothingSaved(call, before)
}))

test('import: entries that only look like duplicates are fine', () => withApp(async call => {
  await setup(call)
  const pairs = [
    [E, { ...E, payer: 'Ben' }], [taxi(4.35), taxi(4.36)],
    [E, { ...E, description: 'Hotel 2' }], [E, { ...E, description: 'Hot el' }],
  ]
  for (const [i, [a, b]] of pairs.entries()) {
    const tag = e => ({ ...e, description: `${e.description} g${i}` })
    await expectCreated(call, [tag(a), tag(b)], { expenses: 2, payments: 0 }, `pair ${i}`)
  }
  await expectCreated(call, [P, P, P], { expenses: 0, payments: 3 }, 'identical payments')
}))

test('import 422: an invalid earlier entry does not make a later one a duplicate', () => withApp(async call => {
  await setup(call)
  await expectProblems(call, [{ ...E, split: [] }, E], [{ index: 0, rule: 'bad-split' }])
  await expectProblems(call, [{ ...E, foo: 1 }, E], [{ index: 0, rule: 'unknown-field' }])
  await expectProblems(call, [E, { ...E, split: ['Dan'] }], [{ index: 1, rule: 'bad-split' }])
}))

test('import 422: already-recorded, per group, and not after delete', () => withApp(async call => {
  await setup(call)
  const only = [{ index: 0, rule: 'already-recorded' }]
  const hotel = { description: 'Hotel', payer: 'Ann', amount: 90 }
  await call('POST', '/groups/trip/expenses', hotel)
  await call('POST', '/groups/trip/expenses', { description: 'Fuel', payer: 'Ben', amount: 1.15 })
  const before = await snapshot(call)
  await expectProblems(call, [E], only)
  await expectProblems(call, [{ ...E, description: ' HOTEL ' }], only)
  await expectProblems(call, [{ ...E, split: ['Ann'] }], only, {}, 'split is not compared')
  await expectProblems(call, [{ type: 'expense', description: 'fuel', payer: 'Ben', amount: 1.15 }], only, {}, 'cents')
  await expectProblems(call, [E, E], [...only, { index: 1, rule: 'duplicate' }], { skip_recorded: false })
  await expectProblems(call, [E, E], [{ index: 1, rule: 'duplicate' }], { skip_recorded: true })
  await expectProblems(call, [{ ...E, payer: 'Dan' }], [{ index: 0, rule: 'bad-payer' }], { skip_recorded: true })
  assert.deepEqual(await snapshot(call), before)
  await expectCreated(call, [{ ...E, amount: 90.5 }], { expenses: 1, payments: 0 }, 'other amount')
  await expectCreated(call, [{ ...E, payer: 'Ben' }], { expenses: 1, payments: 0 }, 'other payer')
}))

test('import: expenses of another group or deleted ones are not recorded', () => withApp(async call => {
  await setup(call)
  await call('POST', '/groups', { ...trip, id: 'flat' })
  await call('POST', '/groups/flat/expenses', { description: 'Hotel', payer: 'Ann', amount: 90 })
  await expectCreated(call, [E], { expenses: 1, payments: 0 }, 'other group')
  const made = await call('POST', '/groups/trip/expenses', { description: 'Taxi', payer: 'Ann', amount: 20 })
  assert.equal((await call('DELETE', `/groups/trip/expenses/${made.body.id}`)).status, 204)
  await expectCreated(call, [{ ...E, description: 'Taxi', amount: 20 }], { expenses: 1, payments: 0 }, 'deleted')
}))

test('import: dry_run gives the same 400, 422 and 404 replies', () => withApp(async call => {
  await setup(call, true)
  const before = await snapshot(call)
  const cases = [
    [{ entries: [E], foo: 1 }, 'trip'], [{ entries: [null, { type: 'x' }] }, 'trip'], [{ entries: [E] }, 'nope'],
    [{ entries: [E, E] }, 'trip'], [{ entries: [], skip_recorded: 'x' }, 'trip'],
  ]
  for (const [body, group] of cases) {
    const real = await importTo(call, body, group)
    const dry = await importTo(call, { ...body, dry_run: true }, group)
    assert.equal(dry.status, real.status, JSON.stringify(body))
    assert.deepEqual(dry.body, real.body, JSON.stringify(body))
  }
  assert.equal((await importTo(call, { entries: [null], dry_run: true })).status, 422)
  assert.deepEqual((await importTo(call, { entries: [E], dry_run: true }, 'nope')).body, NOT_FOUND)
  await assertNothingSaved(call, before)
}))
