import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readRecord } from '../hooks/lib/mode-record.mjs'
import { BENCH_MODEL, PLUGIN_KEY, childEnv, envNames } from './clean-run.mjs'
import {
  API_FAILURE, BatchStop, LIMIT, RoundStop, archiveAttempt, classifyEnd, copyEvidence, exitCodeOf, finishAttempt, nextAttempt, pendingRuns, projectDirFor,
  recordAttempt,
} from './run-attempts.mjs'

// A temp folder removed after the test, even when the test fails.
function tempRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'bench-attempts-'))
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }))
  return root
}

const put = (file, text = '') => {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, text)
}
const readJson = file => JSON.parse(readFileSync(file, 'utf8'))
// Every file under dir, relative, with forward slashes, sorted.
const filesUnder = dir => readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter(e => e.isFile()).map(e => join(e.parentPath, e.name).slice(dir.length + 1).replaceAll('\\', '/')).sort()

const PLUGIN_DIR = 'C:/Users/Asus/section-team-v0.2.1'
const BUILTINS = [
  { name: 'cc-plugin-agents-md', path: 'builtin', source: 'cc-plugin-agents-md@builtin' },
  { name: 'cc-plugin-telemetry', path: 'builtin', source: 'cc-plugin-telemetry@builtin' },
]
const SECTION_TEAM = { name: 'section-team', path: 'C:\\Users\\Asus\\section-team-v0.2.1', source: PLUGIN_KEY, version: '0.2.1' }
const TEAM_LISTS = { agents: ['general-purpose', 'section-team:backend'], skills: ['tdd-workflow', 'section-team:add-skill'] }
const SOLO_LISTS = { agents: ['general-purpose'], skills: ['tdd-workflow'] }
const PIN = {
  binary: 'C:/Users/Asus/bench-runs/claude-2.1.296.exe', version: '2.1.296', apiKeySource: 'none', builtins: BUILTINS.map(p => p.source),
  pluginDir: PLUGIN_DIR, setups: { solo: SOLO_LISTS, lean: TEAM_LISTS, team: TEAM_LISTS, max: TEAM_LISTS },
}
const CTX = { pin: PIN, installedKeys: ['a@market'], pluginDir: PLUGIN_DIR, pluginCommit: 'c0ffee1' }
const LEAN = { id: 'h4-lean-mo-r1', task: 'h4', cond: 'lean-mo', base: 'lean', rep: 1 }
const SOLO = { id: 'h4-solo-mo-r1', task: 'h4', cond: 'solo-mo', base: 'solo', rep: 1 }
const RUN_DIR = 'C:/Users/Asus/bench-runs/h4-0123abcd'
const ENV = childEnv({ PATH: 'C:/bin', ANTHROPIC_API_KEY: 'test-key' }, { pluginDir: PLUGIN_DIR })

// A lean init as Claude Code 2.1.296 writes it (stream-json's first line), with any fields replaced.
const init = (fields = {}) => ({
  type: 'system', subtype: 'init', session_id: 'sid-1', cwd: RUN_DIR, tools: ['Read'], model: BENCH_MODEL, claude_code_version: '2.1.296',
  apiKeySource: 'none', plugins: [...BUILTINS, SECTION_TEAM], mcp_servers: [], ...TEAM_LISTS, ...fields,
})
const result = (fields = {}) => ({ type: 'result', subtype: 'success', is_error: false, result: 'All tests pass.', total_cost_usd: 1.5, ...fields })
const assistant = effort => JSON.stringify({ type: 'assistant', effort, message: { model: BENCH_MODEL, content: [] } })
const MEDIUM = [assistant('medium')]
const INFO = { exitCode: 0, timedOut: false, wallMs: 61_000, startedAt: '2026-11-01T10:00:00.000Z' }

// finishAttempt for one lean attempt into outDir, with any arguments replaced.
const finish = (outDir, fields = {}) => finishAttempt({
  run: LEAN, outDir, dir: RUN_DIR, sessionId: 'sid-1', attempt: 1, info: INFO, messages: [init(), result()], pin: PIN, ctx: CTX,
  evidenceTexts: MEDIUM, env: ENV, ...fields,
})

