import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentModelSplit, codeStats, collectRoles, collectRolesFrom, costOf, hiddenEnv, hiddenTests, isTestPath, ownTests, parseTranscript, readRaw, runCost, runSession, scoreLine, scoreRun, seedDirFor, sessionTexts, splitCoverage, stageCalls, stageChange, stageTwoMetrics, summaryRow, transcriptDir } from './score.mjs'

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

const apiErrorTranscript = { costUSD: 1.4, isError: true, subtype: 'success', tokens: {}, turns: 3, agentSpawns: 0, agentTypes: {}, agentModels: {}, modelUsage: {} }
const runMetrics = { id: 'h1-team-ho-r1', task: 'h1', cond: 'team-ho', rep: 1, timedOut: false, wallMs: 60_000, transcript: apiErrorTranscript, cost: { costUSD: 1.4, costComputed: false }, split: null, splitCoverage: null, hidden: { tests: 23, pass: 0, fail: 23, rate: 0 }, own: { passed: false }, code: {}, team: {} }

// Under the mode-round rules an API failure never gets a run.json: an is_error run that has one is a counted 'error' end.
test('the score line shows how the run ended; summary.json keeps isError', () => {
  assert.match(scoreLine({ ...runMetrics, end: 'error' }), /timedOut=false {2}end=error$/)
  assert.match(scoreLine({ ...runMetrics, end: 'ok', transcript: { ...apiErrorTranscript, isError: false } }), /end=ok$/)
  assert.match(scoreLine(runMetrics), /end=\?$/, 'a held-out run.json has no end')
  assert.doesNotMatch(scoreLine({ ...runMetrics, end: 'error' }), /API|ERROR/)
  assert.equal(summaryRow(runMetrics).isError, true)
  assert.equal(summaryRow({ ...runMetrics, transcript: { ...apiErrorTranscript, isError: null } }).isError, false)
})

test('a computed cost reaches the summary row and the score line, marked', () => {
  const timedOut = { ...runMetrics, timedOut: true, transcript: { ...apiErrorTranscript, costUSD: null, isError: null }, cost: { costUSD: 0.5, costComputed: true } }
  assert.deepEqual([summaryRow(timedOut).costUSD, summaryRow(timedOut).costComputed], [0.5, true])
  assert.deepEqual([summaryRow(runMetrics).costUSD, summaryRow(runMetrics).costComputed], [1.4, false])
  assert.match(scoreLine(timedOut), /\$0\.50 computed /)
  assert.match(scoreLine(runMetrics), /\$1\.40 {2}/)
  assert.match(scoreLine({ ...timedOut, cost: { costUSD: NaN, costComputed: true } }), /\$\? computed /)
})

const jsonl = (...rows) => rows.map(r => JSON.stringify(r)).join('\n') + '\n'
const oneLine = pattern => err => pattern.test(err.message) && !/[\r\n]/.test(err.message)

test('costOf falls back to transcripts and marks it', () => {
  const texts = [jsonl(say('a', 'claude-opus-5-5', { input_tokens: 1_000_000 }))]
  assert.deepEqual(costOf({ transcript: { costUSD: 1.5 }, evidenceTexts: texts }), { costUSD: 1.5, costComputed: false })
  assert.deepEqual(costOf({ transcript: { costUSD: 0 }, evidenceTexts: texts }), { costUSD: 0, costComputed: false })
  assert.deepEqual(costOf({ transcript: { costUSD: null }, evidenceTexts: texts }), { costUSD: 4, costComputed: true })
  const none = costOf({ transcript: { costUSD: null }, evidenceTexts: [] })
  assert.ok(Number.isNaN(none.costUSD), 'no transcripts at all is an unknown cost, not $0')
  assert.equal(none.costComputed, true)
})

test('parseTranscript reads a stream-json raw.json, one cut off before its result, and an older array raw.json', () => {
  const init = { type: 'system', subtype: 'init', session_id: 'sess-init' }
  const spawn = { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'section-team:backend' } }] } }
  const result = { type: 'result', subtype: 'success', total_cost_usd: 2.5, num_turns: 4, session_id: 'sess-1', modelUsage: { 'claude-opus-5-5': { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4, costUSD: 2.5 } } }
  const stream = parseTranscript(jsonl(init, spawn, result))
  assert.equal(stream.found, true)
  assert.equal(stream.costUSD, 2.5)
  assert.equal(stream.sessionId, 'sess-1')
  assert.deepEqual(stream.agentTypes, { 'section-team:backend': 1 })
  assert.equal(stream.tokens.total, 10)
  const cut = parseTranscript(jsonl(init, spawn) + '{"type":"assistant","mess')
  assert.deepEqual([cut.found, cut.costUSD, cut.sessionId, cut.agentSpawns], [false, null, 'sess-init', 1])
  assert.deepEqual(parseTranscript(JSON.stringify([init, spawn, result])), stream)
})

