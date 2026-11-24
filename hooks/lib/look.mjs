import { LOOKS } from '../office.mjs'

// The office look, saved per user beside names.json: {"v":1,"look":"yellow"}. No file means night.
export const DEFAULT_LOOK = 'night'
export const NOT_VALID_LOOK = 'office.json is not valid'
export const NO_HOME_LOOK = 'The office look needs USERPROFILE or HOME to be set.'
// The file holds one short line; anything longer is not one this plugin wrote.
const MAX_FILE = 1024
// How much of an unknown look the reply echoes back.
const MAX_ECHO = 24

export const lookFile = (home) => `${home}/.claude/section-team/office.json`
export const serializeLook = (look) => JSON.stringify({ v: 1, look })
export const LOOK_COMMAND = '/team office yellow|night'
export const describeLook = (look) => `The office is ${look}. ${LOOK_COMMAND} changes it.`

export function parseLook(text) {
  if (text == null) return { look: DEFAULT_LOOK, problem: null }
  let doc = null
  if (text.length <= MAX_FILE) {
    try { doc = JSON.parse(text) } catch { doc = null }
  }
  const good = doc !== null && typeof doc === 'object' && doc.v === 1 && LOOKS.includes(doc.look)
  return good ? { look: doc.look, problem: null } : { look: DEFAULT_LOOK, problem: NOT_VALID_LOOK }
}

// `/team office <raw>`: the reply line, and the look to save when it changes.
export function applyLook(current, raw) {
  const look = raw.toLowerCase()
  if (!LOOKS.includes(look)) return { line: `No office look called ${raw.slice(0, MAX_ECHO)}. Looks: ${LOOKS.join(', ')}.` }
  if (look === current) return { line: `The office is already ${look}.` }
  return { line: `The office is ${look} now.`, next: look }
}
