import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { costByRole, main } from './cost-by-role.mjs'

const put = (file, text) => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}
// One assistant message billing `dollars` on Opus: output tokens at $20 per million.
const billed = (id, dollars) => `${JSON.stringify({ type: 'assistant', message: { id, model: 'claude-opus-5-5', usage: { output_tokens: dollars * 50_000 } } })}\n`

// results/<id>/ with session.json and evidence/ as run.mjs copies it: main's transcript and each subagent's, with its type.
function writeRun(results, id, { main: mainUsd, agents = [] }) {
  const sid = `${id}-sid`
  put(join(results, id, 'session.json'), JSON.stringify({ sessionId: sid, attempt: 1 }))
  put(join(results, id, 'evidence', `${sid}.jsonl`), billed(`${id}-m`, mainUsd))
  agents.forEach(([type, usd], i) => {
    const base = join(results, id, 'evidence', sid, 'subagents', `agent-a${i}`)
    put(`${base}.jsonl`, billed(`${id}-a${i}`, usd))
    if (type !== null) put(`${base}.meta.json`, JSON.stringify({ agentType: type }))
  })
}

function fixture(t) {
  const results = mkdtempSync(join(tmpdir(), 'bench-cost-role-'))
  t.after(() => rmSync(results, { recursive: true, force: true }))
  writeRun(results, 'h8-base-nx-r1', { main: 0.25, agents: [['section-team:backend', 1], ['section-team:reviewer', 0.4], ['section-team:coder', 0.25]] })
  writeRun(results, 'h8-base-nx-r2', { main: 0.25, agents: [['section-team:backend', 1], ['section-team:reviewer', 0.4], ['section-team:reviewer', 0.2]] })
  writeRun(results, 'h8-team-nx-r1', { main: 0.5, agents: [['section-team:reviewer', 0.5]] })
  writeRun(results, 'h9-solo-nx-r1', { main: 0.9, agents: [[null, 0.1]] })
  writeRun(results, 'h8-team-mo-r1', { main: 9 })
  mkdirSync(join(results, 'h8-solo-nx-r1'))
  return results
}

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`)

test('costByRole gives each task and setup its mean cost and mean agent count per role across its runs, priced from the evidence', t => {
  const out = costByRole({ results: fixture(t), round: 'nx' })
  assert.deepEqual(Object.keys(out), ['h8', 'h9'])
  assert.deepEqual(Object.keys(out.h8), ['base', 'solo', 'team'])
  assert.deepEqual([out.h8.solo.runs, out.h8.solo.meanUSD, out.h8.solo.missing], [0, null, ['h8-solo-nx-r1']], 'a run folder with no evidence is listed, not priced')
  const base = out.h8.base
  assert.deepEqual([base.runs, base.missing], [2, []])
  near(base.meanUSD, (0.25 + 1 + 0.4 + 0.25 + 0.25 + 1 + 0.4 + 0.2) / 2)
  assert.deepEqual(base.roles.map(r => r.role), ['section-team:backend', 'section-team:reviewer', 'main', 'section-team:coder'], 'sorted by cost, highest first')
  const reviewer = base.roles.find(r => r.role === 'section-team:reviewer')
  near(reviewer.n, 1.5)
  near(reviewer.meanUSD, 0.5)
  near(reviewer.share, 0.5 / base.meanUSD)
  near(out.h8.team.meanUSD, 1)
  assert.deepEqual(out.h9.solo.roles.map(r => r.role), ['main', 'unknown'], 'a subagent without a meta file is unknown')
})

test('a run with no session or evidence is listed as missing, never priced at $0', t => {
  const results = fixture(t)
  writeRun(results, 'h8-solo-nx-r2', { main: 0.5 })
  const out = costByRole({ results, round: 'nx' })
  assert.deepEqual([out.h8.solo.runs, out.h8.solo.missing], [1, ['h8-solo-nx-r1']])
  near(out.h8.solo.meanUSD, 0.5)
})

test('main writes results/cost-by-role-<round>.json and prints one block per task and setup; it needs its results folder', t => {
  const results = fixture(t)
  const logs = []
  t.mock.method(console, 'log', line => logs.push(line))
  main(['--round=nx'], { results })
  assert.ok(existsSync(join(results, 'cost-by-role-nx.json')))
  assert.deepEqual(JSON.parse(readFileSync(join(results, 'cost-by-role-nx.json'), 'utf8')), costByRole({ results, round: 'nx' }))
  assert.equal(logs[0], 'h8 base (2 runs) mean $1.88')
  assert.match(logs[1], /^ {2}section-team:backend +n {3}1\.0 +\$1\.00 +53%$/)
  assert.throws(() => main(['--round=nx']), { message: 'results is required' })
})
