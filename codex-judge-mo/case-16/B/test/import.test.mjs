// POST /groups/:id/import: the body checks (413, 400, 404) and the per-entry rules (422).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  assertBadRequest, assertNothingWritten, assertRejected, casesToBody, expense, flat, deleteDataFile, importInto,
  nextIds, payment, snapshot, trip, withGroups, without,
} from './import-helpers.mjs'

const MAX_BODY_BYTES = 10 * 1024
const ENTRIES_ERROR = 'entries must be an array of 1 to 50 items'
const NOT_BOOLEANS = [null, 'true', 'false', 1, 0, '', [], {}]
// n different expenses, so none is a duplicate of another.
const many = n => Array.from({ length: n }, (_, i) => expense({ description: `Item ${i}` }))

test('import: a body over 10 KB is 413 even for an unknown group; exactly 10 KB is read', () => withGroups(async (call, file) => {
  const json = JSON.stringify({ entries: [expense()] })
  const exact = json + ' '.repeat(MAX_BODY_BYTES - Buffer.byteLength(json))
  deleteDataFile(file)
  for (const groupId of ['trip', 'nope']) {
    const r = await importInto(call, exact + ' ', groupId)
    assert.equal(r.status, 413)
    assert.deepEqual(r.body, { error: 'body too large' })
  }
  assertNothingWritten(file)
  assert.equal((await importInto(call, exact)).status, 201)
}))

test('import: a body that is not a JSON object is 400, even for an unknown group', () => withGroups(async (call, file) => {
  deleteDataFile(file)
  const cases = [['[]', 'body must be a JSON object'], ['[{"entries": []}]', 'body must be a JSON object'],
    ['null', 'body must be a JSON object'], ['"entries"', 'body must be a JSON object'], ['5', 'body must be a JSON object'],
    ['true', 'body must be a JSON object'], ['{"entries": [', 'invalid JSON'], ['', 'invalid JSON']]
  for (const [text, error] of cases) {
    for (const groupId of ['trip', 'nope']) await assertBadRequest(call, text, error, groupId)
  }
  assertNothingWritten(file)
}))

test('import: an unknown group is 404 before any check of the body\'s fields', () => withGroups(async call => {
  const bodies = [{}, { bogus: 1 }, { entries: 'x' }, { entries: [] }, { entries: [null] },
    { entries: [expense()], dry_run: 'yes' }, { entries: [expense()], skip_recorded: null }, { entries: [expense()] }]
  for (const groupId of ['nope', 'Trip', 'trip-']) {
    for (const body of bodies) {
      const r = await importInto(call, body, groupId)
      assert.equal(r.status, 404, `${groupId} ${JSON.stringify(body)}`)
      assert.deepEqual(r.body, { error: 'not found' })
    }
  }
}))

test('import: the first unknown body field in Object.keys order is a 400 before every other check', () => withGroups(async (call, file) => {
  deleteDataFile(file)
  const ok = [expense()]
  const cases = [
    [{ entries: ok, zeta: 1, alpha: 2 }, 'zeta'],
    [{ alpha: 1, entries: 'bad', dry_run: 'bad' }, 'alpha'],
    [{ entries: [], dry_run: null, skip_recorded: 5, zeta: 1 }, 'zeta'],
    [{ entries: [null], beta: true }, 'beta'],
    [{ entries: ok, Entries: [] }, 'Entries'],
    [{ entries: ok, 'dry-run': true }, 'dry-run'],
    [{ entries: ok, dryRun: true }, 'dryRun'],
    [{ entries: ok, type: 'expense' }, 'type'],
    [{ entries: ok, 'café': 1 }, 'café'],
    [{ entries: ok, '': 1 }, ''],
  ]
  for (const [body, name] of cases) await assertBadRequest(call, body, `unknown field ${name}`)
  // Object.keys puts integer-like keys first, whatever their place in the JSON text.
  await assertBadRequest(call, '{"b": 1, "2": 1, "entries": []}', 'unknown field 2')
  await assertBadRequest(call, '{"__proto__": {}, "entries": []}', 'unknown field __proto__')
  assertNothingWritten(file)
}))

test('import: entries must be an array of 1 to 50 items', () => withGroups(async (call, file) => {
  deleteDataFile(file)
  const bodies = [{}, { dry_run: true }, { entries: null }, { entries: 'x' }, { entries: {} }, { entries: { 0: expense(), length: 1 } },
    { entries: 5 }, { entries: [] }, { entries: many(51) }, { entries: many(51), dry_run: 'x', skip_recorded: 'x' }]
  for (const body of bodies) await assertBadRequest(call, body, ENTRIES_ERROR)
  assertNothingWritten(file)
}))

