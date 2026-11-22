import { CREW } from '../creatures.mjs'
import { NAME_RE } from '../office.mjs'
import { BUILDER_IDS, ADVISOR_IDS } from './report.mjs'

export const DEFAULT_NAMES = Object.fromEntries(BUILDER_IDS.map((id) => [id, CREW[id].name]))
export const NO_HOME_LINE = 'Names need USERPROFILE or HOME to be set.'
export const UNREADABLE_LINE = 'names.json could not be read, so the default names are shown; the next rename rewrites it.'

const BAD_NAME = 'Names are 1 to 12 letters, digits, spaces or dashes, starting with a letter or digit.'
const lc = (s) => s.toLowerCase()

export const namesFile = (home) => `${home}/.claude/section-team/names.json`
export const cleanName = (raw) => raw.trim().normalize('NFC').replace(/ +/g, ' ')

// The other builder whose default or current name is `name`, ignoring case.
const ownerOf = (current, id, name) =>
  BUILDER_IDS.find((o) => o !== id && (lc(current[o]) === lc(name) || lc(DEFAULT_NAMES[o]) === lc(name)))

export function parseNames(text) {
  const names = { ...DEFAULT_NAMES }
  if (text == null) return { names, problem: null }
  let doc
  try { doc = JSON.parse(text) } catch { doc = null }
  if (!doc || doc.v !== 1 || !doc.names || typeof doc.names !== 'object' || Array.isArray(doc.names)) {
    return { names, problem: 'names.json is not valid' }
  }
  let bad = 0
  for (const [id, raw] of Object.entries(doc.names)) {
    const name = typeof raw === 'string' ? cleanName(raw) : ''
    if (!BUILDER_IDS.includes(id) || !NAME_RE.test(name) || ownerOf(names, id, name)) bad++
    else names[id] = name
  }
  return { names, problem: bad ? `names.json had ${bad} bad entr${bad === 1 ? 'y' : 'ies'}, left out` : null }
}

export function applyName(current, rawSection, raw) {
  const section = rawSection.toLowerCase()
  if (ADVISOR_IDS.includes(section)) return { line: 'Advisors have no desk to name.' }
  if (!BUILDER_IDS.includes(section)) {
    return { line: `No builder called ${section}. Builders: ${BUILDER_IDS.join(', ')}.` }
  }
  const old = current[section]
  const def = DEFAULT_NAMES[section]
  const name = raw === undefined ? def : cleanName(raw)
  if (raw !== undefined && !NAME_RE.test(name)) return { line: BAD_NAME }
  if (lc(name) === lc(def)) {
    if (old === def) return { line: `${old} already has its own name (${section}).` }
    return { line: `${old} is back to ${def} (${section}).`, next: { ...current, [section]: def } }
  }
  const owner = ownerOf(current, section, name)
  if (owner) return { line: `${name} is taken by ${owner}; pick another name.` }
  return { line: `${old} is now ${name} (${section}).`, next: { ...current, [section]: name } }
}

export const listNames = (current) => BUILDER_IDS.map((id) => `${id} ${current[id]}`).join('\n')

export const serializeNames = (current) =>
  JSON.stringify({ v: 1, names: Object.fromEntries(BUILDER_IDS.filter((id) => current[id] !== DEFAULT_NAMES[id]).map((id) => [id, current[id]])) })
