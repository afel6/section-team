import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { load, save } from '../lib/store.mjs'
import { tempDataFile } from './helpers.mjs'

test('load returns an empty store when the file does not exist', t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  assert.deepEqual(load(data.file), { groups: [], expenses: [], payments: [], nextExpenseId: 1, nextPaymentId: 1 })
})

test('save then load returns the same data and leaves no temp file', t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  const store = {
    groups: [{ id: 'trip', name: 'Trip', members: ['Ann', 'Ben'] }],
    expenses: [{ id: 1, group: 'trip', description: 'Fuel', payer: 'Ann', amount: 1250, split: ['Ann', 'Ben'] }],
    payments: [],
    nextExpenseId: 2,
    nextPaymentId: 1,
  }
  save(data.file, store)
  assert.deepEqual(load(data.file), store)
  assert.deepEqual(readdirSync(dirname(data.file)), ['groups.json'])
})

test('load rejects a file that is not valid JSON', t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  writeFileSync(data.file, '{ not json')
  assert.throws(() => load(data.file), /not valid JSON/)
})

test('load rejects a file with the wrong shape', t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  writeFileSync(data.file, '{"groups": [], "expenses": {}}')
  assert.throws(() => load(data.file), /unexpected shape/)
})
