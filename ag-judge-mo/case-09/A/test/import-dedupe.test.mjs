// POST /groups/:id/import: the duplicate and already-recorded rules, and skip_recorded.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { expense, expenseBody, importInto, payment, rejected, snapshot, withTrip } from './import-fixtures.mjs'

const record = async (call, fields = {}, groupId = 'trip') => {
  const res = await call('POST', `/groups/${groupId}/expenses`, expenseBody(fields))
  assert.equal(res.status, 201)
}

const expectProblems = async (call, entries, problems, extra = {}) => {
  const res = await importInto(call, { entries, ...extra })
  assert.equal(res.status, 422)
  assert.deepEqual(res.body, rejected(problems))
}

const expectAccepted = async (call, entries, extra = {}) => {
  const res = await importInto(call, { entries, ...extra })
  assert.equal(res.status, 201)
  return res.body
}

const DUP_1 = [{ index: 1, rule: 'duplicate' }]

test('duplicate in one import: case differs only', () =>
  withTrip(({ call }) =>
    expectProblems(call, [expense({ description: 'Hotel' }), expense({ description: 'HOTEL' })], DUP_1)))

test('duplicate in one import: surrounding whitespace differs only', () =>
  withTrip(({ call }) =>
    expectProblems(call, [expense({ description: 'Hotel' }), expense({ description: '  Hotel\t' })], DUP_1)))

test('duplicate in one import: case and whitespace differ', () =>
  withTrip(({ call }) =>
    expectProblems(call, [expense({ description: 'hotel' }), expense({ description: ' HoTeL ' })], DUP_1)))

test('duplicate in one import: identical entries', () =>
  withTrip(({ call }) => expectProblems(call, [expense(), expense()], DUP_1)))

test('not duplicate: inner whitespace differs', () =>
  withTrip(async ({ call }) => {
    const body = await expectAccepted(call, [expense({ description: 'Ho tel' }), expense({ description: 'Hotel' })])
    assert.deepEqual(body.expenses.map(e => e.id), [1, 2])
  }))

test('not duplicate: payer differs', () =>
  withTrip(async ({ call }) => {
    const body = await expectAccepted(call, [expense(), expense({ payer: 'Ben' })])
    assert.deepEqual(body.expenses.map(e => e.id), [1, 2])
  }))

test('not duplicate: amount differs by one cent', () =>
  withTrip(async ({ call }) => {
    const body = await expectAccepted(call, [expense({ amount: 90 }), expense({ amount: 90.01 })])
    assert.deepEqual(body.expenses.map(e => e.id), [1, 2])
  }))

test('not duplicate: description differs', () =>
  withTrip(async ({ call }) => {
    const body = await expectAccepted(call, [expense(), expense({ description: 'Fuel' })])
    assert.deepEqual(body.expenses.map(e => e.id), [1, 2])
  }))

test('duplicate ignores split', () =>
  withTrip(({ call }) => expectProblems(call, [expense({ split: ['Ann'] }), expense()], DUP_1)))

test('duplicate with a fractional amount: 1.15 twice is a duplicate, 1.15 and 1.16 are not', () =>
  withTrip(async ({ call }) => {
    await expectProblems(call, [expense({ amount: 1.15 }), expense({ amount: 1.15 })], DUP_1)
    const body = await expectAccepted(call, [expense({ amount: 1.15 }), expense({ amount: 1.16 })])
    assert.deepEqual(body.expenses.map(e => e.id), [1, 2])
  }))

test('an earlier entry with bad-split does not count for duplicate', () =>
  withTrip(({ call }) =>
    expectProblems(call, [expense({ split: ['Dan'] }), expense()], [{ index: 0, rule: 'bad-split' }])))

test('an earlier entry with unknown-field does not count for duplicate', () =>
  withTrip(({ call }) =>
    expectProblems(call, [expense({ foo: 1 }), expense()], [{ index: 0, rule: 'unknown-field' }])))

test('an earlier entry with bad-amount does not count for duplicate', () =>
  withTrip(({ call }) =>
    expectProblems(call, [expense({ amount: 0 }), expense()], [{ index: 0, rule: 'bad-amount' }])))

test('earlier duplicates still count: three identical entries', () =>
  withTrip(({ call }) =>
    expectProblems(call, [expense(), expense(), expense()], [
      { index: 1, rule: 'duplicate' },
      { index: 2, rule: 'duplicate' },
    ])))

test('payments are never duplicate', () =>
  withTrip(async ({ call }) => {
    const body = await expectAccepted(call, [payment(), payment()])
    assert.deepEqual(body.payments, [
      { id: 1, from: 'Ben', to: 'Ann', amount: 30 },
      { id: 2, from: 'Ben', to: 'Ann', amount: 30 },
    ])
  }))

test('payments are never already-recorded', () =>
  withTrip(async ({ call }) => {
    const { status } = await call('POST', '/groups/trip/payments', { from: 'Ben', to: 'Ann', amount: 30 })
    assert.equal(status, 201)
    const body = await expectAccepted(call, [payment()])
    assert.deepEqual(body.payments, [{ id: 2, from: 'Ben', to: 'Ann', amount: 30 }])
  }))

test('already-recorded: same payer, amount and description', () =>
  withTrip(async ({ call }) => {
    await record(call)
    await expectProblems(call, [expense()], [{ index: 0, rule: 'already-recorded' }])
  }))

test('already-recorded: description differs by case and whitespace', () =>
  withTrip(async ({ call }) => {
    await record(call)
    for (const description of [' hotel ', 'HOTEL']) {
      await expectProblems(call, [expense({ description })], [{ index: 0, rule: 'already-recorded' }])
    }
  }))

