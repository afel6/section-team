// What a run's transcripts show about its sections and reviewer gates, for mode-check.mjs: wake-ups, reviewer calls
// and the gates they form (docs/specs/2026-11-01-mode-round-design.md, "Mode fidelity"). Reads roles as
// score.mjs collectRolesFrom returns them; never touches the disk.
import { senderOf } from '../hooks/lib/grade.mjs'
import { ROUND_GATES, meetsMark, parseGrade, reviewerAnswer } from './gate-stats.mjs'

export const HEADS = ['backend', 'frontend', 'database', 'devops', 'mobile', 'uiux', 'ai-llm', 'testing', 'security', 'docs']
export const BUILDERS = HEADS.filter(head => !['testing', 'security', 'docs'].includes(head))
const REVIEWER = 'section-team:reviewer'
export const FILE_WRITERS = ['Write', 'Edit', 'MultiEdit']

// The section head a subagent type names ('section-team:backend' → 'backend'), or null (reviewer, scout, coder, other agents).
const headOf = type => {
  const name = /^section-team:(.+)$/.exec(String(type ?? ''))?.[1]
  return HEADS.includes(name) ? name : null
}
const isBuilder = type => BUILDERS.includes(headOf(type))

// Every tool_use with one of the given names in a transcript, in line order, with its line's timestamp: [{ at, input }].
export const toolUses = (messages, ...names) => messages.flatMap(m => {
  const content = m?.type === 'assistant' ? m.message?.content : null
  if (!Array.isArray(content)) return []
  return content.filter(part => part?.type === 'tool_use' && names.includes(part.name)).map(part => ({ at: m.timestamp, input: part.input ?? {} }))
})

const callerOf = role => (role.role === 'main' ? 'main' : role.agentId)

// Agent calls that wake a section head, in each transcript: [{ section, at, caller }]. Helpers and SendMessage are not wake-ups.
export function wakeUps(roles) {
  return roles.flatMap(role => toolUses(role.messages, 'Agent')
    .filter(use => headOf(use.input.subagent_type) !== null)
    .map(use => ({ section: headOf(use.input.subagent_type), at: use.at, caller: callerOf(role) })))
}

const startTime = start => { const t = Date.parse(start ?? ''); return Number.isNaN(t) ? Infinity : t }
// The first assistant line's model; Claude Code's own <synthetic> lines (API errors, interrupts) are not the reviewer's model.
const firstModel = messages => messages.find(m => m?.type === 'assistant' && m.message?.model !== '<synthetic>')?.message?.model ?? null

// Reviewer calls in start order: [{ caller, start, model, grade }]; caller is the agent that hired it ('main' at depth 1).
export function reviewerCalls(roles) {
  return roles.filter(r => r.role === REVIEWER)
    .toSorted((a, b) => (startTime(a.start) - startTime(b.start)) || 0)
    .map(r => ({ caller: r.parentId ?? 'main', start: r.start, model: firstModel(r.messages), grade: parseGrade(reviewerAnswer(r.messages)) }))
}

// main got a new job: it woke a builder section, or sent a message to one, at time t.
function mainJobTimes(roles) {
  const main = roles.find(r => r.role === 'main')?.messages ?? []
  const builderIds = new Set(roles.filter(r => isBuilder(r.role)).map(r => r.agentId))
  const woke = toolUses(main, 'Agent').filter(use => isBuilder(use.input.subagent_type))
  const sent = toolUses(main, 'SendMessage').filter(use => builderIds.has(use.input.to))
  return [...woke, ...sent].map(use => Date.parse(use.at))
}

// A queued message that only hands back the work of one of the section's own subagents.
function isOwnHandback(prompt, own) {
  return own.has(senderOf(prompt))
}

// A section got a new job: a queued_command arrived that is not a hand-back from its own subagents. Its user lines
// (job prompt, skill loads, reminders) never count.
function sectionJobTimes(roles, caller) {
  const lines = roles.find(r => r.role !== 'main' && r.agentId === caller)?.messages ?? []
  const own = new Set(roles.filter(r => r.parentId === caller).map(r => r.agentId))
  return lines
    .filter(m => m?.type === 'attachment' && m.attachment?.type === 'queued_command')
    .filter(m => !isOwnHandback(String(m.attachment.prompt ?? ''), own))
    .map(m => Date.parse(m.timestamp))
}

// One caller's reviewer calls split into gates: a call starts a new gate when it is the first, when a new job arrived
// strictly between the previous call's start and its own. A pass ends the gate whatever was edited afterwards.
function splitGates(calls, { jobTimes }) {
  return calls.reduce((list, call, i) => {
    const from = i === 0 ? NaN : Date.parse(calls[i - 1].start)
    const to = Date.parse(call.start)
    const between = t => t > from && t < to
    const startsGate = i === 0 || jobTimes.some(between)
    return startsGate ? [...list, [call]] : [...list.slice(0, -1), [...list.at(-1), call]]
  }, [])
}

function gateOf(caller, calls, mode, isLast) {
  const passed = calls.map(call => meetsMark(call.grade, mode))
  const fixRounds = calls.length - 1
  return {
    caller,
    reviews: calls.map(call => call.grade),
    fixRounds,
    endsEarly: isLast && !passed.at(-1) && fixRounds < ROUND_GATES[mode].fixRounds,
    regradeAfterPass: passed.slice(0, -1).some(Boolean),
  }
}

// Every caller's gates: [{ caller, reviews, fixRounds, endsEarly, regradeAfterPass }]. A review fails when it misses
// the mode's mark; only a caller's last gate can end early, since any later call of that caller follows it.
export function gates(roles, mode) {
  const calls = reviewerCalls(roles)
  const callers = [...new Set(calls.map(call => call.caller))]
  return callers.flatMap(caller => {
    const jobTimes = caller === 'main' ? mainJobTimes(roles) : sectionJobTimes(roles, caller)
    const split = splitGates(calls.filter(call => call.caller === caller), { jobTimes })
    return split.map((list, i) => gateOf(caller, list, mode, i === split.length - 1))
  })
}
