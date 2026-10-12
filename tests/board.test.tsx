import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { boardModel } from '../hooks/board-model.mjs'

const DATA = boardModel({
  agents: [
    { id: '1', type: 'section-team:frontend', status: 'running', description: 'login form' },
    { id: '2', type: 'section-team:backend', status: 'completed', description: 'api' },
    { id: '3', type: 'section-team:devops', status: 'failed', description: 'docker' },
  ],
  reports: { backend: { status: 'done', job: '/api/login + JWT', helpers: 'sonnet ×2' } },
  request: 'add login',
  lastSummary: '14:02',
})
const PROPS = { title: 'Team Board', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 } }

for (const surface of ['terminal', 'desktop'] as const) {
  test(`board draws every section on ${surface}`, async ($, on) => {
    // The test's `$` has no `state` noun, so the stored board is answered beneath the plugin.
    on('state.get', { plugin: 'section-team', key: 'board' }, async () => ({ value: { value: DATA, version: 1 } }))
    const ui = await $.ui.mount({ plugin: 'section-team', surface, component: 'Pane', requestId: 'team-board', props: PROPS as never })
    expect((await ui.find({ key: 'supervisor' }))?.text).toContain('Task: add login')
    expect((await ui.find({ key: 'card-frontend' }))?.text).toContain('Running · login form')
    expect((await ui.find({ key: 'card-backend' }))?.text).toContain('Done · /api/login + JWT')
    expect((await ui.find({ key: 'card-devops' }))?.text).toContain('Problem')
    expect((await ui.find({ key: 'card-mobile' }))?.text).toContain('Asleep')
    expect((await ui.find({ key: 'card-ai-engineer' }))?.text).toContain('Asleep')
  })
}

const FILE = { kind: 'file', size: 1, mtimeMs: 1, isLink: false } as const
const REPORT = '## REPORT · backend\nStatus: done\nJob: /api/login + JWT\nHelpers used: sonnet ×2\n'
const START = { cwd: 'C:/proj', surface: 'terminal', isInteractive: true } as const
const SECTION = { prompt: 'x', description: 'login form', subagentType: 'section-team:frontend' } as const
const OTHER = { prompt: 'x', description: 'login form', subagentType: 'general-purpose' } as const

