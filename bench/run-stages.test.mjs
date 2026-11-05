// The harness's two-stage tasks (h7); run.test.mjs and run-plugin.test.mjs have the rest of run.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordMode } from '../hooks/lib/mode-record.mjs'
import { PLUGIN_KEY } from './clean-run.mjs'
import { fakeClaude, git, soloAttempt, tempRoot } from './run-fixtures.mjs'
import { BatchStop, exitCodeOf } from './run-attempts.mjs'
import { HIDDEN_SETS, TIMEOUT_MIN, builderArgs, freshRepo, isTwoStage, parseArgs, runOne, tagStage, taskProblems } from './run.mjs'

test('h7 has a time limit per stage, and only h7 is a two-stage task', () => {
  assert.equal(TIMEOUT_MIN.h7, 120)
  assert.ok(isTwoStage('h7'))
  for (const task of ['easy', 'h4', 'h5', 'h6', 'constructor']) assert.ok(!isTwoStage(task), task)
  assert.deepEqual(HIDDEN_SETS, ['s1', 's2', 'reg'])
})

test('builderArgs on a resume uses --resume instead of --session-id and changes nothing else', () => {
  const options = { sessionId: 'sid', installedKeys: ['a@market'], pluginDir: 'C:/p' }
  const first = builderArgs('team', 'the prompt', options)
  const second = builderArgs('team', 'the prompt', { ...options, resume: true })
  assert.ok(!second.includes('--session-id'))
  assert.deepEqual(second, first.map(arg => (arg === '--session-id' ? '--resume' : arg)))
})

test('taskProblems finds nothing wrong with h7 and asks a two-stage task for its second prompt and all three hidden sets', t => {
  assert.deepEqual(taskProblems(['h7']), [])
  const bench = tempRoot(t)
  assert.deepEqual(taskProblems(['h7'], bench), ['h7: missing bench/tasks/h7.md, bench/tasks/h7-s2.md, bench/hidden/h7/s1.test.mjs, bench/hidden/h7/s2.test.mjs, bench/hidden/h7/reg.test.mjs'])
  mkdirSync(join(bench, 'tasks'))
  mkdirSync(join(bench, 'hidden', 'h7'), { recursive: true })
  for (const file of ['tasks/h7.md', 'tasks/h7-s2.md', 'hidden/h7/s1.test.mjs', 'hidden/h7/s2.test.mjs']) writeFileSync(join(bench, file), 'x')
  assert.deepEqual(taskProblems(['h7'], bench), ['h7: missing bench/hidden/h7/reg.test.mjs'])
})

// A stand-in for two spawns of the binary: each behaves as fakeClaude with its stage's options, after writing the
// stage's files into the run folder as the run's agents would.
const stagedClaude = ({ home, calls, init, stages }) => {
  let at = 0
  return (command, args, options) => {
    const { files = {}, ...stage } = stages[at++]
    for (const [name, text] of Object.entries(files)) writeFileSync(join(options.cwd, name), text)
    return fakeClaude({ home, calls, init, ...stage })(command, args, options)
  }
}

// A solo attempt of h7 into a temp root; a test gives each stage's options.
function stagedAttempt(t, stages) {
  const base = soloAttempt(t)
  const calls = []
  const run = { id: 'h7-solo-mo-r1', task: 'h7', cond: 'solo-mo', base: 'solo', rep: 1 }
  const outDir = join(base.root, 'results', run.id)
  return { ...base, run, outDir, calls, deps: { ...base.deps, spawn: stagedClaude({ home: base.home, calls, init: base.init, stages }) } }
}
const readRecord = outDir => JSON.parse(readFileSync(join(outDir, 'run.json'), 'utf8'))

