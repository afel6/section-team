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

// Answers, beneath the plugin, everything the board's poll reaches for; `seen` records what it asked.
function world(on: On) {
  const clock = mock.clock(on)
  const seen = { listed: '', opened: [] as string[], agentList: 0, logs: [] as string[] }
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('session.cwd', async () => ({ value: 'C:/proj' }))
  on('process.run', async () => ({ value: { exitCode: 0, stdout: 'C:/proj/.git\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('command.register', async () => ({ value: { command: 'team' } }))
  on('agent.list', async () => {
    seen.agentList += 1
    return { value: [{ id: '1', type: 'section-team:frontend', status: 'running', description: 'login form' }, { id: '2', type: 'section-team:backend', status: 'completed', description: 'api' }] }
  })
  on('fs.list', async (_$, e) => { seen.listed = e.path; return { value: [{ name: '101500-backend.md', ...FILE }, { name: '140200-supervisor-summary.md', ...FILE }] } })
  on('fs.read', async () => ({ value: REPORT }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('agent.spawn', async () => ({ model: 'sonnet' }))
  on('ui.open', async (_$, e) => { seen.opened.push(e.id); return { value: { isPlaced: true } } })
  on('ui.log', async (_$, e) => { seen.logs.push(e.text); return { value: undefined } })
  return { clock, seen }
}

test('the poll turns agents, saved reports and the request into cards and the pane opens by itself', async ($, on) => {
  const { clock, seen } = world(on)

  await $.session.start(START)
  await $.prompt.submit({ text: '/team\nadd login\nmore detail' })
  await $.agent.spawn({ prompt: 'x', description: 'login form', subagentType: 'general-purpose' })
  expect(seen.opened).toEqual([])
  await $.agent.spawn({ prompt: 'x', description: 'login form', subagentType: 'section-team:frontend' })
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

test('a second session.start leaves one poll, and a cleared session keeps polling', async ($, on) => {
  const { clock, seen } = world(on)

  await $.session.start(START)
  await $.session.start(START)
  await clock.advance(1000)
  expect(seen.agentList).toBe(1)

  // /clear ends the session and no session.start follows: the board must keep refreshing.
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  await clock.advance(1000)
  expect(seen.agentList).toBe(2)
})

test('a failed board write is retried on the next tick and logged once per message', async ($, on) => {
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
  await clock.advance(1000)
  await clock.advance(1000)
  expect(seen.agentList).toBe(2)
  expect(seen.logs).toHaveLength(1)
  expect(seen.logs[0]).toContain('disk full')

  await clock.advance(1000)
  const ui = await $.ui.mount({ plugin: 'section-team', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: PROPS as never })
  expect((await ui.find({ key: 'card-frontend' }))?.text).toContain('Running · login form')
  expect(seen.logs).toHaveLength(1)
})
