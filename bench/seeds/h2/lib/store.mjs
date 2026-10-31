// The data file: { items, reservations, nextReservationId } as JSON.
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'

const emptyStore = () => ({ items: [], reservations: [], nextReservationId: 1 })

// Reads the store from file. A missing file is an empty store; a damaged file is an error.
export function load(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return emptyStore()
    throw err
  }
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`data file ${file} is not valid JSON`)
  }
  if (!Array.isArray(data?.items) || !Array.isArray(data.reservations) || !Number.isInteger(data.nextReservationId)) {
    throw new Error(`data file ${file} has an unexpected shape`)
  }
  return data
}

// Writes the store atomically: a temp file next to the target, then a rename over it.
export function save(file, data) {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n')
  try {
    renameSync(tmp, file)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}
