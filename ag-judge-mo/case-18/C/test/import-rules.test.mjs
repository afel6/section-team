// POST /groups/:id/import: the 422 rules each entry is checked against, in order, and that a 422 saves nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asPost, assertNothingSaved, capture, expense, flat, payment, withTrip } from './import-fixtures.mjs'

// Imports entries (an array, or the raw JSON text of a whole body) and asserts the exact 422 reply, and that
// nothing was saved.
async function assertProblems(ctx, entries, problems, flags = {}) {
  const before = await capture(ctx)
  const r = await ctx.importInto(typeof entries === 'string' ? entries : { entries, ...flags })
  assert.equal(r.status, 422, typeof entries === 'string' ? entries : JSON.stringify(entries))
  assert.deepEqual(r.body, { error: 'import rejected', problems })
  await assertNothingSaved(ctx, before)
}

// One entry on its own must break exactly `rule`.
const assertRule = (ctx, entry, rule) => assertProblems(ctx, [entry], [{ index: 0, rule }])

// Imports entries and asserts a 201 (they broke no rule).
async function assertAccepted({ importInto }, entries, flags = {}) {
  const r = await importInto({ entries, ...flags })
  assert.equal(r.status, 201, JSON.stringify(entries))
  return r.body
}

test('import 422: null, arrays and other non-objects are not-an-object', () => withTrip(async ctx => {
  const entries = [null, [], [expense()], 'expense', 5, true, false]
  await assertProblems(ctx, entries, entries.map((_, index) => ({ index, rule: 'not-an-object' })))
}))

test('import 422: a type other than exactly "expense" or "payment" is bad-type', () => withTrip(async ctx => {
  const types = [['expense'], ['payment'], 'Expense', 'expense ', 'payments', '', null, 1, { expense: true }, 'toString', 'constructor', '__proto__']
  for (const type of types) await assertRule(ctx, expense({ type }), 'bad-type')
  const { type, ...noType } = expense()
  await assertRule(ctx, noType, 'bad-type')
  await assertRule(ctx, {}, 'bad-type')
}))

test('import 422: a field the entry type does not take is unknown-field, before its field rules', () => withTrip(async ctx => {
  await assertRule(ctx, expense({ from: 'Ann' }), 'unknown-field')
  await assertRule(ctx, expense({ id: 1 }), 'unknown-field')
  await assertRule(ctx, expense({ Split: ['Ann'] }), 'unknown-field')
  await assertRule(ctx, payment({ description: 'Back' }), 'unknown-field')
  await assertRule(ctx, payment({ split: ['Ann'] }), 'unknown-field')
  await assertRule(ctx, payment({ payer: 'Ann' }), 'unknown-field')
  await assertRule(ctx, { type: 'expense', note: 'x' }, 'unknown-field')
  await assertRule(ctx, { type: 'payment', amount: 0, extra: null }, 'unknown-field')
  const raw = `{"entries": [{"type": "expense", "description": "Hotel", "payer": "Ann", "amount": 9, "__proto__": {}}]}`
  await assertProblems(ctx, raw, [{ index: 0, rule: 'unknown-field' }])
}))

test('import 422: expense fields are checked as on POST, description, payer, amount, split', () => withTrip(async ctx => {
  const cases = [
    [{ description: '' }, 'bad-description'], [{ description: ' \t\n' }, 'bad-description'],
    [{ description: null }, 'bad-description'], [{ description: 'x'.repeat(201) }, 'bad-description'],
    [{ description: 5 }, 'bad-description'],
    [{ payer: 'Dan' }, 'bad-payer'], [{ payer: 'ann' }, 'bad-payer'], [{ payer: null }, 'bad-payer'], [{ payer: ['Ann'] }, 'bad-payer'],
    [{ amount: 0 }, 'bad-amount'], [{ amount: -1 }, 'bad-amount'], [{ amount: 4.355 }, 'bad-amount'],
    [{ amount: '10' }, 'bad-amount'], [{ amount: null }, 'bad-amount'], [{ amount: 1000000.01 }, 'bad-amount'],
    [{ split: null }, 'bad-split'], [{ split: [] }, 'bad-split'], [{ split: ['Ann', 'Ann'] }, 'bad-split'],
    [{ split: ['Ann', 'Dan'] }, 'bad-split'], [{ split: 'Ann' }, 'bad-split'], [{ split: ['ann'] }, 'bad-split'],
  ]
  for (const [over, rule] of cases) await assertRule(ctx, expense(over), rule)
  for (const [field, rule] of [['description', 'bad-description'], ['payer', 'bad-payer'], ['amount', 'bad-amount']]) {
    const { [field]: dropped, ...rest } = expense()
    await assertRule(ctx, rest, rule)
  }
  await assertAccepted(ctx, [expense({ description: 'x'.repeat(200), amount: 1000000 }), expense({ amount: 0.01, description: 'Tip' })])
}))

