// POST /groups/:id/import: the checks on the request as a whole (413, not an object, 404, 400), in order.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertNothingSaved, capture, expense, payment, withTrip } from './import-fixtures.mjs'

const ENTRIES_ERROR = { error: 'entries must be an array of 1 to 50 items' }
const DRY_RUN_ERROR = { error: 'dry_run must be true or false' }
const SKIP_ERROR = { error: 'skip_recorded must be true or false' }
const MAX_BODY_BYTES = 10 * 1024

// Sends body (an object, or raw JSON text) and asserts the exact status and reply, and that nothing was saved.
async function assertRefused(ctx, body, status, reply, group = 'trip') {
  const before = await capture(ctx)
  const r = await ctx.importInto(body, group)
  assert.equal(r.status, status, typeof body === 'string' ? body : JSON.stringify(body))
  assert.deepEqual(r.body, reply)
  await assertNothingSaved(ctx, before)
}

// Raw JSON text of exactly `bytes` bytes for a valid one-payment import, padded with spaces inside the object.
function paddedBody(bytes) {
  const text = JSON.stringify({ entries: [payment()] })
  return `${text.slice(0, -1)}${' '.repeat(bytes - Buffer.byteLength(text))}}`
}

test('import: an unknown group is 404 not found, before any check of the body fields', () => withTrip(async ctx => {
  const notFound = { error: 'not found' }
  await assertRefused(ctx, { entries: [expense()] }, 404, notFound, 'nope')
  await assertRefused(ctx, { bogus: 1, entries: 'x', dry_run: null }, 404, notFound, 'nope')
  await assertRefused(ctx, { entries: [null] }, 404, notFound, 'nope')
}))

test('import: a body that is not a JSON object is 400, even for an unknown group', () => withTrip(async ctx => {
  for (const text of ['[]', '[{"entries": []}]', 'null', '"entries"', '7', 'true']) {
    await assertRefused(ctx, text, 400, { error: 'body must be a JSON object' })
    await assertRefused(ctx, text, 400, { error: 'body must be a JSON object' }, 'nope')
  }
  await assertRefused(ctx, '{"entries": [', 400, { error: 'invalid JSON' })
}))

test('import: a body over 10 KB is 413; exactly 10 KB is accepted', () => withTrip(async ctx => {
  await assertRefused(ctx, paddedBody(MAX_BODY_BYTES + 1), 413, { error: 'body too large' })
  await assertRefused(ctx, paddedBody(MAX_BODY_BYTES + 1), 413, { error: 'body too large' }, 'nope')
  const r = await ctx.importInto(paddedBody(MAX_BODY_BYTES))
  assert.equal(r.status, 201)
  assert.deepEqual(r.body, {
    expenses: [], payments: [{ id: 1, from: 'Ben', to: 'Ann', amount: 30 }], skipped: [], balances: { Ann: -30, Ben: 30, Cara: 0 },
  })
}))

test('import: an unknown body field is 400 naming the first one in Object.keys order', () => withTrip(async ctx => {
  const entries = [expense()]
  await assertRefused(ctx, { entries, extra: 1 }, 400, { error: 'unknown field extra' })
  await assertRefused(ctx, { zeta: 1, entries, alpha: 2 }, 400, { error: 'unknown field zeta' })
  // Integer-like keys come first in Object.keys, whatever their place in the text.
  await assertRefused(ctx, '{"entries": [], "b": 1, "2": 1}', 400, { error: 'unknown field 2' })
  await assertRefused(ctx, `{"__proto__": {}, "entries": ${JSON.stringify(entries)}}`, 400, { error: 'unknown field __proto__' })
  for (const name of ['Entries', 'dryRun', 'dry_run ', 'skip-recorded', 'type', '']) {
    await assertRefused(ctx, { entries, [name]: false }, 400, { error: `unknown field ${name}` })
  }
}))

test('import: an unknown field is reported before bad entries and bad flags', () => withTrip(async ctx => {
  await assertRefused(ctx, { dry_run: 'x', entries: 'x', extra: null }, 400, { error: 'unknown field extra' })
}))

test('import: entries must be an array of 1 to 50 items', () => withTrip(async ctx => {
  const fiftyOne = Array.from({ length: 51 }, () => payment())
  for (const entries of [undefined, null, {}, { 0: payment() }, 'entries', 1, true, [], fiftyOne]) {
    await assertRefused(ctx, { entries }, 400, ENTRIES_ERROR)
  }
  await assertRefused(ctx, {}, 400, ENTRIES_ERROR)
}))

test('import: 50 entries are accepted, each with its own id', () => withTrip(async ({ importInto }) => {
  const r = await importInto({ entries: Array.from({ length: 50 }, () => payment()) })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body, {
    expenses: [],
    payments: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, from: 'Ben', to: 'Ann', amount: 30 })),
    skipped: [],
    balances: { Ann: -1500, Ben: 1500, Cara: 0 },
  })
}))

test('import: a bad entries list is reported before bad flags', () => withTrip(async ctx => {
  await assertRefused(ctx, { dry_run: 'x', skip_recorded: 'x', entries: [] }, 400, ENTRIES_ERROR)
  await assertRefused(ctx, { skip_recorded: null, dry_run: null, entries: [expense()] }, 400, DRY_RUN_ERROR)
}))

test('import: dry_run and skip_recorded must be booleans when given, null included', () => withTrip(async ctx => {
  const entries = [expense()]
  for (const value of [null, 'true', 'false', 0, 1, '', [], {}, [true]]) {
    await assertRefused(ctx, { entries, dry_run: value }, 400, DRY_RUN_ERROR)
    await assertRefused(ctx, { entries, skip_recorded: value }, 400, SKIP_ERROR)
    await assertRefused(ctx, { entries, dry_run: true, skip_recorded: value }, 400, SKIP_ERROR)
  }
}))

test('import: flags given as false behave as left out and the import is saved', () => withTrip(async ({ call, importInto }) => {
  const r = await importInto({ entries: [expense()], dry_run: false, skip_recorded: false })
  assert.equal(r.status, 201)
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body, { expenses: r.body.expenses })
}))

test('import: entries with bad fields and an unknown group are still 404 first', () => withTrip(async ctx => {
  await assertRefused(ctx, { entries: [expense({ amount: 0 })] }, 404, { error: 'not found' }, 'Trip')
}))
