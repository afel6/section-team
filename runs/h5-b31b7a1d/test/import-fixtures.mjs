// Shared fixtures for the POST /groups/:id/import suites (not a test file itself).
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { startApp, tempDataFile } from './helpers.mjs'

export const trip = { id: 'trip', name: 'Ski trip', members: ['Ann', 'Ben', 'Cara'] }
export const flat = { id: 'flat', name: 'Flat', members: ['Ann', 'Ben', 'Cara'] }
export const everyone = trip.members

// A valid expense or payment entry, with some fields replaced.
export const expense = (over = {}) => ({ type: 'expense', description: 'Hotel', payer: 'Ann', amount: 90, ...over })
export const payment = (over = {}) => ({ type: 'payment', from: 'Ben', to: 'Ann', amount: 30, ...over })

// The same expense as POST /groups/:id/expenses takes it (no type).
export const asPost = ({ type, ...fields }) => fields

// Runs fn({ call, file, restart, importInto }) with the "trip" group created on a fresh data file.
export async function withTrip(fn) {
  const data = tempDataFile()
  let app = await startApp(data.file)
  try {
    assert.equal((await app.call('POST', '/groups', trip)).status, 201)
    const call = (...args) => app.call(...args)
    const restart = async () => {
      await app.stop()
      app = await startApp(data.file)
    }
    const importInto = (body, group = 'trip') => call('POST', `/groups/${group}/import`, body)
    await fn({ call, file: data.file, restart, importInto })
  } finally {
    await app.stop()
    data.cleanup()
  }
}

// What identifies one write of the data file: a save renames a new file over it, so the inode changes.
export function snapshot(file) {
  const { ino, mtimeMs } = statSync(file)
  return { ino, mtimeMs, text: readFileSync(file, 'utf8') }
}

// Everything the API shows about a group's ledger.
export async function ledger(call, group = 'trip') {
  const [expenses, payments, balances] = await Promise.all(
    ['expenses', 'payments', 'balances'].map(part => call('GET', `/groups/${group}/${part}`)),
  )
  return { ...expenses.body, ...payments.body, ...balances.body }
}

// Asserts that a request left the data file and the ledger exactly as they were.
export async function assertNothingSaved({ call, file }, before) {
  assert.deepEqual(snapshot(file), before.file)
  assert.deepEqual(await ledger(call), before.ledger)
}

// The data file and the ledger as they are now, for assertNothingSaved.
export async function capture({ call, file }) {
  return { file: snapshot(file), ledger: await ledger(call) }
}
