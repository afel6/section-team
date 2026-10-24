import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boardModel } from '../hooks/board-model.mjs'
import { HIDE_MS, IDLE_MS, sessionState, statusDir, statusRecord } from '../hooks/sessions-model.mjs'

const NOW = 1_000_000_000_000
const AGENTS = [
  { id: '1', type: 'section-team:frontend', status: 'running', description: 'login form' },
  { id: '2', type: 'section-team:backend', status: 'completed', description: 'api' },
]
const USAGE = { frontend: { total: 1250, out: 50, helpers: 2, models: [['haiku', 2]] }, backend: { total: 100, out: 10, helpers: 1, models: [['sonnet', 1]] } }
const BASE = { sessionId: 's1', cwd: 'C:/x/shop-app', request: 'add login', board: boardModel({ agents: AGENTS, usage: USAGE }), turnActive: false, startedAt: NOW - 5000, now: NOW }

test('the two limits are 30 minutes and 24 hours', () => {
  assert.equal(IDLE_MS, 30 * 60 * 1000)
  assert.equal(HIDE_MS, 24 * 60 * 60 * 1000)
})

test('the status folder sits under the home, joined with slashes', () => {
  assert.equal(statusDir('C:/Users/u'), 'C:/Users/u/.claude/section-team/sessions')
  assert.equal(statusDir('C:\\Users\\u'), 'C:\\Users\\u/.claude/section-team/sessions')
})

test('a session works while a turn runs or a section is busy, else needs you, and goes idle after 30 minutes', () => {
  assert.equal(sessionState({ turnActive: true, anyRunning: false, updatedAt: NOW, now: NOW }), 'working')
  assert.equal(sessionState({ turnActive: false, anyRunning: true, updatedAt: NOW, now: NOW }), 'working')
  assert.equal(sessionState({ turnActive: true, anyRunning: true, updatedAt: 0, now: NOW }), 'working')
  assert.equal(sessionState({ turnActive: false, anyRunning: false, updatedAt: NOW, now: NOW }), 'needs-you')
  assert.equal(sessionState({ turnActive: false, anyRunning: false, updatedAt: NOW - IDLE_MS, now: NOW }), 'needs-you')
  assert.equal(sessionState({ turnActive: false, anyRunning: false, updatedAt: NOW - IDLE_MS - 1, now: NOW }), 'idle')
})

test('the record carries the session, the project, the awake sections, the team totals and the times', () => {
  assert.deepEqual(statusRecord(BASE), {
    sessionId: 's1',
    cwd: 'C:/x/shop-app',
    project: 'shop-app',
    request: 'add login',
    state: 'working',
    sections: [{ id: 'frontend', state: 'running' }, { id: 'backend', state: 'done' }],
    helpers: 3,
    tokens: 1350,
    startedAt: NOW - 5000,
    updatedAt: NOW,
    ended: false,
  })
})

test('the state follows the turn and the cards: a finished team and no turn needs you', () => {
  const done = boardModel({ agents: [{ id: '2', type: 'section-team:backend', status: 'completed', description: 'api' }] })
  assert.equal(statusRecord({ ...BASE, board: done }).state, 'needs-you')
  assert.equal(statusRecord({ ...BASE, board: done, turnActive: true }).state, 'working')
  assert.equal(statusRecord({ ...BASE, board: boardModel({ agents: [{ id: '2', type: 'section-team:backend', status: 'waiting', description: 'q' }] }) }).state, 'working')
})

test('sections leave out the ones that sleep', () => {
  assert.deepEqual(statusRecord({ ...BASE, board: boardModel() }).sections, [])
  assert.deepEqual(statusRecord(BASE).sections.map(s => s.id), ['frontend', 'backend'])
})

test('only the first line of the request, cut to 80 characters, is recorded', () => {
  const request = `${'a'.repeat(200)}\nsecond line with a secret`
  const record = statusRecord({ ...BASE, request })
  assert.equal(record.request, 'a'.repeat(80))
  assert.ok(!JSON.stringify(record).includes('secret'))
  assert.equal(statusRecord({ ...BASE, request: 'one\r\ntwo' }).request, 'one')
  assert.equal(statusRecord({ ...BASE, request: '' }).request, '')
})

test('the project is the last segment of the folder, with either slash and a trailing one', () => {
  assert.equal(statusRecord({ ...BASE, cwd: 'C:/x/shop-app' }).project, 'shop-app')
  assert.equal(statusRecord({ ...BASE, cwd: 'C:\\x\\shop-app\\' }).project, 'shop-app')
  assert.equal(statusRecord({ ...BASE, cwd: '/home/u/api' }).project, 'api')
})

test('ended is false unless said, and the team totals are zero for an empty board', () => {
  assert.equal(statusRecord(BASE).ended, false)
  assert.equal(statusRecord({ ...BASE, ended: true }).ended, true)
  const empty = statusRecord({ ...BASE, board: boardModel() })
  assert.equal(empty.helpers, 0)
  assert.equal(empty.tokens, 0)
})