test('runOne gives a two-stage task its second prompt by --resume in the same session, and keeps raw-s1.json and raw-s2.json', async t => {
  const { outDir, ctx, run, calls, deps, pin } = stagedAttempt(t, [{}, {}])
  await runOne(run, outDir, ctx, deps)
  assert.equal(calls.length, 2)
  const { sessionId } = JSON.parse(readFileSync(join(outDir, 'session.json'), 'utf8'))
  const options = { sessionId, installedKeys: ctx.installedKeys, pluginDir: ctx.pluginDir }
  const [first, second] = calls
  assert.ok(first.args[1].endsWith(readFileSync(join(import.meta.dirname, 'tasks', 'h7.md'), 'utf8')), 'stage 1 gets the task prompt')
  assert.ok(second.args[1].endsWith(readFileSync(join(import.meta.dirname, 'tasks', 'h7-s2.md'), 'utf8')), 'stage 2 gets the second prompt')
  assert.deepEqual(first.args, builderArgs('solo', first.args[1], options))
  assert.deepEqual(second.args, builderArgs('solo', second.args[1], { ...options, resume: true }))
  assert.ok(!second.args.includes('--session-id'), 'a resume must not force a session id')
  assert.deepEqual([first.command, second.command], [pin.binary, pin.binary])
  assert.equal(second.options.cwd, first.options.cwd, 'the same folder, where the session lives')
  for (const name of ['raw-s1.json', 'raw-s2.json', 'stderr-s1.txt', 'stderr-s2.txt']) assert.ok(existsSync(join(outDir, name)), name)
  assert.ok(!existsSync(join(outDir, 'raw.json')))
  assert.ok(existsSync(join(outDir, 'evidence', `${sessionId}.jsonl`)))
  const record = readRecord(outDir)
  assert.deepEqual([record.end, record.sessionId, record.exitCode, record.timedOut], ['ok', sessionId, 0, false])
  assert.deepEqual(record.stages.map(s => [s.stage, s.end, s.exitCode, s.timedOut]), [[1, 'ok', 0, false], [2, 'ok', 0, false]])
  assert.equal(record.wallMs, record.stages[0].wallMs + record.stages[1].wallMs)
  assert.equal(record.startedAt, record.stages[0].startedAt)
})

test('runOne tags the folder after each stage, uncommitted work included, and copies it after stage 1', async t => {
  const { outDir, ctx, run, deps } = stagedAttempt(t, [{ files: { 'a.mjs': 'one\n' } }, { files: { 'a.mjs': 'two\n', 'b.mjs': 'new\n' } }])
  await runOne(run, outDir, ctx, deps)
  const { dir } = deps
  assert.equal(git(dir, 'show', 'stage-1:a.mjs'), 'one')
  assert.equal(git(dir, 'show', 'stage-2:a.mjs'), 'two')
  assert.deepEqual(git(dir, 'diff', '--name-only', 'stage-1', 'stage-2').split('\n'), ['a.mjs', 'b.mjs'])
  const record = readRecord(outDir)
  assert.equal(record.snapshot, `${dir}-s1`)
  assert.equal(readFileSync(join(record.snapshot, 'a.mjs'), 'utf8'), 'one\n', 'the copy keeps stage 1\'s code')
  assert.ok(!existsSync(join(record.snapshot, 'b.mjs')))
  assert.equal(readFileSync(join(dir, 'a.mjs'), 'utf8'), 'two\n')
})

