import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boardModel, cardState, latestReportFiles, emptyBoard } from '../hooks/board-model.mjs'

test('agent status and report status map to card states', () => {
  assert.equal(cardState(undefined, undefined), 'asleep')
  assert.equal(cardState('pending'), 'running')
  assert.equal(cardState('running'), 'running')
  assert.equal(cardState('waiting'), 'waiting')
  assert.equal(cardState('idle'), 'waiting')
  assert.equal(cardState('completed', 'done'), 'done')
  assert.equal(cardState('completed', undefined), 'done')
  assert.equal(cardState('completed', 'partial'), 'problem')
  assert.equal(cardState('completed', 'blocked'), 'problem')
  assert.equal(cardState('failed'), 'problem')
  assert.equal(cardState('killed'), 'problem')
})

test('board has 10 builders then 2 advisors and counts states', () => {
  const data = boardModel({
    agents: [
      { id: '1', type: 'section-team:frontend', status: 'running', description: 'login form' },
      { id: '2', type: 'section-team:backend', status: 'completed', description: 'api' },
      { id: '3', type: 'section-team:devops', status: 'failed', description: 'docker' },
      { id: '4', type: 'general-purpose', status: 'running', description: 'helper' },
    ],
    reports: { backend: { status: 'done', job: '/api/login + JWT', helpers: 'sonnet ×2' }, docs: { status: 'done', job: 'readme', helpers: 'none' } },
    request: 'add login',
    lastSummary: '14:02',
  })
  assert.deepEqual(data.cards.map(c => c.kind), [...Array(10).fill('builder'), 'advisor', 'advisor'])
  const card = id => data.cards.find(c => c.id === id)
  assert.equal(card('frontend').line, 'Running · login form')
  assert.equal(card('backend').line, 'Done · /api/login + JWT')
  assert.equal(card('backend').helpers, 'sonnet ×2')
  assert.equal(card('devops').state, 'problem')
  assert.equal(card('docs').line, 'Asleep · last: readme')
  assert.equal(card('docs').helpers, '')
  assert.equal(card('mobile').line, 'Asleep')
  assert.deepEqual(data.counts, { active: 1, done: 1, problem: 1 })
  assert.equal(data.request, 'add login')
})

test('an active agent wins over an older completed one of the same section', () => {
  const data = boardModel({ agents: [
    { id: '1', type: 'section-team:testing', status: 'completed', description: 'old' },
    { id: '2', type: 'section-team:testing', status: 'running', description: 'new' },
  ] })
  assert.equal(data.cards.find(c => c.id === 'testing').line, 'Running · new')
})

test('latest report per section, hyphenated ids and collisions, summary apart', () => {
  const files = latestReportFiles([
    { name: '090000-ai-llm.md' }, { name: '090000-ai-llm-2.md' }, { name: '085959-ai-llm-7.md' },
    { name: '100000-data-scientist.md' }, { name: '110000-supervisor-summary.md' }, { name: '120000-supervisor-summary.md' },
    { name: 'notes.txt' },
  ])
  assert.deepEqual(files.byId, { 'ai-llm': '090000-ai-llm-2.md', 'data-scientist': '100000-data-scientist.md' })
  assert.equal(files.summary, '120000-supervisor-summary.md')
})

test('empty board is all asleep', () => {
  const data = emptyBoard()
  assert.equal(data.cards.length, 12)
  assert.ok(data.cards.every(c => c.state === 'asleep'))
})
