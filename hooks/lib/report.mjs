export const PREFIX = 'section-team:'
export const BUILDER_IDS = ['frontend', 'backend', 'database', 'testing', 'security', 'devops', 'uiux', 'docs', 'ai-llm', 'mobile']
export const ADVISOR_IDS = ['ai-engineer', 'data-scientist']
export const SECTION_IDS = [...BUILDER_IDS, ...ADVISOR_IDS]
export const ADVISOR_HELPERS = ['section-team:scout', 'architect', 'planner', 'code-explorer'] // scout is read-only (Read, Grep, Glob)

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
  'helpers used': 'helpers', helpers: 'helpers', problems: 'problems', next: 'next',
}

export function parseReport(block) {
  const out = { status: '', job: '', changed: '', tests: '', coordination: '', helpers: '', problems: '', next: '' }
  if (typeof block !== 'string') return out
  for (const raw of block.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\*\*/g, '').replace(/^\s*[-*]\s+/, '').trim()
    const match = /^([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/.exec(line)
    if (!match) continue
    const key = FIELDS[match[1].toLowerCase()]
    if (key && out[key] === '') out[key] = match[2].trim()
  }
  out.status = (/(partial|blocked|done)/i.exec(out.status)?.[1] ?? out.status.split(/[\s|·,—-]+/)[0] ?? '').toLowerCase()
  return out
}
