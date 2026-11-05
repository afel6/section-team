import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { BUILDER_IDS, sectionIdFromType } from './report.mjs'

export const HEAD_CONTEXT_LIMIT = 300000
const TAIL_BYTES = 256 * 1024
const PATH_PART = /^[A-Za-z0-9_-]+$/ // the session id and the target become part of a path
const HANDBACK_TOOL = 'SubagentHandback'
const SYNTHETIC_MODEL = '<synthetic>'
const FINISHED_STEP = {
  supervisor: 'Start a fresh Agent call for this work and point it to the notes, its REPORT if it left one, and its changed files (`git status`).',
  section: 'Do not wake it or another section yourself: SendMessage `main` with your request, and the supervisor starts a fresh section.',
}

// The last TAIL_BYTES of a file as whole lines: transcripts can be huge, and a line the cut falls inside is dropped.
function tailLines(file) {
  const fd = openSync(file, 'r')
  try {
    const { size } = fstatSync(fd)
    const start = Math.max(0, size - TAIL_BYTES)
    const tail = Buffer.alloc(size - start)
    const read = readSync(fd, tail, 0, tail.length, start)
    const lines = tail.toString('utf8', 0, read).split('\n').slice(start > 0 ? 1 : 0)
    return lines.filter(line => line.trim() !== '')
  } finally {
    closeSync(fd)
  }
}

const tokenCount = value => (Number.isFinite(value) ? value : 0)
export const contentOf = entry => (Array.isArray(entry?.message?.content) ? entry.message.content : [])
const hasPart = (row, type) => contentOf(row).some(part => part?.type === type)

// The context of the last real assistant turn: a synthetic row carries zero usage and would hide an oversized head. No such turn or an unknown shape counts as 0.
function contextTokens(entries) {
  const usage = entries.findLast(entry => entry?.type === 'assistant' && entry.message?.usage && entry.message.model !== SYNTHETIC_MODEL)?.message.usage
  return tokenCount(usage?.input_tokens) + tokenCount(usage?.cache_read_input_tokens) + tokenCount(usage?.cache_creation_input_tokens)
}

// Each content part is its own row, so a text row with stop_reason tool_use has its call still to come.
const endsInText = row => hasPart(row, 'text') && !hasPart(row, 'tool_use') && row.message.stop_reason !== 'tool_use'

// The result of a SubagentHandback call. An error result is the gate refusing the handback, and that head works on.
function answersHandback(row, rows) {
  const handbackIds = rows.flatMap(contentOf).filter(part => part?.type === 'tool_use' && part.name === HANDBACK_TOOL).map(part => part.id)
  return contentOf(row).some(part => part?.type === 'tool_result' && part.is_error !== true && handbackIds.includes(part.tool_use_id))
}

// Whether the head's last row is one a head finishes on. Rows of other types (attachments, API request copies) come after that and say nothing.
function hasFinished(entries) {
  const rows = entries.filter(entry => entry?.type === 'assistant' || entry?.type === 'user')
  const last = rows.at(-1)
  return last?.type === 'assistant' ? endsInText(last) : answersHandback(last, rows)
}

const isPathPart = part => typeof part === 'string' && PATH_PART.test(part)

// A subagent's transcript path without its extension, or null when the event lacks a usable part.
export function subagentBase(e, id) {
  if (typeof e?.transcript_path !== 'string' || !isPathPart(e.session_id) || !isPathPart(id)) return null
  return join(dirname(e.transcript_path), e.session_id, 'subagents', `agent-${id}`)
}

function builderId(metaFile) {
  const id = sectionIdFromType(JSON.parse(readFileSync(metaFile, 'utf8'))?.agentType)
  return BUILDER_IDS.includes(id) ? id : null
}

// The refusal for a SendMessage that would resume a finished, oversized builder head, else null. A head still working takes messages at any size:
// that is how a sibling's reply or a supervisor's note reaches it. A call with no agent_type is the supervisor, who can start a fresh head; a section or helper asks it to.
// Hooks fail open, so any read failure here (no such target, bad JSON) denies nothing: real work must never be blocked by a guard that cannot see.
export function headContextRule(e) {
  const base = subagentBase(e, e?.tool_input?.to)
  if (base === null) return null
  try {
    const id = builderId(`${base}.meta.json`)
    if (id === null) return null
    const entries = tailLines(`${base}.jsonl`).map(line => JSON.parse(line))
    const tokens = contextTokens(entries)
    if (tokens <= HEAD_CONTEXT_LIMIT || !hasFinished(entries)) return null
    return `section-team: the ${id} section has finished at ${Math.floor(tokens / 1000)}K tokens of context, so resuming it costs far more than starting over. ${e.agent_type ? FINISHED_STEP.section : FINISHED_STEP.supervisor}`
  } catch {
    return null
  }
}