// Six held-out team runs have 3–4 result lines: the last one is the session's true end (classifyEnd reads it too).
test('parseTranscript scores the last of several result lines', () => {
  const result = (turns, ms, text) => ({ type: 'result', subtype: 'success', num_turns: turns, duration_ms: ms, result: text, session_id: 'sess-1', total_cost_usd: 1 })
  const rows = [result(3, 1000, 'first stop'), { type: 'user' }, result(7, 5000, 'second stop'), result(9, 8000, 'session end')]
  for (const raw of [jsonl(...rows), JSON.stringify(rows)]) {
    const t = parseTranscript(raw)
    assert.deepEqual([t.turns, t.durationMs, t.finalText], [9, 8000, 'session end'])
  }
})

test('codeStats leaves out unchanged seed files', t => {
  const root = mkdtempSync(join(tmpdir(), 'bench-code-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (dir, rel, text) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), text) }
  const seed = join(root, 'seed')
  const run = join(root, 'run')
  for (const dir of [seed, run]) {
    put(dir, 'src/app.mjs', 'a\nb\nc')
    put(dir, 'src/same-size.mjs', 'abc')
    put(dir, 'test/app.test.mjs', 'x\ny')
    put(dir, 'README.md', 'r')
  }
  put(run, 'src/same-size.mjs', 'abd')
  put(run, 'test/app.test.mjs', 'x\ny\nz')
  put(run, 'test/new.test.mjs', 'n')
  put(run, 'src/lib.mjs', 'l\nm')
  put(run, 'notes.md', 'd\ne')
  assert.deepEqual(codeStats(run, seed), { files: 2, lines: 3, testFiles: 2, testLines: 4, docsLines: 2 })
  assert.deepEqual(codeStats(run), { files: 3, lines: 6, testFiles: 2, testLines: 4, docsLines: 3 })
})

test('transcriptDir prefers the run evidence copy, and seedDirFor is null without a seed', t => {
  const root = mkdtempSync(join(tmpdir(), 'bench-dirs-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const out = join(root, 'results', 'h5-solo-mo-r1')
  mkdirSync(out, { recursive: true })
  assert.equal(transcriptDir(out, 'C:/bench-runs/h5-1', join(root, 'home')), join(root, 'home', '.claude', 'projects', 'C--bench-runs-h5-1'))
  mkdirSync(join(out, 'evidence'))
  assert.equal(transcriptDir(out, 'C:/bench-runs/h5-1', join(root, 'home')), join(out, 'evidence'))
  mkdirSync(join(root, 'seeds', 'h5'), { recursive: true })
  assert.equal(seedDirFor('h5', join(root, 'seeds')), join(root, 'seeds', 'h5'))
  assert.equal(seedDirFor('h4', join(root, 'seeds')), null)
})

test('isTestPath keeps the inline rule: a test folder or a .test.js/.mjs/.cjs name', () => {
  for (const rel of ['test/a.mjs', 'src/tests/b.js', '__tests__/c.cjs', 'd.test.mjs', 'src/e.test.js']) assert.equal(isTestPath(rel), true, rel)
  for (const rel of ['src/a.mjs', 'testing/a.mjs', 'latest/a.mjs', 'a.test.ts', 'test.mjs']) assert.equal(isTestPath(rel), false, rel)
})

test('runSession prefers session.json', t => {
  const out = mkdtempSync(join(tmpdir(), 'bench-session-'))
  t.after(() => rmSync(out, { recursive: true, force: true }))
  assert.equal(runSession(out), null)
  writeFileSync(join(out, 'raw.json'), jsonl({ type: 'system', subtype: 'init', session_id: 'sess-raw' }))
  assert.equal(runSession(out), 'sess-raw')
  writeFileSync(join(out, 'session.json'), JSON.stringify({ sessionId: 'sess-json', attempt: 2 }))
  assert.equal(runSession(out), 'sess-json')
  // Node's JSON.parse message quotes the bad text, newlines included: the error must still be one line.
  writeFileSync(join(out, 'session.json'), '{"sessionId":\n  oops\n}')
  assert.throws(() => runSession(out), oneLine(/session\.json is not valid JSON$/))
  for (const record of [{ attempt: 1 }, { sessionId: '../x' }, { sessionId: '' }]) {
    writeFileSync(join(out, 'session.json'), JSON.stringify(record))
    assert.throws(() => runSession(out), oneLine(/session\.json has no plain sessionId$/), JSON.stringify(record))
  }
})

test("runSession refuses a raw.json session id that is not plain, since it becomes part of a path", t => {
  const out = mkdtempSync(join(tmpdir(), 'bench-session-raw-'))
  t.after(() => rmSync(out, { recursive: true, force: true }))
  for (const id of ['../../evil', 'a/b', 'x\ny']) {
    writeFileSync(join(out, 'raw.json'), jsonl({ type: 'system', subtype: 'init', session_id: id }))
    assert.throws(() => runSession(out), oneLine(/raw\.json has no plain session id$/), JSON.stringify(id))
  }
  writeFileSync(join(out, 'raw.json'), jsonl({ type: 'user' }))
  assert.equal(runSession(out), null, 'a raw.json without any session id still gives null')
})

test('collectRolesFrom and sessionTexts read an evidence folder', t => {
  const evidence = mkdtempSync(join(tmpdir(), 'bench-evidence-'))
  t.after(() => rmSync(evidence, { recursive: true, force: true }))
  const subs = join(evidence, 'sess1', 'subagents')
  mkdirSync(subs, { recursive: true })
  const main = jsonl(say('m1', 'claude-opus-5-5', { input_tokens: 1 }))
  const sub = jsonl(say('c1', 'claude-sonnet-5-5', { input_tokens: 3 }))
  writeFileSync(join(evidence, 'sess1.jsonl'), main)
  writeFileSync(join(subs, 'agent-c.jsonl'), sub)
  writeFileSync(join(subs, 'agent-c.meta.json'), JSON.stringify({ agentType: 'section-team:coder' }))
  assert.deepEqual(agentModelSplit(collectRolesFrom(evidence, 'sess1')), { main: { opus: 1 }, 'section-team:coder': { sonnet: 3 } })
  assert.deepEqual(sessionTexts(evidence, 'sess1'), [main, sub])
  assert.equal(collectRolesFrom(evidence, 'other'), null)
  assert.deepEqual(sessionTexts(evidence, 'other'), [])
  assert.deepEqual(sessionTexts(evidence, null), [])
})

test('collectRolesFrom and sessionTexts refuse a session id that is not plain in one line, since it becomes part of a path', t => {
  const evidence = mkdtempSync(join(tmpdir(), 'bench-evidence-bad-'))
  t.after(() => rmSync(evidence, { recursive: true, force: true }))
  writeFileSync(join(evidence, 'sess1.jsonl'), jsonl({ type: 'user' }))
  for (const id of ['../sess1', 'a/b', 'x\ny', 'C:', '..', 42]) {
    assert.throws(() => collectRolesFrom(evidence, id), oneLine(/session id is not plain/), JSON.stringify(id))
    assert.throws(() => sessionTexts(evidence, id), oneLine(/session id is not plain/), JSON.stringify(id))
  }
  assert.equal(collectRolesFrom(evidence, undefined), null, 'no id is still no transcript')
  assert.equal(collectRolesFrom(evidence, ''), null)
})

// --- Two-stage tasks (h7) ---

// A bench folder whose h7 sets write what they were given to TMPDIR-<set> (hiddenEnv passes only what node needs) and
// fail as `failing` says.
function fakeSets(t, failing = []) {
  const bench = mkdtempSync(join(tmpdir(), 'score-sets-'))
  t.after(() => rmSync(bench, { recursive: true, force: true, maxRetries: 3 }))
  mkdirSync(join(bench, 'hidden', 'h7'), { recursive: true })
  for (const set of ['s1', 's2', 'reg']) {
    writeFileSync(join(bench, 'hidden', 'h7', `${set}.test.mjs`), [
      "import { test } from 'node:test'",
      "import { writeFileSync } from 'node:fs'",
      `writeFileSync(process.env.TMPDIR + '-${set}', JSON.stringify({ target: process.env.TARGET_DIR, s1: process.env.S1_DIR, key: process.env.ANTHROPIC_API_KEY ?? null }))`,
      "test('passes', () => {})",
      `test('may fail', () => { if (${failing.includes(set)}) throw new Error('no') })`,
    ].join('\n'))
  }
  return bench
}

// hiddenTests with TMPDIR (and a key that must not reach the sets) set for the call.
function withEnv(t, env, fn) {
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]))
  Object.assign(process.env, env)
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value } })
  return fn()
}