test('import 422: the first broken expense rule decides', () => withTrip(async ctx => {
  await assertRule(ctx, expense({ description: '', payer: 'Dan', amount: 0, split: null }), 'bad-description')
  await assertRule(ctx, expense({ payer: 'Dan', amount: 0, split: null }), 'bad-payer')
  await assertRule(ctx, expense({ amount: 0, split: null }), 'bad-amount')
}))

test('import 422: payment fields, bad-from, bad-to (stranger or same as from), bad-amount', () => withTrip(async ctx => {
  const cases = [
    [{ from: 'Dan' }, 'bad-from'], [{ from: null }, 'bad-from'], [{ from: 'ben' }, 'bad-from'],
    [{ to: 'Dan' }, 'bad-to'], [{ to: null }, 'bad-to'], [{ to: 'Ben' }, 'bad-to'],
    [{ amount: 0 }, 'bad-amount'], [{ amount: '30' }, 'bad-amount'], [{ amount: 1.001 }, 'bad-amount'], [{ amount: null }, 'bad-amount'],
    [{ from: 'Dan', to: 'Dan', amount: 0 }, 'bad-from'], [{ to: 'Ben', amount: 0 }, 'bad-to'],
  ]
  for (const [over, rule] of cases) await assertRule(ctx, payment(over), rule)
  for (const [field, rule] of [['from', 'bad-from'], ['to', 'bad-to'], ['amount', 'bad-amount']]) {
    const { [field]: dropped, ...rest } = payment()
    await assertRule(ctx, rest, rule)
  }
}))

test('import 422: one problem per bad entry, sorted by index, valid entries left out', () => withTrip(async ctx => {
  const entries = [expense(), { type: 'loan' }, payment(), null, expense({ description: 'Skis', amount: 0 }), payment({ to: 'Ben' })]
  await assertProblems(ctx, entries, [
    { index: 1, rule: 'bad-type' }, { index: 3, rule: 'not-an-object' },
    { index: 4, rule: 'bad-amount' }, { index: 5, rule: 'bad-to' },
  ])
}))

test('import 422: duplicate matches payer, amount in cents and trimmed lower-cased description', () => withTrip(async ctx => {
  const dup = [{ index: 1, rule: 'duplicate' }]
  await assertProblems(ctx, [expense(), expense({ description: '  hOTEL \n' })], dup)
  await assertProblems(ctx, [expense({ description: ' hotel' }), expense({ description: 'HOTEL ' })], dup)
  await assertProblems(ctx, [expense({ description: 'Café' }), expense({ description: ' CAFÉ\t' })], dup)
  await assertProblems(ctx, [expense({ split: ['Ann', 'Ben'] }), expense({ split: ['Cara'] })], dup)
  await assertProblems(ctx, [expense({ split: ['Ben'] }), payment(), expense()], [{ index: 2, rule: 'duplicate' }])
  // The same amount written two ways in the JSON text is one amount.
  const entry = amount => `{"type": "expense", "description": "Hotel", "payer": "Ann", "amount": ${amount}}`
  await assertProblems(ctx, `{"entries": [${entry('10')}, ${entry('10.00')}, ${entry('1e1')}]}`, [...dup, { index: 2, rule: 'duplicate' }])
}))

