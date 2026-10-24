import { existsSync, readFileSync } from 'node:fs'
import { extractReport, sectionIdFromType } from './lib/report.mjs'
import { isMainModule, projectRoot, readStdinJson, writeReport } from './lib/paths.mjs'

// A job starts at a coordinator message (even though the harness flags it isMeta) or at a real user row.
// Harness rows (isMeta: skill loads, hook feedback, system reminders) and tool results arrive mid-job and never start one.
const isToolResultOnly = content => Array.isArray(content) && content.every(part => part == null || part.type === 'tool_result')
const startsJob = row => row?.type === 'user' && (row.origin?.kind === 'coordinator' || (row.isMeta !== true && !isToolResultOnly(row.message?.content)))

// The current job's last handback, else its last assistant text, else ''. Never reaches back past the job's first row.
export function finalAgentText(transcriptPath) {
  if (typeof transcriptPath !== 'string' || !existsSync(transcriptPath)) return ''
  const rows = readFileSync(transcriptPath, 'utf8').split(/\r?\n/).filter(Boolean)
  let lastText = ''
  for (let i = rows.length - 1; i >= 0; i--) {
    let row
    try {
      row = JSON.parse(rows[i])
    } catch {
      continue
    }
    if (startsJob(row)) break
    if (row?.type !== 'assistant' || !Array.isArray(row.message?.content)) continue
    const handback = row.message.content.find(part => part?.type === 'tool_use' && part.name === 'SubagentHandback')
    if (typeof handback?.input?.message === 'string') return handback.input.message
    const text = row.message.content.filter(part => part?.type === 'text').map(part => part.text).join('\n')
    if (lastText === '' && text !== '') lastText = text
  }
  return lastText
}

// Every section REPORT is saved. The clean-code gate is enforced earlier, when the REPORT is handed back (pre-tool-use.mjs):
// by the time a section stops, the supervisor already has its REPORT.
export function saveFromEvent(e, now = new Date()) {
  const id = sectionIdFromType(e?.agent_type)
  if (!id || typeof e.cwd !== 'string') return null
  const block = extractReport(e.last_assistant_message || finalAgentText(e.agent_transcript_path))
  return block ? writeReport(projectRoot(e.cwd), id, block, now) : null
}

if (isMainModule(import.meta.url)) {
  readStdinJson()
    .then(e => saveFromEvent(e))
    .catch(err => process.stderr.write(`section-team subagent-stop: ${err.message}\n`))
}