test('hiddenTests runs s1 on the stage-1 copy and s2 and reg on the final code, adding up the failures', t => {
  const bench = fakeSets(t, ['s2', 'reg'])
  const seen = join(bench, 'seen')
  const r = withEnv(t, { TMPDIR: seen, ANTHROPIC_API_KEY: 'test-key' }, () => hiddenTests('h7', 'C:/final', { s1Dir: 'C:/copy', bench }))
  const read = set => JSON.parse(readFileSync(`${seen}-${set}`, 'utf8'))
  assert.deepEqual(read('s1'), { target: 'C:/copy', s1: 'C:/copy', key: null })
  assert.deepEqual(read('s2'), { target: 'C:/final', s1: 'C:/copy', key: null })
  assert.deepEqual(read('reg'), { target: 'C:/final', s1: 'C:/copy', key: null })
  assert.deepEqual(r.parts, { s1: { tests: 2, pass: 2, fail: 0 }, s2: { tests: 2, pass: 1, fail: 1 }, reg: { tests: 2, pass: 1, fail: 1 } })
  assert.deepEqual([r.tests, r.pass, r.fail, r.rate], [6, 4, 2, 4 / 6])
  assert.deepEqual(r.incomplete, [])
  for (const set of ['s1', 's2', 'reg']) assert.ok(r.tap.includes(`# set ${set}`), set)
})

