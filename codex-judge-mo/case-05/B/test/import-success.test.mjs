// POST /groups/:id/import: successful imports, ids, skipped entries, dry runs and what reaches the data file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asPost, assertNothingSaved, capture, everyone, expense, flat, ledger, payment, snapshot, withTrip } from './import-fixtures.mjs'

const taxi = expense({ description: 'Taxi', amount: 20 })
const skis = expense({ description: 'Skis', payer: 'Cara', amount: 12.5, split: ['Cara', 'Ben'] })

// Leaves the next expense id at 3 and the next payment id at 2, with Taxi recorded in trip.
async function seedIds(call) {
  await call('POST', '/groups', flat)
  await call('POST', '/groups/flat/expenses', { description: 'Rent', payer: 'Ben', amount: 500 })
  await call('POST', '/groups/trip/expenses', asPost(taxi))
  await call('POST', '/groups/flat/payments', { from: 'Cara', to: 'Ann', amount: 5 })
}

// [expense, skipped expense, payment, expense] imported after seedIds.
const mixedEntries = [expense(), { ...taxi, description: ' taxi ', split: ['Ben'] }, payment(), skis]
const mixedReply = {
  expenses: [
    { id: 3, description: 'Hotel', payer: 'Ann', amount: 90, split: everyone, shares: { Ann: 30, Ben: 30, Cara: 30 } },
    { id: 4, description: 'Skis', payer: 'Cara', amount: 12.5, split: ['Cara', 'Ben'], shares: { Cara: 6.25, Ben: 6.25 } },
  ],
  payments: [{ id: 2, from: 'Ben', to: 'Ann', amount: 30 }],
  skipped: [1],
  balances: { Ann: 43.33, Ben: -12.92, Cara: -30.41 },
}

test('import 201: expenses and payments shown as their POST routes show them, with balances', () => withTrip(async ({ call, importInto }) => {
  const r = await importInto({ entries: [expense(), payment()] })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body, {
    expenses: [{ id: 1, description: 'Hotel', payer: 'Ann', amount: 90, split: everyone, shares: { Ann: 30, Ben: 30, Cara: 30 } }],
    payments: [{ id: 1, from: 'Ben', to: 'Ann', amount: 30 }],
    skipped: [],
    balances: { Ann: 30, Ben: 0, Cara: -30 },
  })
  assert.deepEqual(await ledger(call), { expenses: r.body.expenses, payments: r.body.payments, balances: r.body.balances })
}))

test('import 201: each entry matches what POST gives for the same fields, description kept as given', () => withTrip(async ({ call, importInto }) => {
  await call('POST', '/groups', flat)
  const entries = [expense({ description: '  Hotel night ', amount: 4.35, split: ['Ben', 'Ann'] }), expense({ amount: 10 }), payment({ amount: 0.29 })]
  const r = await importInto({ entries })
  assert.equal(r.status, 201)
  const posted = [
    (await call('POST', '/groups/flat/expenses', asPost(entries[0]))).body,
    (await call('POST', '/groups/flat/expenses', asPost(entries[1]))).body,
  ]
  const withoutId = ({ id, ...rest }) => rest
  assert.deepEqual(r.body.expenses.map(withoutId), posted.map(withoutId))
  assert.deepEqual(r.body.expenses[0], { id: 1, description: '  Hotel night ', payer: 'Ann', amount: 4.35, split: ['Ben', 'Ann'], shares: { Ben: 2.18, Ann: 2.17 } })
  assert.deepEqual(r.body.expenses[1].shares, { Ann: 3.34, Ben: 3.33, Cara: 3.33 })
  assert.deepEqual(r.body.payments, [{ id: 1, from: 'Ben', to: 'Ann', amount: 0.29 }])
}))

test('import 201: ids run on per kind in entry order; skipped entries take none', () => withTrip(async ({ call, importInto }) => {
  await seedIds(call)
  const r = await importInto({ entries: mixedEntries, skip_recorded: true })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body, mixedReply)
  assert.deepEqual((await call('GET', '/groups/trip/balances')).body, { balances: mixedReply.balances })
  assert.equal((await call('POST', '/groups/trip/expenses', asPost(expense({ description: 'Bus' })))).body.id, 5)
  assert.equal((await call('POST', '/groups/flat/payments', asPost(payment()))).body.id, 3)
}))