test('already-recorded: amount 4.35 matches in cents', () =>
  withTrip(async ({ call }) => {
    await record(call, { amount: 4.35 })
    await expectProblems(call, [expense({ amount: 4.35 })], [{ index: 0, rule: 'already-recorded' }])
  }))

test('already-recorded: split is not compared', () =>
  withTrip(async ({ call }) => {
    await record(call, { split: ['Ann', 'Ben'] })
    await expectProblems(call, [expense({ split: ['Cara'] })], [{ index: 0, rule: 'already-recorded' }])
  }))

test('not already-recorded: recorded in another group', () =>
  withTrip(async ({ call }) => {
    const created = await call('POST', '/groups', { id: 'flat', name: 'Flat', members: ['Ann', 'Ben', 'Cara'] })
    assert.equal(created.status, 201)
    await record(call, {}, 'flat')
    const body = await expectAccepted(call, [expense()])
    assert.deepEqual(body.expenses.map(e => e.id), [2])
  }))

test('not already-recorded: the recorded expense was deleted', () =>
  withTrip(async ({ call }) => {
    await record(call)
    const deleted = await call('DELETE', '/groups/trip/expenses/1')
    assert.equal(deleted.status, 204)
    const body = await expectAccepted(call, [expense()])
    assert.deepEqual(body.expenses.map(e => e.id), [2])
  }))

test('already-recorded follows a PATCH of the amount', () =>
  withTrip(async ({ call }) => {
    await record(call)
    const patched = await call('PATCH', '/groups/trip/expenses/1', { amount: 60 })
    assert.equal(patched.status, 200)
    await expectProblems(call, [expense({ amount: 60 })], [{ index: 0, rule: 'already-recorded' }])
    const body = await expectAccepted(call, [expense({ amount: 90 })])
    assert.deepEqual(body.expenses.map(e => e.id), [2])
  }))

const BOTH = [
  { index: 0, rule: 'already-recorded' },
  { index: 1, rule: 'duplicate' },
]

test('a recorded expense sent twice: already-recorded, then duplicate (skip_recorded false)', () =>
  withTrip(async ({ call }) => {
    await record(call)
    await expectProblems(call, [expense(), expense()], BOTH, { skip_recorded: false })
  }))

test('a recorded expense sent twice: already-recorded, then duplicate (skip_recorded absent)', () =>
  withTrip(async ({ call }) => {
    await record(call)
    await expectProblems(call, [expense(), expense()], BOTH)
  }))

test('a recorded expense sent twice with skip_recorded: the first is skipped, the second is still a duplicate', () =>
  withTrip(async ({ call }) => {
    await record(call)
    await expectProblems(call, [expense(), expense()], DUP_1, { skip_recorded: true })
  }))

test('skip_recorded skips only already-recorded entries', () =>
  withTrip(async ({ call }) => {
    await record(call)
    await expectProblems(call, [expense(), expense({ amount: 0 })], [{ index: 1, rule: 'bad-amount' }], {
      skip_recorded: true,
    })
  }))

test('skip_recorded true: skips recorded entries and imports the rest', () =>
  withTrip(async ({ call }) => {
    await record(call)
    await record(call, { description: 'Fuel', payer: 'Ben', amount: 30 })
    const entries = [
      expense(),
      expense({ description: 'Taxi', amount: 12 }),
      expense({ description: 'Fuel', payer: 'Ben', amount: 30 }),
      payment(),
    ]
    const res = await importInto(call, { entries, skip_recorded: true })
    assert.equal(res.status, 201)
    assert.deepEqual(res.body, {
      expenses: [
        {
          id: 3,
          description: 'Taxi',
          payer: 'Ann',
          amount: 12,
          split: ['Ann', 'Ben', 'Cara'],
          shares: { Ann: 4, Ben: 4, Cara: 4 },
        },
      ],
      payments: [{ id: 1, from: 'Ben', to: 'Ann', amount: 30 }],
      skipped: [0, 2],
      balances: { Ann: 28, Ben: 16, Cara: -44 },
    })
  }))

test('all entries skipped: nothing is written', () =>
  withTrip(async ({ call, file }) => {
    await record(call)
    const before = snapshot(file)
    const res = await importInto(call, { entries: [expense()], skip_recorded: true })
    assert.equal(res.status, 201)
    assert.deepEqual(res.body, { expenses: [], payments: [], skipped: [0], balances: { Ann: 60, Ben: -30, Cara: -30 } })
    assert.deepEqual(snapshot(file), before)
  }))

test('all entries skipped with dry_run: 200 and nothing is written', () =>
  withTrip(async ({ call, file }) => {
    await record(call)
    const before = snapshot(file)
    const res = await importInto(call, { entries: [expense()], skip_recorded: true, dry_run: true })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { expenses: [], payments: [], skipped: [0], balances: { Ann: 60, Ben: -30, Cara: -30 } })
    assert.deepEqual(snapshot(file), before)
  }))

test('all entries skipped: two recorded expenses', () =>
  withTrip(async ({ call, file }) => {
    await record(call)
    await record(call, { description: 'Fuel', payer: 'Ben', amount: 30 })
    const before = snapshot(file)
    const entries = [expense(), expense({ description: 'Fuel', payer: 'Ben', amount: 30 })]
    const res = await importInto(call, { entries, skip_recorded: true })
    assert.equal(res.status, 201)
    assert.deepEqual(res.body, {
      expenses: [],
      payments: [],
      skipped: [0, 1],
      balances: { Ann: 50, Ben: -10, Cara: -40 },
    })
    assert.deepEqual(snapshot(file), before)
  }))
