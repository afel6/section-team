import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'
import type { BoardCard, BoardData } from '../types'
import { boardModel, emptyBoard, latestReportFiles, sectionUsage } from './board-model.mjs'
import { parseReport, PREFIX } from './lib/report.mjs'

// The scan that lists a module's state reads an atom only when it is declared in this file.
const board = atom({ plugin: 'section-team', key: 'board' } as const, emptyBoard() as BoardData)
const PANE = 'team-board'
const TITLE = 'Team Board'
const POLL_MS = 1000
const GIT_TIMEOUT_MS = 5000
const COLOR = { asleep: 'inactive', running: 'suggestion', waiting: 'warning', done: 'success', problem: 'error' } as const
const pad = (n: number) => String(n).padStart(2, '0')
const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

async function findRoot($: EngineInterface): Promise<string> {
  const cwd = await $.session.cwd()
  const result = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, timeoutMs: GIT_TIMEOUT_MS }).catch(() => undefined)
  const common = result?.exitCode === 0 ? result.stdout.trim() : ''
  return /[\\/]\.git$/.test(common) ? common.replace(/[\\/]\.git$/, '') : cwd
}

type Report = ReturnType<typeof parseReport>
type Spawn = { parentAgentId?: string; subagentType: string; model: string }
type Used = { total: number; out: number }
// spawns and usage live here, not in the atom: only the computed board is stored. Both are keyed by agent id.
type Ctx = {
  root: string; request: string; lastJson: string; lastError: string; hasOpened: boolean; stop?: Timer
  cache: Map<string, { mtimeMs: number; report: Report }>; spawns: Map<string, Spawn>; usage: Map<string, Used>
}

// A fresh session counts from zero. The poll is not touched: the board stays alive across a /clear.
function resetCounts(ctx: Ctx) {
  ctx.spawns.clear()
  ctx.usage.clear()
}

// Accounting is best effort: whatever goes wrong in it is dropped, so it can never reach the session. A count that is not a number reads as zero.
const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0)

function recordSpawn(ctx: Ctx, e: { parentAgentId?: string; subagentType: string }, result: { model?: string; agentId?: string; deny?: string }) {
  try {
    if (result.deny || !result.agentId) return
    ctx.spawns.set(result.agentId, { parentAgentId: e.parentAgentId, subagentType: e.subagentType, model: String(result.model ?? '') })
  } catch {
    // dropped on purpose
  }
}

function recordStep(ctx: Ctx, agentId: string | undefined, result: { usage?: Record<string, unknown> | null } | undefined) {
  try {
    const u = result?.usage
    if (!agentId || !u) return
    const out = count(u.output_tokens)
    const total = out + count(u.input_tokens) + count(u.cache_creation_input_tokens) + count(u.cache_read_input_tokens)
    const before = ctx.usage.get(agentId)
    ctx.usage.set(agentId, { total: (before?.total ?? 0) + total, out: (before?.out ?? 0) + out })
  } catch {
    // dropped on purpose
  }
}

async function readReports($: EngineInterface, ctx: Ctx) {
  const dir = `${ctx.root}/.team/reports/${today()}`
  const entries = await $.fs.list(dir).catch(() => [])
  const { byId, summary } = latestReportFiles(entries)
  const reports: Record<string, Report> = {}
  for (const [id, name] of Object.entries(byId)) {
    const entry = entries.find(e => e.name === name)
    const key = `${dir}/${name}`
    const hit = ctx.cache.get(key)
    if (hit && hit.mtimeMs === entry?.mtimeMs) {
      reports[id] = hit.report
      continue
    }
    const text = await $.fs.read(key).catch(() => '')
    const report = parseReport(text)
    ctx.cache.set(key, { mtimeMs: entry?.mtimeMs ?? 0, report })
    reports[id] = report
  }
  const lastSummary = summary ? `${summary.slice(0, 2)}:${summary.slice(2, 4)}` : ''
  return { reports, lastSummary }
}

async function refresh($: EngineInterface, ctx: Ctx) {
  const agents = await $.agent.list()
  // Looked up here, not at session.start, so the session start never waits on git.
  if (ctx.root === '') ctx.root = await findRoot($)
  const { reports, lastSummary } = await readReports($, ctx)
  const usage = sectionUsage({ agents, spawns: Object.fromEntries(ctx.spawns), usage: Object.fromEntries(ctx.usage) })
  const next = boardModel({ agents, reports, request: ctx.request, lastSummary, usage })
  const json = JSON.stringify(next)
  if (json === ctx.lastJson) return
  await update($, board, () => next)
  ctx.lastJson = json
}