test('LIMIT and API_FAILURE are the frozen match rules', () => {
  assert.equal(LIMIT.source, 'usage limit|rate limit|rate_limit_error|hit your (?:[a-z]+ )*limit|out of (?:extra usage|usage credits)')
  assert.equal(LIMIT.flags, 'i')
  assert.equal(API_FAILURE.source, 'API Error|overloaded|overloaded_error|api_error')
  assert.equal(API_FAILURE.flags, 'i')
})

test('classifyEnd: timeout, crash, no result, usage and rate limits, other API failures, other errors and ok', () => {
  const end = (fields, extra = {}) => classifyEnd({ messages: [init(), result(fields)], timedOut: false, exitCode: 0, ...extra })
  const rows = [
    [{ is_error: true, subtype: 'success', result: 'API Error: 529 overloaded' }, 'api-other'],
    [{ is_error: false, subtype: 'success', result: 'API Error: 529 overloaded' }, 'ok'],
    [{ is_error: true, result: "You've hit your limit · resets 5pm" }, 'api-limit'],
    [{ is_error: true, result: "You've hit your weekly usage limit" }, 'api-limit'],
    [{ is_error: true, result: 'Claude AI usage limit reached|1762000000' }, 'api-limit'],
    [{ is_error: true, result: 'API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}' }, 'api-limit'],
    [{ is_error: true, result: 'You are out of extra usage' }, 'api-limit'],
    // Real API-error texts from ~/.claude/projects transcripts (2026-11-01); a -p result carries the same text.
    [{ is_error: true, result: "You've hit your session limit · resets 12pm (Europe/Istanbul)" }, 'api-limit'],
    [{ is_error: true, result: "You've hit your weekly limit · resets Sep 26, 10pm (Europe/Istanbul)" }, 'api-limit'],
    [{ is_error: true, result: 'Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.' }, 'api-other'],
    [{ is_error: true, result: 'API Error: Connection lost mid-response. The response above may be incomplete.' }, 'api-other'],
    [{ is_error: true, result: 'Request failed', api_error_status: 429 }, 'api-limit'],
    [{ is_error: true, result: 'Request failed', api_error_status: 500 }, 'api-other'],
    [{ is_error: true, result: '{"type":"error","error":{"type":"api_error"}}' }, 'api-other'],
    [{ is_error: true, subtype: 'error_max_turns', result: 'Reached the maximum number of turns' }, 'error'],
    [{ is_error: true, subtype: 'error_max_turns', api_error_status: null, result: 'Reached the maximum number of turns' }, 'error'],
    [{ is_error: true, subtype: 'error_during_execution', result: undefined }, 'error'],
    [{}, 'ok'],
  ]
  for (const [fields, kind] of rows) assert.equal(end(fields), kind, JSON.stringify(fields))
  assert.equal(end({}, { timedOut: true, exitCode: null }), 'timeout', 'a timeout wins over what the output says')
  assert.equal(classifyEnd({ messages: [init()], timedOut: true, exitCode: null }), 'timeout')
  assert.equal(classifyEnd({ messages: [init()], timedOut: false, exitCode: 1 }), 'crash')
  assert.equal(classifyEnd({ messages: [], timedOut: false, exitCode: null }), 'crash', 'killed from outside')
  assert.equal(classifyEnd({ messages: [init()], timedOut: false, exitCode: 0 }), 'no-result')
})

test('projectDirFor turns every character of the run folder other than a letter or digit into a dash', () => {
  assert.equal(projectDirFor(RUN_DIR, 'C:/home'), join('C:/home', '.claude', 'projects', 'C--Users-Asus-bench-runs-h4-0123abcd'))
  assert.equal(projectDirFor('C:\\Users\\Asus\\bench-runs\\h4-0123abcd', 'C:/home'), projectDirFor(RUN_DIR, 'C:/home'))
})

