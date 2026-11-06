import { readFileSync } from 'node:fs'
import { contentOf, subagentBase } from './head-context.mjs'

const REVIEWER_TYPE = 'section-team:reviewer'
const NO_REVIEWER_CALL = 'section-team: your REPORT gives a grade, but no reviewer call is in your transcript. Run section-team:reviewer on your changed files.'
const AGENT_ID = /agentId:\s*([\w-]+)/g
// A line of the GRADE block: the harness indents it and a model may bold it. Prose that only mentions an overall grade does not start with it.
const OVERALL_LINE = /^[ \t*_#>-]*Overall[ \t*_]*:[ \t*_]*(\d+(?:\.\d+)?)[ \t]*\/[ \t]*10\b/gim

// An item line of the GRADE block, decorated the same way; `n/a` has no digits and so is no score.
const ITEM_LINE = /^[ \t*_#>-]*(structure|naming|duplication|size|errors|tests|security|leftovers)[ \t*_]*:[ \t*_]*(\d+(?:\.\d+)?)\b/i
const FIXES_LINE = /^[ \t*_#>-]*Fixes[ \t*_]*:/i

const lastMatch = (pattern, text) => [...text.matchAll(pattern)].at(-1)?.[1]
// Assistant turns only: transcripts also keep copies of API requests, later in the file than the results of the calls they copy.
const toolUsesOf = entry => (entry?.type === 'assistant' ? contentOf(entry).filter(part => part?.type === 'tool_use') : [])
const isReviewerCall = part => (part.name === 'Agent' || part.name === 'Task') && part.input?.subagent_type === REVIEWER_TYPE
const textOf = content => (Array.isArray(content) ? content.map(part => part?.text ?? '').join('\n') : String(content ?? ''))

// Who a queued hand-back comes from. Anything else queued (a message from the supervisor) has no sender.
export function senderOf(prompt) {
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

// The item scores of the block after the answer's last Overall line, up to its Fixes: line. Earlier prose is not a score.
function itemScores(answer) {
  const last = [...answer.matchAll(OVERALL_LINE)].at(-1)
  const block = answer.slice(last.index).split('\n').slice(1)
  const end = block.findIndex(line => FIXES_LINE.test(line))
  return (end < 0 ? block : block.slice(0, end)).flatMap(line => {
    const found = ITEM_LINE.exec(line)
    return found ? [{ name: found[1].toLowerCase(), score: Number(found[2]) }] : []
  })
}

const lowItemReason = (item, min) => `section-team: the reviewer scored ${item.name} ${item.score}/10, under the ${min}/10 minimum for an item. Give the fix list to a coder and grade again with a new Agent \`section-team:reviewer\` call, or hand back with \`Status: partial\` once the fix rounds are used.`

function refusal(entries, quality, gate) {
  const at = entries.findLastIndex(entry => toolUsesOf(entry).some(isReviewerCall))
  // A transcript with no tool call at all is a shape this code does not know, so it proves nothing.
  if (at < 0) return entries.some(entry => toolUsesOf(entry).length > 0) ? NO_REVIEWER_CALL : null
  const answers = reviewerAnswers(entries.slice(at + 1), toolUsesOf(entries[at]).findLast(isReviewerCall).id)
  const answer = answers.findLast(text => lastMatch(OVERALL_LINE, text) !== undefined)
  if (answer === undefined) return null
  const said = Number(lastMatch(OVERALL_LINE, answer))
  if (quality > said) return `section-team: your REPORT says ${quality}/10, but the reviewer said ${said}/10. Report the reviewer's grade.`
  const min = gate?.minItem ?? null
  const low = min === null ? undefined : itemScores(answer).find(item => item.score < min)
  return low ? lowItemReason(low, min) : null
}

// The refusal for a REPORT whose grade the section's own transcript does not back, else null. quality is the REPORT's grade;
// gate is the mode's, and its minItem is the lowest score the reviewer may have given any item.
// Hooks fail open, so any read failure denies nothing. The whole file is read, unlike the resume guard's tail: a missing call
// refuses here, and real reviewer calls sit up to megabytes from the end. It runs once per graded handback, not on every message.
export function gradeRule(e, quality, gate) {
  const base = subagentBase(e, e?.agent_id)
  if (base === null) return null
  try {
    const lines = readFileSync(`${base}.jsonl`, 'utf8').split('\n').filter(line => line.trim() !== '')
    return refusal(lines.map(line => JSON.parse(line)), quality, gate)
  } catch {
    return null
  }
}
