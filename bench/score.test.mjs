import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentModelSplit, collectRoles, hiddenEnv, hiddenTests, ownTests, parseTranscript, splitCoverage } from './score.mjs'

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

test('collectRoles: subagents carry agentId, parentId and start; main stays { role, messages }', () => {
  const home = mkdtempSync(join(tmpdir(), 'bench-roles-'))
  try {
    const project = join(home, '.claude', 'projects', 'C--bench-runs-h1-team-ho-r1')
    const subs = join(project, 'sess1', 'subagents')
    mkdirSync(subs, { recursive: true })
    const jsonl = (...rows) => rows.map(r => JSON.stringify(r)).join('\n') + '\n'
    const at = (timestamp, row) => ({ ...row, timestamp })
    writeFileSync(join(project, 'sess1.jsonl'), jsonl(at('2026-10-30T09:00:00.000Z', say('m1', 'claude-opus-5-5', {}))))
    writeFileSync(join(subs, 'agent-p1.jsonl'), jsonl(at('2026-10-30T09:01:00.000Z', { type: 'user' }), at('2026-10-30T09:09:00.000Z', say('b1', 'claude-opus-5-5', {}))))
    writeFileSync(join(subs, 'agent-p1.meta.json'), JSON.stringify({ agentType: 'section-team:backend', spawnDepth: 1 }))
    writeFileSync(join(subs, 'agent-r7.jsonl'), jsonl(at('2026-10-30T09:05:00.000Z', { type: 'user' })))
    writeFileSync(join(subs, 'agent-r7.meta.json'), JSON.stringify({ agentType: 'section-team:reviewer', parentAgentId: 'p1', spawnDepth: 2 }))
    writeFileSync(join(subs, 'agent-n0.jsonl'), jsonl({ type: 'user' }, at('2026-10-30T09:06:00.000Z', { type: 'user' })))
    const roles = collectRoles('C:/bench-runs/h1-team-ho-r1', 'sess1', home)
    const byId = Object.fromEntries(roles.slice(1).map(r => [r.agentId, r]))
    assert.deepEqual(Object.keys(roles[0]), ['role', 'messages'])
    assert.equal(roles[0].role, 'main')
    assert.deepEqual({ ...byId.r7, messages: undefined }, { role: 'section-team:reviewer', agentId: 'r7', parentId: 'p1', start: '2026-10-30T09:05:00.000Z', messages: undefined })
    assert.equal(byId.p1.parentId, null)
    assert.equal(byId.p1.start, '2026-10-30T09:01:00.000Z')
    assert.equal(byId.n0.start, null, 'start is the first message\'s timestamp, not the first timestamp found')
    assert.equal(byId.n0.role, 'unknown')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

// Run inside node --test, so it also checks that hiddenEnv drops NODE_TEST_CONTEXT (with it the child runs 0 tests).
test('hiddenTests is exported and scores a folder against bench/hidden/<task>.test.mjs', () => {
  const empty = mkdtempSync(join(tmpdir(), 'bench-hidden-'))
  try {
    const r = hiddenTests('easy', empty)
    assert.ok(r.tests > 0)
    assert.equal(r.pass, 0)
    assert.equal(r.rate, 0)
    assert.match(r.tap, /^not ok \d+ - /m)
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
})

test('parseTranscript keeps its fields and carries the session id', () => {
  const t = parseTranscript(JSON.stringify([{ type: 'result', total_cost_usd: 1, session_id: 'sess1' }]))
  assert.equal(t.costUSD, 1)
  assert.equal(t.sessionId, 'sess1')
})

test('hiddenEnv passes solution code only what node needs plus TARGET_DIR, never keys or tokens', () => {
  const env = { PATH: '/bin', SystemRoot: 'C:\\Windows', TEMP: 't', TMP: 'u', TMPDIR: 'v', ANTHROPIC_API_KEY: 'sk-x', GITHUB_TOKEN: 'g', DATABASE_URL: 'postgres://u:p@h/db', NODE_TEST_CONTEXT: 'child-v8' }
  assert.deepEqual(hiddenEnv('/run', env), { PATH: '/bin', SystemRoot: 'C:\\Windows', TEMP: 't', TMP: 'u', TMPDIR: 'v', TARGET_DIR: '/run' })
  assert.deepEqual(hiddenEnv('/run', { PATH: '/bin' }), { PATH: '/bin', TARGET_DIR: '/run' })
})

test("ownTests runs the solution's npm test without the maintainer's keys and tokens", t => {
  const dir = mkdtempSync(join(tmpdir(), 'bench-own-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node check.mjs' } }))
  writeFileSync(join(dir, 'check.mjs'), 'process.exit(process.env.BENCH_FAKE_SECRET === undefined ? 0 : 1)\n')
  const r = ownTests(dir, { ...process.env, BENCH_FAKE_SECRET: 'sk-probe' })
  assert.equal(r.passed, true, `npm test exit code ${r.exitCode}`)
})
