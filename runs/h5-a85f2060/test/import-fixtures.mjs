// Shared fixtures for the POST /groups/:id/import suites.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { startApp, tempDataFile } from './helpers.mjs'

export const trip = { id: 'trip', name: 'Ski trip', members: ['Ann', 'Ben', 'Cara'] }

// Import entries; fields override the defaults.
export const expense = (fields = {}) => ({ type: 'expense', description: 'Hotel', payer: 'Ann', amount: 90, ...fields })
export const payment = (fields = {}) => ({ type: 'payment', from: 'Ben', to: 'Ann', amount: 30, ...fields })

// The same expense as a body for POST /groups/:id/expenses (no type).
export const expenseBody = (fields = {}) => {
  const { type, ...body } = expense(fields)
  return body
}

export const importInto = (call, body, groupId = 'trip') => call('POST', `/groups/${groupId}/import`, body)

export const rejected = problems => ({ error: 'import rejected', problems })

// Runs fn({ call, file, restart }) with a running app whose data file already holds the trip group.
// restart() stops the app and starts a new one on the same data file; call always reaches the current app.
export async function withTrip(fn, group = trip) {
  const data = tempDataFile()
  let app
  try {
    app = await startApp(data.file)
    const created = await app.call('POST', '/groups', group)
    assert.equal(created.status, 201)
    const restart = async () => {
      await app.stop()
      app = await startApp(data.file)
    }
    await fn({ call: (...args) => app.call(...args), file: data.file, restart })
  } finally {
    await app?.stop()
    data.cleanup()
  }
}

// Every reply so far saved nothing: same data file and empty lists.
export async function assertNothingSaved({ call, file }, before) {
  assert.deepEqual(snapshot(file), before)
  const expenses = await call('GET', '/groups/trip/expenses')
  assert.equal(expenses.status, 200)
  assert.deepEqual(expenses.body, { expenses: [] })
  const payments = await call('GET', '/groups/trip/payments')
  assert.equal(payments.status, 200)
  assert.deepEqual(payments.body, { payments: [] })
}

// The next expense and the next payment still get id 1.
export async function assertNextIdsAreOne(call) {
  const expense = await call('POST', '/groups/trip/expenses', { description: 'Hotel', payer: 'Ann', amount: 90 })
  assert.equal(expense.status, 201)
  assert.deepEqual(expense.body, {
    id: 1, description: 'Hotel', payer: 'Ann', amount: 90,
    split: ['Ann', 'Ben', 'Cara'], shares: { Ann: 30, Ben: 30, Cara: 30 },
  })
  const payment = await call('POST', '/groups/trip/payments', { from: 'Ben', to: 'Ann', amount: 5 })
  assert.equal(payment.status, 201)
  assert.deepEqual(payment.body, { id: 1, from: 'Ben', to: 'Ann', amount: 5 })
}

// What changes when the data file is written: its text, its inode (a save renames a new file over it) and mtime.
// Also lists the folder, so a stray temp file shows up.
export function snapshot(file) {
  const { ino, mtimeNs } = statSync(file, { bigint: true })
  return { text: readFileSync(file, 'utf8'), ino, mtimeNs, folder: readdirSync(dirname(file)) }
}
