// The data file: { "nextId": <n>, "polls": [{ id, question, closed, answers: [text], votes: [{ voter, answer }] }] }.
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'

export const emptyStore = () => ({ nextId: 1, polls: [] })

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const isVote = v => isObject(v) && typeof v.voter === 'string' && Number.isInteger(v.answer)
const isPoll = p => isObject(p) && Number.isInteger(p.id) && typeof p.question === 'string' && typeof p.closed === 'boolean' &&
  Array.isArray(p.answers) && p.answers.every(a => typeof a === 'string') && Array.isArray(p.votes) && p.votes.every(isVote)
const isStore = d => isObject(d) && Number.isInteger(d.nextId) && Array.isArray(d.polls) && d.polls.every(isPoll)

// Reads the store. A missing file (or folder) is an empty store; anything else that goes wrong throws.
export function loadStore(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return emptyStore()
    throw err
  }
  const data = JSON.parse(text)
  if (!isStore(data)) throw new Error('the data file does not hold polls')
  return data
}

// Writes the store atomically: a temp file next to the target, then a rename over it. Never creates folders.
export function saveStore(file, store) {
  const tmp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`)
    renameSync(tmp, file)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}
