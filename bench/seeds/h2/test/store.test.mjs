import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { load, save } from '../lib/store.mjs'
import { tempDataFile } from './helpers.mjs'

test('load returns an empty store when the file does not exist', t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  assert.deepEqual(load(data.file), { items: [], reservations: [], nextReservationId: 1 })
})

test('save then load returns the same data and leaves no temp file', t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  const store = { items: [{ sku: 'A-1', name: 'A', qty: 2, reserved: 1 }], reservations: [{ id: 1, sku: 'A-1', qty: 1 }], nextReservationId: 2 }
  save(data.file, store)
  assert.deepEqual(load(data.file), store)
  assert.deepEqual(readdirSync(dirname(data.file)), ['stock.json'])
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
  writeFileSync(data.file, '{"items": {}}')
  assert.throws(() => load(data.file), /unexpected shape/)
})