test('import: 1 and 50 entries are accepted', () => withGroups(async call => {
  const r = await importInto(call, { entries: many(50) })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.expenses.map(e => e.id), Array.from({ length: 50 }, (_, i) => i + 1))
  const one = await importInto(call, { entries: [payment()] })
  assert.equal(one.status, 201)
  assert.deepEqual(one.body.payments, [{ id: 1, from: 'Ben', to: 'Ann', amount: 30 }])
}))

test('import: dry_run and skip_recorded must be booleans, null included, dry_run first', () => withGroups(async (call, file) => {
  deleteDataFile(file)
  for (const value of NOT_BOOLEANS) {
    await assertBadRequest(call, { entries: [expense()], dry_run: value }, 'dry_run must be true or false')
    await assertBadRequest(call, { entries: [expense()], skip_recorded: value }, 'skip_recorded must be true or false')
    await assertBadRequest(call, { skip_recorded: value, dry_run: value, entries: [expense()] }, 'dry_run must be true or false')
    await assertBadRequest(call, { entries: [null, payment({ to: 'Ben' })], skip_recorded: value }, 'skip_recorded must be true or false')
  }
  assertNothingWritten(file)
}))

test('import: dry_run and skip_recorded given as false behave as left out', () => withGroups(async (call, file) => {
  const r = await importInto(call, { entries: [expense()], dry_run: false, skip_recorded: false })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.expenses.map(e => e.id), [1])
  deleteDataFile(file)
  await assertRejected(call, { entries: [expense()], skip_recorded: false }, [{ index: 0, rule: 'already-recorded' }])
  assertNothingWritten(file)
}))

test('import: entries that are not JSON objects are not-an-object', () => withGroups(async call => {
  const { body, problems } = casesToBody([[null, 'not-an-object'], [[], 'not-an-object'], [[expense()], 'not-an-object'],
    ['expense', 'not-an-object'], [7, 'not-an-object'], [true, 'not-an-object'], [false, 'not-an-object'], [expense(), null]])
  await assertRejected(call, body, problems)
}))

test('import: a type other than "expense" or "payment" is bad-type, before unknown-field', () => withGroups(async call => {
  const { body, problems } = casesToBody([
    [without(expense(), 'type'), 'bad-type'], [expense({ type: ['expense'] }), 'bad-type'], [payment({ type: ['payment'] }), 'bad-type'],
    [expense({ type: 'Expense' }), 'bad-type'], [expense({ type: ' expense' }), 'bad-type'], [payment({ type: 'payments' }), 'bad-type'],
    [expense({ type: null }), 'bad-type'], [expense({ type: 1 }), 'bad-type'], [expense({ type: { expense: 1 } }), 'bad-type'],
    [{}, 'bad-type'], [{ bogus: 1 }, 'bad-type'], [{ type: 'toString' }, 'bad-type'], [{ type: 'constructor' }, 'bad-type'],
    [payment(), null],
  ])
  await assertRejected(call, body, problems)
}))

test('import: a field the entry\'s type does not take is unknown-field, before the field checks', () => withGroups(async call => {
  const { body, problems } = casesToBody([
    [expense({ from: 'Ben' }), 'unknown-field'], [expense({ to: 'Ben' }), 'unknown-field'], [expense({ id: 1 }), 'unknown-field'],
    [expense({ group: 'trip' }), 'unknown-field'], [expense({ Description: 'x' }), 'unknown-field'],
    [payment({ payer: 'Ann' }), 'unknown-field'], [payment({ split: ['Ann'] }), 'unknown-field'],
    [payment({ description: 'x' }), 'unknown-field'], [{ type: 'expense', note: '' }, 'unknown-field'],
    [{ type: 'payment', from: 'Dan', to: 'Dan', amount: 0, extra: null }, 'unknown-field'],
    [expense({ split: ['Cara', 'Ben'] }), null], [payment(), null],
  ])
  await assertRejected(call, body, problems)
}))

