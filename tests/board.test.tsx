import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { boardModel } from '../hooks/board-model.mjs'
import { register } from '../hooks/register'

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
    // Sections nobody woke fold into one line instead of a card each.
    expect(await ui.find({ key: 'card-mobile' })).toBeUndefined()
    expect(await ui.find({ key: 'card-ai-engineer' })).toBeUndefined()
    expect((await ui.find({ key: 'asleep' }))?.text).toBe('9 asleep')
  })
}

const FILE = { kind: 'file', size: 1, mtimeMs: 1, isLink: false } as const
const REPORT = '## REPORT · backend\nStatus: done\nJob: /api/login + JWT\nHelpers used: sonnet ×2\n'
const START = { cwd: 'C:/proj', surface: 'terminal', isInteractive: true } as const
const SECTION = { prompt: 'x', description: 'login form', subagentType: 'section-team:frontend' } as const
const OTHER = { prompt: 'x', description: 'login form', subagentType: 'general-purpose' } as const

// Answers, beneath the plugin, everything the board's poll reaches for; `seen` records what it asked.
function world(on: On, now = 0) {
  const clock = mock.clock(on, { now })
  const seen = { listed: '', opened: [] as string[], agentList: 0, runs: [] as { argv: readonly string[]; timeoutMs?: number }[], logs: [] as { text: string; to: string }[], denySpawn: false,
    writes: [] as { path: string; text: string }[], env: { USERPROFILE: 'C:/Users/u' } as Record<string, string | undefined>, sessionId: 's1', denyWrite: undefined as string | undefined, registered: [] as string[],
    // The status folder the /chats pane reads: file texts by name (mtimes by name, T0 when not given), a refusal, and what was asked of it.
    chats: { files: {} as Record<string, string>, mtimes: {} as Record<string, number>, deny: undefined as string | undefined, lists: 0, reads: [] as string[] },
    agents: undefined as readonly object[] | undefined, spawnAnswer: undefined as ((e: { subagentType: string; parentAgentId?: string }) => { model: string; agentId?: string }) | undefined, stepUsage: null as unknown }
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('session.cwd', async () => ({ value: 'C:/proj' }))
  on('session.id', async () => ({ value: seen.sessionId }))
  on('env.get', async (_$, e) => ({ value: seen.env[e.name] }))
  on('fs.write', async (_$, e) => {
    if (seen.denyWrite) return { deny: seen.denyWrite }
    // The engine hands the path over as the OS spells it (backslashes on Windows).
    seen.writes.push({ path: e.path.replaceAll('\\', '/'), text: e.text })
    return { value: undefined }
  })
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('process.run', async (_$, e) => {
    seen.runs.push({ argv: e.argv, timeoutMs: e.init?.timeoutMs })
    return { value: { exitCode: 0, stdout: 'C:/proj/.git\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', async (_$, e) => {
    seen.registered.push(e.name)
    return { value: { command: e.name } }
  })
  on('agent.list', async () => {
    seen.agentList += 1
    return { value: seen.agents ?? [{ id: '1', type: 'section-team:frontend', status: 'running', description: 'login form' }, { id: '2', type: 'section-team:backend', status: 'completed', description: 'api' }] }
  })
  on('fs.list', async (_$, e) => {
    if (slashes(e.path) === STATUS_DIR) {
      seen.chats.lists += 1
      if (seen.chats.deny) return { deny: seen.chats.deny }
      return { value: Object.keys(seen.chats.files).map(name => ({ name, ...FILE, mtimeMs: seen.chats.mtimes[name] ?? T0 })) }
    }
    seen.listed = e.path
    return { value: [{ name: '101500-backend.md', ...FILE }, { name: '140200-supervisor-summary.md', ...FILE }] }
  })
  on('fs.read', async (_$, e) => {
    const path = slashes(e.path)
    if (!path.startsWith(`${STATUS_DIR}/`)) return { value: REPORT }
    const name = path.slice(STATUS_DIR.length + 1)
    seen.chats.reads.push(name)
    return { value: seen.chats.files[name] }
  })
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('agent.spawn', async (_$, e) => (seen.denySpawn ? { deny: 'guard says no' } : seen.spawnAnswer?.(e) ?? { model: 'sonnet' }))
  // The model's answer to a step, beneath the plugin: one text chunk, then a result carrying the usage the test set.
  on('turn.step', async function* (_$, e) {
    yield { kind: 'text', index: 0, text: 'ok' } as const
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: seen.stepUsage as never }
  })
  on('ui.open', async (_$, e) => {
    seen.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.log', async (_$, e) => { seen.logs.push({ text: e.text, to: e.to }); return { value: undefined } })
  return { clock, seen }
}

test('the poll turns agents, saved reports and the request into cards, and only /team opens the pane', async ($, on) => {
  const { clock, seen } = world(on)

  await $.session.start(START)
  expect(seen.opened).toEqual([])
  await $.prompt.submit({ text: '/team\nadd login\nmore detail' })
  await $.agent.spawn(OTHER)
  await $.agent.spawn(SECTION)
  expect(seen.opened).toEqual([])
  expect(await $.command.run({ command: 'team' })).toEqual({ text: 'Team Board opened.' })
  expect(seen.opened).toEqual(['team-board'])

  await clock.advance(1000)
  expect(seen.listed).toMatch(/^C:[\\/]proj[\\/]\.team[\\/]reports[\\/]\d{4}-\d{2}-\d{2}$/)
  const ui = await $.ui.mount({ plugin: 'section-team', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: PROPS as never })
  expect((await ui.find({ key: 'supervisor' }))?.text).toContain('Task: add login')
  expect((await ui.find({ key: 'supervisor' }))?.text).toContain('last summary 14:02')
  expect((await ui.find({ key: 'card-frontend' }))?.text).toContain('Running · login form')
  expect((await ui.find({ key: 'card-backend' }))?.text).toContain('Done · /api/login + JWT')
  // The report's "Helpers used" line gives way to the live helpers line, which is empty without spawns.
  expect((await ui.find({ key: 'card-backend' }))?.text).not.toContain('sonnet ×2')
})

// Intentionally replaces "a session that never uses the team never polls or runs git" (user decision 2026-10-12, spec §9.3).
test('session.start alone starts the poll but opens no pane: waiting for /team or a section spawn is intentionally removed', async ($, on) => {
  const { clock, seen } = world(on)

  await $.session.start(START)
  expect(seen.opened).toEqual([])
  expect(seen.agentList).toBe(0)
  expect(seen.runs).toEqual([])

  await clock.advance(1000)
  expect(seen.agentList).toBe(1)
  expect(seen.runs).toHaveLength(1)
  expect(seen.opened).toEqual([])
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

test('a denied or allowed section spawn after session.start opens nothing and adds no second poll', async ($, on) => {
  const { clock, seen } = world(on)

  await $.session.start(START)
  seen.denySpawn = true
  expect(await $.agent.spawn(SECTION)).toEqual({ deny: 'guard says no' })
  await clock.advance(3000)
  expect(seen.opened).toEqual([])
  expect(seen.agentList).toBe(3)

  seen.denySpawn = false
  await $.agent.spawn(SECTION)
  expect(seen.opened).toEqual([])
  await clock.advance(1000)
  expect(seen.agentList).toBe(4)
})

test('neither session.start nor section spawns open the pane, /team always does', async ($, on) => {
  const { seen } = world(on)

  await $.session.start(START)
  await $.agent.spawn(SECTION)
  await $.agent.spawn({ ...SECTION, subagentType: 'section-team:backend' })
  expect(seen.opened).toEqual([])
  await $.command.run({ command: 'team' })
  await $.command.run({ command: 'team' })
  expect(seen.opened).toEqual(['team-board', 'team-board'])
})

const BAND = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} }
const mountStrip = ($: { ui: { mount: (t: never) => Promise<{ find: (q: { key: string }) => Promise<{ text: string } | undefined>; press: (t: { key: string }) => Promise<unknown> }> } }, props: object = BAND) =>
  $.ui.mount({ plugin: 'section-team', surface: 'terminal', component: 'AbovePrompt', props } as never)

test('the strip sits above the prompt: idle before anyone wakes, then the sections that are awake', async ($, on) => {
  const { clock } = world(on)

  await $.session.start(START)
  expect((await (await mountStrip($ as never)).find({ key: 'strip' }))?.text).toContain('Team · idle')

  await clock.advance(1000)
  const text = (await (await mountStrip($ as never)).find({ key: 'strip' }))?.text
  expect(text).toContain('Team · ● frontend running · ● backend done · 10 asleep')
})

test('the strip button opens the board, and a survey on the band leaves the band to the engine', async ($, on) => {
  const { clock, seen } = world(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  await $.session.start(START)
  await clock.advance(1000)
  const ui = await mountStrip($ as never)
  expect(seen.opened).toEqual([])
  await ui.press({ key: 'open-board' })
  expect(seen.opened).toEqual(['team-board'])

  const survey = await mountStrip($ as never, { ...BAND, hasSurvey: true })
  expect(await survey.find({ key: 'strip' })).toBeUndefined()
})

test('the board pane draws the sections that are awake and folds the rest into one asleep line', async ($, on) => {
  const { clock } = world(on)

  await $.session.start(START)
  await clock.advance(1000)
  const ui = await mountBoard($ as never)
  expect((await ui.find({ key: 'card-frontend' }))?.text).toContain('Running · login form')
  expect(await ui.find({ key: 'card-mobile' })).toBeUndefined()
  expect((await ui.find({ key: 'asleep' }))?.text).toMatch(/\d+ asleep/)
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

const usage = (input: number, output: number, cacheRead: number, cacheCreate: number) =>
  ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheCreate, model: 'claude-opus-5-5' })

// One model step through the plugin's hooks as the engine raises it; the chunks it yields and the result it returns.
async function step($: { turn: { step: (e: never) => AsyncGenerator<unknown, unknown> } }, seen: { stepUsage: unknown }, agentId: string | undefined, stepUsage: unknown) {
  seen.stepUsage = stepUsage
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...(agentId ? { agentId } : {}) } as never)
  const chunks: unknown[] = []
  for (;;) {
    const next = await stream.next()
    if (next.done) return { chunks, result: next.value }
    chunks.push(next.value)
  }
}

const TEAM = [
  { id: 'S1', type: 'section-team:frontend', status: 'running', description: 'login form' },
  { id: 'H1', type: 'general-purpose', status: 'running', description: 'look up', parentId: 'S1' },
  { id: 'X1', type: 'general-purpose', status: 'running', description: 'supervisor helper' },
]
const answerSpawns = (e: { subagentType: string; parentAgentId?: string }) => {
  if (e.parentAgentId === 'S1') return { model: 'claude-haiku-5-5', agentId: 'H1' }
  return e.subagentType.startsWith('section-team:') ? { model: 'claude-opus-5-5', agentId: 'S1' } : { model: 'claude-haiku-5-5', agentId: 'X1' }
}

test('a section card shows its tokens and its helpers by model, the supervisor card the team total', async ($, on) => {
  const { clock, seen } = world(on)
  seen.agents = TEAM
  seen.spawnAnswer = answerSpawns

  await $.session.start(START)
  await $.agent.spawn(SECTION)
  await $.agent.spawn({ ...OTHER, parentAgentId: 'S1', model: 'haiku' } as never)
  await $.agent.spawn(OTHER)
  await step($ as never, seen, 'S1', usage(100, 50, 1000, 200))
  await step($ as never, seen, 'S1', usage(10, 40, 0, 0))
  await step($ as never, seen, 'H1', usage(2000, 500, 3000, 500))
  // Not the section's: the supervisor's own steps and its own helper's.
  await step($ as never, seen, undefined, usage(9000, 900, 0, 0))
  await step($ as never, seen, 'X1', usage(5000, 500, 0, 0))

  await clock.advance(1000)
  const ui = await $.ui.mount({ plugin: 'section-team', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: PROPS as never })
  const frontend = (await ui.find({ key: 'card-frontend' }))?.text
  expect(frontend).toContain('Running · login form')
  expect(frontend).toContain('tokens 7.4k · out 590')
  expect(frontend).toContain('helpers 1 · haiku×1')
  expect((await ui.find({ key: 'supervisor' }))?.text).toContain('team tokens 7.4k · 1 helper')
  expect((await ui.find({ key: 'supervisor' }))?.text).not.toContain('1 helpers')
  const backend = (await ui.find({ key: 'card-backend' }))?.text
  expect(backend).not.toContain('tokens')
  expect(backend).not.toContain('helpers')
})

test('steps pass through untouched, a denied spawn is not counted, a step without usable counts adds nothing', async ($, on) => {
  const { clock, seen } = world(on)
  seen.agents = TEAM
  seen.spawnAnswer = answerSpawns

  await $.session.start(START)
  await $.agent.spawn(SECTION)
  seen.denySpawn = true
  expect(await $.agent.spawn({ ...OTHER, parentAgentId: 'S1' } as never)).toEqual({ deny: 'guard says no' })
  seen.denySpawn = false
  await $.agent.spawn({ ...OTHER, parentAgentId: 'S1' } as never)

  const good = usage(1, 2, 3, 4)
  const first = await step($ as never, seen, 'S1', good)
  expect(first.chunks).toEqual([{ kind: 'text', index: 0, text: 'ok' }])
  expect(first.result).toEqual({ turnId: 't1', index: 0, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: good })
  for (const bad of [null, { ...good, output_tokens: 'lots', input_tokens: undefined, cache_read_input_tokens: null, cache_creation_input_tokens: {} }, { cache_read_input_tokens: Number.NaN }]) {
    const again = await step($ as never, seen, 'S1', bad)
    expect(again.chunks).toEqual(first.chunks)
    expect(again.result).toEqual({ ...first.result as object, usage: bad })
  }

  await clock.advance(1000)
  const ui = await $.ui.mount({ plugin: 'section-team', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: PROPS as never })
  const frontend = (await ui.find({ key: 'card-frontend' }))?.text
  expect(frontend).toContain('tokens 10 · out 2')
  expect(frontend).toContain('helpers 1 · haiku×1')
  expect(frontend).not.toContain('NaN')
})

const mountBoard = ($: { ui: { mount: (t: never) => Promise<{ find: (q: { key: string }) => Promise<{ text: string } | undefined>; unmount: () => Promise<void> }> } }) =>
  $.ui.mount({ plugin: 'section-team', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: PROPS } as never)

// Counts something worth resetting: a request, a section, one helper, and steps of both.
async function work($: never, seen: never) {
  await ($ as { prompt: { submit: (e: never) => Promise<unknown> } }).prompt.submit({ text: 'add login' } as never)
  await ($ as { agent: { spawn: (e: never) => Promise<unknown> } }).agent.spawn(SECTION as never)
  await ($ as { agent: { spawn: (e: never) => Promise<unknown> } }).agent.spawn({ ...OTHER, parentAgentId: 'S1' } as never)
  await step($, seen, 'S1', usage(100, 50, 0, 0))
  await step($, seen, 'H1', usage(1, 2, 3, 4))
}

test('a /clear starts the counts again, keeps the poll alive, and the next steps are counted from zero', async ($, on) => {
  const { clock, seen } = world(on)
  seen.agents = TEAM
  seen.spawnAnswer = answerSpawns

  await $.session.start(START)
  await work($ as never, seen as never)
  await clock.advance(1000)
  let ui = await mountBoard($ as never)
  expect((await ui.find({ key: 'card-frontend' }))?.text).toContain('tokens 160 · out 52')
  expect((await ui.find({ key: 'card-frontend' }))?.text).toContain('helpers 1 · haiku×1')
  expect((await ui.find({ key: 'supervisor' }))?.text).toContain('Task: add login')

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  const listed = seen.agentList
  await clock.advance(1000)
  expect(seen.agentList).toBe(listed + 1)
  await ui.unmount()
  ui = await mountBoard($ as never)
  const cleared = (await ui.find({ key: 'card-frontend' }))?.text
  expect(cleared).toContain('Running · login form')
  expect(cleared).not.toContain('tokens')
  expect(cleared).not.toContain('helpers')
  expect((await ui.find({ key: 'supervisor' }))?.text).not.toContain('team tokens')
  expect((await ui.find({ key: 'supervisor' }))?.text).toContain('Waiting for your next request')

  await step($ as never, seen, 'S1', usage(7, 3, 0, 0))
  await clock.advance(1000)
  expect(seen.agentList).toBe(listed + 2)
  await ui.unmount()
  ui = await mountBoard($ as never)
  expect((await ui.find({ key: 'card-frontend' }))?.text).toContain('tokens 10 · out 3')
  expect((await ui.find({ key: 'card-frontend' }))?.text).not.toContain('helpers')
})

test('a session that ends for any other reason keeps its counts, a new session.start resets them', async ($, on) => {
  const { clock, seen } = world(on)
  seen.agents = TEAM
  seen.spawnAnswer = answerSpawns

  await $.session.start(START)
  await work($ as never, seen as never)
  await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
  await clock.advance(1000)
  let ui = await mountBoard($ as never)
  expect((await ui.find({ key: 'card-frontend' }))?.text).toContain('tokens 160 · out 52')
  expect((await ui.find({ key: 'supervisor' }))?.text).toContain('Task: add login')

  await $.session.start(START)
  await clock.advance(1000)
  await ui.unmount()
  ui = await mountBoard($ as never)
  const restarted = (await ui.find({ key: 'card-frontend' }))?.text
  expect(restarted).not.toContain('tokens')
  expect(restarted).not.toContain('helpers')
})

// The status file the /chats dashboard reads: one JSON per session id, under the home folder.
const STATUS_DIR = 'C:/Users/u/.claude/section-team/sessions'
const T0 = 1_700_000_000_000
const MINUTE = 60 * 1000
const slashes = (path: string) => path.replaceAll('\\', '/')
const IDLE_TEAM = [{ id: '2', type: 'section-team:backend', status: 'completed', description: 'api' }]
const TURN_DONE = { answer: 'ok', durationMs: 5, isAborted: false, reason: 'answer' } as const
const statusOf = (seen: { writes: { path: string; text: string }[] }, id: string) => seen.writes.filter(w => w.path === `${STATUS_DIR}/${id}.json`).map(w => JSON.parse(w.text))

test('a session writes its status file: working while its turn runs, needs-you once the turn completes', async ($, on) => {
  const { clock, seen } = world(on)
  seen.agents = IDLE_TEAM

  await $.session.start(START)
  await $.prompt.submit({ text: 'add login\nthe second line stays out of the file' })
  await $.turn.start({ text: 'add login', turnId: 't1' })
  await clock.advance(1000)
  expect(seen.writes).toHaveLength(1)
  expect(seen.writes[0].text).not.toContain('second line')
  expect(statusOf(seen, 's1')[0]).toEqual({
    sessionId: 's1', cwd: 'C:/proj', project: 'proj', request: 'add login', state: 'working',
    sections: [{ id: 'backend', state: 'done' }], helpers: 0, tokens: 0, startedAt: 1000, updatedAt: 1000, ended: false,
  })

  // A helper's turn is not the chat's turn: it neither starts nor ends it.
  await $.turn.start({ text: 'look up', turnId: 't2', agentId: 'H1' })
  await $.turn.complete({ ...TURN_DONE, turnId: 't2', agentId: 'H1' })
  await clock.advance(1000)
  expect(statusOf(seen, 's1')).toHaveLength(1)

  await $.turn.complete({ ...TURN_DONE, turnId: 't1' })
  await clock.advance(1000)
  expect(statusOf(seen, 's1')).toHaveLength(2)
  expect(statusOf(seen, 's1')[1].state).toBe('needs-you')
  expect(statusOf(seen, 's1')[1].startedAt).toBe(1000)
})

test('a busy section keeps the session working even with no turn running', async ($, on) => {
  const { clock, seen } = world(on)

  await $.session.start(START)
  await clock.advance(1000)
  expect(statusOf(seen, 's1')[0].state).toBe('working')
  expect(statusOf(seen, 's1')[0].sections).toEqual([{ id: 'frontend', state: 'running' }, { id: 'backend', state: 'done' }])
})

test('a working session is not rewritten while its status is unchanged, then a heartbeat after 60 s', async ($, on) => {
  const { clock, seen } = world(on)

  await $.session.start(START)
  await clock.advance(1000)
  expect(statusOf(seen, 's1')[0].state).toBe('working')
  expect(seen.writes).toHaveLength(1)
  await clock.advance(59000)
  expect(seen.writes).toHaveLength(1)
  await clock.advance(1000)
  expect(seen.writes).toHaveLength(2)
  expect(statusOf(seen, 's1')[1].updatedAt).toBe(61000)
  expect(statusOf(seen, 's1')[1].startedAt).toBe(1000)
})

test('a session waiting for you is written once and never heartbeats, so its updatedAt freezes and the dashboard can age it to idle', async ($, on) => {
  const { clock, seen } = world(on)
  seen.agents = IDLE_TEAM

  await $.session.start(START)
  await clock.advance(1000)
  expect(statusOf(seen, 's1')).toHaveLength(1)
  expect(statusOf(seen, 's1')[0].state).toBe('needs-you')
  await clock.advance(120000)
  expect(statusOf(seen, 's1')).toHaveLength(1)
  expect(statusOf(seen, 's1')[0].updatedAt).toBe(1000)
})

test('a /clear marks the old file ended, and the next write uses the new session id', async ($, on) => {
  const { clock, seen } = world(on)
  seen.agents = IDLE_TEAM

  await $.session.start(START)
  await $.prompt.submit({ text: 'add login' })
  await clock.advance(1000)
  expect(statusOf(seen, 's1')).toHaveLength(1)

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  expect(statusOf(seen, 's1')).toHaveLength(2)
  expect(statusOf(seen, 's1')[1]).toMatchObject({ sessionId: 's1', ended: true, request: 'add login' })

  seen.sessionId = 's2'
  await clock.advance(1000)
  expect(statusOf(seen, 's1')).toHaveLength(2)
  expect(statusOf(seen, 's2')).toHaveLength(1)
  expect(statusOf(seen, 's2')[0]).toMatchObject({ sessionId: 's2', ended: false, request: '', startedAt: 2000 })
})

test('a tick that still answers the old session id after the session ended does not un-end its file', async ($, on) => {
  const { clock, seen } = world(on)
  seen.agents = IDLE_TEAM

  await $.session.start(START)
  await clock.advance(1000)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  expect(statusOf(seen, 's1')).toHaveLength(2)

  // The id has not switched yet: ticks go on asking for 's1', through a whole heartbeat and beyond.
  await clock.advance(70000)
  expect(statusOf(seen, 's1')).toHaveLength(2)
  expect(statusOf(seen, 's1')[1].ended).toBe(true)
})

test('an ended session id is written again once the chat comes back to it', async ($, on) => {
  const { clock, seen } = world(on)
  seen.agents = IDLE_TEAM

  await $.session.start(START)
  await clock.advance(1000)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  seen.sessionId = 's2'
  await clock.advance(1000)
  expect(statusOf(seen, 's2')).toHaveLength(1)

  seen.sessionId = 's1'
  await clock.advance(1000)
  expect(statusOf(seen, 's1')).toHaveLength(3)
  expect(statusOf(seen, 's1')[2].ended).toBe(false)
})

test('any other session end marks the file ended too', async ($, on) => {
  const { clock, seen } = world(on)

  await $.session.start(START)
  await clock.advance(1000)
  await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
  expect(statusOf(seen, 's1').at(-1)?.ended).toBe(true)
})

test('with no USERPROFILE or HOME nothing is written and nothing is logged', async ($, on) => {
  const { clock, seen } = world(on)
  seen.env = {}

  await $.session.start(START)
  await $.prompt.submit({ text: 'add login' })
  await clock.advance(3000)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  await clock.advance(1000)
  expect(seen.writes).toEqual([])
  expect(seen.logs).toEqual([])
  expect(seen.agentList).toBe(4)
})

test('HOME serves when USERPROFILE is unset or empty', async ($, on) => {
  const { clock, seen } = world(on)
  seen.env = { USERPROFILE: '', HOME: 'C:/Users/h' }

  await $.session.start(START)
  await clock.advance(1000)
  expect(seen.writes.map(w => w.path)).toEqual(['C:/Users/h/.claude/section-team/sessions/s1.json'])
})

test('a failed status write is retried on the next tick, logged once to the debug log, and never holds the board back', async ($, on) => {
  const { clock, seen } = world(on)
  seen.denyWrite = 'disk full'

  await $.session.start(START)
  await clock.advance(1000)
  await clock.advance(1000)
  expect(seen.writes).toEqual([])
  expect(seen.logs).toHaveLength(1)
  expect(seen.logs[0].text).toContain('disk full')
  expect(seen.logs[0].to).toBe('debug')
  const ui = await mountBoard($ as never)
  expect((await ui.find({ key: 'card-frontend' }))?.text).toContain('Running · login form')

  seen.denyWrite = undefined
  await clock.advance(1000)
  expect(statusOf(seen, 's1')).toHaveLength(1)
  expect(seen.logs).toHaveLength(1)
})

// The /chats dashboard: the status folder is answered beneath the plugin by world(), from seen.chats.
const chat = (sessionId: string, change: object = {}) =>
  JSON.stringify({ sessionId, cwd: `C:/x/${sessionId}`, project: sessionId, request: `job ${sessionId}`, state: 'needs-you', sections: [], helpers: 0, tokens: 0, startedAt: T0 - 5 * MINUTE, updatedAt: T0 - MINUTE, ended: false, ...change })

type Drawn = { find: (q: { key: string }) => Promise<{ text: string; props: Record<string, unknown>; children: unknown[] } | undefined>; unmount: () => Promise<void> }
const mountChats = ($: { ui: { mount: (t: never) => Promise<Drawn> } }) =>
  $.ui.mount({ plugin: 'section-team', surface: 'terminal', component: 'Pane', requestId: 'team-chats', props: { ...PROPS, title: 'Chats' } } as never)
const chatKeys = async (ui: Drawn) => ((await ui.find({ key: 'chats' }))?.children as { props: { key?: string } }[]).map(c => c.props.key)

test('/chats opens the Chats pane, and the poll reads the status folder only from then on', async ($, on) => {
  const { clock, seen } = world(on, T0)
  seen.chats.files = { 'a.json': chat('a') }

  await $.session.start(START)
  expect(seen.registered).toEqual(['team', 'chats'])
  await clock.advance(3000)
  expect(seen.chats.lists).toBe(0)
  expect(seen.opened).toEqual([])

  expect(await $.command.run({ command: 'chats' })).toEqual({ text: 'Chats opened.' })
  expect(seen.opened).toEqual(['team-chats'])
  const listed = seen.chats.lists
  expect(listed).toBeGreaterThan(0)
  await clock.advance(2000)
  expect(seen.chats.lists).toBeGreaterThan(listed)
})

// The test engine cannot raise ui.close (its `$` has no ui.close, and a hook of the test may not call it), so this one drives the
// registered hooks themselves with a stub `$`: the real register(), the real poll, only the engine around them is stubbed.
type Registered = { event: string; matcher: unknown; hook: (...args: unknown[]) => Promise<unknown> }
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

test('closing the Chats pane stops the poll reading the status folder, and /chats starts it again', async () => {
  const registered: Registered[] = []
  register(((event: string, matcher: unknown, hook?: Registered['hook']) => {
    registered.push(hook ? { event, matcher, hook } : { event, matcher: undefined, hook: matcher as Registered['hook'] })
  }) as never)
  const hookFor = (event: string, matcher: unknown) => registered.find(r => r.event === event && JSON.stringify(r.matcher) === JSON.stringify(matcher))?.hook
  let tick = () => {}
  const reads = { lists: 0 }
  const $ = {
    clock: { every: (_ms: number, run: () => void) => { tick = run; return {} }, now: async () => T0 },
    env: { get: async (name: string) => (name === 'USERPROFILE' ? 'C:/Users/u' : undefined) },
    fs: { list: async () => { reads.lists += 1; return [] }, read: async () => '' },
    ui: { open: async () => ({ isPlaced: true }), log: () => {} },
  }
  const chatsRun = hookFor('command.run', { command: 'chats' })
  const onClose = hookFor('ui.close', { id: 'team-chats' })
  expect(chatsRun).toBeDefined()
  expect(onClose).toBeDefined()
  // Only the Chats pane has a close hook: closing the Team Board leaves the poll alone.
  expect(registered.filter(r => r.event === 'ui.close')).toHaveLength(1)

  await chatsRun!($, { command: 'chats' })
  const opened = reads.lists
  expect(opened).toBeGreaterThan(0)
  tick()
  await flush()
  expect(reads.lists).toBeGreaterThan(opened)

  const event = { id: 'team-chats', origin: { kind: 'person' } }
  const passed: unknown[] = []
  expect(await onClose!($, event, async (e: unknown) => { passed.push(e); return 'next-result' })).toBe('next-result')
  expect(passed).toEqual([event])
  const closed = reads.lists
  tick()
  await flush()
  tick()
  await flush()
  expect(reads.lists).toBe(closed)

  await chatsRun!($, { command: 'chats' })
  expect(reads.lists).toBeGreaterThan(closed)
  const reopened = reads.lists
  tick()
  await flush()
  expect(reads.lists).toBeGreaterThan(reopened)
})

test('the Chats pane draws one card per good file, needs-you first, and skips a file cut off mid-write', async ($, on) => {
  const { clock, seen } = world(on, T0)
  seen.chats.files = {
    'w.json': chat('w', { project: 'claude-team', request: '', state: 'working', updatedAt: T0 - 1000, startedAt: T0 - 31 * MINUTE, tokens: 640_000, helpers: 4, sections: [{ id: 'backend', state: 'running' }, { id: 'testing', state: 'done' }] }),
    'cut.json': '{"sessionId":',
    'n.json': chat('n', { project: 'shop-app', request: 'approve the 3-section plan?', startedAt: T0 - 12 * MINUTE, tokens: 210_000 }),
    'notes.txt': 'not a status file',
  }

  await $.session.start(START)
  await $.command.run({ command: 'chats' })
  const ui = await mountChats($ as never)
  expect(await chatKeys(ui)).toEqual(['chat-n', 'chat-w'])
  const waiting = await ui.find({ key: 'chat-n' })
  for (const line of ['shop-app', 'needs you', 'approve the 3-section plan?', 'no sections awake', '0 helpers', '12 min · 210k tokens']) expect(waiting?.text).toContain(line)
  expect(waiting?.props.borderColor).toBe('warning')
  const working = await ui.find({ key: 'chat-w' })
  for (const line of ['claude-team', 'working', 'No request yet', 'backend running', 'testing done', '4 helpers', '31 min · 640k tokens']) expect(working?.text).toContain(line)
  expect(working?.props.borderColor).toBe('suggestion')

  // The next tick draws what changed: that chat ended, so its card goes.
  seen.chats.files['n.json'] = chat('n', { ended: true })
  await clock.advance(1000)
  await ui.unmount()
  expect(await chatKeys(await mountChats($ as never))).toEqual(['chat-w'])
})

test('ended chats and chats over 24 hours old are left out, a stale file is not read, and a working chat silent for 31 minutes shows idle', async ($, on) => {
  const { seen } = world(on, T0)
  seen.chats.files = {
    'live.json': chat('live', { state: 'working', updatedAt: T0 - 1000 }),
    'crashed.json': chat('crashed', { state: 'working', updatedAt: T0 - 31 * MINUTE }),
    'ended.json': chat('ended', { ended: true }),
    'old.json': chat('old', { updatedAt: T0 - 25 * 60 * MINUTE }),
    'stale.json': chat('stale'),
  }
  seen.chats.mtimes = { 'stale.json': T0 - 25 * 60 * MINUTE }

  await $.session.start(START)
  await $.command.run({ command: 'chats' })
  const ui = await mountChats($ as never)
  expect(await chatKeys(ui)).toEqual(['chat-live', 'chat-crashed'])
  expect((await ui.find({ key: 'chat-crashed' }))?.text).toContain('idle')
  expect((await ui.find({ key: 'chat-crashed' }))?.props.borderColor).toBe('inactive')
  expect((await ui.find({ key: 'chat-live' }))?.text).toContain('working')
  expect(seen.chats.reads).not.toContain('stale.json')
})

test('two chats in one project each keep a card', async ($, on) => {
  const { seen } = world(on, T0)
  seen.chats.files = { 'a.json': chat('a', { project: 'shop-app' }), 'b.json': chat('b', { project: 'shop-app', updatedAt: T0 }) }

  await $.session.start(START)
  await $.command.run({ command: 'chats' })
  expect(await chatKeys(await mountChats($ as never))).toEqual(['chat-b', 'chat-a'])
})

test('with no chats, or no status folder yet, the pane says there are none and nothing is logged', async ($, on) => {
  const { seen } = world(on, T0)
  seen.chats.deny = 'no such folder'

  await $.session.start(START)
  await $.command.run({ command: 'chats' })
  const ui = await mountChats($ as never)
  expect((await ui.find({ key: 'no-chats' }))?.text).toBe('No open chats.')
  expect(seen.logs).toEqual([])
})

test('with no USERPROFILE or HOME the Chats pane says so in one line and reads nothing', async ($, on) => {
  const { seen } = world(on, T0)
  seen.env = {}
  seen.chats.files = { 'a.json': chat('a') }

  await $.session.start(START)
  await $.command.run({ command: 'chats' })
  const ui = await mountChats($ as never)
  expect((await ui.find({ key: 'no-home' }))?.text).toBe('Chats need USERPROFILE or HOME to be set.')
  expect(await ui.find({ key: 'chats' })).toBeUndefined()
  expect(seen.chats.lists).toBe(0)
  expect(seen.logs).toEqual([])
})