test('hiddenTests without a stage-1 copy runs all three sets on the one folder there is', t => {
  const bench = fakeSets(t)
  const seen = join(bench, 'seen')
  withEnv(t, { TMPDIR: seen }, () => hiddenTests('h7', 'C:/final', { bench }))
  assert.deepEqual(JSON.parse(readFileSync(`${seen}-s1`, 'utf8')).target, 'C:/final')
})

test('hiddenTests marks a set killed at its limit as incomplete, so its zero failures cannot read as a pass', t => {
  const bench = fakeSets(t)
  writeFileSync(join(bench, 'hidden', 'h7', 's2.test.mjs'), "setTimeout(() => {}, 2000)\n")
  const fast = "import { test } from 'node:test'\ntest('passes', () => {})\n"
  writeFileSync(join(bench, 'hidden', 'h7', 's1.test.mjs'), fast)
  writeFileSync(join(bench, 'hidden', 'h7', 'reg.test.mjs'), fast)
  // Long enough for a passing set under load: 's1' and 'reg' may be cut too, but 's2' can never finish in time.
  const r = withEnv(t, { TMPDIR: join(bench, 'seen') }, () => hiddenTests('h7', 'C:/final', { s1Dir: 'C:/copy', bench, timeoutMs: 1500 }))
  assert.ok(r.incomplete.includes('s2'), JSON.stringify(r.incomplete))
  assert.equal(r.parts.s2.tests, 0)
})

test('stageChange counts the files and lines stage 2 changed, by kind, leaving out .team and files that are not code', t => {
  const dir = mkdtempSync(join(tmpdir(), 'score-change-'))
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }))
  const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.email=b@l', '-c', 'user.name=b', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
  const write = (rel, text) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), text) }
  const tag = name => { git('add', '-A'); git('commit', '-q', '-m', name); git('tag', name) }
  git('init', '-q', '-b', 'main')
  write('server.mjs', 'a\nb\nc\n')
  write('test/api.test.mjs', 'a\n')
  write('README.md', 'a\n')
  write('data.db', Buffer.from([0, 1, 2]))
  tag('stage-1')
  assert.equal(stageChange(dir), null, 'no stage-2 tag: not measured')
  write('server.mjs', 'a\nB\nc\nd\n')
  write('lib/new.mjs', 'x\ny\n')
  write('test/api.test.mjs', 'a\nb\n')
  write('README.md', 'a\nb\nc\n')
  write('data.db', Buffer.from([3, 4, 5]))
  write('.team/notes/plan.md', 'x\ny\nz\n')
  tag('stage-2')
  assert.deepEqual(stageChange(dir), { files: 2, lines: 5, testFiles: 1, testLines: 1, docsLines: 2 })
})

