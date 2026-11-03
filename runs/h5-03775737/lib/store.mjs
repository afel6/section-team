// The data file: { groups, expenses, payments, nextExpenseId, nextPaymentId } as JSON.
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'

export const emptyStore = () => ({ groups: [], expenses: [], payments: [], nextExpenseId: 1, nextPaymentId: 1 })

const hasShape = data =>
  Array.isArray(data?.groups) &&
  Array.isArray(data.expenses) &&
  Array.isArray(data.payments) &&
  Number.isInteger(data.nextExpenseId) &&
  Number.isInteger(data.nextPaymentId)

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
  if (!hasShape(data)) throw new Error(`data file ${file} has an unexpected shape`)
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
