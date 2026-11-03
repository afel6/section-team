import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startApp, tempDataFile, withApp } from './helpers.mjs'

const trip = { id: 'trip', name: 'Ski trip', members: ['Ann', 'Ben', 'Cara'] }
const hotel = { description: 'Hotel', payer: 'Ann', amount: 90 }

test('POST /groups creates a group, GET /groups/:id returns it', () => withApp(async call => {
  const r = await call('POST', '/groups', trip)
  assert.equal(r.status, 201)
  assert.deepEqual(r.body, trip)
  assert.deepEqual((await call('GET', '/groups/trip')).body, trip)
}))

test('POST /groups refuses an existing id with 409, and keeps the first group', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const r = await call('POST', '/groups', { ...trip, name: 'Other' })
  assert.equal(r.status, 409)
  assert.deepEqual(r.body, { error: 'group already exists' })
  assert.equal((await call('GET', '/groups/trip')).body.name, 'Ski trip')
}))

test('POST /groups refuses a bad id, name or member list with 400', () => withApp(async call => {
  for (const bad of [{ id: 'Trip' }, { name: '' }, { members: ['Ann'] }, { members: ['Ann', 'Ann'] }]) {
    const r = await call('POST', '/groups', { ...trip, ...bad })
    assert.equal(r.status, 400, JSON.stringify(bad))
    assert.equal(typeof r.body.error, 'string')
  }
}))

test('GET on an unknown group is 404 not found', () => withApp(async call => {
  for (const path of ['/groups/nope', '/groups/nope/expenses', '/groups/nope/payments', '/groups/nope/balances', '/groups/nope/settle-up']) {
    const r = await call('GET', path)
    assert.equal(r.status, 404, path)
    assert.deepEqual(r.body, { error: 'not found' })
  }
}))

test('POST /groups/:id/expenses splits between every member by default', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const r = await call('POST', '/groups/trip/expenses', hotel)
  assert.equal(r.status, 201)
  assert.deepEqual(r.body, { id: 1, ...hotel, split: trip.members, shares: { Ann: 30, Ben: 30, Cara: 30 } })
}))

test('POST /groups/:id/expenses takes a split of some members', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const r = await call('POST', '/groups/trip/expenses', { description: 'Fuel', payer: 'Ben', amount: 12.5, split: ['Cara', 'Ben'] })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body.shares, { Cara: 6.25, Ben: 6.25 })
}))

test('POST /groups/:id/expenses keeps 4.35 as 4.35, and uneven shares add up to the amount', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const coffee = await call('POST', '/groups/trip/expenses', { description: 'Coffee', payer: 'Ann', amount: 4.35 })
  assert.equal(coffee.body.amount, 4.35)
  await call('DELETE', '/groups/trip/expenses/1')
  const taxi = await call('POST', '/groups/trip/expenses', { description: 'Taxi', payer: 'Ann', amount: 10 })
  assert.deepEqual(taxi.body.shares, { Ann: 3.34, Ben: 3.33, Cara: 3.33 })
  assert.deepEqual((await call('GET', '/groups/trip/balances')).body, { balances: { Ann: 6.66, Ben: -3.33, Cara: -3.33 } })
}))

test('POST /groups/:id/expenses refuses bad fields with 400, and 404 for an unknown group', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const cases = [
    [{ description: ' ' }, 'description must be a non-empty string of at most 200 characters'],
    [{ payer: 'Dan' }, 'payer must be a member of the group'],
    [{ amount: 0 }, 'amount must be a number from 0.01 to 1000000 with at most 2 decimals'],
    [{ amount: 1.234 }, 'amount must be a number from 0.01 to 1000000 with at most 2 decimals'],
    [{ split: ['Ann', 'Dan'] }, 'split must be a non-empty list of different members of the group'],
  ]
  for (const [bad, error] of cases) {
    const r = await call('POST', '/groups/trip/expenses', { ...hotel, ...bad })
    assert.equal(r.status, 400, JSON.stringify(bad))
    assert.deepEqual(r.body, { error })
  }
  assert.equal((await call('POST', '/groups/nope/expenses', hotel)).status, 404)
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body, { expenses: [] })
}))