test('archiveAttempt moves the earlier results and project folder into attempt-1, then attempt-2', t => {
  const root = tempRoot(t)
  const outDir = join(root, 'results', 'h4-lean-mo-r1')
  const projectDir = join(root, 'projects', 'C--Users-Asus-bench-runs-h4-0123abcd')
  assert.equal(archiveAttempt(outDir, projectDir), null, 'a first attempt has nothing to move')
  assert.ok(!existsSync(outDir), 'and creates nothing')
  assert.equal(nextAttempt(outDir), 1)

  for (const name of ['raw.json', 'run.json', 'session.json', 'evidence/sid-1.jsonl', 'section-memory/section-team-backend/a.md']) put(join(outDir, name), name)
  put(join(outDir, 'attempts.json'), '[]\n')
  put(join(projectDir, 'sid-1.jsonl'), 'transcript')
  put(join(projectDir, 'memory', 'MEMORY.md'), 'auto-memory')

  assert.equal(archiveAttempt(outDir, projectDir), join(outDir, 'attempt-1'))
  assert.deepEqual(readdirSync(outDir).sort(), ['attempt-1', 'attempts.json'])
  assert.deepEqual(filesUnder(join(outDir, 'attempt-1')), [
    'C--Users-Asus-bench-runs-h4-0123abcd/memory/MEMORY.md', 'C--Users-Asus-bench-runs-h4-0123abcd/sid-1.jsonl',
    'evidence/sid-1.jsonl', 'raw.json', 'run.json', 'section-memory/section-team-backend/a.md', 'session.json',
  ])
  assert.ok(!existsSync(projectDir), 'the next attempt starts with no transcripts or auto-memory of this one')
  assert.equal(readFileSync(join(outDir, 'attempts.json'), 'utf8'), '[]\n', 'attempts.json stays in place')
  assert.equal(nextAttempt(outDir), 2)

  put(join(outDir, 'raw.json'), 'second')
  assert.equal(archiveAttempt(outDir, projectDir), join(outDir, 'attempt-2'))
  assert.deepEqual(filesUnder(join(outDir, 'attempt-2')), ['raw.json'], 'no project folder this time')
  assert.equal(filesUnder(join(outDir, 'attempt-1')).length, 7, 'attempt-1 is left as it was')
  assert.equal(archiveAttempt(outDir, projectDir), null, 'only attempt folders and attempts.json left: nothing to move')
  assert.deepEqual(readdirSync(outDir).sort(), ['attempt-1', 'attempt-2', 'attempts.json'])
})

test('archiveAttempt refuses to mix two attempts in one folder', t => {
  const outDir = tempRoot(t)
  mkdirSync(join(outDir, 'attempt-2'))
  put(join(outDir, 'raw.json'), 'x')
  assert.throws(() => archiveAttempt(outDir, join(outDir, 'no-project')), { code: 'EEXIST' })
  assert.ok(existsSync(join(outDir, 'raw.json')), 'nothing moved')
})

test('recordAttempt counts api-other and void toward the cap, not api-limit; a harness-bug entry resets it', t => {
  const outDir = join(tempRoot(t), 'h4-lean-mo-r1')
  const kinds = [['api-other', 1], ['api-limit', 1], ['void', 2], ['harness-bug', 0], ['api-other', 1], ['void', 2], ['api-other', 3]]
  for (const [kind, capped] of kinds) assert.equal(recordAttempt(outDir, { kind, at: 't' }).capped, capped, kind)
  const { history } = recordAttempt(outDir, { kind: 'void', at: 'last' })
  assert.deepEqual(history.map(e => e.kind), [...kinds.map(([kind]) => kind), 'void'])
  assert.deepEqual(readJson(join(outDir, 'attempts.json')), history, 'appended to attempts.json')

  const twice = join(outDir, '..', 'two-fixes')
  const counts = ['void', 'harness-bug', 'void', 'void', 'harness-bug', 'void'].map(kind => recordAttempt(twice, { kind }).capped)
  assert.deepEqual(counts, [1, 0, 1, 2, 0, 1], 'only entries after the last harness-bug count')
})

test('recordAttempt says in one line that attempts.json is broken, and changes nothing', t => {
  const outDir = tempRoot(t)
  put(join(outDir, 'attempts.json'), '[{"kind":')
  assert.throws(() => recordAttempt(outDir, { kind: 'void' }), err => {
    assert.match(err.message, /attempts\.json is not valid JSON/)
    assert.doesNotMatch(err.message, /\n/)
    return true
  })
  put(join(outDir, 'attempts.json'), '{"kind":"void"}')
  assert.throws(() => recordAttempt(outDir, { kind: 'void' }), /attempts\.json is not a list of attempts/)
  assert.equal(readFileSync(join(outDir, 'attempts.json'), 'utf8'), '{"kind":"void"}')
})

