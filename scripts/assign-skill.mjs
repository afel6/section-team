import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { SECTION_IDS } from '../hooks/lib/report.mjs'
import { isMainModule } from '../hooks/lib/paths.mjs'

export const SKILL_NAME = /^[a-z0-9][a-z0-9._:-]{0,99}$/i
export const EXTRA_FILE = new URL('./roster-extra.json', import.meta.url)

const USAGE = 'usage: assign-skill.mjs <skill> <section> [<section>...] | --remove <skill> | --list'

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

export function assignSkill(extra, skill, sections) {
  validateExtra(extra)
  checkSkill(skill)
  if (!Array.isArray(sections) || sections.length === 0) throw new Error('at least one section is required')
  sections.forEach(checkSection)
  return sections.reduce((acc, id) => ({ ...acc, [id]: [...new Set([...(acc[id] ?? []), skill])] }), clone(extra))
}

export function removeSkill(extra, skill) {
  validateExtra(extra)
  return Object.fromEntries(
    Object.entries(extra)
      .map(([id, skills]) => [id, skills.filter(s => s !== skill)])
      .filter(([, skills]) => skills.length > 0),
  )
}

export function readExtra(file = EXTRA_FILE) {
  if (!existsSync(file)) return {}
  const extra = JSON.parse(readFileSync(file, 'utf8'))
  validateExtra(extra)
  return extra
}

async function save(extra) {
  const { writeAgents } = await import('./gen-agents.mjs') // lazy: gen-agents imports this module
  writeFileSync(EXTRA_FILE, `${JSON.stringify(extra, null, 2)}\n`)
  writeAgents({ extra })
}

async function run([first, ...rest]) {
  if (first === '--list') return JSON.stringify(readExtra(), null, 2)
  if (first === '--remove') {
    if (rest.length !== 1) throw new Error(USAGE)
    await save(removeSkill(readExtra(), rest[0]))
    return `removed ${rest[0]}`
  }
  if (first === undefined || rest.length === 0) throw new Error(USAGE)
  await save(assignSkill(readExtra(), first, rest))
  return `assigned ${first} → ${rest.join(', ')}`
}

// No top-level await: gen-agents (imported lazily by save) imports this module back, so it must finish evaluating first.
if (isMainModule(import.meta.url)) {
  run(process.argv.slice(2)).then(console.log, err => {
    console.error(`error: ${err.message}`)
    process.exit(1)
  })
}
