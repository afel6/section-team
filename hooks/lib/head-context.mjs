import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { BUILDER_IDS, sectionIdFromType } from './report.mjs'

export const HEAD_CONTEXT_LIMIT = 300000
const TAIL_BYTES = 256 * 1024
const PATH_PART = /^[A-Za-z0-9_-]+$/ // the session id and the target become part of a path

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

// The context of the transcript's last assistant turn. Bad JSON throws; no such turn or an unknown shape counts as 0.
function contextTokens(file) {
  const entries = tailLines(file).map(line => JSON.parse(line))
  const usage = entries.findLast(entry => entry?.type === 'assistant' && entry.message?.usage)?.message.usage
  return tokenCount(usage?.input_tokens) + tokenCount(usage?.cache_read_input_tokens) + tokenCount(usage?.cache_creation_input_tokens)
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

// The refusal for a SendMessage that would resume an oversized builder head, else null.
// Hooks fail open, so any read failure here (no such target, bad JSON) denies nothing: real work must never be blocked by a guard that cannot see.
export function headContextRule(e) {
  const base = subagentBase(e, e?.tool_input?.to)
  if (base === null) return null
  try {
    const id = builderId(`${base}.meta.json`)
    if (id === null) return null
    const tokens = contextTokens(`${base}.jsonl`)
    if (tokens <= HEAD_CONTEXT_LIMIT) return null
    return `section-team: the ${id} section is at ${Math.floor(tokens / 1000)}K tokens of context, so resuming it costs far more than starting over. Start a fresh Agent call for this work and point it to the notes and its REPORT.`
  } catch {
    return null
  }
}
