// The data file: { "nextId": <next booking id>, "bookings": [<booking>, ...] } as JSON, bookings in creation order.
import { readFileSync, writeFileSync } from 'node:fs'
import { checkFields, findConflict } from './bookings.mjs'

const BOOKING_KEYS = ['date', 'end', 'id', 'room', 'start', 'title']

export const emptyState = () => ({ nextId: 1, bookings: [] })

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)

// Reads the state from file. ENOENT (the file or a folder on its path is missing) is the empty state;
// any other read error, or content not in the layout saveState writes, throws.
export function loadState(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return emptyState()
    throw err
  }
  return parseState(text)
}

// A stored booking is one this server could have created: exact keys, an id below nextId, every rule met.
function isStoredBooking(b, nextId) {
  if (!isPlainObject(b) || Object.keys(b).sort().join() !== BOOKING_KEYS.join()) return false
  if (!Number.isSafeInteger(b.id) || b.id < 1 || b.id >= nextId) return false
  const { fields } = checkFields(b)
  return fields !== undefined && fields.title === b.title
}

// Parses and checks the data file's text; throws an Error when it is not in this server's layout.
export function parseState(text) {
  const data = JSON.parse(text)
  if (!isPlainObject(data) || !Number.isSafeInteger(data.nextId) || data.nextId < 1 || !Array.isArray(data.bookings)) {
    throw new Error('data file is not in the bookings layout')
  }
  const bookings = []
  for (const b of data.bookings) {
    const clash = !isStoredBooking(b, data.nextId) || bookings.some(o => o.id === b.id) || findConflict(bookings, b)
    if (clash) throw new Error('data file holds an invalid booking')
    bookings.push({ id: b.id, room: b.room, title: b.title, date: b.date, start: b.start, end: b.end })
  }
  return { nextId: data.nextId, bookings }
}

// Writes the whole state. Never creates folders: a missing folder throws ENOENT.
export function saveState(file, state) {
  writeFileSync(file, `${JSON.stringify(state)}\n`)
}
