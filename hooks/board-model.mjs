import { ADVISOR_IDS, BUILDER_IDS, sectionIdFromType } from './lib/report.mjs'

const ACTIVE = new Set(['pending', 'running', 'waiting', 'idle'])

export function cardState(agentStatus, reportStatus) {
  if (agentStatus === 'pending' || agentStatus === 'running') return 'running'
  if (agentStatus === 'waiting' || agentStatus === 'idle') return 'waiting'
  if (agentStatus === 'failed' || agentStatus === 'killed') return 'problem'
  if (agentStatus === 'completed') return reportStatus === 'partial' || reportStatus === 'blocked' ? 'problem' : 'done'
  return 'asleep'
}

export function cardLine(state, agent, report) {
  if (state === 'running') return `Running · ${agent?.description || 'working'}`
  if (state === 'waiting') return `Waiting · ${agent?.description || 'for a reply'}`
  if (state === 'done') return `Done · ${report?.job || 'no report yet'}${typeof report?.quality === 'number' ? ` · ${report.quality}/10` : ''}`
  if (state === 'problem') return `Problem · ${report?.job ? `${report.status}: ${report.job}` : agent?.status ?? 'unknown'}`
  return report?.job ? `Asleep · last: ${report.job}` : 'Asleep'
}

// 999 -> '999', 12345 -> '12.3k', 1250000 -> '1.3M'. Rounds before it picks the unit, so 999999 is '1M', not '1000k'.
export function formatTokens(n) {
  if (n < 1000) return String(n)
  const thousands = Math.round(n / 100) / 10
  return thousands < 1000 ? `${thousands}k` : `${Math.round(n / 1e5) / 10}M`
}

export function shortModel(id) {
  return /haiku|sonnet|opus|fable/i.exec(id)?.[0].toLowerCase() ?? id
}

const MAX_DEPTH = 50

// What each section's head and every agent below it used. Plain objects in (spawns and usage are keyed by agent id), plain objects out.
// An agent belongs to the first section head on its parent chain (spawn record first, the agent list's parentId second); none, no section.
export function sectionUsage({ agents = [], spawns = {}, usage = {} } = {}) {
  const spawnOf = new Map(Object.entries(spawns))
  const parentOf = new Map(agents.map(a => [a.id, a.parentId]))
  const heads = new Map()
  for (const a of agents) if (sectionIdFromType(a.type)) heads.set(a.id, sectionIdFromType(a.type))
  for (const [id, s] of spawnOf) if (sectionIdFromType(s.subagentType)) heads.set(id, sectionIdFromType(s.subagentType))

  const owner = id => {
    for (let hops = 0; id !== undefined && hops < MAX_DEPTH; hops++) {
      if (heads.has(id)) return heads.get(id)
      id = spawnOf.get(id)?.parentAgentId ?? parentOf.get(id)
    }
    return undefined
  }

  const sections = {}
  const counts = {}
  const section = id => (sections[id] ??= { total: 0, out: 0, helpers: 0, models: [] })
  for (const id of new Set(heads.values())) section(id)
  for (const [agentId, u] of Object.entries(usage)) {
    const id = owner(agentId)
    if (id === undefined) continue
    section(id).total += u.total
    section(id).out += u.out
  }
  for (const s of spawnOf.values()) {
    const id = heads.get(s.parentAgentId)
    if (id === undefined) continue
    const model = shortModel(s.model)
    const tally = (counts[id] ??= new Map())
    section(id).helpers += 1
    tally.set(model, (tally.get(model) ?? 0) + 1)
  }
  for (const [id, tally] of Object.entries(counts)) {
    section(id).models = [...tally].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  }
  return sections
}

export function boardModel({ agents = [], reports = {}, request = '', lastSummary = '', usage = {} } = {}) {
  const byId = new Map()
  for (const agent of agents) {
    const id = sectionIdFromType(agent.type)
    if (id) byId.set(id, [...(byId.get(id) ?? []), agent])
  }
  const card = (id, kind) => {
    const list = byId.get(id) ?? []
    const agent = list.find(a => ACTIVE.has(a.status)) ?? list.at(-1)
    const report = reports[id]
    const state = cardState(agent?.status, report?.status)
    const used = usage[id]
    const tokens = used?.total > 0 ? `tokens ${formatTokens(used.total)} · out ${formatTokens(used.out)}` : ''
    const helpersLine = used?.helpers > 0 ? `helpers ${used.helpers} · ${used.models.map(([model, n]) => `${model}×${n}`).join(' ')}` : ''
    return { id, kind, state, line: cardLine(state, agent, report), tokens, helpersLine }
  }
  const cards = [...BUILDER_IDS.map(id => card(id, 'builder')), ...ADVISOR_IDS.map(id => card(id, 'advisor'))]
  const count = (...states) => cards.filter(c => states.includes(c.state)).length
  const team = Object.values(usage).reduce((sum, u) => ({ total: sum.total + u.total, helpers: sum.helpers + u.helpers }), { total: 0, helpers: 0 })
  const teamLine = team.total > 0 || team.helpers > 0 ? `team tokens ${formatTokens(team.total)} · ${team.helpers} ${team.helpers === 1 ? 'helper' : 'helpers'}` : ''
  return { request, lastSummary, cards, counts: { active: count('running', 'waiting'), done: count('done'), problem: count('problem') }, teamLine }
}

export function emptyBoard() {
  return boardModel()
}

export function latestReportFiles(entries) {
  const byId = {}
  const rank = {}
  let summary = null
  for (const { name } of entries) {
    const match = /^(\d{6})-(.+?)(?:-(\d+))?\.md$/.exec(name)
    if (!match) continue
    const [, time, id, n] = match
    if (id === 'supervisor-summary') {
      if (summary === null || name > summary) summary = name
      continue
    }
    const score = Number(time) * 1000 + Number(n ?? 1)
    if (rank[id] === undefined || score > rank[id]) {
      rank[id] = score
      byId[id] = name
    }
  }
  return { byId, summary }
}