test('copyEvidence copies only this session in the evidence layout, and stops loudly without the session file or a team setup\'s mode record', t => {
  const root = tempRoot(t)
  const home = join(root, 'home')
  const project = projectDirFor(RUN_DIR, home)
  const modes = join(home, '.claude', 'section-team', 'modes')
  put(join(project, 'sid-1.jsonl'), assistant('medium'))
  put(join(project, 'sid-1', 'subagents', 'agent-a1.jsonl'), assistant('medium'))
  put(join(project, 'sid-1', 'subagents', 'agent-a1.meta.json'), '{"agentType":"section-team:backend"}')
  put(join(project, 'sid-0.jsonl'), 'an earlier session')
  put(join(project, 'sid-0', 'subagents', 'agent-b.jsonl'), 'an earlier session')
  put(join(project, 'memory', 'MEMORY.md'), 'auto-memory')
  put(join(modes, 'sid-1.json'), '{"mode":"lean"}')
  put(join(modes, 'sid-0.json'), '{"mode":"max"}')

  const outDir = join(root, 'results', 'h4-lean-mo-r1')
  const evidence = join(outDir, 'evidence')
  const copied = copyEvidence({ runDir: RUN_DIR, sessionId: 'sid-1', outDir, base: 'lean', home })
  const layout = ['.claude/section-team/modes/sid-1.json', 'sid-1.jsonl', 'sid-1/subagents/agent-a1.jsonl', 'sid-1/subagents/agent-a1.meta.json']
  assert.deepEqual(filesUnder(evidence), layout)
  assert.deepEqual(copied.map(file => file.slice(evidence.length + 1).replaceAll('\\', '/')).sort(), layout, 'it returns the copied files')
  assert.equal(readRecord(evidence, 'sid-1'), 'lean', 'readRecord reads the copied mode record')
  assert.ok(existsSync(join(project, 'sid-1.jsonl')), 'a copy: the transcript stays where Claude Code wrote it')

  const noSession = join(root, 'results', 'no-session')
  put(join(modes, 'sid-2.json'), '{"mode":"team"}')
  assert.throws(() => copyEvidence({ runDir: RUN_DIR, sessionId: 'sid-2', outDir: noSession, base: 'team', home }),
    { message: `evidence missing for sid-2: ${join(project, 'sid-2.jsonl')}` })
  assert.ok(!existsSync(noSession), 'nothing copied before the stop')

  put(join(project, 'sid-3.jsonl'), assistant('medium'))
  for (const base of ['lean', 'team', 'max']) {
    assert.throws(() => copyEvidence({ runDir: RUN_DIR, sessionId: 'sid-3', outDir: join(root, base), base, home }),
      { message: `evidence missing for sid-3: ${join(modes, 'sid-3.json')}` }, base)
  }
  assert.deepEqual(copyEvidence({ runDir: RUN_DIR, sessionId: 'sid-3', outDir: join(root, 'solo'), base: 'solo', home }).length, 1, 'solo has no mode record')
  assert.deepEqual(filesUnder(join(root, 'solo', 'evidence')), ['sid-3.jsonl'])
  assert.deepEqual(copyEvidence({ runDir: RUN_DIR, sessionId: 'sid-4', outDir: join(root, 'limit'), base: 'max', home, bestEffort: true }), [],
    'best effort copies what exists and never stops')
  assert.throws(() => copyEvidence({ runDir: RUN_DIR, sessionId: '../sid-1', outDir: join(root, 'bad'), base: 'solo', home }), /session id/)
})

test('finishAttempt on a usage limit: no run.json, no cap use', t => {
  const outDir = tempRoot(t)
  const limit = [init(), result({ is_error: true, result: "You've hit your limit · resets 5pm" })]
  for (let i = 0; i < 4; i++) {
    assert.throws(() => finish(outDir, { messages: limit }), err => {
      assert.ok(err instanceof BatchStop)
      assert.equal(err.exitCode, 2)
      assert.match(err.reason, /^h4-lean-mo-r1: .*hit your limit/)
      assert.doesNotMatch(err.message, /\n/)
      return true
    })
  }
  assert.deepEqual(readdirSync(outDir), [], 'no run.json, void.json or attempts entry')
})