test('GET /groups/:id/expenses lists the group\'s expenses by id', () => withApp(async call => {
  await call('POST', '/groups', trip)
  await call('POST', '/groups', { ...trip, id: 'flat' })
  await call('POST', '/groups/trip/expenses', hotel)
  await call('POST', '/groups/flat/expenses', { ...hotel, description: 'Rent' })
  await call('POST', '/groups/trip/expenses', { ...hotel, description: 'Skis', amount: 60 })
  const r = await call('GET', '/groups/trip/expenses')
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.expenses.map(e => [e.id, e.description]), [[1, 'Hotel'], [3, 'Skis']])
}))

test('PATCH /groups/:id/expenses/:id changes only the fields it is given', () => withApp(async call => {
  await call('POST', '/groups', trip)
  await call('POST', '/groups/trip/expenses', hotel)
  const r = await call('PATCH', '/groups/trip/expenses/1', { amount: 60, split: ['Ann', 'Ben'] })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { id: 1, description: 'Hotel', payer: 'Ann', amount: 60, split: ['Ann', 'Ben'], shares: { Ann: 30, Ben: 30 } })
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body, { expenses: [r.body] })
  assert.deepEqual((await call('GET', '/groups/trip/balances')).body, { balances: { Ann: 30, Ben: -30, Cara: 0 } })
}))

test('PATCH refuses a bad field with 400 and changes nothing; 404 for an unknown expense', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const before = (await call('POST', '/groups/trip/expenses', hotel)).body
  const r = await call('PATCH', '/groups/trip/expenses/1', { description: 'Rooms', amount: -1 })
  assert.equal(r.status, 400)
  assert.deepEqual(r.body, { error: 'amount must be a number from 0.01 to 1000000 with at most 2 decimals' })
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body, { expenses: [before] })
  assert.equal((await call('PATCH', '/groups/trip/expenses/9', { amount: 5 })).status, 404)
  assert.equal((await call('PATCH', '/groups/nope/expenses/1', { amount: 5 })).status, 404)
}))

test('DELETE /groups/:id/expenses/:id removes the expense, then 404', () => withApp(async call => {
  await call('POST', '/groups', trip)
  await call('POST', '/groups/trip/expenses', hotel)
  const r = await call('DELETE', '/groups/trip/expenses/1')
  assert.equal(r.status, 204)
  assert.equal(r.text, '')
  assert.deepEqual((await call('GET', '/groups/trip/expenses')).body, { expenses: [] })
  assert.equal((await call('DELETE', '/groups/trip/expenses/1')).status, 404)
}))

test('POST /groups/:id/payments records a payment; GET lists them', () => withApp(async call => {
  await call('POST', '/groups', trip)
  const r = await call('POST', '/groups/trip/payments', { from: 'Ben', to: 'Ann', amount: 30 })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body, { id: 1, from: 'Ben', to: 'Ann', amount: 30 })
  assert.deepEqual((await call('GET', '/groups/trip/payments')).body, { payments: [r.body] })
}))

test('POST /groups/:id/payments refuses a payment to oneself or to a stranger', () => withApp(async call => {
  await call('POST', '/groups', trip)
  for (const bad of [{ from: 'Ann', to: 'Ann', amount: 5 }, { from: 'Ann', to: 'Dan', amount: 5 }]) {
    const r = await call('POST', '/groups/trip/payments', bad)
    assert.equal(r.status, 400)
    assert.deepEqual(r.body, { error: 'from and to must be two different members of the group' })
  }
}))

test('GET /groups/:id/balances adds up expenses and payments', () => withApp(async call => {
  await call('POST', '/groups', trip)
  await call('POST', '/groups/trip/expenses', hotel)
  await call('POST', '/groups/trip/payments', { from: 'Ben', to: 'Ann', amount: 30 })
  const r = await call('GET', '/groups/trip/balances')
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { balances: { Ann: 30, Ben: 0, Cara: -30 } })
}))

