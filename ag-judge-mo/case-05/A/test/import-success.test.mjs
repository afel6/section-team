import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { startApp, tempDataFile, withApp } from './helpers.mjs'

const trip = { id: 'trip', name: 'Ski trip', members: ['Ann', 'Ben', 'Cara'] }
const E = { type: 'expense', description: 'Hotel', payer: 'Ann', amount: 90 }
const P = { type: 'payment', from: 'Ben', to: 'Ann', amount: 30 }
const skis = { type: 'expense', description: 'Skis', payer: 'Ben', amount: 60 }
const IMPORT = '/groups/trip/import'

const plain = ({ type, ...fields }) => fields
const ids = list => list.map(item => item.id)

async function setup(call, extra = []) {
  await call('POST', '/groups', trip)
  for (const entry of extra) {
    await call('POST', `/groups/trip/${entry.type}s`, plain(entry))
  }
}

test('import answers 201 with the new expenses, payments, skipped and balances', () => withApp(async call => {
  await setup(call)
  const r = await call('POST', IMPORT, { entries: [E, P] })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body, {
    expenses: [{ id: 1, description: 'Hotel', payer: 'Ann', amount: 90, split: ['Ann', 'Ben', 'Cara'], shares: { Ann: 30, Ben: 30, Cara: 30 } }],
    payments: [{ id: 1, from: 'Ben', to: 'Ann', amount: 30 }],
    skipped: [],
    balances: { Ann: 30, Ben: 0, Cara: -30 },
  })
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body, { expenses: r.body.expenses })
  assert.deepEqual((await call('GET', '/groups/trip/payments')).body, { payments: r.body.payments })
  assert.deepEqual((await call('GET', '/groups/trip/balances')).body, { balances: r.body.balances })
}))

test('balances keep group order even when the import names Cara first', () => withApp(async call => {
  await setup(call)
  const r = await call('POST', IMPORT, { entries: [{ type: 'payment', from: 'Cara', to: 'Ben', amount: 5 }] })
  assert.equal(r.status, 201)
  assert.deepEqual(Object.keys(r.body.balances), ['Ann', 'Ben', 'Cara'])
  assert.deepEqual(r.body.balances, { Ann: 0, Ben: -5, Cara: 5 })
}))

test('imported expenses look exactly like POSTed ones apart from the id', async () => {
  const cases = [
    { description: 'Lunch', payer: 'Ann', amount: 10, split: ['Cara', 'Ben'] },
    { description: 'Lunch', payer: 'Ann', amount: 10 },
  ]
  for (const body of cases) {
    let posted
    await withApp(async call => {
      await setup(call)
      posted = (await call('POST', '/groups/trip/expenses', body)).body
    })
    await withApp(async call => {
      await setup(call)
      const r = await call('POST', IMPORT, { entries: [{ type: 'expense', ...body }] })
      assert.deepEqual(r.body.expenses, [{ ...posted, id: 1 }])
      assert.deepEqual(Object.entries(r.body.expenses[0].shares), Object.entries(posted.shares))
    })
  }
  await withApp(async call => {
    await setup(call)
    const a = await call('POST', IMPORT, { entries: [{ type: 'expense', description: 'Lunch', payer: 'Ann', amount: 10, split: ['Cara', 'Ben'] }] })
    assert.deepEqual(Object.entries(a.body.expenses[0].shares), [['Cara', 5], ['Ben', 5]])
    const b = await call('POST', IMPORT, { entries: [{ type: 'expense', description: 'Other', payer: 'Ann', amount: 10 }] })
    assert.deepEqual(b.body.expenses[0].shares, { Ann: 3.34, Ben: 3.33, Cara: 3.33 })
  })
})

test('description is kept as given and amounts are not rounded down', () => withApp(async call => {
  await setup(call)
  const r = await call('POST', IMPORT, { entries: [{ ...E, description: '  Taxi ', amount: 4.35 }] })
  assert.equal(r.status, 201)
  assert.equal(r.body.expenses[0].description, '  Taxi ')
  assert.equal(r.body.expenses[0].amount, 4.35)
}))