test('finishAttempt on a third api-other: RoundStop', t => {
  const outDir = tempRoot(t)
  const overloaded = [init(), result({ is_error: true, result: 'API Error: 529 overloaded' })]
  for (const attempt of [1, 2]) {
    assert.throws(() => finish(outDir, { messages: overloaded, attempt }), err => err instanceof BatchStop && err.exitCode === 2, `attempt ${attempt}`)
  }
  assert.throws(() => finish(outDir, { messages: overloaded, attempt: 3 }), err => {
    assert.ok(err instanceof RoundStop)
    assert.equal(err.exitCode, 3)
    assert.match(err.message, /^round stopped: h4-lean-mo-r1: /)
    return true
  })
  assert.deepEqual(readdirSync(outDir), ['attempts.json'], 'an API failure writes no run.json')
  assert.deepEqual(readJson(join(outDir, 'attempts.json')).map(e => [e.kind, e.attempt, e.sessionId]),
    [['api-other', 1, 'sid-1'], ['api-other', 2, 'sid-1'], ['api-other', 3, 'sid-1']])
})

test('finishAttempt: void writes void.json', t => {
  const outDir = tempRoot(t)
  assert.throws(() => finish(outDir, { messages: [init({ mcp_servers: [{ name: 'x' }] }), result()] }), err => err instanceof BatchStop)
  assert.deepEqual(readJson(join(outDir, 'void.json')), { reasons: ['MCP servers loaded: x'] })
  assert.ok(!existsSync(join(outDir, 'run.json')))

  assert.throws(() => finish(outDir, { evidenceTexts: [assistant('high')] }), err => err instanceof BatchStop)
  assert.deepEqual(readJson(join(outDir, 'void.json')), { reasons: ['assistant effort high, expected medium'] }, 'the effort comes from the transcripts')

  assert.throws(() => finish(outDir, { messages: [result()] }), err => err instanceof RoundStop, 'a third void stops the round')
  assert.deepEqual(readJson(join(outDir, 'void.json')), { reasons: ['no init message'] })
  assert.deepEqual(readJson(join(outDir, 'attempts.json')).map(e => [e.kind, e.reasons]),
    [['void', ['MCP servers loaded: x']], ['void', ['assistant effort high, expected medium']], ['void', ['no init message']]])
  assert.ok(!existsSync(join(outDir, 'run.json')))
})

test('finishAttempt: a version or model mismatch is a harness bug that stops the batch and resets the cap', t => {
  const outDir = tempRoot(t)
  recordAttempt(outDir, { kind: 'void' })
  recordAttempt(outDir, { kind: 'api-other' })
  for (const fields of [{ claude_code_version: '2.1.300' }, { model: 'claude-sonnet-5' }, { apiKeySource: 'ANTHROPIC_API_KEY' }]) {
    assert.throws(() => finish(outDir, { messages: [init({ ...fields, mcp_servers: [{ name: 'x' }] }), result()] }), err => {
      assert.ok(err instanceof BatchStop, 'never a round stop')
      assert.equal(err.reason, 'harness bug: version or model mismatch')
      return true
    }, JSON.stringify(fields))
    assert.equal(readJson(join(outDir, 'void.json')).reasons.length, 2, 'void.json lists every reason')
  }
  const history = readJson(join(outDir, 'attempts.json'))
  assert.deepEqual(history.map(e => e.kind), ['void', 'api-other', 'harness-bug', 'harness-bug', 'harness-bug'])
  assert.equal(recordAttempt(outDir, { kind: 'void' }).capped, 1, 'the rerun count starts again at 0')
  assert.ok(!existsSync(join(outDir, 'run.json')))
})

test('finishAttempt: a wrong section-team version is a void run, not a harness bug', t => {
  const outDir = tempRoot(t)
  const old = init({ plugins: [...BUILTINS, { ...SECTION_TEAM, version: '0.2.0' }] })
  assert.throws(() => finish(outDir, { messages: [old, result()] }), err => err instanceof BatchStop && err.reason !== 'harness bug: version or model mismatch')
  assert.deepEqual(readJson(join(outDir, 'void.json')), { reasons: ['section-team version 0.2.0, expected 0.2.1'] })
  assert.deepEqual(readJson(join(outDir, 'attempts.json')).map(e => e.kind), ['void'])
})

