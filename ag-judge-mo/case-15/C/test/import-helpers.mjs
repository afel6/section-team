// Shared fixtures for the POST /groups/:id/import suites. Not a test file itself (no `.test.` in its name).
import assert from 'node:assert/strict'
import { readdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { startApp, tempDataFile } from './helpers.mjs'

export const trip = { id: 'trip', name: 'Ski trip', members: ['Ann', 'Ben', 'Cara'] }
export const flat = { id: 'flat', name: 'Flat', members: ['Ann', 'Ben', 'Cara'] }

export const expense = (fields = {}) => ({ type: 'expense', description: 'Hotel', payer: 'Ann', amount: 90, ...fields })
export const payment = (fields = {}) => ({ type: 'payment', from: 'Ben', to: 'Ann', amount: 30, ...fields })

// A copy of entry with key left out, so the key is absent rather than undefined.
export const without = (entry, key) => Object.fromEntries(Object.entries(entry).filter(([k]) => k !== key))

export const AMOUNT_ERROR = 'amount must be a number from 0.01 to 1000000 with at most 2 decimals'

// Runs fn(call, file) on a fresh app whose groups (default: trip) already exist, then stops it and cleans up.
export async function withGroups(fn, groups = [trip]) {
  const data = tempDataFile()
  const app = await startApp(data.file)
  try {
    for (const group of groups) assert.equal((await app.call('POST', '/groups', group)).status, 201)
    await fn(app.call, data.file)
  } finally {
    await app.stop()
    data.cleanup()
  }
}

export const importInto = (call, body, groupId = 'trip') => call('POST', `/groups/${groupId}/import`, body)

// Sends entries and asserts the exact 422 reply.
export async function assertRejected(call, body, problems) {
  const r = await importInto(call, body)
  assert.equal(r.status, 422, JSON.stringify(r.body))
  assert.deepEqual(r.body, { error: 'import rejected', problems })
}

// Sends body and asserts the exact 400 reply.
export async function assertBadRequest(call, body, error, groupId = 'trip') {
  const r = await importInto(call, body, groupId)
  assert.equal(r.status, 400, `${typeof body === 'string' ? body : JSON.stringify(body)} -> ${r.text}`)
  assert.deepEqual(r.body, { error })
}

// Pairs [entry, rule] become the entries to send and the problems expected back (rule null: no problem).
export function casesToBody(cases, extra = {}) {
  const entries = cases.map(([entry]) => entry)
  const problems = cases.flatMap(([, rule], index) => (rule ? [{ index, rule }] : []))
  return { body: { entries, ...extra }, problems }
}

// Deletes the data file; assertNothingWritten then proves no save (nor temp file) happened since.
export const deleteDataFile = file => rmSync(file)
export const assertNothingWritten = file => assert.deepEqual(readdirSync(dirname(file)), [])

// What the API shows for a group: its expenses, payments and balances.
export async function snapshot(call, groupId = 'trip') {
  const get = async path => (await call('GET', `/groups/${groupId}/${path}`)).body
  return { ...(await get('expenses')), ...(await get('payments')), ...(await get('balances')) }
}

// Ids the next POST expense and POST payment get (records them in flat, so trip is unaffected).
export async function nextIds(call) {
  const e = await call('POST', '/groups/flat/expenses', { description: 'Probe', payer: 'Ann', amount: 1 })
  const p = await call('POST', '/groups/flat/payments', { from: 'Ben', to: 'Ann', amount: 1 })
  assert.equal(e.status, 201)
  assert.equal(p.status, 201)
  return { expense: e.body.id, payment: p.body.id }
}
