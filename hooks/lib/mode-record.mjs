import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { MODES, assertMode } from './mode.mjs'

// The mode each session runs in, kept per session so later hooks can tell when the project's mode changed
// and the handback gate can keep the session's mode when the mode file breaks mid-session.

// The id becomes a file name, so only plain characters pass.
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function modeRecordDir(home) {
  return `${home}/.claude/section-team/modes`
}

// Throws one line unless the session id can be a file name.
export function assertSessionId(sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) throw new Error('no usable session id (letters, digits, - and _ only)')
}

// The file that keeps one session's mode. Throws one line on a bad session id, since the id becomes the file name.
export function modeRecordFile(home, sessionId) {
  assertSessionId(sessionId)
  return `${modeRecordDir(home)}/${sessionId}.json`
}

// Saves the mode a session runs in as {"mode":"<mode>"}. Throws one line on a bad session id or an unknown mode.
export function recordMode(home, sessionId, mode) {
  const file = modeRecordFile(home, sessionId)
  assertMode(mode)
  mkdirSync(modeRecordDir(home), { recursive: true })
  writeFileSync(file, JSON.stringify({ mode }))
}

// The mode in a record's text. Throws one line when the text is not a record recordMode could have written.
function parseRecord(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = null // not JSON: reported just below as an invalid record
  }
  if (!MODES.includes(data?.mode)) throw new Error('mode record is not valid')
  return data.mode
}

// The mode the session last ran in, or null when it has no record yet (a session from before 0.2.0, or a record never written).
// Throws one line on a bad session id or an invalid record; another read error keeps its code.
export function readRecord(home, sessionId) {
  const file = modeRecordFile(home, sessionId)
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (err) {
    if (err?.code === 'ENOENT') return null
    throw err
  }
  return parseRecord(text)
}