test('import: expense fields are checked in order description, payer, amount, split', () => withGroups(async call => {
  const { body, problems } = casesToBody([
    [without(expense(), 'description'), 'bad-description'], [expense({ description: null }), 'bad-description'],
    [expense({ description: '' }), 'bad-description'], [expense({ description: ' \t\n' }), 'bad-description'],
    [expense({ description: 'x'.repeat(201) }), 'bad-description'], [expense({ description: 5 }), 'bad-description'],
    [expense({ description: ['Hotel'] }), 'bad-description'],
    [without(expense(), 'payer'), 'bad-payer'], [expense({ payer: null }), 'bad-payer'], [expense({ payer: 'Dan' }), 'bad-payer'],
    [expense({ payer: 'ann' }), 'bad-payer'], [expense({ payer: ' Ann' }), 'bad-payer'], [expense({ payer: ['Ann'] }), 'bad-payer'],
    [without(expense(), 'amount'), 'bad-amount'], [expense({ amount: null }), 'bad-amount'], [expense({ amount: 0 }), 'bad-amount'],
    [expense({ amount: -1 }), 'bad-amount'], [expense({ amount: 1.234 }), 'bad-amount'], [expense({ amount: '90' }), 'bad-amount'],
    [expense({ amount: 1000000.01 }), 'bad-amount'], [expense({ amount: 0.001 }), 'bad-amount'], [expense({ amount: true }), 'bad-amount'],
    [expense({ split: null }), 'bad-split'], [expense({ split: [] }), 'bad-split'], [expense({ split: ['Ann', 'Ann'] }), 'bad-split'],
    [expense({ split: ['Dan'] }), 'bad-split'], [expense({ split: 'Ann' }), 'bad-split'], [expense({ split: {} }), 'bad-split'],
    [expense({ split: ['ann'] }), 'bad-split'], [expense({ split: [null] }), 'bad-split'],
    [expense({ description: '', payer: 'Dan', amount: 0, split: [] }), 'bad-description'],
    [expense({ payer: 'Dan', amount: 0, split: [] }), 'bad-payer'],
    [expense({ description: 'Fees', amount: 0, split: null }), 'bad-amount'],
    [expense({ description: 'x'.repeat(200), amount: 1000000, split: ['Cara'] }), null],
  ])
  await assertRejected(call, body, problems)
}))

test('import: payment fields are checked in order from, to (a member other than from), amount', () => withGroups(async call => {
  const { body, problems } = casesToBody([
    [without(payment(), 'from'), 'bad-from'], [payment({ from: null }), 'bad-from'], [payment({ from: 'Dan' }), 'bad-from'],
    [payment({ from: 'ben' }), 'bad-from'], [payment({ from: 5 }), 'bad-from'],
    [without(payment(), 'to'), 'bad-to'], [payment({ to: null }), 'bad-to'], [payment({ to: 'Dan' }), 'bad-to'],
    [payment({ to: 'Ben' }), 'bad-to'],
    [without(payment(), 'amount'), 'bad-amount'], [payment({ amount: null }), 'bad-amount'], [payment({ amount: 0 }), 'bad-amount'],
    [payment({ amount: 1.234 }), 'bad-amount'], [payment({ amount: '30' }), 'bad-amount'],
    [payment({ from: 'Dan', to: 'Dan', amount: 0 }), 'bad-from'], [payment({ to: 'Dan', amount: 0 }), 'bad-to'],
    [payment({ from: 'Ann', to: 'Ann', amount: 0 }), 'bad-to'], [payment({ from: 'Cara', to: 'Ben', amount: 0.01 }), null],
  ])
  await assertRejected(call, body, problems)
}))

test('import: one problem per bad entry, sorted by index, and nothing is saved', () => withGroups(async (call, file) => {
  const before = await snapshot(call)
  deleteDataFile(file)
  await assertRejected(call, { entries: [expense(), payment({ from: 'Dan' }), expense({ payer: 'Dan', amount: 0 }), payment(), null] }, [
    { index: 1, rule: 'bad-from' }, { index: 2, rule: 'bad-payer' }, { index: 4, rule: 'not-an-object' },
  ])
  assertNothingWritten(file)
  assert.deepEqual(await snapshot(call), before)
  assert.deepEqual(await nextIds(call), { expense: 1, payment: 1 })
}, [trip, flat]))