test('stageCalls counts the main session\'s fresh Agent calls and its SendMessages, not a helper\'s', () => {
  const say = (content, fields = {}) => JSON.stringify({ type: 'assistant', message: { content }, ...fields })
  const raw = [
    JSON.stringify({ type: 'system', subtype: 'init' }),
    say([{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'section-team:backend' } }, { type: 'tool_use', name: 'Read', input: {} }]),
    say([{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'section-team:coder' } }], { parent_tool_use_id: 'toolu_1' }),
    say([{ type: 'tool_use', name: 'SendMessage', input: { to: 'a1' } }]),
    say([{ type: 'tool_use', name: 'Task', input: {} }]),
    JSON.stringify({ type: 'result', subtype: 'success' }),
  ].join('\n')
  assert.deepEqual(stageCalls(raw), { freshAgents: 2, agentTypes: { 'section-team:backend': 1, 'general-purpose': 1 }, sendMessages: 1 })
  assert.deepEqual(stageCalls(''), { freshAgents: 0, agentTypes: {}, sendMessages: 0 })
})

test('readRaw joins a two-stage run\'s output so the last result is scored and both stages\' agents count', t => {
  const outDir = mkdtempSync(join(tmpdir(), 'score-raw-'))
  t.after(() => rmSync(outDir, { recursive: true, force: true, maxRetries: 3 }))
  const line = fields => JSON.stringify(fields)
  const agent = type => line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Agent', input: { subagent_type: type } }] } })
  writeFileSync(join(outDir, 'raw-s1.json'), `${agent('a')}\n${line({ type: 'result', subtype: 'first', session_id: 's' })}\n`)
  writeFileSync(join(outDir, 'raw-s2.json'), `${agent('b')}\n${line({ type: 'result', subtype: 'second', session_id: 's' })}\n`)
  const transcript = parseTranscript(readRaw(outDir))
  assert.deepEqual([transcript.subtype, transcript.agentSpawns], ['second', 2])
  rmSync(join(outDir, 'raw-s2.json'))
  assert.equal(parseTranscript(readRaw(outDir)).subtype, 'first', 'a run that stopped after stage 1')
  rmSync(join(outDir, 'raw-s1.json'))
  writeFileSync(join(outDir, 'raw.json'), line({ type: 'result', subtype: 'single' }))
  assert.equal(parseTranscript(readRaw(outDir)).subtype, 'single', 'a single-stage run')
})

test('a two-stage run\'s cost comes from its transcripts, since a resumed CLI\'s totals may count stage 1 again', () => {
  const usage = { input_tokens: 1000000 }
  const texts = [`${JSON.stringify({ type: 'assistant', message: { id: 'm', model: 'claude-opus-5-5', usage } })}\n`]
  assert.deepEqual(runCost({ run: { stages: [{}, {}] }, transcript: { costUSD: 99 }, evidenceTexts: texts }), { costUSD: 4, costComputed: true })
  assert.deepEqual(runCost({ run: {}, transcript: { costUSD: 99 }, evidenceTexts: texts }), { costUSD: 99, costComputed: false })
})

test('stageTwoMetrics reports stage 2\'s change and calls; a run that stopped after stage 1 has neither', t => {
  const outDir = mkdtempSync(join(tmpdir(), 'score-stage-'))
  t.after(() => rmSync(outDir, { recursive: true, force: true, maxRetries: 3 }))
  assert.deepEqual(stageTwoMetrics(outDir, outDir), { change: null, calls: null })
  writeFileSync(join(outDir, 'raw-s2.json'), `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'SendMessage', input: {} }] } })}\n`)
  assert.deepEqual(stageTwoMetrics(outDir, outDir), { change: null, calls: { freshAgents: 0, agentTypes: {}, sendMessages: 1 } })
})

