import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boardModel, cardLine, cardState, latestReportFiles, emptyBoard, formatTokens, shortModel, sectionUsage } from '../hooks/board-model.mjs'

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
  assert.equal('helpers' in card('backend'), false) // the report's "Helpers used" text is no longer part of a card
  assert.equal(card('devops').state, 'problem')
  assert.equal(card('docs').line, 'Asleep · last: readme')
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

test('bare and foreign agent types never light a card', () => {
  const data = boardModel({ agents: [
    { id: '1', type: 'frontend', status: 'running', description: 'my own agent' },
    { id: '2', type: 'security', status: 'failed', description: 'project agent' },
  ] })
  assert.equal(data.cards.find(c => c.id === 'frontend').state, 'asleep')
  assert.equal(data.cards.find(c => c.id === 'security').state, 'asleep')
  assert.deepEqual(data.counts, { active: 0, done: 0, problem: 0 })
})

test('empty board is all asleep', () => {
  const data = emptyBoard()
  assert.equal(data.cards.length, 12)
  assert.ok(data.cards.every(c => c.state === 'asleep'))
})

test('formatTokens: as-is under 1000, 12.3k, 1.3M, no trailing .0', () => {
  assert.equal(formatTokens(0), '0')
  assert.equal(formatTokens(999), '999')
  assert.equal(formatTokens(1000), '1k')
  assert.equal(formatTokens(12345), '12.3k')
  assert.equal(formatTokens(1250000), '1.3M')
  assert.equal(formatTokens(2000000), '2M')
  assert.equal(formatTokens(999999), '1M')
})

test('shortModel: family name when the id has one, else the raw id', () => {
  assert.equal(shortModel('claude-haiku-5-5'), 'haiku')
  assert.equal(shortModel('claude-sonnet-5-5'), 'sonnet')
  assert.equal(shortModel('claude-opus-5-5'), 'opus')
  assert.equal(shortModel('claude-fable-5-1'), 'fable')
  assert.equal(shortModel('sonnet'), 'sonnet')
  assert.equal(shortModel('gpt-9'), 'gpt-9')
})

const HEAD = { id: 'S1', type: 'section-team:frontend', status: 'running', description: 'login form' }

test('sectionUsage: head, helpers and a grandchild roll up to the section; helpers are direct children only', () => {
  const result = sectionUsage({
    agents: [HEAD, { id: 'H1', type: 'general-purpose', status: 'completed', description: 'a' }, { id: 'H2', type: 'Explore', status: 'completed', description: 'b' }, { id: 'G1', type: 'Explore', status: 'completed', description: 'c' }],
    spawns: {
      S1: { subagentType: 'section-team:frontend', model: 'claude-opus-5-5' },
      H1: { parentAgentId: 'S1', subagentType: 'general-purpose', model: 'claude-haiku-5-5' },
      H2: { parentAgentId: 'S1', subagentType: 'Explore', model: 'claude-sonnet-5-5' },
      G1: { parentAgentId: 'H1', subagentType: 'Explore', model: 'claude-haiku-5-5' },
    },
    usage: { S1: { total: 1000, out: 100 }, H1: { total: 2000, out: 200 }, H2: { total: 300, out: 30 }, G1: { total: 40, out: 4 } },
  })
  assert.deepEqual(result, { frontend: { total: 3340, out: 334, helpers: 2, models: [['haiku', 1], ['sonnet', 1]] } })
})

test('sectionUsage: agents with no section ancestor are ignored, even with helpers of their own', () => {
  const result = sectionUsage({
    agents: [HEAD, { id: 'X1', type: 'general-purpose', status: 'running', description: 'supervisor helper' }, { id: 'X2', type: 'Explore', status: 'running', description: 'its helper' }],
    spawns: {
      S1: { subagentType: 'section-team:frontend', model: 'claude-opus-5-5' },
      X1: { subagentType: 'general-purpose', model: 'claude-haiku-5-5' },
      X2: { parentAgentId: 'X1', subagentType: 'Explore', model: 'claude-haiku-5-5' },
    },
    usage: { S1: { total: 10, out: 1 }, X1: { total: 5000, out: 500 }, X2: { total: 700, out: 70 }, ghost: { total: 9, out: 9 } },
  })
  assert.deepEqual(result, { frontend: { total: 10, out: 1, helpers: 0, models: [] } })
})

test('sectionUsage: the parent falls back to the agent list when the spawn record has none, and a parent loop cannot hang it', () => {
  const result = sectionUsage({
    agents: [HEAD, { id: 'H1', type: 'general-purpose', status: 'running', description: 'a', parentId: 'S1' }, { id: 'A', type: 'Explore', status: 'running', description: 'loop', parentId: 'B' }, { id: 'B', type: 'Explore', status: 'running', description: 'loop', parentId: 'A' }],
    spawns: {},
    usage: { H1: { total: 60, out: 6 }, A: { total: 1, out: 1 } },
  })
  assert.deepEqual(result, { frontend: { total: 60, out: 6, helpers: 0, models: [] } })
})

