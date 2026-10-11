export const PREFIX = 'section-team:'
export const BUILDER_IDS = ['frontend', 'backend', 'database', 'testing', 'security', 'devops', 'uiux', 'docs', 'ai-llm', 'mobile']
export const ADVISOR_IDS = ['ai-engineer', 'data-scientist']
export const SECTION_IDS = [...BUILDER_IDS, ...ADVISOR_IDS]

export function sectionIdFromType(type) {
  if (typeof type !== 'string') return null
  const id = type.startsWith(PREFIX) ? type.slice(PREFIX.length) : type
  return SECTION_IDS.includes(id) ? id : null
}

export function extractReport(text) {
  if (typeof text !== 'string') return null
  const lf = text.replace(/\r\n?/g, '\n')
  const heading = /^[ \t]*#{1,6}[ \t]*REPORT\b.*$/m.exec(lf)
  if (!heading) return null
  const block = lf.slice(heading.index).replace(/^[ \t]+/, '').replace(/\n[ \t]*```[\s\S]*$/, '')
  return block.trimEnd() + '\n'
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
  out.status = (out.status.split(/[\s|·,—-]+/)[0] ?? '').toLowerCase()
  return out
}
