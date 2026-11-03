import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertNextIdsAreOne, assertNothingSaved, expense, importInto, payment, rejected, snapshot, withTrip,
} from './import-fixtures.mjs'

const raw = JSON.stringify
const one = raw([expense()])
const err = error => ({ error })
const ENTRIES_MSG = 'entries must be an array of 1 to 50 items'
const HOTEL_IMPORTED = {
  expenses: [{ id: 1, description: 'Hotel', payer: 'Ann', amount: 90, split: ['Ann', 'Ben', 'Cara'], shares: { Ann: 30, Ben: 30, Cara: 30 } }],
  payments: [],
  skipped: [],
  balances: { Ann: 60, Ben: -30, Cara: -30 },
}

// Sends each body to the import route and checks the exact status and error body.
async function expectAll(ctx, bodies, status, expected, groupId = 'trip') {
  const before = snapshot(ctx.file)
  for (const body of bodies) {
    const r = await importInto(ctx.call, body, groupId)
    assert.equal(r.status, status, String(raw(body)))
    assert.deepEqual(r.body, expected(body), String(raw(body)))
  }
  await assertNothingSaved(ctx, before)
}

test('a body over 10 KB is 413, before the group check, and saves nothing', () => withTrip(async ctx => {
  const big = { entries: [expense({ description: 'x'.repeat(11 * 1024) })] }
  await expectAll(ctx, [big], 413, () => err('body too large'))
  await expectAll(ctx, [big], 413, () => err('body too large'), 'nope')
}))

test('a body that is not a JSON object is 400, before the group check', () => withTrip(async ctx => {
  for (const groupId of ['trip', 'nope']) {
    await expectAll(ctx, ['[]', 'null', '"x"', '5', 'true'], 400, () => err('body must be a JSON object'), groupId)
    await expectAll(ctx, ['{'], 400, () => err('invalid JSON'), groupId)
  }
}))

test('an unknown group wins over every later check', () => withTrip(async ctx => {
  const bodies = [{ bogus: 1 }, {}, { entries: 'x' }, { entries: [null] }, { entries: [expense()], dry_run: 'yes' }]
  await expectAll(ctx, bodies, 404, () => err('not found'), 'nope')
}))

test('an unknown body field is 400', () => withTrip(async ctx => {
  const names = ['extra', 'Entries', 'dryRun', 'dry-run', 'skipRecorded', 'toString', 'constructor', 'hasOwnProperty', 'valueOf']
  const before = snapshot(ctx.file)
  for (const name of names) {
    const r = await importInto(ctx.call, `{"entries":${one},${raw(name)}:1}`)
    assert.equal(r.status, 400, name)
    assert.deepEqual(r.body, err(`unknown field ${name}`), name)
  }
  await assertNothingSaved(ctx, before)
}))

test('an unknown field named __proto__ is refused', () => withTrip(async ctx => {
  const before = snapshot(ctx.file)
  const r = await importInto(ctx.call, `{"entries":${one},"__proto__":1}`)
  assert.equal(r.status, 400)
  assert.deepEqual(r.body, err('unknown field __proto__'))
  await assertNothingSaved(ctx, before)
}))

test('the first unknown field in key order is named, not the first sorted', () => withTrip(async ctx => {
  const before = snapshot(ctx.file)
  const r = await importInto(ctx.call, `{"zeta":1,"alpha":2,"entries":${one}}`)
  assert.equal(r.status, 400)
  assert.deepEqual(r.body, err('unknown field zeta'))
  const num = await importInto(ctx.call, `{"entries":${one},"b":1,"7":2}`)
  assert.equal(num.status, 400)
  assert.deepEqual(num.body, err('unknown field 7'))
  await assertNothingSaved(ctx, before)
}))

test('an unknown field beats a bad entries or dry_run', () => withTrip(async ctx => {
  await expectAll(ctx, [{ entries: 'x', dry_run: 'y', extra: 1 }], 400, () => err('unknown field extra'))
}))

