import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { emptyState, loadState, parseState, saveState } from '../lib/store.mjs'
import { tempDir } from './helpers.mjs'

const stored = (overrides = {}) => ({
  id: 1, room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00', ...overrides,
})
const text = (bookings, nextId = 5) => JSON.stringify({ nextId, bookings })

test('saveState then loadState gives the same state back', () => {
  const { dir, cleanup } = tempDir()
  try {
    const file = join(dir, 'data.json')
    const state = { nextId: 4, bookings: [stored({ id: 3 }), stored({ id: 1, room: 'Cosmos' })] }
    saveState(file, state)
    assert.deepEqual(loadState(file), state)
  } finally {
    cleanup()
  }
})

test('loadState: a missing file, or a missing folder on its path, is the empty state', () => {
  const { dir, cleanup } = tempDir()
  try {
    assert.deepEqual(loadState(join(dir, 'none.json')), emptyState())
    assert.deepEqual(loadState(join(dir, 'no-folder', 'none.json')), emptyState())
  } finally {
    cleanup()
  }
})

test('loadState throws for a folder, and saveState never creates folders', () => {
  const { dir, cleanup } = tempDir()
  try {
    mkdirSync(join(dir, 'folder'))
    assert.throws(() => loadState(join(dir, 'folder')))
    assert.throws(() => saveState(join(dir, 'no-folder', 'data.json'), emptyState()), { code: 'ENOENT' })
  } finally {
    cleanup()
  }
})

test('parseState rejects content that is not in the layout the server writes', () => {
  const bad = ['', ' ', 'not json', 'null', '[]', '"x"', '1', '{}', '{"nextId":1}', '{"nextId":0,"bookings":[]}',
    '{"nextId":1.5,"bookings":[]}', '{"nextId":"1","bookings":[]}', `﻿${text([])}`,
    text([stored({ id: 5 })]), text([stored({ id: 0 })]), text([stored(), stored({ room: 'Cosmos' })]),
    text([{ ...stored(), extra: 1 }]), text([stored({ title: ' padded ' })]), text([stored({ room: 'Mars' })]),
    text([stored({ start: '10:00' })]), text([stored(), stored({ id: 2, start: '09:30', end: '10:30' })]), text([null])]
  for (const t of bad) assert.throws(() => parseState(t), undefined, JSON.stringify(t))
})

test('parseState accepts touching bookings and keeps the next id', () => {
  const list = [stored(), stored({ id: 3, start: '10:00', end: '11:00' })]
  assert.deepEqual(parseState(text(list, 7)), { nextId: 7, bookings: list })
})

test('loadState reads a file without writing it', () => {
  const { dir, cleanup } = tempDir()
  try {
    const file = join(dir, 'data.json')
    writeFileSync(file, text([stored()]))
    const state = loadState(file)
    assert.equal(readFileSync(file, 'utf8'), text([stored()]), 'loading does not write')
    assert.deepEqual(state.bookings, [stored()])
  } finally {
    cleanup()
  }
})
