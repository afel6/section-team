// POST /groups/:id/import: what a passing import records and replies, skip_recorded and dry_run.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  assertNothingWritten, assertRejected, expense, flat, deleteDataFile, importInto, nextIds, payment, snapshot, trip,
  withGroups,
} from './import-helpers.mjs'

const everyone = trip.members
const taxi = expense({ description: 'Taxi', payer: 'Ben', amount: 20 })
const dinner = expense({ description: 'Dinner', payer: 'Cara', amount: 10 })

// Records E1 (flat), Hotel as E2 (trip) and P1 (flat), so the next ids are E3 and P2.
async function recordHistory(call) {
  assert.equal((await call('POST', '/groups/flat/expenses', { description: 'Rent', payer: 'Ann', amount: 1 })).body.id, 1)
  assert.equal((await call('POST', '/groups/trip/expenses', { description: 'Hotel', payer: 'Ann', amount: 90 })).body.id, 2)
  assert.equal((await call('POST', '/groups/flat/payments', { from: 'Ben', to: 'Ann', amount: 1 })).body.id, 1)
}

test('import: ids count on per kind in entry order, skipped entries take none', () => withGroups(async call => {
  await recordHistory(call)
  const body = { entries: [taxi, expense(), payment(), dinner], skip_recorded: true }
  const expected = {
    expenses: [
      { id: 3, description: 'Taxi', payer: 'Ben', amount: 20, split: everyone, shares: { Ann: 6.67, Ben: 6.67, Cara: 6.66 } },
      { id: 4, description: 'Dinner', payer: 'Cara', amount: 10, split: everyone, shares: { Ann: 3.34, Ben: 3.33, Cara: 3.33 } },
    ],
    payments: [{ id: 2, from: 'Ben', to: 'Ann', amount: 30 }],
    skipped: [1],
    balances: { Ann: 19.99, Ben: 10, Cara: -29.99 },
  }
  const r = await importInto(call, body)
  assert.equal(r.status, 201)
  assert.equal(r.headers.get('content-type'), 'application/json')
  assert.deepEqual(r.body, expected)
  assert.deepEqual(await snapshot(call), {
    expenses: [{ id: 2, description: 'Hotel', payer: 'Ann', amount: 90, split: everyone, shares: { Ann: 30, Ben: 30, Cara: 30 } },
      ...expected.expenses],
    payments: expected.payments,
    balances: expected.balances,
  })
  assert.deepEqual(await nextIds(call), { expense: 5, payment: 3 })
}, [trip, flat]))

test('import: replies, lists and the data file match what the POST routes give', () => withGroups((callA, fileA) =>
  withGroups(async (callB, fileB) => {
    const items = [
      expense({ description: ' Taxi ', amount: 10 }),
      expense({ description: 'Gum', payer: 'Cara', amount: 0.29, split: ['Cara', 'Ann'] }),
      payment({ amount: 4.35 }),
      expense({ description: 'Ferry', payer: 'Ben', amount: 1.15, split: ['Ben'] }),
    ]
    const posted = []
    for (const { type, ...fields } of items) {
      const r = await callA('POST', `/groups/trip/${type}s`, fields)
      assert.equal(r.status, 201)
      posted.push(r.body)
    }
    const r = await importInto(callB, { entries: items })
    assert.equal(r.status, 201)
    assert.deepEqual(r.body, {
      expenses: [posted[0], posted[1], posted[3]],
      payments: [posted[2]],
      skipped: [],
      balances: (await callA('GET', '/groups/trip/balances')).body.balances,
    })
    assert.deepEqual(r.body.expenses[0].shares, { Ann: 3.34, Ben: 3.33, Cara: 3.33 })
    assert.deepEqual(r.body.expenses[1].shares, { Cara: 0.15, Ann: 0.14 })
    assert.deepEqual(await snapshot(callB), await snapshot(callA))
    assert.deepEqual(JSON.parse(readFileSync(fileB, 'utf8')), JSON.parse(readFileSync(fileA, 'utf8')))
  })))

test('import: balances come back in the group\'s member order and add up to 0', () => {
  const odd = { id: 'odd', name: 'Odd order', members: ['Cara', 'Ann', 'Ben'] }
  return withGroups(async call => {
    const r = await importInto(call, { entries: [expense({ amount: 10 })] }, 'odd')
    assert.equal(r.status, 201)
    assert.deepEqual(Object.keys(r.body.balances), odd.members)
    assert.deepEqual(r.body.balances, { Cara: -3.34, Ann: 6.67, Ben: -3.33 })
    assert.deepEqual((await call('GET', '/groups/odd/balances')).body, { balances: r.body.balances })
  }, [odd])
})