test('import: expenses differing in payer, amount or inner text are not duplicates', () => withTrip(async ctx => {
  const entries = [
    expense(), expense({ payer: 'Ben' }), expense({ amount: 90.01 }), expense({ description: 'Ho tel' }), expense({ description: 'Hotels' }),
  ]
  const body = await assertAccepted(ctx, entries)
  assert.deepEqual(body.expenses.map(({ id, description, payer, amount }) => ({ id, description, payer, amount })),
    entries.map(({ description, payer, amount }, i) => ({ id: i + 1, description, payer, amount })))
  assert.deepEqual(body.skipped, [])
}))

test('import 422: every later copy is a duplicate; an earlier entry with a bad field does not count', () => withTrip(async ctx => {
  await assertProblems(ctx, [expense(), expense(), expense()], [{ index: 1, rule: 'duplicate' }, { index: 2, rule: 'duplicate' }])
  await assertProblems(ctx, [expense({ split: null }), expense()], [{ index: 0, rule: 'bad-split' }])
  await assertProblems(ctx, [expense({ extra: 1 }), expense(), expense()], [{ index: 0, rule: 'unknown-field' }, { index: 2, rule: 'duplicate' }])
}))

test('import 422: already-recorded matches the group\'s current expenses', () => withTrip(async ctx => {
  const { call } = ctx
  await call('POST', '/groups/trip/expenses', { ...asPost(expense()), split: ['Ann'] })
  await assertRule(ctx, expense({ description: ' hotel ', split: ['Ben', 'Cara'] }), 'already-recorded')
  await call('PATCH', '/groups/trip/expenses/1', { amount: 60 })
  await assertRule(ctx, expense({ amount: 60 }), 'already-recorded')
  await call('DELETE', '/groups/trip/expenses/1')
  await assertAccepted(ctx, [expense({ amount: 60 })])
  await assertRule(ctx, expense({ amount: 60 }), 'already-recorded') // recorded by the import above
}))

test('import: an expense of another group is not already-recorded', () => withTrip(async ctx => {
  await ctx.call('POST', '/groups', flat)
  await ctx.call('POST', '/groups/flat/expenses', asPost(expense()))
  const body = await assertAccepted(ctx, [expense()])
  assert.deepEqual(body.expenses.map(e => e.id), [2])
}))

test('import 422: duplicate wins over already-recorded, and a recorded entry still counts as earlier', () => withTrip(async ctx => {
  await ctx.call('POST', '/groups/trip/expenses', asPost(expense()))
  const entries = [expense(), expense({ description: 'HOTEL' })]
  await assertProblems(ctx, entries, [{ index: 0, rule: 'already-recorded' }, { index: 1, rule: 'duplicate' }])
  await assertProblems(ctx, entries, [{ index: 1, rule: 'duplicate' }], { skip_recorded: true })
  await assertProblems(ctx, entries, [{ index: 1, rule: 'duplicate' }], { skip_recorded: true, dry_run: true })
}))

test('import 422: skip_recorded only skips already-recorded; other problems still reject', () => withTrip(async ctx => {
  await ctx.call('POST', '/groups/trip/expenses', asPost(expense()))
  await assertProblems(ctx, [expense(), { type: 'loan' }], [{ index: 1, rule: 'bad-type' }], { skip_recorded: true })
  await assertProblems(ctx, [expense(), payment({ from: 'Ann' })], [{ index: 1, rule: 'bad-to' }], { skip_recorded: true })
}))

test('import 422: payments are never duplicate or already-recorded', () => withTrip(async ctx => {
  await ctx.call('POST', '/groups/trip/payments', asPost(payment()))
  const body = await assertAccepted(ctx, [payment(), payment(), payment()])
  assert.deepEqual(body.payments, [2, 3, 4].map(id => ({ id, from: 'Ben', to: 'Ann', amount: 30 })))
  assert.deepEqual(body.balances, { Ann: -120, Ben: 120, Cara: 0 })
}))

test('import 422: a rejected import burns no ids', () => withTrip(async ctx => {
  await assertProblems(ctx, [expense(), payment(), null], [{ index: 2, rule: 'not-an-object' }])
  assert.equal((await ctx.call('POST', '/groups/trip/expenses', asPost(expense()))).body.id, 1)
  assert.equal((await ctx.call('POST', '/groups/trip/payments', asPost(payment()))).body.id, 1)
}))