test('finishAttempt: a timed-out run with an init and no result writes run.json with end timeout and is not void', t => {
  const outDir = tempRoot(t)
  const info = { exitCode: null, timedOut: true, wallMs: 7_200_000, startedAt: '2026-11-01T10:00:00.000Z' }
  assert.deepEqual(finish(outDir, { info, messages: [init()], attempt: 2 }), { kind: 'timeout', wrote: join(outDir, 'run.json') })
  assert.deepEqual(readJson(join(outDir, 'run.json')), {
    ...LEAN, dir: RUN_DIR, ...info, sessionId: 'sid-1', attempt: 2, end: 'timeout', subtype: null, resultText: null, pluginCommit: 'c0ffee1',
    sectionTeam: { path: SECTION_TEAM.path, version: '0.2.1' },
    init: { plugins: [...BUILTINS, SECTION_TEAM], mcp_servers: [], ...TEAM_LISTS, claude_code_version: '2.1.296', model: BENCH_MODEL, apiKeySource: 'none' },
    envNames: ['CLAUDE_CODE_PLUGIN_DIRS', 'DISABLE_AUTOUPDATER', 'ENABLE_CLAUDEAI_MCP_SERVERS', 'SECTION_TEAM_AUTO_INSTALL_SKILLS'],
  })
  assert.deepEqual(readdirSync(outDir), ['run.json'], 'no void.json and no attempts entry')
})

test('finishAttempt: a crash with an init writes run.json with end crash', t => {
  const outDir = tempRoot(t)
  const info = { ...INFO, exitCode: 1 }
  assert.equal(finish(outDir, { info, messages: [init()] }).kind, 'crash')
  const run = readJson(join(outDir, 'run.json'))
  assert.deepEqual([run.end, run.exitCode, run.subtype, run.resultText], ['crash', 1, null, null])
})

test('finishAttempt: an ok or error ending keeps its subtype and the first 500 characters of the result; solo records no section-team', t => {
  const outDir = tempRoot(t)
  const long = 'x'.repeat(600)
  const soloInit = init({ plugins: BUILTINS, ...SOLO_LISTS })
  assert.equal(finish(outDir, { run: SOLO, messages: [soloInit, result({ result: long })] }).kind, 'ok')
  const run = readJson(join(outDir, 'run.json'))
  assert.deepEqual([run.id, run.end, run.subtype, run.resultText, run.sectionTeam], ['h4-solo-mo-r1', 'ok', 'success', 'x'.repeat(500), null])
  assert.deepEqual(run.envNames, envNames(ENV))

  const error = result({ is_error: true, subtype: 'error_max_turns', result: 'Reached the maximum number of turns' })
  assert.equal(finish(outDir, { messages: [init(), error] }).kind, 'error')
  assert.deepEqual(readJson(join(outDir, 'run.json')).subtype, 'error_max_turns')
})

test('BatchStop and RoundStop carry a one-line reason and exit codes 2 and 3', () => {
  const batch = new BatchStop('h4-lean-mo-r1: API failure')
  assert.deepEqual([batch.name, batch.reason, batch.message, batch.exitCode], ['BatchStop', 'h4-lean-mo-r1: API failure', 'batch stopped: h4-lean-mo-r1: API failure', 2])
  const round = new RoundStop('cap')
  assert.deepEqual([round.name, round.message, round.exitCode], ['RoundStop', 'round stopped: cap', 3])
  assert.ok(batch instanceof Error && round instanceof Error)
  assert.deepEqual([exitCodeOf(batch), exitCodeOf(round), exitCodeOf(new Error('cannot read pin')), exitCodeOf(Object.assign(new Error('x'), { exitCode: 2 }))], [2, 3, 1, 1])
})

test('pendingRuns names a broken run.json of a rerun id in one line', t => {
  const { results, runs } = batchResults(t)
  const flags = { results, rerun: ['h4-a-mo-r1'], reason: 'fix a1b2c3d', at: '2026-11-01T12:00:00.000Z' }
  pendingRuns(runs, flags)
  put(join(results, 'h4-a-mo-r1', 'run.json'), '{"startedAt":')
  assert.throws(() => pendingRuns(runs, flags), err => {
    assert.match(err.message, /run\.json is not valid JSON/)
    assert.doesNotMatch(err.message, /\n/)
    return true
  })
})

// Three runs of a batch: a and c have finished (run.json), b has not.
function batchResults(t) {
  const results = tempRoot(t)
  const runs = ['a', 'b', 'c'].map(id => ({ id: `h4-${id}-mo-r1`, task: 'h4', cond: `${id}-mo`, base: 'team', rep: 1 }))
  for (const id of ['h4-a-mo-r1', 'h4-c-mo-r1']) put(join(results, id, 'run.json'), JSON.stringify({ id, startedAt: '2026-11-01T09:00:00.000Z' }))
  return { results, runs }
}

