import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentModelSplit, collectRoles, parseTranscript, splitCoverage } from './score.mjs'

const say = (id, model, usage) => ({ type: 'assistant', message: { id, model, usage, content: [] } })

// A main stream (one API response written twice, once per content block), a background backend head on Opus,
// and the depth-2 coder that head hired on Sonnet.
const roles = [
  { role: 'main', messages: [{ type: 'system' }, say('m1', 'claude-opus-5-5', { input_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 30, output_tokens: 7 }), say('m1', 'claude-opus-5-5', { input_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 30, output_tokens: 7 })] },
  { role: 'section-team:backend', messages: [say('b1', 'claude-opus-5-5', { input_tokens: 1, cache_read_input_tokens: 200 })] },
  { role: 'section-team:coder', messages: [say('c1', 'claude-sonnet-5-5', { input_tokens: 10, cache_creation_input_tokens: 5, output_tokens: 99 })] },
]

test('agentModelSplit: input tokens per role and short model, a repeated message id counted once, no output', () => {
  assert.deepEqual(agentModelSplit(roles), {
    main: { opus: 132 },
    'section-team:backend': { opus: 201 },
    'section-team:coder': { sonnet: 15 },
  })
})

test('agentModelSplit: roles of the same type add up, and an id replayed in another role is not counted twice', () => {
  const split = agentModelSplit([
    ...roles,
    { role: 'section-team:coder', messages: [say('c2', 'claude-sonnet-5-5', { input_tokens: 5 }), say('m1', 'claude-opus-5-5', { input_tokens: 999 })] },
  ])
  assert.deepEqual(split['section-team:coder'], { sonnet: 20 })
  assert.deepEqual(split.main, { opus: 132 })
})

test('splitCoverage: the remainder per model is modelUsage input minus the split, and only an exact match is complete', () => {
  const split = agentModelSplit(roles)
  const modelUsage = { 'claude-opus-5-5': { input: 3, cacheRead: 400, cacheWrite: 30 }, 'claude-sonnet-5-5': { input: 10, cacheRead: 0, cacheWrite: 5 }, 'claude-haiku-5': { input: 7, cacheRead: 0, cacheWrite: 0 } }
  assert.deepEqual(splitCoverage(split, modelUsage), { complete: false, unattributed: { opus: 433 - 333, sonnet: 0, haiku: 7 } })
  assert.deepEqual(splitCoverage(split, { 'claude-opus-5-5': { input: 3, cacheRead: 300, cacheWrite: 30 }, 'claude-sonnet-5-5': { input: 10, cacheRead: 0, cacheWrite: 5 } }), { complete: true, unattributed: { opus: 0, sonnet: 0 } })
})

test('splitCoverage: no split (transcripts not found) is incomplete and everything is unattributed', () => {
  const cov = splitCoverage(null, { 'claude-opus-5-5': { input: 1, cacheRead: 2, cacheWrite: 3 } })
  assert.deepEqual(cov, { complete: false, unattributed: { opus: 6 } })
})

test('collectRoles: reads the session and subagent transcripts from the project folder, null when it is missing', () => {
  const home = mkdtempSync(join(tmpdir(), 'bench-split-'))
  try {
    const project = join(home, '.claude', 'projects', 'C--bench-runs-easy-team-r1')
    const subs = join(project, 'sess1', 'subagents')
    mkdirSync(subs, { recursive: true })
    const jsonl = (...rows) => rows.map(r => JSON.stringify(r)).join('\n') + '\n'
    writeFileSync(join(project, 'sess1.jsonl'), jsonl(say('m1', 'claude-opus-5-5', { input_tokens: 1 })))
    writeFileSync(join(subs, 'agent-a.jsonl'), jsonl(say('b1', 'claude-opus-5-5', { input_tokens: 2 })))
    writeFileSync(join(subs, 'agent-a.meta.json'), JSON.stringify({ agentType: 'section-team:backend', spawnDepth: 1 }))
    writeFileSync(join(subs, 'agent-b.jsonl'), jsonl(say('c1', 'claude-sonnet-5-5', { input_tokens: 3 })) + 'not json\n')
    const found = collectRoles('C:/bench-runs/easy-team-r1', 'sess1', home)
    assert.deepEqual(agentModelSplit(found), { main: { opus: 1 }, 'section-team:backend': { opus: 2 }, unknown: { sonnet: 3 } })
    assert.equal(collectRoles('C:/bench-runs/easy-team-r1', 'other-session', home), null)
    assert.equal(collectRoles('C:/bench-runs/not-run', 'sess1', home), null)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('parseTranscript keeps its fields and carries the session id', () => {
  const t = parseTranscript(JSON.stringify([{ type: 'result', total_cost_usd: 1, session_id: 'sess1' }]))
  assert.equal(t.costUSD, 1)
  assert.equal(t.sessionId, 'sess1')
})
