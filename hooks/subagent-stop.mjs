import { existsSync, readFileSync } from 'node:fs'
import { BUILDER_IDS, extractReport, needsGate, parseReport, sectionIdFromType } from './lib/report.mjs'
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

const reportOf = e => extractReport(e.last_assistant_message || finalAgentText(e.agent_transcript_path))

const GATE_MESSAGE = 'Your REPORT lists changed code but no reviewer grade, so you are not done yet. Send your changed files to Agent `section-team:reviewer` (do not pass `model`). If it fails, have a coder apply its fix list and grade again, at most 2 fix rounds. Then end again with your REPORT carrying `Quality: <overall>/10 (reviewer, <n> fix rounds)`, or `Status: partial` with the grade if it still fails.'

// The clean-code gate, enforced: a builder whose REPORT changed code without a grade is kept running once
// (stop_hook_active is set on the next stop, so it can never loop). Returns the hook output, or null to let it stop.
export function gateFeedback(e, block) {
  const id = sectionIdFromType(e?.agent_type)
  if (!id || !BUILDER_IDS.includes(id) || !block || e.stop_hook_active === true) return null
  if (!needsGate(parseReport(block))) return null
  return { hookSpecificOutput: { hookEventName: 'SubagentStop', additionalContext: GATE_MESSAGE } }
}

export function saveFromEvent(e, now = new Date(), block = reportOf(e ?? {})) {
  const id = sectionIdFromType(e?.agent_type)
  if (!id || typeof e.cwd !== 'string') return null
  return block ? writeReport(projectRoot(e.cwd), id, block, now) : null
}

// A REPORT sent back to the gate is not saved: the section ends again with the graded one.
export function handleEvent(e, now = new Date()) {
  if (!sectionIdFromType(e?.agent_type)) return null
  const block = reportOf(e)
  const feedback = gateFeedback(e, block)
  if (feedback) return feedback
  saveFromEvent(e, now, block)
  return null
}

if (isMainModule(import.meta.url)) {
  readStdinJson()
    .then(e => {
      const feedback = handleEvent(e)
      if (feedback) process.stdout.write(JSON.stringify(feedback))
    })
    .catch(err => process.stderr.write(`section-team subagent-stop: ${err.message}\n`))
}