test('GET /groups/:id/settle-up suggests payments without recording them', () => withApp(async call => {
  await call('POST', '/groups', { ...trip, members: ['Ann', 'Ben', 'Cara', 'Dev'] })
  await call('POST', '/groups/trip/expenses', { description: 'Hotel', payer: 'Ann', amount: 120 })
  await call('POST', '/groups/trip/expenses', { description: 'Fuel', payer: 'Cara', amount: 20, split: ['Ben', 'Dev'] })
  const r = await call('GET', '/groups/trip/settle-up')
  assert.equal(r.status, 200)
  assert.deepEqual(r.body, { payments: [
    { from: 'Ben', to: 'Ann', amount: 40 },
    { from: 'Dev', to: 'Ann', amount: 40 },
    { from: 'Cara', to: 'Ann', amount: 10 },
  ] })
  assert.deepEqual((await call('GET', '/groups/trip/payments')).body, { payments: [] })
}))

test('bad JSON, a non-object body and unknown routes are refused', () => withApp(async call => {
  const bad = await call('POST', '/groups', '{"id": ')
  assert.equal(bad.status, 400)
  assert.deepEqual(bad.body, { error: 'invalid JSON' })
  assert.deepEqual((await call('POST', '/groups', '[1, 2]')).body, { error: 'body must be a JSON object' })
  const unknown = await call('GET', '/nothing-here')
  assert.equal(unknown.status, 404)
  assert.deepEqual(unknown.body, { error: 'not found' })
}))

test('a body over 10 KB is refused with 413', () => withApp(async call => {
  const r = await call('POST', '/groups', { ...trip, name: 'x'.repeat(11 * 1024) })
  assert.equal(r.status, 413)
  assert.deepEqual(r.body, { error: 'body too large' })
  assert.equal((await call('GET', '/groups/trip')).status, 404)
}))

test('data survives a restart on the same data file', async t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  const first = await startApp(data.file)
  await first.call('POST', '/groups', trip)
  await first.call('POST', '/groups/trip/expenses', hotel)
  await first.stop()
  const second = await startApp(data.file)
  t.after(second.stop)
  assert.deepEqual((await second.call('GET', '/groups/trip/balances')).body, { balances: { Ann: 60, Ben: -30, Cara: -30 } })
  const next = await second.call('POST', '/groups/trip/expenses', { ...hotel, description: 'Skis' })
  assert.equal(next.body.id, 2)
})

test('a failed save answers 500 and logs one line, not a stack', async t => {
  const data = tempDataFile()
  const app = await startApp(data.file)
  t.after(app.stop)
  data.cleanup() // the folder is gone, so the save fails with ENOENT
  const logged = t.mock.method(console, 'error', () => {})
  const r = await app.call('POST', '/groups', trip)
  assert.equal(r.status, 500)
  assert.deepEqual(r.body, { error: 'internal error' })
  assert.deepEqual(logged.mock.calls.map(c => c.arguments), [[`ENOENT open ${data.file}.${process.pid}.tmp`]])
})

// Runs server.mjs on dataFile until it exits; one that starts instead is killed after 5 s.
function runServer(dataFile) {
  const server = fileURLToPath(new URL('../server.mjs', import.meta.url))
  const env = { ...process.env, PORT: '0', DATA_FILE: dataFile }
  return spawnSync(process.execPath, [server], { env, encoding: 'utf8', timeout: 5000 })
}

test('the server will not start on a DATA_FILE in a missing folder, or on a folder', t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  const folder = dirname(data.file)
  const missing = join(folder, 'missing', 'groups.json')
  for (const [file, line] of [
    [missing, `cannot start: folder for DATA_FILE ${missing} does not exist`],
    [folder, `cannot start: DATA_FILE ${folder} is a folder, not a file`],
  ]) {
    const r = runServer(file)
    assert.equal(r.status, 1, file)
    assert.equal(r.stdout, '')
    assert.equal(r.stderr, `${line}\n`)
  }
})
