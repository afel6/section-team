import { readFileSync } from 'node:fs'
import { contentOf, subagentBase } from './head-context.mjs'

const REVIEWER_TYPE = 'section-team:reviewer'
const NO_REVIEWER_CALL = 'section-team: your REPORT gives a grade, but no reviewer call is in your transcript. Run section-team:reviewer on your changed files.'
const AGENT_ID = /agentId:\s*([\w-]+)/g
// A line of the GRADE block: the harness indents it and a model may bold it. Prose that only mentions an overall grade does not start with it.
const OVERALL_LINE = /^[\s*_#>-]*Overall[\s*_]*:[\s*_]*(\d+(?:\.\d+)?)\s*\/\s*10\b/gim

const lastMatch = (pattern, text) => [...text.matchAll(pattern)].at(-1)?.[1]
// Assistant turns only: transcripts also keep copies of API requests, later in the file than the results of the calls they copy.
const toolUsesOf = entry => (entry?.type === 'assistant' ? contentOf(entry).filter(part => part?.type === 'tool_use') : [])
const isReviewerCall = part => part.name === 'Agent' && part.input?.subagent_type === REVIEWER_TYPE
const textOf = content => (Array.isArray(content) ? content.map(part => part?.text ?? '').join('\n') : String(content ?? ''))

// Who a queued hand-back comes from. Anything else queued (a message from the supervisor) has no sender.
function senderOf(prompt) {
  const from = /^<agent-message from="([^"]*)">/.exec(prompt)?.[1]
  return from ?? (prompt.startsWith('<task-notification>') ? /<task-id>([^<]*)<\/task-id>/.exec(prompt)?.[1] : undefined)
}

const queuedPrompts = entries => entries.filter(entry => entry?.type === 'attachment' && entry.attachment?.type === 'queued_command').map(entry => String(entry.attachment.prompt ?? ''))

// What the reviewer said after its last ask, oldest first: the tool_result, then what came as queued_command attachments from the
// agent id it names, because the desktop app delivers helper results that way. Nobody else's text can pass as its grade.
// A section that resumed the reviewer asked it again, and a supervisor may relay that answer in words, so the earlier grade no longer counts.
function reviewerAnswers(later, callId) {
  const result = textOf(later.flatMap(contentOf).find(part => part?.type === 'tool_result' && part.tool_use_id === callId)?.content)
  const reviewer = lastMatch(AGENT_ID, result)
  if (reviewer === undefined) return [result]
  const resumedAt = later.findLastIndex(entry => toolUsesOf(entry).some(part => part.name === 'SendMessage' && part.input?.to === reviewer))
  const delivered = queuedPrompts(later.slice(resumedAt + 1)).filter(prompt => senderOf(prompt) === reviewer)
  return resumedAt < 0 ? [result, ...delivered] : delivered
}

function refusal(entries, quality) {
  const at = entries.findLastIndex(entry => toolUsesOf(entry).some(isReviewerCall))
  // A transcript with no tool call at all is a shape this code does not know, so it proves nothing.
  if (at < 0) return entries.some(entry => toolUsesOf(entry).length > 0) ? NO_REVIEWER_CALL : null
  const answers = reviewerAnswers(entries.slice(at + 1), toolUsesOf(entries[at]).findLast(isReviewerCall).id)
  const said = answers.map(text => lastMatch(OVERALL_LINE, text)).findLast(grade => grade !== undefined)
  return said !== undefined && quality > Number(said) ? `section-team: your REPORT says ${quality}/10, but the reviewer said ${Number(said)}/10. Report the reviewer's grade.` : null
}

// The refusal for a REPORT whose grade the section's own transcript does not back, else null. quality is the REPORT's grade.
// Hooks fail open, so any read failure denies nothing. The whole file is read, unlike the resume guard's tail: a missing call
// refuses here, and real reviewer calls sit up to megabytes from the end. It runs once per graded handback, not on every message.
export function gradeRule(e, quality) {
  const base = subagentBase(e, e?.agent_id)
  if (base === null) return null
  try {
    const lines = readFileSync(`${base}.jsonl`, 'utf8').split('\n').filter(line => line.trim() !== '')
    return refusal(lines.map(line => JSON.parse(line)), quality)
  } catch {
    return null
  }
}