test('tagStage is not stopped by a hook the solution installed, and tags even with nothing to commit', t => {
  const root = tempRoot(t)
  const dir = join(root, 'run')
  freshRepo(dir, { root })
  mkdirSync(join(dir, '.git', 'hooks'), { recursive: true })
  writeFileSync(join(dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  writeFileSync(join(dir, 'a.mjs'), 'x\n')
  tagStage(dir, 'stage-1')
  tagStage(dir, 'stage-2')
  assert.equal(git(dir, 'show', 'stage-1:a.mjs'), 'x')
  assert.equal(git(dir, 'rev-parse', 'stage-1^{tree}'), git(dir, 'rev-parse', 'stage-2^{tree}'))
})

test('a stage 1 that does not end ok gets no second prompt and no copy; the run ends as stage 1 did', async t => {
  const { outDir, ctx, run, calls, deps } = stagedAttempt(t, [{ hang: true }])
  await runOne(run, outDir, ctx, { ...deps, timeoutMs: 50 })
  assert.equal(calls.length, 1)
  const record = readRecord(outDir)
  assert.deepEqual([record.end, record.timedOut, record.snapshot], ['timeout', true, null])
  assert.deepEqual(record.stages.map(s => [s.stage, s.end]), [[1, 'timeout']])
  assert.ok(!existsSync(`${deps.dir}-s1`))
  assert.ok(!existsSync(join(outDir, 'raw-s2.json')))
})

test('an API failure in either stage stops the batch; stage 1\'s stops it before stage 2 starts', async t => {
  const overloaded = { type: 'result', subtype: 'success', is_error: true, result: 'API Error: 529 overloaded' }
  const inFirst = stagedAttempt(t, [{ result: overloaded }])
  await assert.rejects(runOne(inFirst.run, inFirst.outDir, inFirst.ctx, inFirst.deps), err => err instanceof BatchStop && /API failure/.test(err.reason))
  assert.equal(inFirst.calls.length, 1)
  const inSecond = stagedAttempt(t, [{}, { result: overloaded }])
  await assert.rejects(runOne(inSecond.run, inSecond.outDir, inSecond.ctx, inSecond.deps), err => err instanceof BatchStop && /API failure/.test(err.reason))
  assert.equal(inSecond.calls.length, 2)
  assert.ok(!existsSync(join(inSecond.outDir, 'run.json')))
})

test('a stage 2 that writes no result ends the run that way, never as stage 1\'s ok', async t => {
  const { outDir, ctx, run, deps } = stagedAttempt(t, [{}, { result: null }])
  await runOne(run, outDir, ctx, deps)
  const record = readRecord(outDir)
  assert.equal(record.end, 'no-result')
  assert.deepEqual(record.stages.map(s => s.end), ['ok', 'no-result'])
})

test('a stage 1 whose init is void gets no second prompt, and a resume as another session or a void stage 2 init voids the run', async t => {
  const voidFirst = stagedAttempt(t, [{ init: { ...soloAttempt(t).init, model: 'claude-sonnet-5' } }])
  await assert.rejects(runOne(voidFirst.run, voidFirst.outDir, voidFirst.ctx, voidFirst.deps), /version or model mismatch/)
  assert.equal(voidFirst.calls.length, 1)
  const forked = stagedAttempt(t, [{}, { reportedSession: 'another-session' }])
  await assert.rejects(runOne(forked.run, forked.outDir, forked.ctx, forked.deps), err => err instanceof BatchStop && /stage 2 ran as session another-session/.test(err.reason))
  assert.match(readFileSync(join(forked.outDir, 'void.json'), 'utf8'), /another-session/)
  const voidSecond = stagedAttempt(t, [{}, { init: { ...soloAttempt(t).init, mcp_servers: [{ name: 'stray' }] } }])
  await assert.rejects(runOne(voidSecond.run, voidSecond.outDir, voidSecond.ctx, voidSecond.deps), err => err instanceof BatchStop && /MCP servers loaded: stray/.test(err.reason))
})

test('a second attempt keeps the first attempt\'s stage copy beside its solution folder', async t => {
  const { outDir, ctx, run, deps } = stagedAttempt(t, [{ files: { 'a.mjs': 'first\n' } }, {}, { files: { 'a.mjs': 'second\n' } }, {}])
  await runOne(run, outDir, ctx, deps)
  await runOne(run, outDir, ctx, deps)
  assert.equal(readFileSync(join(`${deps.dir}-s1-attempt-1`, 'a.mjs'), 'utf8'), 'first\n')
  assert.equal(readFileSync(join(`${deps.dir}-s1`, 'a.mjs'), 'utf8'), 'second\n')
  assert.ok(existsSync(join(outDir, 'attempt-1', 'raw-s1.json')))
})

test('a single-stage task still spawns once, writes raw.json and records no stages', async t => {
  const { home, outDir, ctx, init, run, deps: base } = soloAttempt(t)
  const calls = []
  await runOne(run, outDir, ctx, { ...base, spawn: fakeClaude({ home, calls, init }) })
  assert.equal(calls.length, 1)
  assert.ok(existsSync(join(outDir, 'raw.json')) && existsSync(join(outDir, 'stderr.txt')))
  assert.ok(!existsSync(join(outDir, 'raw-s1.json')))
  const record = readRecord(outDir)
  assert.ok(!('stages' in record) && !('snapshot' in record))
  assert.ok(!existsSync(`${base.dir}-s1`))
  assert.throws(() => git(base.dir, 'rev-parse', '--verify', '-q', 'stage-1'))
})

test('a tag that fails loses only stage 2\'s change measure: the run is said, and counted', async t => {
  const { outDir, ctx, run, deps } = stagedAttempt(t, [{}, {}])
  const errors = t.mock.method(console, 'error', () => {})
  const spawn = (command, args, options) => {
    if (args.includes('--resume')) writeFileSync(join(options.cwd, '.git', 'index.lock'), '')
    return deps.spawn(command, args, options)
  }
  await runOne(run, outDir, ctx, { ...deps, spawn })
  assert.equal(readRecord(outDir).end, 'ok')
  assert.equal(git(deps.dir, 'rev-parse', '--verify', 'stage-1^{commit}').length, 40)
  assert.throws(() => git(deps.dir, 'rev-parse', '--verify', '-q', 'stage-2'))
  assert.match(String(errors.mock.calls.at(-1).arguments[0]), /could not tag stage-2 in .*: /)
})

test('a stage copy that fails stops the run before stage 2: one line naming the run and the step, and attempts.json lists it', async t => {
  const { outDir, ctx, run, calls, deps } = stagedAttempt(t, [{}])
  // A file where the copy goes: cpSync cannot copy a folder over it.
  const spawn = (command, args, options) => {
    writeFileSync(`${options.cwd}-s1`, 'in the way')
    return deps.spawn(command, args, options)
  }
  const err = await runOne(run, outDir, ctx, { ...deps, spawn }).then(() => assert.fail('runOne resolved'), e => e)
  assert.match(err.message, /^h7-solo-mo-r1: could not copy .*easy-0123abcd after stage 1 \([A-Z_]+\)$/)
  assert.equal(exitCodeOf(err), 1, 'a harness error: stop and report')
  assert.equal(calls.length, 1, 'stage 2 is not paid for')
  assert.ok(!existsSync(join(outDir, 'run.json')))
  const { sessionId } = JSON.parse(readFileSync(join(outDir, 'session.json'), 'utf8'))
  const history = JSON.parse(readFileSync(join(outDir, 'attempts.json'), 'utf8'))
  assert.deepEqual(history.map(({ at, reason, ...entry }) => entry), [{ kind: 'stage-copy-failed', attempt: 1, sessionId }])
  assert.equal(`${run.id}: ${history[0].reason}`, err.message)
})

// The plugin under test's worktree, which the harness only points the run at: no file of it is read here.
const OTHER_PLUGIN = join(tmpdir(), 'section-team-next')

// A team attempt of h7 on a plugin whose manifest says 0.2.3, and whose inits load it at loaded. The mode record is
// written as the plugin's hook would.
function otherVersionAttempt(t, loaded) {
  const started = soloAttempt(t).init
  const init = { ...started, plugins: [...started.plugins, { name: 'section-team', path: OTHER_PLUGIN, source: PLUGIN_KEY, version: loaded }] }
  const base = stagedAttempt(t, [{ init }, { init }])
  const run = { id: 'h7-team-mo-r1', task: 'h7', cond: 'team-mo', base: 'team', rep: 1 }
  const pin = { ...base.ctx.pin, setups: { ...base.ctx.pin.setups, team: base.ctx.pin.setups.solo } }
  const spawn = (command, args, options) => {
    recordMode(base.home, args[args.indexOf(args.includes('--resume') ? '--resume' : '--session-id') + 1], 'balanced')
    return base.deps.spawn(command, args, options)
  }
  return {
    ...base, run, outDir: join(base.root, 'results', run.id),
    ctx: { ...base.ctx, pin, pluginDir: OTHER_PLUGIN, pluginVersion: '0.2.3' },
    deps: { ...base.deps, spawn },
  }
}

test('a two-stage run works on a plugin at another version: the worktree holds the plugin, this checkout the task', async t => {
  const { outDir, ctx, run, calls, deps } = otherVersionAttempt(t, '0.2.3')
  await runOne(run, outDir, ctx, deps)
  assert.equal(calls.length, 2)
  for (const call of calls) {
    assert.equal(call.options.env.CLAUDE_CODE_PLUGIN_DIRS, OTHER_PLUGIN)
    assert.equal(JSON.parse(call.args[call.args.indexOf('--settings') + 1]).env.CLAUDE_CODE_PLUGIN_DIRS, OTHER_PLUGIN)
  }
  assert.ok(calls[0].args[1].endsWith(readFileSync(join(import.meta.dirname, 'tasks', 'h7.md'), 'utf8')), 'the prompt comes from the harness')
  const record = readRecord(outDir)
  assert.deepEqual([record.end, record.sectionTeam], ['ok', { path: OTHER_PLUGIN, version: '0.2.3' }])
})

test('a two-stage run whose init disagrees with the plugin\'s manifest gets no second prompt and is void', async t => {
  const { outDir, ctx, run, calls, deps } = otherVersionAttempt(t, '0.2.2')
  await assert.rejects(runOne(run, outDir, ctx, deps), err => err instanceof BatchStop && /section-team version 0\.2\.2, expected 0\.2\.3/.test(err.reason))
  assert.equal(calls.length, 1)
  assert.ok(!existsSync(join(outDir, 'run.json')))
})

// A solo attempt of p1 (three stages) into a temp root, with prompts for each stage in a temp bench folder.
function p1Attempt(t, stages, upTo) {
  const base = soloAttempt(t)
  const calls = []
  const bench = join(base.root, 'bench')
  mkdirSync(join(bench, 'tasks'), { recursive: true })
  for (const name of ['p1', 'p1-s2', 'p1-s3']) writeFileSync(join(bench, 'tasks', `${name}.md`), `prompt ${name}\n`)
  const run = { id: 'p1-solo-mo-r1', task: 'p1', cond: 'solo-mo', base: 'solo', rep: 1 }
  const spawn = stagedClaude({ home: base.home, calls, init: base.init, stages })
  return { ...base, run, calls, outDir: join(base.root, 'results', run.id), ctx: { ...base.ctx, upTo }, deps: { ...base.deps, bench, spawn } }
}

test('a 3-stage run writes every stage\'s files, copies stages 1 and 2, tags all three and resumes in one session', async t => {
  const { outDir, ctx, run, calls, deps } = p1Attempt(t, [{ files: { 'a.mjs': 'one\n' } }, { files: { 'a.mjs': 'two\n' } }, { files: { 'a.mjs': 'three\n' } }])
  await runOne(run, outDir, ctx, deps)
  assert.equal(calls.length, 3)
  const { sessionId } = JSON.parse(readFileSync(join(outDir, 'session.json'), 'utf8'))
  assert.ok(calls[0].args.includes('--session-id'))
  for (const call of calls.slice(1)) assert.equal(call.args[call.args.indexOf('--resume') + 1], sessionId)
  assert.deepEqual(calls.map(c => c.args[1].split('\n').at(-2)), ['prompt p1', 'prompt p1-s2', 'prompt p1-s3'])
  for (const k of [1, 2, 3]) {
    assert.ok(existsSync(join(outDir, `raw-s${k}.json`)) && existsSync(join(outDir, `stderr-s${k}.txt`)), `stage ${k}`)
    assert.equal(git(deps.dir, 'show', `stage-${k}:a.mjs`), ['one', 'two', 'three'][k - 1])
  }
  assert.equal(readFileSync(join(`${deps.dir}-s1`, 'a.mjs'), 'utf8'), 'one\n')
  assert.equal(readFileSync(join(`${deps.dir}-s2`, 'a.mjs'), 'utf8'), 'two\n')
  assert.ok(!existsSync(`${deps.dir}-s3`))
  const record = readRecord(outDir)
  assert.deepEqual(record.stages.map(s => [s.stage, s.end]), [[1, 'ok'], [2, 'ok'], [3, 'ok']])
  assert.equal(record.wallMs, record.stages.reduce((sum, s) => sum + s.wallMs, 0))
  assert.equal(record.end, 'ok')
})

test('a stage 2 that times out starts no stage 3 and records two stages', async t => {
  const { outDir, ctx, run, calls, deps } = p1Attempt(t, [{}, { hang: true }])
  await runOne(run, outDir, ctx, { ...deps, timeoutMs: 100 })
  assert.equal(calls.length, 2)
  assert.ok(!existsSync(join(outDir, 'raw-s3.json')))
  const record = readRecord(outDir)
  assert.deepEqual(record.stages.map(s => [s.stage, s.end]), [[1, 'ok'], [2, 'timeout']])
  assert.equal(record.end, 'timeout')
  assert.ok(existsSync(`${deps.dir}-s1`) && !existsSync(`${deps.dir}-s2`), 'no copy of a stage that did not end ok')
})

test('upTo 1 on p1 runs stage 1 only', async t => {
  const { outDir, ctx, run, calls, deps } = p1Attempt(t, [{}], 1)
  await runOne(run, outDir, ctx, deps)
  assert.equal(calls.length, 1)
  assert.deepEqual(readRecord(outDir).stages.map(s => s.stage), [1])
})

test('parseArgs reads --stages and refuses one a task cannot run', () => {
  assert.equal(parseArgs(['--tasks=p1']).stages, null)
  assert.equal(parseArgs(['--tasks=p1', '--stages=1']).stages, 1)
  assert.equal(parseArgs(['--tasks=p1', '--stages=3']).stages, 3)
  for (const bad of ['--stages=4', '--stages=0', '--stages=', '--stages=x', '--stages=1.5']) {
    assert.throws(() => parseArgs(['--tasks=p1', bad]), RangeError, bad)
  }
  assert.throws(() => parseArgs(['--tasks=h4', '--stages=']), RangeError)
  assert.throws(() => parseArgs(['--tasks=h4', '--stages=2']), RangeError)
})
