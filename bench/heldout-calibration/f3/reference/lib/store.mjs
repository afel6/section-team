// The data file: the whole store as JSON, written to a temp file and renamed into place.
import { readFileSync, renameSync, writeFileSync } from 'node:fs'

export const EMPTY = Object.freeze({ nextId: 1, polls: [] })

const isStore = v => v !== null && typeof v === 'object' && Number.isInteger(v.nextId) && Array.isArray(v.polls)

// The store in file, or EMPTY when there is no file; throws when the file cannot be read or is not a store.
export function load(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') return EMPTY
    throw e
  }
  const value = JSON.parse(text)
  if (!isStore(value)) throw new Error('not a store')
  return value
}

export function save(file, store) {
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(store))
  renameSync(temp, file)
}