test('entries that are not an array of 1 to 50 items are 400', () => withTrip(async ctx => {
  const bodies = [
    {}, { dry_run: true }, { entries: null }, { entries: 'x' }, { entries: 5 }, { entries: {} },
    { entries: { length: 1, 0: expense() } }, { entries: [] },
    { entries: Array.from({ length: 51 }, () => payment({ amount: 1 })) },
  ]
  await expectAll(ctx, bodies, 400, () => err(ENTRIES_MSG))
}))

test('a bad entries beats a bad dry_run', () => withTrip(async ctx => {
  await expectAll(ctx, [{ entries: 'x', dry_run: 'y' }, { dry_run: 'y' }], 400, () => err(ENTRIES_MSG))
}))

test('exactly 1 entry is accepted', () => withTrip(async ({ call }) => {
  const r = await importInto(call, { entries: [expense()] })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body, HOTEL_IMPORTED)
}))

test('exactly 50 entries are accepted, with ids 1 to 50', () => withTrip(async ({ call }) => {
  const entries = Array.from({ length: 50 }, () => payment({ amount: 1 }))
  const r = await importInto(call, { entries })
  assert.equal(r.status, 201)
  assert.equal(r.body.payments.length, 50)
  assert.deepEqual(r.body.payments.map(p => p.id), Array.from({ length: 50 }, (_, i) => i + 1))
}))

test('a dry_run that is not true or false is 400', () => withTrip(async ctx => {
  const bodies = [null, 'true', 'false', 1, 0, [], {}].map(dry_run => ({ entries: [expense()], dry_run }))
  await expectAll(ctx, bodies, 400, () => err('dry_run must be true or false'))
}))

test('a skip_recorded that is not true or false is 400', () => withTrip(async ctx => {
  const bodies = [null, 'true', 'false', 1, 0, [], {}].map(skip_recorded => ({ entries: [expense()], skip_recorded }))
  await expectAll(ctx, bodies, 400, () => err('skip_recorded must be true or false'))
}))

test('both flags bad names dry_run, whatever the key order', () => withTrip(async ctx => {
  const before = snapshot(ctx.file)
  const r = await importInto(ctx.call, `{"skip_recorded":"x","dry_run":"y","entries":${one}}`)
  assert.equal(r.status, 400)
  assert.deepEqual(r.body, err('dry_run must be true or false'))
  await assertNothingSaved(ctx, before)
}))

test('explicit false for both flags imports', () => withTrip(async ({ call }) => {
  const r = await importInto(call, { entries: [expense()], dry_run: false, skip_recorded: false })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body, HOTEL_IMPORTED)
}))

test('after error replies the next expense still gets id 1', () => withTrip(async ({ call, file }) => {
  const before = snapshot(file)
  const cases = [
    ['[]', 'body must be a JSON object'],
    ['{', 'invalid JSON'],
    [raw({ entries: 'x' }), ENTRIES_MSG],
    [raw({ entries: [null], dry_run: 1 }), 'dry_run must be true or false'],
    [raw({ extra: 1 }), 'unknown field extra'],
  ]
  for (const [body, message] of cases) {
    const r = await importInto(call, body)
    assert.equal(r.status, 400, body)
    assert.deepEqual(r.body, err(message), body)
  }
  const bad = await importInto(call, { entries: [null] })
  assert.equal(bad.status, 422)
  assert.deepEqual(bad.body, rejected([{ index: 0, rule: 'not-an-object' }]))
  assert.deepEqual(snapshot(file), before)
  await assertNextIdsAreOne(call)
}))

test('a 400 flag error beats a 422 entry problem', () => withTrip(async ctx => {
  await expectAll(ctx, [{ entries: [null], dry_run: 'yes' }], 400, () => err('dry_run must be true or false'))
  await expectAll(ctx, [{ entries: [null], skip_recorded: null }], 400, () => err('skip_recorded must be true or false'))
}))
