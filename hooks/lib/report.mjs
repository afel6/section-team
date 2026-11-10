import { DEFAULT_MODE, GATES } from './mode.mjs'

export const PREFIX = 'section-team:'
export const BUILDER_IDS = ['frontend', 'backend', 'database', 'testing', 'security', 'devops', 'uiux', 'docs', 'ai-llm', 'mobile']
export const ADVISOR_IDS = ['ai-engineer', 'data-scientist', 'plan-advisor']
export const SECTION_IDS = [...BUILDER_IDS, ...ADVISOR_IDS]
export const ADVISOR_HELPERS = ['section-team:scout', 'architect', 'planner', 'code-explorer'] // scout is read-only (Read, Grep, Glob, Skill; no write or shell tools)

export function sectionIdFromType(type) {
  if (typeof type !== 'string') return null
  if (!type.startsWith(PREFIX)) return null
  const id = type.slice(PREFIX.length)
  return SECTION_IDS.includes(id) ? id : null
}

const isFenceLine = line => /^[ \t]*(```|~~~)/.test(line)
const toLf = text => text.replace(/\r\n?/g, '\n')
// The contract ends the message with the report, so the last heading is the one that counts.
const lastReportHeading = lf => [...lf.matchAll(/^[ \t]*#{1,6}[ \t]*REPORT\b.*$/gim)].at(-1)

// The text above the last REPORT heading, in LF line ends and trimmed; null when there is no REPORT heading.
export function reportHead(text) {
  if (typeof text !== 'string') return null
  const lf = toLf(text)
  const heading = lastReportHeading(lf)
  return heading ? lf.slice(0, heading.index).trim() : null
}

export function extractReport(text) {
  if (typeof text !== 'string') return null
  const lf = toLf(text)
  const heading = lastReportHeading(lf)
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

// A path under .team/ (a note, a report, a -details.md file) is the team's own record, never a change to grade:
// a separator or the line start, any folders ending in a slash, then .team/ and the rest of that path.
const TEAM_PATH = /(?:^|[\s,;(`'"])(?:[^\s,;()`'"]*[/\\])?\.team[/\\][^\s,;()`'"]*/g
const withoutTeamPaths = changed => changed.replace(TEAM_PATH, ' ')

// Whether a REPORT's Changed line names any file that is not a doc. Free text without file names counts as no code.
export function changesCode(changed) {
  if (typeof changed !== 'string') return false
  return (withoutTeamPaths(changed).match(PATH_LIKE) ?? []).some(path => !DOC_FILE.test(path))
}

// The reviewer's pass mark for the overall grade in the default mode; the generated PASS_RULE uses it too.
export const PASS_OVERALL = GATES[DEFAULT_MODE].passOverall

// Whether a REPORT's Changed line names any file at all, docs included (a gate with gradeAll grades those too).
// The contract is `<files, or "none">`, so a line that does not open with a no-change value counts as files, however it is worded.
const NO_CHANGE = /^[\s`'"*_(]*(?:(?:none|nothing|n\/a|no|unchanged)\b|[-—–]|$)/i
// A no-change opener that still names a file counts too: a dotted name, a dotfile, a path with a directory or a well-known extensionless name.
const EXTRA_FILE = /(?:^|[\s,;(`'"])(?:\.[\w-][\w.-]*|(?![nN]\/[aA](?![\w-]))[\w.-]+[/\\][\w./\\-]+|(?:Dockerfile|Makefile|LICENSE|LICENCE|Procfile|Gemfile|Rakefile|Jenkinsfile|Vagrantfile|CODEOWNERS|NOTICE|COPYING)(?![\w-]))/
// What is left of a line that named only .team/ paths: separators and blank space.
const ONLY_SEPARATORS = /^[\s,;()`'"]*$/
// The .team/ paths are taken out first; the rest is read as before, so free text beside one still counts as a change.
export function changesFiles(changed) {
  if (typeof changed !== 'string') return false
  const rest = withoutTeamPaths(changed)
  if (rest !== changed && ONLY_SEPARATORS.test(rest)) return false
  return !NO_CHANGE.test(rest) || rest.match(PATH_LIKE) !== null || EXTRA_FILE.test(rest)
}

// partial, blocked and ungraded are the honest ways out, so a section can never be stuck at the gate.
export const HONEST_STATUSES = ['blocked', 'partial', 'ungraded']
// gradeAll: the mode grades every changed file, not only code.
export const claimsDoneWithCode = (report, gradeAll = false) => !HONEST_STATUSES.includes(report.status) && (gradeAll ? changesFiles(report.changed) : changesCode(report.changed))

// A parsed REPORT that changed code but carries no reviewer grade must go through the gate first.
export function needsGate(report, gradeAll = false) {
  return claimsDoneWithCode(report, gradeAll) && report.quality === null
}

// A REPORT that claims done with a grade under the pass mark (the project mode's, Balanced's by default) skipped its fix rounds.
export function failsGate(report, passOverall = PASS_OVERALL, gradeAll = false) {
  return claimsDoneWithCode(report, gradeAll) && report.quality !== null && report.quality < passOverall
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