test('pendingRuns: a --rerun id with run.json is pending again and its earlier attempt is archived on the next run', t => {
  const { results, runs } = batchResults(t)
  assert.deepEqual(pendingRuns(runs, { results, rerun: [], reason: '', at: 'T' }).map(r => r.id), ['h4-b-mo-r1'])
  const reason = 'fix a1b2c3d: wrong timeout'
  const at = '2026-11-01T12:00:00.000Z'
  const pending = pendingRuns(runs, { results, rerun: ['h4-a-mo-r1'], reason, at })
  assert.deepEqual(pending, [runs[0], runs[1]], 'plan order, the runs themselves')
  assert.deepEqual(readJson(join(results, 'h4-a-mo-r1', 'attempts.json')), [{ kind: 'harness-bug', reason, at }])
  assert.ok(!existsSync(join(results, 'h4-c-mo-r1', 'attempts.json')))

  const outDir = join(results, 'h4-a-mo-r1')
  assert.equal(archiveAttempt(outDir, join(results, 'no-project')), join(outDir, 'attempt-1'))
  assert.ok(existsSync(join(outDir, 'attempt-1', 'run.json')), 'the earlier attempt is kept, not scored')
  assert.ok(existsSync(join(outDir, 'attempts.json')), 'the harness-bug entry stays with the run')
})

test('pendingRuns: a resume with the same --rerun and reason records nothing again and reruns only what has not rerun since', t => {
  const { results, runs } = batchResults(t)
  const flags = { results, rerun: ['h4-a-mo-r1', 'h4-c-mo-r1'], reason: 'fix a1b2c3d', at: '2026-11-01T12:00:00.000Z' }
  pendingRuns(runs, flags)
  // a reran after the fix; c did not get its turn before the batch stopped.
  put(join(results, 'h4-a-mo-r1', 'run.json'), JSON.stringify({ startedAt: '2026-11-01T12:05:00.000Z' }))
  const resumed = pendingRuns(runs, { ...flags, at: '2026-11-01T18:00:00.000Z' })
  assert.deepEqual(resumed.map(r => r.id), ['h4-b-mo-r1', 'h4-c-mo-r1'])
  for (const id of ['h4-a-mo-r1', 'h4-c-mo-r1']) assert.equal(readJson(join(results, id, 'attempts.json')).length, 1, `${id}: the cap is not reset again`)
  assert.equal(pendingRuns(runs, { ...flags, reason: 'fix d4e5f6a' }).length, 3, 'a new fix reruns both again')
})

test('pendingRuns refuses a --rerun id outside the plan, or without a reason, before it records anything', t => {
  const { results, runs } = batchResults(t)
  assert.throws(() => pendingRuns(runs, { results, rerun: ['h4-a-mo-r1', 'h5-a-mo-r1'], reason: 'fix', at: 'T' }),
    { name: 'RangeError', message: '--rerun names h5-a-mo-r1, which is not a run of this batch' })
  assert.throws(() => pendingRuns(runs, { results, rerun: ['h4-a-mo-r1'], reason: ' ', at: 'T' }),
    { name: 'RangeError', message: '--rerun needs --reason= naming the harness-bug fix commit' })
  assert.throws(() => pendingRuns(runs, { results, rerun: ['h4-a-mo-r1'], reason: 'fix' }), { name: 'TypeError' }, 'no time to record')
  assert.ok(!existsSync(join(results, 'h4-a-mo-r1', 'attempts.json')))
  assert.ok(!existsSync(join(results, 'h5-a-mo-r1')))
})

test('pendingRuns keeps the round stopped while a run has used its capped reruns, until a harness-bug rerun', t => {
  const { results, runs } = batchResults(t)
  const outDir = join(results, 'h4-b-mo-r1')
  for (const kind of ['api-other', 'void', 'api-other']) recordAttempt(outDir, { kind })
  assert.throws(() => pendingRuns(runs, { results, rerun: [], reason: '', at: 'T' }), err => {
    assert.ok(err instanceof RoundStop)
    assert.match(err.reason, /^h4-b-mo-r1: .*--rerun=h4-b-mo-r1 --reason=/)
    return true
  })
  assert.deepEqual(pendingRuns(runs, { results, rerun: ['h4-b-mo-r1'], reason: 'fix 0a1b2c3', at: 'T' }).map(r => r.id), ['h4-b-mo-r1'])
})