test('import 201: ids are shared with every group', () => withTrip(async ({ call, importInto }) => {
  await call('POST', '/groups', flat)
  const first = await importInto({ entries: [expense(), payment(), expense({ description: 'Bus' })] }, 'flat')
  assert.deepEqual([first.body.expenses.map(e => e.id), first.body.payments.map(p => p.id)], [[1, 2], [1]])
  const second = await importInto({ entries: [payment(), expense()] })
  assert.deepEqual([second.body.expenses.map(e => e.id), second.body.payments.map(p => p.id)], [[3], [2]])
  assert.deepEqual(second.body.balances, { Ann: 30, Ben: 0, Cara: -30 })
}))

test('import 201: when every entry is skipped, nothing is written and the reply shows current balances', () => withTrip(async ctx => {
  const { call, importInto } = ctx
  await call('POST', '/groups/trip/expenses', asPost(expense()))
  await call('POST', '/groups/trip/expenses', asPost(taxi))
  const expected = { expenses: [], payments: [], skipped: [0, 1], balances: (await call('GET', '/groups/trip/balances')).body.balances }
  const before = await capture(ctx)
  const r = await importInto({ entries: [taxi, expense({ description: 'HOTEL' })], skip_recorded: true })
  assert.deepEqual([r.status, r.body], [201, expected])
  await assertNothingSaved(ctx, before)
  const dry = await importInto({ entries: [taxi, expense({ description: 'HOTEL' })], skip_recorded: true, dry_run: true })
  assert.deepEqual([dry.status, dry.body], [200, expected])
  await assertNothingSaved(ctx, before)
}))

test('import dry run: 200 with the same body as the real import, and nothing saved', () => withTrip(async ctx => {
  const { call, importInto } = ctx
  await seedIds(call)
  const before = await capture(ctx)
  const dry = await importInto({ entries: mixedEntries, skip_recorded: true, dry_run: true })
  assert.deepEqual([dry.status, dry.body], [200, mixedReply])
  await assertNothingSaved(ctx, before)
  const real = await importInto({ dry_run: false, entries: mixedEntries, skip_recorded: true })
  assert.deepEqual([real.status, real.body], [201, mixedReply])
}))

test('import dry run: the next real POSTs get the ids the dry run showed', () => withTrip(async ctx => {
  const { call, importInto } = ctx
  await seedIds(call)
  const dry = await importInto({ entries: [payment(), expense()], dry_run: true })
  assert.deepEqual([dry.body.expenses.map(e => e.id), dry.body.payments.map(p => p.id)], [[3], [2]])
  assert.equal((await call('POST', '/groups/trip/expenses', asPost(expense()))).body.id, 3)
  assert.equal((await call('POST', '/groups/trip/payments', asPost(payment()))).body.id, 2)
}))

test('import dry run: problems are the same 422 and nothing is saved', () => withTrip(async ctx => {
  await ctx.call('POST', '/groups/trip/expenses', asPost(expense()))
  const before = await capture(ctx)
  const r = await ctx.importInto({ entries: [payment(), expense()], dry_run: true })
  assert.deepEqual([r.status, r.body], [422, { error: 'import rejected', problems: [{ index: 1, rule: 'already-recorded' }] }])
  await assertNothingSaved(ctx, before)
}))

test('import 201: a real import writes the data file, and it survives a restart', () => withTrip(async ctx => {
  const { call, file, importInto, restart } = ctx
  const before = snapshot(file)
  const r = await importInto({ entries: [expense(), payment(), skis] })
  assert.equal(r.status, 201)
  assert.notEqual(snapshot(file).ino, before.ino)
  const after = await ledger(call)
  await restart()
  assert.deepEqual(await ledger(call), after)
  assert.deepEqual(after.balances, r.body.balances)
  assert.equal((await call('POST', '/groups/trip/expenses', asPost(taxi))).body.id, 3)
  assert.equal((await call('POST', '/groups/trip/payments', asPost(payment()))).body.id, 2)
}))

test('import: a dry run leaves nothing behind after a restart', () => withTrip(async ctx => {
  const { call, importInto, restart } = ctx
  const r = await importInto({ entries: [expense(), payment()], dry_run: true })
  assert.equal(r.status, 200)
  await restart()
  assert.deepEqual(await ledger(call), { expenses: [], payments: [], balances: { Ann: 0, Ben: 0, Cara: 0 } })
  assert.equal((await importInto({ entries: [expense()] })).body.expenses[0].id, 1)
}))
