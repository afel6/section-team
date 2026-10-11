import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { BoardCard, BoardData } from '../types'
import { boardModel, emptyBoard, latestReportFiles } from './board-model.mjs'
import { parseReport, PREFIX } from './lib/report.mjs'

// The scan that lists a module's state reads an atom only when it is declared in this file.
const board = atom({ plugin: 'section-team', key: 'board' } as const, emptyBoard() as BoardData)
const PANE = 'team-board'
const TITLE = 'Team Board'
const COLOR = { asleep: 'inactive', running: 'suggestion', waiting: 'warning', done: 'success', problem: 'error' } as const
const pad = (n: number) => String(n).padStart(2, '0')
const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

async function findRoot($: EngineInterface): Promise<string> {
  const cwd = await $.session.cwd()
  const result = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd }).catch(() => undefined)
  const common = result?.exitCode === 0 ? result.stdout.trim() : ''
  return /[\\/]\.git$/.test(common) ? common.replace(/[\\/]\.git$/, '') : cwd
}

type Report = ReturnType<typeof parseReport>
type Ctx = { root: string; request: string; lastJson: string; cache: Map<string, { mtimeMs: number; report: Report }> }

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
  const { reports, lastSummary } = await readReports($, ctx)
  const next = boardModel({ agents, reports, request: ctx.request, lastSummary })
  const json = JSON.stringify(next)
  if (json === ctx.lastJson) return
  ctx.lastJson = json
  await update($, board, () => next)
}

export const register: Register = on => {
  let stop: (() => void) | undefined
  const ctx: Ctx = { root: '', request: '', lastJson: '', cache: new Map() }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'team', description: 'Show the section-team Team Board' })
    ctx.root = await findRoot($)
    stop?.()
    stop = $.clock.every(1000, () => {
      void refresh($, ctx).catch(() => undefined)
    })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    stop?.()
    stop = undefined
    return next(e)
  })

  on('command.run', { command: 'team' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Team Board opened.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (typeof e.subagentType === 'string' && e.subagentType.startsWith(PREFIX)) void $.ui.open({ id: PANE, title: TITLE })
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
        {c.helpers !== '' && <Text wrap="truncate-end" dimColor>{c.helpers}</Text>}
      </Box>
    )
    const counts = `${data.counts.active} active · ${data.counts.done} done · ${data.counts.problem} problem`
    return (
      <Box flexDirection="column" gap={1}>
        <Box key="supervisor" flexDirection="column" paddingX={1} borderStyle="double" borderColor="claude">
          <Text bold>Supervisor</Text>
          <Text wrap="truncate-end">{data.request === '' ? 'Waiting for your next request' : `Task: ${data.request}`}</Text>
          <Text dimColor>{data.lastSummary === '' ? counts : `${counts} · last summary ${data.lastSummary}`}</Text>
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
