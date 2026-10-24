import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'
import type { BoardCard, BoardData } from '../types'
import { boardModel, emptyBoard, latestReportFiles, sectionUsage, stripLine } from './board-model.mjs'
import { parseReport, PREFIX } from './lib/report.mjs'
import { statusDir, statusRecord } from './sessions-model.mjs'

// The scan that lists a module's state reads an atom only when it is declared in this file.
const board = atom({ plugin: 'section-team', key: 'board' } as const, emptyBoard() as BoardData)
const PANE = 'team-board'
const TITLE = 'Team Board'
const POLL_MS = 1000
const GIT_TIMEOUT_MS = 5000
const HEARTBEAT_MS = 60 * 1000
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
  root: string; request: string; lastJson: string; lastError: string; stop?: Timer
  board: BoardData; turnActive: boolean; mainTurnId: string; startedAt?: number; endedId?: string; lastStatus: string; lastWrite: number
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
  ctx.board = next
  const json = JSON.stringify(next)
  if (json !== ctx.lastJson) {
    await update($, board, () => next)
    ctx.lastJson = json
  }
  await writeStatus($, ctx)
}

// The status file the /chats dashboard reads, one per session id under the home folder. It is written when anything but updatedAt changes,
// and every HEARTBEAT_MS while working, so a session that died goes stale. A session waiting for you is not rewritten: its updatedAt freezes
// and the dashboard turns it idle after IDLE_MS. Without a home there is nowhere to write: skipped, silently.
async function writeStatus($: EngineInterface, ctx: Ctx, ended?: { sessionId: string }) {
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
  if (!home) return
  const now = await $.clock.now()
  ctx.startedAt ??= now
  const sessionId = ended?.sessionId ?? (await $.session.id())
  // Seeing another id means the chat has moved on; seeing the ended one again (a /resume back to it) writes it afresh.
  if (!ended && sessionId !== ctx.endedId) ctx.endedId = undefined
  const record = statusRecord({ sessionId, cwd: await $.session.cwd(), request: ctx.request, board: ctx.board, turnActive: ctx.turnActive, startedAt: ctx.startedAt, now, ended: ended !== undefined })
  const key = JSON.stringify({ ...record, updatedAt: 0 })
  if (key === ctx.lastStatus && (record.state !== 'working' || now - ctx.lastWrite < HEARTBEAT_MS)) return
  // A tick that still answers the old id after the session ended (in flight, or before the id switches) must not un-end its file.
  if (!ended && sessionId === ctx.endedId) return
  await $.fs.write(`${statusDir(home)}/${sessionId}.json`, JSON.stringify(record))
  ctx.lastStatus = key
  ctx.lastWrite = now
}

// Logged once per message, to the debug log only.
function logFailure($: EngineInterface, ctx: Ctx, what: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (message === ctx.lastError) return
  ctx.lastError = message
  $.ui.log(`Team Board: ${what} failed: ${message}`, { to: 'debug' })
}

// A failed tick is retried by the next one (lastJson and lastStatus only move after a write lands).
async function poll($: EngineInterface, ctx: Ctx) {
  try {
    await refresh($, ctx)
  } catch (error) {
    logFailure($, ctx, 'refresh', error)
  }
}

// The poll starts with the session (/team and section spawns call this too), once. The session.end hook below only
// resets the counts on /clear; it never stops the poll (/clear starts no new session.start), and the timer ends with the process.
function startPoll($: EngineInterface, ctx: Ctx) {
  if (ctx.stop) return
  ctx.stop = $.clock.every(POLL_MS, () => {
    void poll($, ctx)
  })
}

export const register: Register = on => {
  const ctx: Ctx = { root: '', request: '', lastJson: '', lastError: '', board: emptyBoard() as BoardData, turnActive: false, mainTurnId: '', lastStatus: '', lastWrite: 0, cache: new Map(), spawns: new Map(), usage: new Map() }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'team', description: 'Show the section-team Team Board' })
    ctx.root = ''
    resetCounts(ctx)
    startPoll($, ctx)
    return next(e)
  })

  // The ended file is written first, while it still holds the request and the board of the session that is ending.
  // /clear ends the session and no session.start follows: its counts and its request start again, and the poll keeps running.
  on('session.end', async ($, e, next) => {
    ctx.endedId = e.sessionId // before the first await: writeStatus must see it from here on
    await writeStatus($, ctx, { sessionId: e.sessionId }).catch(error => logFailure($, ctx, 'status write', error))
    if (e.reason === 'clear') {
      resetCounts(ctx)
      ctx.request = ''
      ctx.startedAt = undefined
    }
    return next(e)
  })

  // The chat's own turn, not a helper's: it decides between working and needs-you in the status file.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      ctx.mainTurnId = e.turnId
      ctx.turnActive = true
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.turnId === ctx.mainTurnId) ctx.turnActive = false
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

  // The strip: one line above the prompt, drawn from the same stored board as the pane. A survey holds the band, so the strip yields to it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const data = await read($, board)
    return (
      <Box key="strip" gap={1}>
        <Text wrap="truncate-end">{stripLine(data)}</Text>
        <Button key="open-board" label="Board" onPress={() => $.ui.open({ id: PANE, title: TITLE })} />
      </Box>
    )
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
    // Sections nobody woke are one line, not a card each; a heading is drawn only when it has a card under it.
    const awake = data.cards.filter(c => c.state !== 'asleep')
    const asleep = data.cards.length - awake.length
    const group = (title: string, kind: BoardCard['kind']) => {
      const cards = awake.filter(c => c.kind === kind)
      return cards.length === 0 ? null : (
        <Box key={`group-${kind}`} flexDirection="column" gap={1}>
          <Text dimColor>{title}</Text>
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>{cards.map(card)}</Box>
        </Box>
      )
    }
    return (
      <Box flexDirection="column" gap={1}>
        <Box key="supervisor" flexDirection="column" paddingX={1} borderStyle="double" borderColor="claude">
          <Text bold>Supervisor</Text>
          <Text wrap="truncate-end">{data.request === '' ? 'Waiting for your next request' : `Task: ${data.request}`}</Text>
          <Text dimColor>{data.lastSummary === '' ? counts : `${counts} · last summary ${data.lastSummary}`}</Text>
          {data.teamLine ? <Text dimColor>{data.teamLine}</Text> : null}
        </Box>
        {group('Sections', 'builder')}
        {group('Advisors', 'advisor')}
        <Box key="asleep"><Text dimColor>{asleep} asleep</Text></Box>
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