test('sectionUsage: models sorted by count then name, two sections kept apart, the same section woken twice adds up', () => {
  const spawn = (parentAgentId, model) => ({ parentAgentId, subagentType: 'general-purpose', model })
  const result = sectionUsage({
    agents: [HEAD, { id: 'S2', type: 'section-team:backend', status: 'running', description: 'api' }, { id: 'S3', type: 'section-team:frontend', status: 'completed', description: 'again' }],
    spawns: {
      H1: spawn('S1', 'claude-sonnet-5-5'), H2: spawn('S1', 'claude-haiku-5-5'), H3: spawn('S1', 'claude-sonnet-5-5'), H4: spawn('S1', 'claude-fable-5-1'),
      H5: spawn('S2', 'claude-opus-5-5'), H6: spawn('S3', 'claude-haiku-5-5'),
    },
    usage: { S1: { total: 100, out: 10 }, S2: { total: 7, out: 1 }, S3: { total: 50, out: 5 } },
  })
  assert.deepEqual(result.frontend, { total: 150, out: 15, helpers: 5, models: [['haiku', 2], ['sonnet', 2], ['fable', 1]] })
  assert.deepEqual(result.backend, { total: 7, out: 1, helpers: 1, models: [['opus', 1]] })
})

test('sectionUsage: a section head missing from the agent list is still known from its spawn record', () => {
  const result = sectionUsage({
    agents: [],
    spawns: { S1: { subagentType: 'section-team:docs', model: 'claude-opus-5-5' }, H1: { parentAgentId: 'S1', subagentType: 'Explore', model: 'claude-haiku-5-5' } },
    usage: { H1: { total: 8, out: 2 } },
  })
  assert.deepEqual(result, { docs: { total: 8, out: 2, helpers: 1, models: [['haiku', 1]] } })
})

test('sectionUsage: no input at all is an empty result', () => {
  assert.deepEqual(sectionUsage(), {})
  assert.deepEqual(sectionUsage({ agents: [HEAD] }), { frontend: { total: 0, out: 0, helpers: 0, models: [] } })
})

test('card lines and the team line come from the usage, zero shows nothing', () => {
  const usage = {
    frontend: { total: 12345, out: 321, helpers: 3, models: [['haiku', 2], ['sonnet', 1]] },
    'ai-engineer': { total: 1250000, out: 400000, helpers: 1, models: [['opus', 1]] },
    docs: { total: 0, out: 0, helpers: 0, models: [] },
  }
  const data = boardModel({ usage })
  const card = id => data.cards.find(c => c.id === id)
  assert.equal(card('frontend').tokens, 'tokens 12.3k · out 321')
  assert.equal(card('frontend').helpersLine, 'helpers 3 · haiku×2 sonnet×1')
  assert.equal(card('ai-engineer').tokens, 'tokens 1.3M · out 400k')
  assert.equal(card('ai-engineer').helpersLine, 'helpers 1 · opus×1')
  assert.equal(card('docs').tokens, '')
  assert.equal(card('docs').helpersLine, '')
  assert.equal(card('mobile').tokens, '')
  assert.equal(card('mobile').helpersLine, '')
  assert.equal(data.teamLine, 'team tokens 1.3M · 4 helpers')
})

test('no usage means empty lines and no team line', () => {
  for (const data of [boardModel(), boardModel({ usage: {} }), emptyBoard()]) {
    assert.equal(data.teamLine, '')
    assert.ok(data.cards.every(c => c.tokens === '' && c.helpersLine === ''))
  }
})

test('the team line says "1 helper" for one and "N helpers" for any other count', () => {
  const line = (total, helpers) => boardModel({ usage: { frontend: { total, out: 1, helpers, models: helpers ? [['haiku', helpers]] : [] } } }).teamLine
  assert.equal(line(5, 1), 'team tokens 5 · 1 helper')
  assert.equal(line(5, 2), 'team tokens 5 · 2 helpers')
  assert.equal(line(5, 0), 'team tokens 5 · 0 helpers')
  assert.equal(line(0, 1), 'team tokens 0 · 1 helper')
})

test('a done card shows the reviewer grade when the report has one', () => {
  assert.equal(cardLine('done', undefined, { job: 'api', quality: 9 }), 'Done · api · 9/10')
  assert.equal(cardLine('done', undefined, { job: 'api', quality: null }), 'Done · api')
  assert.equal(cardLine('done', undefined, { job: 'api' }), 'Done · api')
})
