// The data file: { "loans": [{ number, item, person, due, returned }] } as JSON.
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { UserError } from './rules.mjs'

export const emptyStore = () => ({ loans: [] })

// Reads the store. A missing file is an empty store; a file that is not JSON with a loans list is damaged.
export function load(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return emptyStore()
    throw new UserError(`cannot read data file ${file}`)
  }
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new UserError(`data file ${file} is damaged`)
  }
  if (!Array.isArray(data?.loans)) throw new UserError(`data file ${file} is damaged`)
  return data
}

// Writes the store atomically: a temp file next to the target, then a rename over it.
export function save(file, store) {
  const tmp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`)
    renameSync(tmp, file)
  } catch {
    rmSync(tmp, { force: true })
    throw new UserError(`cannot write data file ${file}`)
  }
}
