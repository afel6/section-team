import { existsSync, readFileSync } from 'node:fs'
import { extractReport, sectionIdFromType } from './lib/report.mjs'
import { isMainModule, projectRoot, readStdinJson, writeReport } from './lib/paths.mjs'

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
    if (row.type !== 'assistant' || !Array.isArray(row.message?.content)) continue
    const handback = row.message.content.find(part => part.type === 'tool_use' && part.name === 'SubagentHandback')
    if (typeof handback?.input?.message === 'string') return handback.input.message
    const text = row.message.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    if (lastText === '' && text !== '') lastText = text
  }
  return lastText
}

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
