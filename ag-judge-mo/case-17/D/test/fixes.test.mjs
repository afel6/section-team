import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { startApp, tempDataFile } from './helpers.mjs'
import { trip, withTrip } from './import-fixtures.mjs'

const item = (amount, extra = {}) => ({ description: 'Item', payer: 'Ann', amount, ...extra })
const all = ['Ann', 'Ben', 'Cara']

const post = async (call, body) => {
  const res = await call('POST', '/groups/trip/expenses', body)
  assert.equal(res.status, 201)
  return res.body
}

const getBody = async (call, path) => {
  const res = await call('GET', path)
  assert.equal(res.status, 200)
  return res.body
}

test('an expense of 4.35 is shown as 4.35, not 4.34', () => withTrip(async ({ call }) => {
  const shown = { id: 1, description: 'Item', payer: 'Ann', amount: 4.35, split: all, shares: { Ann: 1.45, Ben: 1.45, Cara: 1.45 } }
  assert.deepEqual(await post(call, item(4.35)), shown)
  assert.deepEqual(await getBody(call, '/groups/trip/expenses'), { expenses: [shown] })
}))

test('a payment of 4.35 is shown as 4.35, not 4.34', () => withTrip(async ({ call }) => {
  const created = await call('POST', '/groups/trip/payments', { from: 'Ben', to: 'Ann', amount: 4.35 })
  assert.equal(created.status, 201)
  const shown = { id: 1, from: 'Ben', to: 'Ann', amount: 4.35 }
  assert.deepEqual(created.body, shown)
  assert.deepEqual(await getBody(call, '/groups/trip/payments'), { payments: [shown] })
}))

test('the data file stores 4.35 as 435 cents', () => withTrip(async ({ call, file }) => {
  await post(call, item(4.35))
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).expenses, [
    { id: 1, group: 'trip', description: 'Item', payer: 'Ann', amount: 435, split: all },
  ])
}))

test('a 10.00 expense gives the spare cent to the first person in the default split', () => withTrip(async ({ call }) => {
  assert.deepEqual(await post(call, item(10)), {
    id: 1, description: 'Item', payer: 'Ann', amount: 10, split: all, shares: { Ann: 3.34, Ben: 3.33, Cara: 3.33 },
  })
}))

test('a 10.00 expense gives the spare cent to the first person in a given split', () => withTrip(async ({ call }) => {
  const split = ['Cara', 'Ann', 'Ben']
  assert.deepEqual(await post(call, item(10, { split })), {
    id: 1, description: 'Item', payer: 'Ann', amount: 10, split, shares: { Cara: 3.34, Ann: 3.33, Ben: 3.33 },
  })
}))

test('balances after a 10.00 expense paid by Ann', () => withTrip(async ({ call }) => {
  await post(call, item(10))
  assert.deepEqual(await getBody(call, '/groups/trip/balances'), { balances: { Ann: 6.66, Ben: -3.33, Cara: -3.33 } })
}))

test('balances still add up to 0 cents after several uneven expenses', () => withTrip(async ({ call }) => {
  await post(call, item(10))
  await post(call, item(0.01))
  await post(call, item(7.77, { split: ['Ben', 'Cara'] }))
  await post(call, item(100))
  const body = await getBody(call, '/groups/trip/balances')
  assert.deepEqual(body, { balances: { Ann: 81.09, Ben: -40.55, Cara: -40.54 } })
  assert.equal(Object.values(body.balances).reduce((s, v) => s + Math.round(v * 100), 0), 0)
}))

test('settle-up after a 10.00 expense asks Ben and Cara for 3.33 each', () => withTrip(async ({ call }) => {
  await post(call, item(10))
  assert.deepEqual(await getBody(call, '/groups/trip/settle-up'), {
    payments: [{ from: 'Ben', to: 'Ann', amount: 3.33 }, { from: 'Cara', to: 'Ann', amount: 3.33 }],
  })
}))

const oldTaxi = { id: 1, group: 'trip', description: 'Taxi', payer: 'Ann', amount: 434, split: all }

function writeOldData(file) {
  const old = { groups: [trip], expenses: [oldTaxi], payments: [], nextExpenseId: 2, nextPaymentId: 1 }
  writeFileSync(file, JSON.stringify(old, null, 2) + '\n')
}

async function startOnOldData(t) {
  const data = tempDataFile()
  let app
  // One hook, so the server stops before its folder is deleted, and the folder goes even if the start fails.
  t.after(async () => {
    await app?.stop()
    data.cleanup()
  })
  writeOldData(data.file)
  app = await startApp(data.file)
  return { app, file: data.file }
}

test('an existing data file is read as it is and not rewritten by a GET', async t => {
  const { app, file } = await startOnOldData(t)
  const before = readFileSync(file, 'utf8')
  assert.deepEqual(await getBody(app.call, '/groups/trip/expenses'), {
    expenses: [{
      id: 1, description: 'Taxi', payer: 'Ann', amount: 4.34, split: all, shares: { Ann: 1.45, Ben: 1.45, Cara: 1.44 },
    }],
  })
  assert.equal(readFileSync(file, 'utf8'), before)
})

test('an existing 434 cent expense keeps its value after a new expense is added', async t => {
  const { app, file } = await startOnOldData(t)
  await post(app.call, item(4.35))
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).expenses, [
    oldTaxi,
    { id: 2, group: 'trip', description: 'Item', payer: 'Ann', amount: 435, split: all },
  ])
})
