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
  if (state === 'done') return `Done · ${report?.job || 'no report yet'}`
  if (state === 'problem') return `Problem · ${report?.job ? `${report.status}: ${report.job}` : agent?.status ?? 'unknown'}`
  return report?.job ? `Asleep · last: ${report.job}` : 'Asleep'
}

export function boardModel({ agents = [], reports = {}, request = '', lastSummary = '' } = {}) {
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
    const helpers = report?.helpers && report.helpers !== 'none' ? report.helpers : ''
    return { id, kind, state, line: cardLine(state, agent, report), helpers }
  }
  const cards = [...BUILDER_IDS.map(id => card(id, 'builder')), ...ADVISOR_IDS.map(id => card(id, 'advisor'))]
  const count = (...states) => cards.filter(c => states.includes(c.state)).length
  return { request, lastSummary, cards, counts: { active: count('running', 'waiting'), done: count('done'), problem: count('problem') } }
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
