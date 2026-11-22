import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { SECTION_IDS } from '../hooks/lib/report.mjs'
import { isMainModule, lineOf } from '../hooks/lib/paths.mjs'

export const SKILL_NAME = /^[a-z0-9][a-z0-9._:-]{0,99}$/i
// The roster that ships with the plugin; gen-agents builds the committed agent files from it alone.
export const EXTRA_FILE = new URL('./roster-extra.json', import.meta.url)
// The user's own assignments live outside the plugin folder, which `claude plugin update` replaces.
export const userExtraFile = home => join(home, '.claude', 'section-team', 'roster-extra.json')
const USER_FILE_LABEL = '~/.claude/section-team/roster-extra.json' // what messages say: never the full home path

const USAGE = 'usage: assign-skill.mjs <skill> <section> [<section>...] | --remove <skill> | --list | --reapply'

function checkSkill(skill) {
  if (typeof skill !== 'string' || !SKILL_NAME.test(skill)) throw new Error(`invalid skill name: ${JSON.stringify(skill)} (letters, digits, . _ : -, max 100, starts with a letter or digit)`)
}

function checkSection(id) {
  if (!SECTION_IDS.includes(id)) throw new Error(`unknown section: ${id} (known: ${SECTION_IDS.join(', ')})`)
}

export function validateExtra(extra) {
  if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) throw new Error('roster-extra must be an object of section id -> skill names')
  for (const [id, skills] of Object.entries(extra)) {
    checkSection(id)
    if (!Array.isArray(skills)) throw new Error(`roster-extra ${id}: expected an array of skill names`)
    skills.forEach(checkSkill)
  }
}

const clone = extra => Object.fromEntries(Object.entries(extra).map(([id, skills]) => [id, [...skills]]))
const addTo = (extra, id, skills) => ({ ...extra, [id]: [...new Set([...(extra[id] ?? []), ...skills])] })

export function assignSkill(extra, skill, sections) {
  validateExtra(extra)
  checkSkill(skill)
  if (!Array.isArray(sections) || sections.length === 0) throw new Error('at least one section is required')
  sections.forEach(checkSection)
  return sections.reduce((acc, id) => addTo(acc, id, [skill]), clone(extra))
}

export function removeSkill(extra, skill) {
  validateExtra(extra)
  checkSkill(skill)
  return Object.fromEntries(
    Object.entries(extra)
      .map(([id, skills]) => [id, skills.filter(s => s !== skill)])
      .filter(([, skills]) => skills.length > 0),
  )
}

// The roster the installed agents are built from: the shipped one first, then the user's skills, deduped per section.
export function mergeExtra(shipped, user) {
  validateExtra(shipped)
  validateExtra(user)
  return Object.entries(user).reduce((acc, [id, skills]) => addTo(acc, id, skills), clone(shipped))
}

export function readExtra(file = EXTRA_FILE) {
  if (!existsSync(file)) return {}
  const extra = JSON.parse(readFileSync(file, 'utf8'))
  validateExtra(extra)
  return extra
}

function readUser(home) {
  try {
    return readExtra(userExtraFile(home))
  } catch (err) {
    throw new Error(`${USER_FILE_LABEL}: ${lineOf(err)}`)
  }
}

const has = (extra, skill) => Object.values(extra).some(skills => skills.includes(skill))

// Rebuilds the installed plugin's agent files from the shipped roster plus `user`; returns the file names it rewrote.
async function regenerate(user) {
  const { writeAgents } = await import('./gen-agents.mjs') // lazy: gen-agents imports this module
  const extra = mergeExtra(readExtra(), user)
  try {
    return writeAgents({ extra })
  } catch (err) {
    throw new Error(`could not write the plugin's agent files (${lineOf(err)})`)
  }
}

// Agent files first, the user's roster last: a failed agent write leaves the roster unchanged.
async function save(user, home) {
  await regenerate(user)
  const file = userExtraFile(home)
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(user, null, 2)}\n`)
  } catch (err) {
    throw new Error(`could not save ${USER_FILE_LABEL} (${lineOf(err)})`)
  }
}

async function reapply(home) {
  const count = (await regenerate(readUser(home))).length
  return `reapplied your assignments: ${count} agent file${count === 1 ? '' : 's'} updated`
}

async function remove(skill, home) {
  const user = readUser(home)
  const next = removeSkill(user, skill) // also validates the name
  if (!has(user, skill)) {
    if (has(readExtra(), skill)) throw new Error(`${skill} ships with the plugin (scripts/roster-extra.json); only skills you assigned can be removed`)
    return `not assigned: ${skill}`
  }
  await save(next, home)
  return `removed ${skill}`
}

async function assign(skill, sections, home) {
  const user = readUser(home)
  const next = assignSkill(user, skill, sections)
  const shipped = readExtra()
  const same = JSON.stringify(mergeExtra(shipped, next)) === JSON.stringify(mergeExtra(shipped, user))
  await save(next, home) // even when nothing is new: it also brings stale agent files up to date
  return `${same ? 'already assigned' : 'assigned'} ${skill} → ${sections.join(', ')}`
}

async function run([first, ...rest], home) {
  if (first === '--list' || first === '--reapply') {
    if (rest.length > 0) throw new Error(USAGE)
    return first === '--list' ? JSON.stringify(mergeExtra(readExtra(), readUser(home)), null, 2) : reapply(home)
  }
  if (first === '--remove') {
    if (rest.length !== 1) throw new Error(USAGE)
    return remove(rest[0], home)
  }
  if (first === undefined || rest.length === 0) throw new Error(USAGE)
  return assign(first, rest, home)
}

// No top-level await: gen-agents (imported lazily by regenerate) imports this module back, so it must finish evaluating first.
if (isMainModule(import.meta.url)) {
  run(process.argv.slice(2), homedir()).then(console.log, err => {
    console.error(`error: ${lineOf(err)}`)
    process.exit(1)
  })
}