test('the score line and summary row show a two-stage run\'s three sets; a single-stage run\'s stay as they were', () => {
  const hidden = { tests: 6, pass: 4, fail: 2, rate: 4 / 6, parts: { s1: { tests: 2, pass: 2, fail: 0 }, s2: { tests: 2, pass: 1, fail: 1 }, reg: { tests: 2, pass: 1, fail: 1 } }, incomplete: ['reg'] }
  const transcript = { agentSpawns: 0, tokens: {}, isError: false, turns: 1, agentTypes: {}, agentModels: {}, modelUsage: {} }
  const row = { id: 'h7-solo-mo-r1', hidden, own: { passed: true }, transcript, cost: { costUSD: 1, costComputed: true }, wallMs: 1000, timedOut: false, end: 'ok', code: {}, team: {}, split: null, splitCoverage: {} }
  assert.match(scoreLine(row), /hidden 4\/6 \(fail s1 0 s2 1 reg 1, incomplete reg\)/)
  assert.doesNotMatch(scoreLine({ ...row, hidden: { tests: 2, pass: 2, fail: 0, rate: 1 } }), /fail s1/)
  assert.deepEqual(summaryRow({ ...row, stage2: { change: null, calls: null } }).stage2, { change: null, calls: null })
  assert.ok(!('stage2' in summaryRow(row)))
})

// A results folder holding one run, with a transcript that prices at $4.
function scoredRun(t, id, record, files) {
  const results = mkdtempSync(join(tmpdir(), 'score-run-'))
  t.after(() => rmSync(results, { recursive: true, force: true, maxRetries: 3 }))
  const outDir = join(results, id)
  mkdirSync(join(outDir, 'evidence'), { recursive: true })
  writeFileSync(join(outDir, 'run.json'), JSON.stringify({ id, dir: join(results, 'no-such-folder'), ...record }))
  writeFileSync(join(outDir, 'session.json'), JSON.stringify({ sessionId: 'sid', attempt: 1 }))
  writeFileSync(join(outDir, 'evidence', 'sid.jsonl'), `${JSON.stringify({ type: 'assistant', message: { id: 'm', model: 'claude-opus-5-5', usage: { input_tokens: 1000000 } } })}\n`)
  for (const [name, text] of Object.entries(files)) writeFileSync(join(outDir, name), text)
  return { results, outDir }
}
const counts = { tests: 3, pass: 2, fail: 1, rate: 2 / 3, tap: 'the tap' }
const scoreDeps = (results, seen) => ({ results, hidden: (task, dir, options) => { seen.push({ task, dir, options }); return { ...counts, parts: { s1: counts }, incomplete: [] } }, own: () => ({ hasScript: false, passed: false }) })

test('scoreRun gives a two-stage run its copy for s1, its three sets, a computed cost and its stage-2 measures', t => {
  const result = JSON.stringify({ type: 'result', subtype: 'success', total_cost_usd: 99, session_id: 'sid' })
  const send = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'SendMessage', input: {} }] } })
  const { results, outDir } = scoredRun(t, 'h7-team-sm-r1', { task: 'h7', snapshot: 'C:/copy', stages: [{}, {}] }, { 'raw-s1.json': `${result}\n`, 'raw-s2.json': `${send}\n${result}\n` })
  const seen = []
  const row = scoreRun('h7-team-sm-r1', scoreDeps(results, seen))
  assert.deepEqual(seen[0].options, { s1Dir: 'C:/copy' })
  assert.deepEqual(row.cost, { costUSD: 4, costComputed: true })
  assert.deepEqual(row.hidden.parts, { s1: counts })
  assert.deepEqual(row.stage2, { change: null, calls: { freshAgents: 0, agentTypes: {}, sendMessages: 1 } })
  assert.equal(readFileSync(join(outDir, 'hidden.tap'), 'utf8'), 'the tap')
})

test('scoreRun leaves a single-stage run as it was: raw.json, the CLI\'s cost, no parts and no stage-2 measures', t => {
  const raw = JSON.stringify({ type: 'result', subtype: 'success', total_cost_usd: 99, session_id: 'sid' })
  const { results } = scoredRun(t, 'h4-team-mo-r1', { task: 'h4' }, { 'raw.json': `${raw}\n` })
  const seen = []
  const row = scoreRun('h4-team-mo-r1', { ...scoreDeps(results, seen), hidden: (task, dir, options) => { seen.push({ task, dir, options }); return counts } })
  assert.deepEqual(row.cost, { costUSD: 99, costComputed: false })
  assert.deepEqual(row.hidden, { tests: 3, pass: 2, fail: 1, rate: 2 / 3 })
  assert.ok(!('stage2' in row))
})
