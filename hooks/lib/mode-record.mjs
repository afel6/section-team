import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { MODES, RETIRED_MODE, assertMode } from './mode.mjs'

// The mode each session runs in, kept per session so later hooks can tell when the project's mode changed
// and the handback gate can keep the session's mode when the mode file breaks mid-session.

// The id becomes a file name, so only plain characters pass.
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function modeRecordDir(home) {
  return `${home}/.claude/section-team/modes`
}

// Whether the session id can be a file name.
export const isSessionId = sessionId => typeof sessionId === 'string' && SESSION_ID_PATTERN.test(sessionId)

// Throws one line unless the session id can be a file name.
export function assertSessionId(sessionId) {
  if (!isSessionId(sessionId)) throw new Error('no usable session id (letters, digits, - and _ only)')
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

// The JSON in a record's text, or null when it is not JSON (each reader reports that as an invalid record).
function jsonOrNull(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// A record file's text, or null when it does not exist; another read error keeps its code.
function recordText(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch (err) {
    if (err?.code === 'ENOENT') return null
    throw err
  }
}

// The mode in a record's text. Throws one line when the text is not a record recordMode could have written.
function parseRecord(text) {
  const data = jsonOrNull(text)
  if (data?.mode === RETIRED_MODE) return RETIRED_MODE // a record written before 0.3.0: callers run it with activeMode
  if (!MODES.includes(data?.mode)) throw new Error('mode record is not valid')
  return data.mode
}

// The mode the session last ran in (a record from before 0.3.0 may say lean: see activeMode), or null when it has no record yet (a session from before 0.2.0, or a record never written).
// Throws one line on a bad session id or an invalid record; another read error keeps its code.
export function readRecord(home, sessionId) {
  const text = recordText(modeRecordFile(home, sessionId))
  return text === null ? null : parseRecord(text)
}

// The sha256 hex of the brief a session was given, so a resume can leave out a brief that has not changed.
const BRIEF_HASH_PATTERN = /^[0-9a-f]{64}$/

// The file that keeps one session's brief hash, next to its mode record (pruneStatus prunes both). Throws one line on a bad session id.
function briefRecordFile(home, sessionId) {
  assertSessionId(sessionId)
  return `${modeRecordDir(home)}/${sessionId}.brief.json`
}

// Saves the hash of the brief a session was given as {"brief":"<hex>"}. Throws one line on a bad session id.
export function recordBriefHash(home, sessionId, hash) {
  const file = briefRecordFile(home, sessionId)
  mkdirSync(modeRecordDir(home), { recursive: true })
  writeFileSync(file, JSON.stringify({ brief: hash }))
}

// The brief hash recordBriefHash saved, or null when the session has none.
// Throws one line on a bad session id or an invalid record; another read error keeps its code.
export function readBriefHash(home, sessionId) {
  const text = recordText(briefRecordFile(home, sessionId))
  if (text === null) return null
  const brief = jsonOrNull(text)?.brief
  if (typeof brief !== 'string' || !BRIEF_HASH_PATTERN.test(brief)) throw new Error('brief record is not valid')
  return brief
}