test('ids are consecutive per kind, global across groups and never reused', () => withApp(async call => {
  await setup(call)
  await call('POST', '/groups', { ...trip, id: 'flat' })
  const flat = (kind, body) => call('POST', `/groups/flat/${kind}`, body)
  await flat('expenses', plain(E))
  await flat('expenses', plain(skis))
  assert.equal((await call('POST', '/groups/trip/expenses', plain(E))).body.id, 3)
  await call('DELETE', '/groups/trip/expenses/3')
  await flat('payments', plain(P))
  const r = await call('POST', IMPORT, { entries: [E, P, { ...E, description: 'Skis' }, { ...P, amount: 5 }] })
  assert.equal(r.status, 201)
  assert.deepEqual(ids(r.body.expenses), [4, 5])
  assert.deepEqual(ids(r.body.payments), [2, 3])
  assert.equal((await call('POST', '/groups/trip/expenses', plain(skis))).body.id, 6)
  assert.equal((await call('POST', '/groups/trip/payments', plain(P))).body.id, 4)
}))

test('skip_recorded skips a recorded expense and numbers the rest in entry order', () => withApp(async call => {
  await setup(call, [E])
  const fuel = { type: 'expense', description: 'Fuel', payer: 'Ben', amount: 20 }
  const food = { type: 'expense', description: 'Food', payer: 'Cara', amount: 12 }
  const r = await call('POST', IMPORT, { entries: [fuel, E, P, food], skip_recorded: true })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.expenses.map(e => [e.id, e.description]), [[2, 'Fuel'], [3, 'Food']])
  assert.deepEqual(ids(r.body.payments), [1])
  assert.deepEqual(r.body.skipped, [1])
  assert.equal((await call('POST', '/groups/trip/expenses', plain(skis))).body.id, 4)
  assert.equal((await call('POST', '/groups/trip/payments', plain(P))).body.id, 2)
}))

test('skipped lists indexes in ascending order, and is [] when none', () => withApp(async call => {
  const fuel = { type: 'expense', description: 'Fuel', payer: 'Cara', amount: 20 }
  await setup(call, [E, skis, fuel])
  const fresh = { type: 'expense', description: 'Food', payer: 'Cara', amount: 12 }
  const r = await call('POST', IMPORT, { entries: [E, fresh, skis, fuel], skip_recorded: true })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.skipped, [0, 2, 3])
  assert.deepEqual(ids(r.body.expenses), [4])
  const none = await call('POST', IMPORT, { entries: [{ ...fresh, description: 'Other' }], skip_recorded: true })
  assert.deepEqual(none.body.skipped, [])
}))

function snapshot(file) {
  return { bytes: readFileSync(file), mtime: statSync(file).mtimeMs, dir: readdirSync(dirname(file)) }
}

test('an import that skips everything writes nothing', async t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  const app = await startApp(data.file)
  t.after(app.stop)
  await setup(app.call, [E, skis])
  const before = snapshot(data.file)
  const entries = [E, { type: 'expense', description: 'SKIS', payer: 'Ben', amount: 60 }]
  const balances = (await app.call('GET', '/groups/trip/balances')).body.balances
  for (const [extra, status] of [[{}, 201], [{ dry_run: true }, 200]]) {
    const r = await app.call('POST', IMPORT, { entries, skip_recorded: true, ...extra })
    assert.equal(r.status, status)
    assert.deepEqual(r.body, { expenses: [], payments: [], skipped: [0, 1], balances })
    const after = snapshot(data.file)
    assert.deepEqual(after.bytes, before.bytes)
    assert.equal(after.mtime, before.mtime)
    assert.deepEqual(after.dir, before.dir)
  }
})