test('import: skip_recorded leaves out only entries whose first broken rule is already-recorded', () => withGroups(async (call, file) => {
  await recordHistory(call)
  deleteDataFile(file)
  await assertRejected(call, { entries: [expense({ split: null }), expense({ bogus: 1 }), expense({ amount: '90' })], skip_recorded: true },
    [{ index: 0, rule: 'bad-split' }, { index: 1, rule: 'unknown-field' }, { index: 2, rule: 'bad-amount' }])
  await assertRejected(call, { entries: [expense(), expense({ payer: 'Dan' })], skip_recorded: true }, [{ index: 1, rule: 'bad-payer' }])
  assertNothingWritten(file)
  const r = await importInto(call, { entries: [taxi, expense({ description: ' hotel ', split: ['Ben'] })], skip_recorded: true })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.skipped, [1])
  assert.deepEqual(r.body.expenses.map(e => [e.id, e.description]), [[3, 'Taxi']])
}, [trip, flat]))

test('import: when every entry is skipped the reply is 201 with empty lists and nothing is written', () => withGroups(async (call, file) => {
  await recordHistory(call)
  assert.equal((await call('POST', '/groups/trip/expenses', { description: 'Taxi', payer: 'Ben', amount: 20 })).body.id, 3)
  const before = await snapshot(call)
  deleteDataFile(file)
  const entries = [expense({ description: 'TAXI', payer: 'Ben', amount: 20 }), expense()]
  const expected = { expenses: [], payments: [], skipped: [0, 1], balances: before.balances }
  for (const [dryRun, status] of [[true, 200], [false, 201]]) {
    const r = await importInto(call, { entries, skip_recorded: true, dry_run: dryRun })
    assert.equal(r.status, status)
    assert.deepEqual(r.body, expected)
  }
  assertNothingWritten(file)
  assert.deepEqual(await snapshot(call), before)
  assert.deepEqual(await nextIds(call), { expense: 4, payment: 2 })
}, [trip, flat]))

test('import: dry_run replies 200 with the body a real import gets, and saves nothing', () => withGroups(async (call, file) => {
  await recordHistory(call)
  const before = await snapshot(call)
  deleteDataFile(file)
  const body = { entries: [taxi, expense(), payment(), dinner], skip_recorded: true }
  const dry = await importInto(call, { ...body, dry_run: true })
  assert.equal(dry.status, 200)
  assert.deepEqual(dry.body.expenses.map(e => e.id), [3, 4])
  assert.deepEqual(dry.body.payments.map(p => p.id), [2])
  assertNothingWritten(file)
  assert.deepEqual(await snapshot(call), before)
  const again = await importInto(call, { ...body, dry_run: true })
  assert.deepEqual([again.status, again.body], [200, dry.body])
  const real = await importInto(call, body)
  assert.equal(real.status, 201)
  assert.deepEqual(real.body, dry.body)
}, [trip, flat]))

test('import: after a dry run the next POSTs get the ids the dry run showed', () => withGroups(async call => {
  await recordHistory(call)
  const dry = await importInto(call, { entries: [payment(), taxi], dry_run: true })
  assert.equal(dry.status, 200)
  assert.deepEqual(await nextIds(call), { expense: dry.body.expenses[0].id, payment: dry.body.payments[0].id })
  assert.deepEqual(await nextIds(call), { expense: 4, payment: 3 })
}, [trip, flat]))

test('import: dry_run gets the same errors as a real import, and saves nothing', () => withGroups(async (call, file) => {
  await recordHistory(call)
  deleteDataFile(file)
  const cases = [
    ['trip', { entries: [] }], ['trip', { entries: [expense()], bogus: 1 }], ['trip', { entries: [expense()], skip_recorded: 'yes' }],
    ['trip', { entries: [null, payment({ to: 'Ben' }), expense(), taxi, taxi] }], ['nope', { entries: [expense()] }],
    ['trip', { entries: [expense(), expense({ payer: 'Dan' })], skip_recorded: true }],
  ]
  for (const [groupId, body] of cases) {
    const real = await importInto(call, body, groupId)
    const dry = await importInto(call, { ...body, dry_run: true }, groupId)
    assert.notEqual(real.status, 201, JSON.stringify(body))
    assert.deepEqual([dry.status, dry.body], [real.status, real.body], JSON.stringify(body))
  }
  assertNothingWritten(file)
}, [trip, flat]))
