import { DEFAULT_MODE, GATES } from './mode.mjs'

export const PREFIX = 'section-team:'
export const BUILDER_IDS = ['frontend', 'backend', 'database', 'testing', 'security', 'devops', 'uiux', 'docs', 'ai-llm', 'mobile']
export const ADVISOR_IDS = ['ai-engineer', 'data-scientist']
export const SECTION_IDS = [...BUILDER_IDS, ...ADVISOR_IDS]
export const ADVISOR_HELPERS = ['section-team:scout', 'architect', 'planner', 'code-explorer'] // scout is read-only (Read, Grep, Glob, Skill; no write or shell tools)

export function sectionIdFromType(type) {
  if (typeof type !== 'string') return null
  if (!type.startsWith(PREFIX)) return null
  const id = type.slice(PREFIX.length)
  return SECTION_IDS.includes(id) ? id : null
}

const isFenceLine = line => /^[ \t]*(```|~~~)/.test(line)

export function extractReport(text) {
  if (typeof text !== 'string') return null
  const lf = text.replace(/\r\n?/g, '\n')
  // The contract ends the message with the report, so the last heading is the one that counts.
  const heading = [...lf.matchAll(/^[ \t]*#{1,6}[ \t]*REPORT\b.*$/gim)].at(-1)
  if (!heading) return null
  let lines = lf.slice(heading.index).replace(/^[ \t]+/, '').split('\n')
  const fencesBefore = lf.slice(0, heading.index).split('\n').filter(isFenceLine).length
  if (fencesBefore % 2 === 1) {
    const close = lines.findIndex(isFenceLine)
    if (close > 0) lines = lines.slice(0, close)
  }
  return lines.join('\n').trimEnd() + '\n'
}

const FIELDS = {
  status: 'status', job: 'job', changed: 'changed', tests: 'tests', coordination: 'coordination',
  'helpers used': 'helpers', helpers: 'helpers', problems: 'problems', next: 'next', quality: 'quality',
}

const PATH_LIKE = /[\w./\\-]+\.[A-Za-z0-9]+/g
const DOC_FILE = /\.(md|mdx|txt|rst|adoc)$/i

// Whether a REPORT's Changed line names any file that is not a doc. Free text without file names counts as no code.
export function changesCode(changed) {
  if (typeof changed !== 'string') return false
  return (changed.match(PATH_LIKE) ?? []).some(path => !DOC_FILE.test(path))
}

// The reviewer's pass mark for the overall grade in the default mode; the generated PASS_RULE uses it too.
export const PASS_OVERALL = GATES[DEFAULT_MODE].passOverall

// partial, blocked and ungraded are the honest ways out, so a section can never be stuck at the gate.
const HONEST_STATUSES = ['blocked', 'partial', 'ungraded']
const claimsDoneWithCode = report => !HONEST_STATUSES.includes(report.status) && changesCode(report.changed)

// A parsed REPORT that changed code but carries no reviewer grade must go through the gate first.
export function needsGate(report) {
  return claimsDoneWithCode(report) && report.quality === null
}

// A REPORT that claims done with a grade under the pass mark (the project mode's, Balanced's by default) skipped its fix rounds.
export function failsGate(report, passOverall = PASS_OVERALL) {
  return claimsDoneWithCode(report) && report.quality !== null && report.quality < passOverall
}

// quality: the reviewer's overall grade as a number, or null for "n/a (no code)" and a missing line.
export function parseReport(block) {
  const out = { status: '', job: '', changed: '', tests: '', coordination: '', helpers: '', problems: '', next: '', quality: '' }
  if (typeof block !== 'string') return { ...out, quality: null }
  for (const raw of block.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\*\*/g, '').replace(/^\s*[-*]\s+/, '').trim()
    const match = /^([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/.exec(line)
    if (!match) continue
    const key = FIELDS[match[1].toLowerCase()]
    if (key && out[key] === '') out[key] = match[2].trim()
  }
  out.status = (/(ungraded|partial|blocked|done)/i.exec(out.status)?.[1] ?? out.status.split(/[\s|·,—-]+/)[0] ?? '').toLowerCase()
  const grade = /(\d+(?:\.\d+)?)\s*\/\s*10\b/.exec(out.quality)
  out.quality = grade ? Number(grade[1]) : null
  return out
}