test('an import is saved, survives a restart, and leaves no tmp file', async t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  const first = await startApp(data.file)
  await setup(first.call)
  const r = await first.call('POST', IMPORT, { entries: [E, P] })
  await first.stop()
  const second = await startApp(data.file)
  t.after(second.stop)
  assert.deepEqual((await second.call('GET', '/groups/trip/expenses')).body, { expenses: r.body.expenses })
  assert.deepEqual((await second.call('GET', '/groups/trip/payments')).body, { payments: r.body.payments })
  assert.deepEqual((await second.call('GET', '/groups/trip/balances')).body, { balances: r.body.balances })
  assert.equal((await second.call('POST', '/groups/trip/expenses', plain(skis))).body.id, 2)
  assert.equal((await second.call('POST', '/groups/trip/payments', plain(P))).body.id, 2)
  assert.deepEqual(readdirSync(dirname(data.file)).filter(name => name.endsWith('.tmp')), [])
})

test('dry_run answers 200 with the body a real import then gives, and saves nothing', async t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  const app = await startApp(data.file)
  t.after(app.stop)
  const { call } = app
  await setup(call, [E, P])
  const lists = async () => [(await call('GET', '/groups/trip/expenses')).body, (await call('GET', '/groups/trip/payments')).body]
  const listsBefore = await lists()
  const bytesBefore = readFileSync(data.file)
  const entries = [{ ...E, description: 'Skis' }, P]
  const dry = await call('POST', IMPORT, { entries, dry_run: true })
  assert.equal(dry.status, 200)
  assert.deepEqual(await lists(), listsBefore)
  assert.deepEqual(readFileSync(data.file), bytesBefore)
  const real = await call('POST', IMPORT, { entries })
  assert.equal(real.status, 201)
  assert.deepEqual(real.body, dry.body)
  assert.deepEqual(ids(real.body.expenses), [2])
  assert.deepEqual(ids(real.body.payments), [2])
})

test('after a dry run the next POST gets the first id the dry run showed', () => withApp(async call => {
  await setup(call, [E])
  const dry = await call('POST', IMPORT, { entries: [{ ...E, description: 'Skis' }], dry_run: true })
  assert.deepEqual(ids(dry.body.expenses), [2])
  assert.equal((await call('POST', '/groups/trip/expenses', plain(skis))).body.id, 2)
}))

test('dry_run false behaves like an absent dry_run', () => withApp(async call => {
  await setup(call)
  const r = await call('POST', IMPORT, { entries: [E], dry_run: false })
  assert.equal(r.status, 201)
  assert.deepEqual(ids((await call('GET', '/groups/trip/expenses')).body.expenses), [1])
}))

test('skip_recorded false still rejects a recorded expense', () => withApp(async call => {
  await setup(call, [E])
  const r = await call('POST', IMPORT, { entries: [E], skip_recorded: false })
  assert.equal(r.status, 422)
  assert.deepEqual(r.body, { error: 'import rejected', problems: [{ index: 0, rule: 'already-recorded' }] })
}))

test('an import of 50 entries works', () => withApp(async call => {
  await setup(call)
  const r = await call('POST', IMPORT, { entries: Array.from({ length: 50 }, () => P) })
  assert.equal(r.status, 201)
  assert.deepEqual(ids(r.body.payments), Array.from({ length: 50 }, (_, i) => i + 1))
}))

test('identical payments are all imported', () => withApp(async call => {
  await setup(call)
  const r = await call('POST', IMPORT, { entries: [P, P, P] })
  assert.equal(r.status, 201)
  assert.deepEqual(ids(r.body.payments), [1, 2, 3])
  assert.deepEqual(r.body.balances, { Ann: -90, Ben: 90, Cara: 0 })
}))

test('a payment like one already recorded is imported, even with skip_recorded', () => withApp(async call => {
  await setup(call, [P])
  const r = await call('POST', IMPORT, { entries: [P], skip_recorded: true })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.payments, [{ id: 2, from: 'Ben', to: 'Ann', amount: 30 }])
  assert.deepEqual(r.body.skipped, [])
}))