// Answers, beneath the plugin, everything the board's poll reaches for; `seen` records what it asked.
function world(on: On) {
  const clock = mock.clock(on)
  const seen = { listed: '', opened: [] as string[], agentList: 0, runs: [] as { argv: readonly string[]; timeoutMs?: number }[], logs: [] as { text: string; to: string }[], denySpawn: false, denyOpen: false, holdOpen: false }
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('session.cwd', async () => ({ value: 'C:/proj' }))
  on('process.run', async (_$, e) => {
    seen.runs.push({ argv: e.argv, timeoutMs: e.init?.timeoutMs })
    return { value: { exitCode: 0, stdout: 'C:/proj/.git\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', async () => ({ value: { command: 'team' } }))
  on('agent.list', async () => {
    seen.agentList += 1
    return { value: [{ id: '1', type: 'section-team:frontend', status: 'running', description: 'login form' }, { id: '2', type: 'section-team:backend', status: 'completed', description: 'api' }] }
  })
  on('fs.list', async (_$, e) => { seen.listed = e.path; return { value: [{ name: '101500-backend.md', ...FILE }, { name: '140200-supervisor-summary.md', ...FILE }] } })
  on('fs.read', async () => ({ value: REPORT }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('agent.spawn', async () => (seen.denySpawn ? { deny: 'guard says no' } : { model: 'sonnet' }))
  on('ui.open', async (_$, e) => {
    seen.opened.push(e.id)
    if (seen.holdOpen) await new Promise<never>(() => undefined)
    return seen.denyOpen ? { deny: 'no pane today' } : { value: { isPlaced: true } }
  })
  on('ui.log', async (_$, e) => { seen.logs.push({ text: e.text, to: e.to }); return { value: undefined } })
  return { clock, seen }
}

test('the poll turns agents, saved reports and the request into cards and the pane opens by itself', async ($, on) => {
  const { clock, seen } = world(on)

  await $.session.start(START)
  expect(seen.opened).toEqual(['team-board'])
  await $.prompt.submit({ text: '/team\nadd login\nmore detail' })
  await $.agent.spawn(OTHER)
  await $.agent.spawn(SECTION)
  expect(seen.opened).toEqual(['team-board'])
  expect(await $.command.run({ command: 'team' })).toEqual({ text: 'Team Board opened.' })
  expect(seen.opened).toEqual(['team-board', 'team-board'])

  await clock.advance(1000)
  expect(seen.listed).toMatch(/^C:[\\/]proj[\\/]\.team[\\/]reports[\\/]\d{4}-\d{2}-\d{2}$/)
  const ui = await $.ui.mount({ plugin: 'section-team', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: PROPS as never })
  expect((await ui.find({ key: 'supervisor' }))?.text).toContain('Task: add login')
  expect((await ui.find({ key: 'supervisor' }))?.text).toContain('last summary 14:02')
  expect((await ui.find({ key: 'card-frontend' }))?.text).toContain('Running · login form')
  expect((await ui.find({ key: 'card-backend' }))?.text).toContain('Done · /api/login + JWT')
  expect((await ui.find({ key: 'card-backend' }))?.text).toContain('sonnet ×2')
})

// Intentionally replaces "a session that never uses the team never polls or runs git" (user decision 2026-10-12, spec §9.3).
test('session.start alone opens the pane and starts the poll: waiting for /team or a section spawn is intentionally removed', async ($, on) => {
  const { clock, seen } = world(on)

  await $.session.start(START)
  expect(seen.opened).toEqual(['team-board'])
  expect(seen.agentList).toBe(0)
  expect(seen.runs).toEqual([])

  await clock.advance(1000)
  expect(seen.agentList).toBe(1)
  expect(seen.runs).toHaveLength(1)
})

test('two session.start events leave one poll: exactly one agent.list per tick', async ($, on) => {
  const { clock, seen } = world(on)

  await $.session.start(START)
  await $.session.start(START)
  await clock.advance(1000)
  expect(seen.agentList).toBe(1)
  await clock.advance(1000)
  expect(seen.agentList).toBe(2)
})

test('a refused pane open never fails session.start and the poll still ticks', async ($, on) => {
  const { clock, seen } = world(on)
  seen.denyOpen = true

  await $.session.start(START)
  await clock.advance(1000)
  expect(seen.opened).toEqual(['team-board'])
  expect(seen.agentList).toBe(1)
})

test('session.start does not wait for the pane open', async ($, on) => {
  const { clock, seen } = world(on)
  seen.holdOpen = true

  const outcome = await Promise.race([$.session.start(START).then(() => 'returned'), new Promise(resolve => setTimeout(() => resolve('waited'), 300))])
  expect(outcome).toBe('returned')
  await clock.advance(1000)
  expect(seen.agentList).toBe(1)
})

test('the git root is looked up on the first refresh, not at session.start or /team, with a 5 s limit', async ($, on) => {
  const { clock, seen } = world(on)

  await $.session.start(START)
  expect(seen.runs).toEqual([])
  await $.command.run({ command: 'team' })
  expect(seen.runs).toEqual([])
  expect(seen.agentList).toBe(0)

  await clock.advance(1000)
  expect(seen.agentList).toBe(1)
  expect(seen.runs).toHaveLength(1)
  expect(seen.runs[0].argv.slice(0, 2)).toEqual(['git', 'rev-parse'])
  expect(seen.runs[0].timeoutMs).toBe(5000)

  await clock.advance(1000)
  expect(seen.agentList).toBe(2)
  expect(seen.runs).toHaveLength(1)
})

test('a section spawn and /team after session.start do not add a second poll', async ($, on) => {
  const { clock, seen } = world(on)

  await $.session.start(START)
  await $.agent.spawn(SECTION)
  await $.command.run({ command: 'team' })
  await $.agent.spawn(SECTION)
  await clock.advance(1000)
  expect(seen.agentList).toBe(1)
  expect(seen.runs).toHaveLength(1)
})

test('a denied or allowed section spawn after session.start opens nothing more and adds no second poll', async ($, on) => {
  const { clock, seen } = world(on)

  await $.session.start(START)
  seen.denySpawn = true
  expect(await $.agent.spawn(SECTION)).toEqual({ deny: 'guard says no' })
  await clock.advance(3000)
  expect(seen.opened).toEqual(['team-board'])
  expect(seen.agentList).toBe(3)

  seen.denySpawn = false
  await $.agent.spawn(SECTION)
  expect(seen.opened).toEqual(['team-board'])
  await clock.advance(1000)
  expect(seen.agentList).toBe(4)
})

test('session.start opens the pane once, spawns do not open it again, /team always opens it', async ($, on) => {
  const { seen } = world(on)

  await $.session.start(START)
  expect(seen.opened).toEqual(['team-board'])
  await $.agent.spawn(SECTION)
  await $.agent.spawn({ ...SECTION, subagentType: 'section-team:backend' })
  expect(seen.opened).toEqual(['team-board'])
  await $.command.run({ command: 'team' })
  await $.command.run({ command: 'team' })
  expect(seen.opened).toEqual(['team-board', 'team-board', 'team-board'])
})

test('a second session.start leaves one poll, and a cleared session keeps polling', async ($, on) => {
  const { clock, seen } = world(on)

  await $.session.start(START)
  await $.command.run({ command: 'team' })
  await $.session.start(START)
  await $.command.run({ command: 'team' })
  await clock.advance(1000)
  expect(seen.agentList).toBe(1)

  // /clear ends the session and no session.start follows: the board must keep refreshing.
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  await clock.advance(1000)
  expect(seen.agentList).toBe(2)
})

test('a failed board write is retried on the next tick and logged once per message, to the debug log only', async ($, on) => {
  const { clock, seen } = world(on)
  let failures = 2
  on('state.set', { plugin: 'section-team', key: 'board' }, async (_$, e, next) => {
    if (failures > 0) {
      failures -= 1
      return { deny: 'disk full' }
    }
    return next(e)
  })

  await $.session.start(START)
  await $.command.run({ command: 'team' })
  await clock.advance(1000)
  await clock.advance(1000)
  expect(seen.agentList).toBe(2)
  expect(seen.logs).toHaveLength(1)
  expect(seen.logs[0].text).toContain('disk full')
  expect(seen.logs[0].to).toBe('debug')

  await clock.advance(1000)
  const ui = await $.ui.mount({ plugin: 'section-team', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: PROPS as never })
  expect((await ui.find({ key: 'card-frontend' }))?.text).toContain('Running · login form')
  expect(seen.logs).toHaveLength(1)
})