// A failed tick is retried by the next one (lastJson only moves after a write lands) and logged once per message, to the debug log only.
async function poll($: EngineInterface, ctx: Ctx) {
  try {
    await refresh($, ctx)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === ctx.lastError) return
    ctx.lastError = message
    $.ui.log(`Team Board: refresh failed: ${message}`, { to: 'debug' })
  }
}

// The poll starts with the session (/team and section spawns call this too), once. There is no session.end hook:
// /clear ends a session without a new session.start, and the timer ends with the process.
function startPoll($: EngineInterface, ctx: Ctx) {
  if (ctx.stop) return
  ctx.stop = $.clock.every(POLL_MS, () => {
    void poll($, ctx)
  })
}

export const register: Register = on => {
  const ctx: Ctx = { root: '', request: '', lastJson: '', lastError: '', hasOpened: false, cache: new Map(), spawns: new Map(), usage: new Map() }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'team', description: 'Show the section-team Team Board' })
    ctx.root = ''
    resetCounts(ctx)
    startPoll($, ctx)
    // The board opens by itself with the session. Not awaited, so the start never waits on the open; a refused or failed open is dropped.
    ctx.hasOpened = true
    void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
    return next(e)
  })

  // /clear ends the session and no session.start follows: its counts and its request start again, and the poll keeps running.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      resetCounts(ctx)
      ctx.request = ''
    }
    return next(e)
  })

  on('command.run', { command: 'team' }, async $ => {
    startPoll($, ctx)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Team Board opened.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    recordSpawn(ctx, e, result)
    if (typeof e.subagentType !== 'string' || !e.subagentType.startsWith(PREFIX) || result.deny) return result
    startPoll($, ctx)
    // Only if session.start did not already open it; a person who closed the pane is not fought, /team opens it again.
    if (!ctx.hasOpened) {
      ctx.hasOpened = true
      void $.ui.open({ id: PANE, title: TITLE })
    }
    return result
  })

  // Watches only: the stream and its result pass through as they are; the counts are added after the last chunk, and the 1 s poll shows them.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    recordStep(ctx, e.agentId, result)
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    const first = e.text.split(/\r?\n/).find(line => line.trim() !== '' && !line.startsWith('/'))
    if (first) ctx.request = first.trim().slice(0, 120)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const data = await read($, board)
    const columns = e.props.bodyColumns ?? 80
    const width = Math.max(18, Math.floor(columns / (columns >= 90 ? 3 : 2)) - 1)
    const card = (c: BoardCard) => (
      <Box key={`card-${c.id}`} width={width} flexDirection="column" paddingX={1} borderStyle={c.kind === 'advisor' ? 'dashed' : 'round'} borderColor={COLOR[c.state]}>
        <Text bold color={COLOR[c.state]}>● {c.id}</Text>
        <Text wrap="truncate-end" dimColor={c.state === 'asleep'}>{c.line}</Text>
        {c.tokens ? <Text wrap="truncate-end" dimColor>{c.tokens}</Text> : null}
        {c.helpersLine ? <Text dimColor>{c.helpersLine}</Text> : null}
      </Box>
    )
    const counts = `${data.counts.active} active · ${data.counts.done} done · ${data.counts.problem} problem`
    return (
      <Box flexDirection="column" gap={1}>
        <Box key="supervisor" flexDirection="column" paddingX={1} borderStyle="double" borderColor="claude">
          <Text bold>Supervisor</Text>
          <Text wrap="truncate-end">{data.request === '' ? 'Waiting for your next request' : `Task: ${data.request}`}</Text>
          <Text dimColor>{data.lastSummary === '' ? counts : `${counts} · last summary ${data.lastSummary}`}</Text>
          {data.teamLine ? <Text dimColor>{data.teamLine}</Text> : null}
        </Box>
        <Text dimColor>Sections</Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>{data.cards.filter(c => c.kind === 'builder').map(card)}</Box>
        <Text dimColor>Advisors</Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>{data.cards.filter(c => c.kind === 'advisor').map(card)}</Box>
        <Box key="legend" flexDirection="row" gap={2}>
          <Text color={COLOR.running}>● running</Text>
          <Text color={COLOR.waiting}>● waiting</Text>
          <Text color={COLOR.done}>● done</Text>
          <Text color={COLOR.problem}>● problem</Text>
          <Text color={COLOR.asleep}>● asleep</Text>
        </Box>
      </Box>
    )
  })
}