test('import: duplicate compares payer, cents and the trimmed, lower-cased description, not split', () => withGroups(async call => {
  const { body, problems } = casesToBody([
    [expense(), null], [expense({ description: 'hotel', split: ['Ben'] }), 'duplicate'], [expense({ description: ' Hotel' }), 'duplicate'],
    [expense({ description: 'Hotel ' }), 'duplicate'], [expense({ description: '\t HOTEL\n ' }), 'duplicate'],
    [expense({ payer: 'Ben' }), null], [expense({ amount: 90.01 }), null], [expense({ description: 'Hotel room' }), null],
    [expense({ description: 'Ho tel' }), null], [payment({ from: 'Ben', to: 'Ann', amount: 90 }), null],
    [expense({ description: 'Café', payer: 'Cara' }), null], [expense({ description: 'CAFÉ', payer: 'Cara' }), 'duplicate'],
    [expense({ description: 'Café', payer: 'Cara' }), null],
  ])
  await assertRejected(call, body, problems)
}))

test('import: an earlier entry that broke a field rule does not make a later one a duplicate', () => withGroups(async call => {
  const { body, problems } = casesToBody([
    [expense({ split: null }), 'bad-split'], [expense(), null],
    [expense({ description: 'Taxi', bogus: 1 }), 'unknown-field'], [expense({ description: 'Taxi' }), null],
    [expense({ description: 'Bus', amount: '10' }), 'bad-amount'], [expense({ description: 'Bus', amount: 10 }), null],
    [{ ...expense({ description: 'Tram' }), type: 'Expense' }, 'bad-type'], [expense({ description: 'Tram' }), null],
    [payment({ to: 'Ben' }), 'bad-to'],
  ])
  await assertRejected(call, body, problems)
}))

test('import: an earlier duplicate or already-recorded entry still counts for duplicate', () => withGroups(async call => {
  await assertRejected(call, { entries: [expense(), expense(), expense()] },
    [{ index: 1, rule: 'duplicate' }, { index: 2, rule: 'duplicate' }])
  assert.equal((await call('POST', '/groups/trip/expenses', { description: 'Hotel', payer: 'Ann', amount: 90 })).status, 201)
  await assertRejected(call, { entries: [expense(), expense({ description: 'HOTEL ' })] },
    [{ index: 0, rule: 'already-recorded' }, { index: 1, rule: 'duplicate' }])
  await assertRejected(call, { entries: [expense(), payment(), expense({ split: ['Ann'] })], skip_recorded: true },
    [{ index: 2, rule: 'duplicate' }])
}))

test('import: already-recorded compares with this group\'s current expenses only', () => withGroups(async (call, file) => {
  const post = (groupId, body) => call('POST', `/groups/${groupId}/expenses`, body)
  assert.equal((await post('trip', { description: ' HOTEL ', payer: 'Ann', amount: 90, split: ['Ann', 'Ben'] })).status, 201)
  assert.equal((await post('trip', { description: 'Coffee', payer: 'Ben', amount: 4.35 })).status, 201)
  assert.equal((await post('flat', { description: 'Rent', payer: 'Ann', amount: 500 })).status, 201)
  deleteDataFile(file)
  const { body, problems } = casesToBody([
    [expense({ description: 'hotel', split: ['Cara'] }), 'already-recorded'], [expense({ description: 'Coffee', payer: 'Ben', amount: 4.35 }), 'already-recorded'],
    [expense({ amount: 90.01 }), null], [expense({ payer: 'Ben' }), null], [expense({ description: 'Rent', amount: 500 }), null],
    [payment({ amount: 90 }), null],
  ])
  await assertRejected(call, body, problems)
  assertNothingWritten(file)
  assert.equal((await call('DELETE', '/groups/trip/expenses/1')).status, 204)
  assert.equal((await importInto(call, { entries: [expense()] })).status, 201)
  await assertRejected(call, { entries: [expense()] }, [{ index: 0, rule: 'already-recorded' }])
  assert.equal((await call('PATCH', '/groups/trip/expenses/2', { description: 'Espresso', amount: 3 })).status, 200)
  await assertRejected(call, { entries: [expense({ description: 'Coffee', payer: 'Ben', amount: 4.35 }),
    expense({ description: 'espresso', payer: 'Ben', amount: 3 })] }, [{ index: 1, rule: 'already-recorded' }])
}, [trip, flat]))

test('import: payments are never duplicate or already-recorded', () => withGroups(async call => {
  assert.equal((await call('POST', '/groups/trip/payments', { from: 'Ben', to: 'Ann', amount: 30 })).status, 201)
  const r = await importInto(call, { entries: [payment(), payment()] })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.payments, [{ id: 2, from: 'Ben', to: 'Ann', amount: 30 }, { id: 3, from: 'Ben', to: 'Ann', amount: 30 }])
}))
