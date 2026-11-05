import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { outputMessages } from './clean-run.mjs'
import { BatchStop, EvidenceMissing, exitCodeOf, projectDirFor, recordAttempt } from './run-attempts.mjs'
import { FAKE_PID, endStreams, fakeClaude, git, soloAttempt, tempRoot } from './run-fixtures.mjs'
import {
  CONDITIONS, DEFAULT_CONDS, TASKS, TIMEOUT_MIN, builderArgs, builderEnv, checkConds, checkPin, checkRoundTag, checkVolumes, killTree,
  freshRepo, isolateSectionMemory, modeFileFor, parseArgs, plan, prepareRun, publishAtStart, runAll, runFolder, runOne, spawnOptions, syncBranchOf, taskProblems, userListing,
  watchUserLists, withPublish,
} from './run.mjs'

// The two-stage tasks' tests are in run-stages.test.mjs; the plugin under test's are in run-plugin.test.mjs.

test('plan defaults are unchanged', () => {
  const runs = plan()
  assert.equal(runs.length, 18)
  assert.equal(runs[0].id, 'easy-team-r1')
  assert.equal(runs.at(-1).id, 'hard-team-r2')
})

test('plan with tasks, reps and tag', () => {
  const runs = plan({ tag: 'ho', conds: ['team', 'solo'], tasks: ['h1', 'h2', 'h3'], reps: 3 })
  assert.equal(runs.length, 18)
  const ids = runs.map(r => r.id)
  assert.ok(ids.includes('h1-team-ho-r1'))
  assert.ok(ids.includes('h3-solo-ho-r3'))
  assert.ok(runs.every(r => r.base === 'team' || r.base === 'solo'))
  assert.equal(new Set(ids).size, 18)
})

test('plan alternates the condition order by rep, so no condition always goes first', () => {
  const ids = plan({ tasks: ['h1'], reps: 3 }).map(r => r.id)
  assert.deepEqual(ids, [
    'h1-team-r1', 'h1-solo-r1', 'h1-forced-r1',
    'h1-forced-r2', 'h1-solo-r2', 'h1-team-r2',
    'h1-team-r3', 'h1-solo-r3', 'h1-forced-r3',
  ])
})

test('plan runs the lean and max setups in the order --conds gives them, tagged like the others', () => {
  const order = plan({ conds: ['solo', 'lean', 'team', 'max'], tasks: ['h1'], reps: 1 }).map(r => r.cond)
  assert.deepEqual(order, ['solo', 'lean', 'team', 'max'])
  const runs = plan({ tag: 'mo', conds: ['lean', 'max'], tasks: ['h1'], reps: 2 })
  assert.deepEqual(runs.map(r => r.id), ['h1-lean-mo-r1', 'h1-max-mo-r1', 'h1-max-mo-r2', 'h1-lean-mo-r2'])
  assert.deepEqual(runs.map(r => r.base), ['lean', 'max', 'max', 'lean'])
  const repeated = plan({ conds: ['team', 'team'], tasks: ['h1'], reps: 1 }).map(r => r.id)
  assert.deepEqual(repeated, ['h1-team-r1'], 'a repeated setup adds no run')
  assert.throws(() => plan({ conds: ['lean', 'mxa'], tasks: ['h1'] }), /^RangeError: --conds takes team, solo, forced, lean, max, got "mxa"$/, 'a typo is refused, not silently skipped')
})

test('the setups are team, solo, forced, lean and max; a round without --conds still plans team, solo and forced', () => {
  assert.deepEqual(CONDITIONS, ['team', 'solo', 'forced', 'lean', 'max'])
  assert.deepEqual(DEFAULT_CONDS, ['team', 'solo', 'forced'])
  assert.deepEqual(parseArgs([]).conds, ['team', 'solo', 'forced'])
  assert.deepEqual(parseArgs(['--conds=solo,lean,team,max']).conds, ['solo', 'lean', 'team', 'max'])
})

test('modeFileFor gives lean and max their mode file, and team, solo and forced none', () => {
  assert.strictEqual(modeFileFor('lean'), '{"mode":"lean"}\n')
  assert.strictEqual(modeFileFor('max'), '{"mode":"max"}\n')
  for (const base of ['team', 'solo', 'forced']) assert.strictEqual(modeFileFor(base), null, base)
})

// A run's options: its session id, the installed plugin keys read when the batch starts, and the v0.2.1 worktree.
const OPTIONS = { sessionId: '0b7c-sid', installedKeys: ['a@market', 'b@market'], pluginDir: 'C:/Users/Asus/section-team-v0.2.1' }

test('lean, max and forced builder runs get exactly the team run\'s arguments', () => {
  for (const base of ['lean', 'max', 'forced']) assert.deepEqual(builderArgs(base, 'the prompt', OPTIONS), builderArgs('team', 'the prompt', OPTIONS), base)
})

test('prepareRun writes the mode file for lean and max into the fresh run folder, uncommitted, and none for team', t => {
  const root = tempRoot(t)
  const seeds = join(root, 'seeds')
  mkdirSync(join(seeds, 'h1'), { recursive: true })
  writeFileSync(join(seeds, 'h1', 'a.txt'), 'seeded\n')

  for (const [base, text] of [['lean', '{"mode":"lean"}\n'], ['max', '{"mode":"max"}\n']]) {
    const dir = join(root, base)
    const run = { id: `h1-${base}-mo-r1`, task: 'h1', cond: `${base}-mo`, base }
    assert.strictEqual(prepareRun(run, { dir, root, seeds }), dir)
    assert.strictEqual(readFileSync(join(dir, '.team', 'mode.json'), 'utf8'), text)
    assert.ok(existsSync(join(dir, 'a.txt')), `${base}: the seed is copied`)
    assert.equal(git(dir, 'log', '--format=%s'), 'seed\ninit')
    assert.equal(git(dir, 'status', '--porcelain'), '?? .team/', `${base}: the mode file is left uncommitted, as when a user picks a mode`)
  }

  const teamDir = join(root, 'team')
  prepareRun({ id: 'h1-team-mo-r1', task: 'h1', cond: 'team-mo', base: 'team' }, { dir: teamDir, root, seeds })
  assert.ok(!existsSync(join(teamDir, '.team')), 'a team run gets no mode file')
  assert.equal(git(teamDir, 'status', '--porcelain'), '')

  const again = join(root, 'again')
  prepareRun({ id: 'h1-lean-mo-r1', task: 'h1', cond: 'lean-mo', base: 'lean' }, { dir: again, root, seeds })
  prepareRun({ id: 'h1-team-mo-r1', task: 'h1', cond: 'team-mo', base: 'team' }, { dir: again, root, seeds })
  assert.ok(!existsSync(join(again, '.team')), 'a rerun of the folder as a team run removes the old mode file')

  const nobase = join(root, 'nobase')
  prepareRun({ id: 'h1-max-r1', task: 'zz', cond: 'max' }, { dir: nobase, root, seeds })
  assert.strictEqual(readFileSync(join(nobase, '.team', 'mode.json'), 'utf8'), '{"mode":"max"}\n', 'a run without base falls back to cond')
  assert.equal(git(nobase, 'log', '--format=%s'), 'init', 'task zz has no seed')
})

test('parseArgs reads tasks and reps', () => {
  const args = parseArgs(['--tasks=h1,h2', '--reps=3'])
  assert.deepEqual(args.tasks, ['h1', 'h2'])
  assert.equal(args.reps, 3)
  const defaults = parseArgs([])
  assert.deepEqual(defaults.tasks, TASKS)
  assert.equal(defaults.reps, 2)
})

test('parseArgs rejects bad reps', () => {
  for (const bad of ['--reps=0', '--reps=x', '--reps=1.5', '--reps=', '--reps=-1', '--reps=1e1']) {
    assert.throws(() => parseArgs([bad]), RangeError, bad)
  }
})

test('TASKS and the held-out timeouts', () => {
  assert.deepEqual(TASKS, ['easy', 'medium', 'hard'])
  assert.deepEqual({ h1: TIMEOUT_MIN.h1, h2: TIMEOUT_MIN.h2, h3: TIMEOUT_MIN.h3 }, { h1: 100, h2: 60, h3: 45 })
})

test('TIMEOUT_MIN has h4 120, h5 60, h6 60', () => {
  assert.deepEqual({ h4: TIMEOUT_MIN.h4, h5: TIMEOUT_MIN.h5, h6: TIMEOUT_MIN.h6 }, { h4: 120, h5: 60, h6: 60 })
})

test('checkRoundTag refuses --round=mo with --tag=ho and accepts either alone', () => {
  assert.throws(() => checkRoundTag({ round: 'mo', tag: 'ho' }), { name: 'RangeError', message: '--round=mo and --tag=ho must match' })
  for (const ok of [{ round: 'mo', tag: '' }, { round: '', tag: 'mo' }, { round: 'mo', tag: 'mo' }, { round: '', tag: '' }]) {
    assert.doesNotThrow(() => checkRoundTag(ok), JSON.stringify(ok))
  }
})

test('parseArgs reads --plugin, --rerun and --reason', () => {
  const args = parseArgs(['--plugin=C:/Users/Asus/section-team-v0.2.1', '--rerun=h4-lean-mo-r1,h5-max-mo-r2', '--reason=fix a1b2c3d: wrong timeout'])
  assert.deepEqual([args.plugin, args.rerun, args.reason], ['C:/Users/Asus/section-team-v0.2.1', ['h4-lean-mo-r1', 'h5-max-mo-r2'], 'fix a1b2c3d: wrong timeout'])
  const none = parseArgs([])
  assert.deepEqual([none.plugin, none.rerun, none.reason], ['', [], ''])
  // Rerun ids name results folders that get moved: run-id characters only, and no empty id from a stray comma.
  for (const bad of ['--rerun=', '--rerun=h4-lean-mo-r1,', '--rerun=../x', '--rerun=h4 lean']) {
    assert.throws(() => parseArgs([bad]), RangeError, bad)
  }
})

test('freshRepo with a seed', t => {
  const root = tempRoot(t)
  const seed = join(root, 'seed')
  mkdirSync(seed)
  writeFileSync(join(seed, 'a.txt'), 'seeded\n')
  const dir = join(root, 'r')
  freshRepo(dir, { seed, root })
  assert.ok(existsSync(join(dir, 'a.txt')))
  assert.equal(git(dir, 'log', '--format=%s'), 'seed\ninit')
  assert.equal(git(dir, 'status', '--porcelain'), '')
})

test('freshRepo without a seed', t => {
  const root = tempRoot(t)
  const dir = join(root, 'r')
  freshRepo(dir, { root })
  assert.equal(git(dir, 'log', '--format=%s'), 'init')
  assert.equal(git(dir, 'status', '--porcelain'), '')
})

test('freshRepo refuses a folder outside root', t => {
  const base = tempRoot(t)
  const keep = name => {
    const dir = join(base, name)
    mkdirSync(dir)
    writeFileSync(join(dir, 'keep.txt'), 'keep\n')
    return dir
  }
  const root = keep('runs')
  // A sibling whose name starts with root's name, a path that climbs out with '..', and root itself.
  for (const dir of [keep('runs-x'), `${root}/../up`, root]) {
    assert.throws(() => freshRepo(dir, { root }), /refusing/, dir)
  }
  assert.ok(existsSync(join(base, 'runs-x', 'keep.txt')))
  assert.ok(existsSync(join(root, 'keep.txt')))
  assert.ok(!existsSync(join(base, 'up')))
})

test('taskProblems lists every task missing its prompt, hidden tests or timeout', t => {
  const bench = tempRoot(t)
  mkdirSync(join(bench, 'tasks'))
  mkdirSync(join(bench, 'hidden'))
  const put = file => writeFileSync(join(bench, file), '')
  for (const task of ['h1', 'zz']) { put(`tasks/${task}.md`); put(`hidden/${task}.test.mjs`) }
  put('tasks/h2.md')
  const problems = taskProblems(['h1', 'h2', 'h3', 'zz'], bench)
  assert.equal(problems.length, 3)
  assert.match(problems[0], /^h2\b.*bench\/hidden\/h2\.test\.mjs/)
  assert.doesNotMatch(problems[0], /h2\.md/)
  assert.match(problems[1], /^h3\b.*bench\/tasks\/h3\.md.*bench\/hidden\/h3\.test\.mjs/)
  assert.match(problems[2], /^zz\b.*timeout/)
})

test('taskProblems finds nothing wrong with the shipped tasks', () => {
  assert.deepEqual(taskProblems(TASKS), [])
})

test('taskProblems finds nothing wrong with the mode-round tasks', () => {
  assert.deepEqual(taskProblems(['h4', 'h5', 'h6']), [])
})

test('parseArgs rejects a round, tag or task name that is not only letters and digits', () => {
  for (const bad of ['--round=x/..', '--round=..', '--round=a b', '--tag=x\\..', '--tag=a-b', '--tasks=h1,../x', '--tasks=h1,']) {
    assert.throws(() => parseArgs([bad]), RangeError, bad)
  }
  const ok = parseArgs(['--round=ho', '--tag=ho', '--tasks=h1,h2'])
  assert.deepEqual([ok.round, ok.tag, ok.tasks], ['ho', 'ho', ['h1', 'h2']])
})

test('taskProblems does not take an inherited key such as constructor as a timeout', t => {
  const bench = tempRoot(t)
  mkdirSync(join(bench, 'tasks'))
  mkdirSync(join(bench, 'hidden'))
  writeFileSync(join(bench, 'tasks', 'constructor.md'), '')
  writeFileSync(join(bench, 'hidden', 'constructor.test.mjs'), '')
  assert.deepEqual(taskProblems(['constructor'], bench), ['constructor: missing a timeout in TIMEOUT_MIN'])
})

test('builderArgs uses stream-json, model, effort medium, verbose, strict MCP, the session id and clean settings; solo turns section-team off and still sets the worktree', () => {
  const settingsFor = sectionTeam => ({
    syncClaudeAiPlugins: false,
    syncClaudeAiSkills: false,
    enabledPlugins: { 'a@market': false, 'b@market': false, 'cc-plugin-plugin-authoring@builtin': false, 'section-team@inline': sectionTeam },
    env: {
      SECTION_TEAM_AUTO_INSTALL_SKILLS: '0', DISABLE_AUTOUPDATER: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false', CLAUDE_CODE_PLUGIN_DIRS: 'C:/Users/Asus/section-team-v0.2.1',
      CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0',
    },
  })
  for (const [base, sectionTeam] of [['team', true], ['solo', false]]) {
    const args = builderArgs(base, 'the prompt', OPTIONS)
    assert.deepEqual(args.slice(0, 5), ['-p', 'the prompt', '--output-format', 'stream-json', '--allowedTools'], base)
    assert.match(args[5], /^Task,Agent,SendMessage,Read,Write,Edit,.*,Bash\(node \*\),/, base)
    assert.deepEqual(args.slice(6, -2), ['--model', 'claude-opus-5-5', '--effort', 'medium', '--verbose', '--strict-mcp-config', '--session-id', '0b7c-sid'], base)
    assert.equal(args.at(-2), '--settings', base)
    assert.deepEqual(JSON.parse(args.at(-1)), settingsFor(sectionTeam), base)
  }
  assert.throws(() => builderArgs('team', 'the prompt', { ...OPTIONS, sessionId: undefined }), /sessionId/)
  assert.throws(() => builderArgs('solo', 'the prompt', { ...OPTIONS, pluginDir: undefined }), /pluginDir/)
})

test('run folders are named by task and a hash, so the setup never shows in a path or a package name', () => {
  const team = runFolder({ id: 'h1-team-ho-r1', task: 'h1' })
  const solo = runFolder({ id: 'h1-solo-ho-r1', task: 'h1' })
  for (const dir of [team, solo]) assert.match(dir, /\/bench-runs\/h1-[0-9a-f]{8}$/)
  assert.notEqual(team, solo)
  assert.equal(runFolder({ id: 'h1-team-ho-r1', task: 'h1' }), team, 'stable, so a rerun reuses the folder')
})

test('runAll moves section memory aside only when a team run is left, and always moves it back, even when a run throws', async () => {
  const calls = []
  const isolate = () => { calls.push('aside'); return () => calls.push('back') }
  const ok = async run => { calls.push(run.id) }
  const team = { id: 'h1-team-ho-r1', base: 'team' }
  const solo = { id: 'h1-solo-ho-r1', base: 'solo' }

  await runAll([solo], { runOne: ok, isolate, results: 'results' })
  assert.deepEqual(calls, ['h1-solo-ho-r1'], 'a solo-only round leaves the memory alone')

  calls.length = 0
  await runAll([team, solo], { runOne: ok, isolate, results: 'results' })
  assert.deepEqual(calls, ['aside', 'h1-team-ho-r1', 'h1-solo-ho-r1', 'back'])

  calls.length = 0
  const failing = async run => { calls.push(run.id); throw new Error('claude crashed') }
  await assert.rejects(runAll([team, solo], { runOne: failing, isolate, results: 'results' }), /claude crashed/)
  assert.deepEqual(calls, ['aside', 'h1-team-ho-r1', 'back'])

  calls.length = 0
  await runAll([{ id: 'h1-lean-mo-r1', base: 'lean' }, { id: 'h1-max-mo-r1', base: 'max' }], { runOne: ok, isolate, results: 'results' })
  assert.deepEqual(calls, ['aside', 'h1-lean-mo-r1', 'h1-max-mo-r1', 'back'], 'lean and max runs are team runs too')
})

test('runAll gives each run a folder under the results it was given', async () => {
  const folders = []
  await runAll([{ id: 'h1-solo-ho-r1', base: 'solo' }], { runOne: async (run, outDir) => folders.push(outDir), isolate: () => () => {}, results: 'given' })
  assert.deepEqual(folders, [join('given', 'h1-solo-ho-r1')])
})

test('runAll refuses to start without a runOne, before section memory moves', async () => {
  let moved = false
  const isolate = () => { moved = true; return () => {} }
  await assert.rejects(runAll([{ id: 'h4-team-mo-r1', base: 'team' }], { isolate }), { name: 'TypeError', message: 'runAll needs a runOne bound to the batch context' })
  assert.equal(moved, false)
  await assert.rejects(runAll([]), { name: 'TypeError', message: 'runAll needs a runOne bound to the batch context' }, 'also with no options at all')
})

test('isolateSectionMemory refuses a different-drive setup before anything moves', () => {
  let moved = false
  const volumes = () => { throw new Error('C:/x and D:/y are on different drives') }
  assert.throws(() => isolateSectionMemory({ volumes, backup: () => { moved = true; return [] }, restore: () => {} }), /different drives/)
  assert.equal(moved, false)
})

test('isolateSectionMemory puts the memory back once, and a failed restore is one line with the --restore-memory hint', t => {
  const lines = []
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', line => lines.push(line))
  const exitCode = process.exitCode
  t.after(() => { process.exitCode = exitCode })
  const listeners = ['SIGINT', 'exit'].map(event => process.listenerCount(event))
  let restores = 0
  const release = isolateSectionMemory({ volumes: () => {}, backup: () => ['section-team-testing'], restore: () => { restores++; throw new Error('EBUSY') }, stop: () => {} })
  release()
  release()
  assert.equal(restores, 1, 'release is idempotent')
  assert.deepEqual(lines, ['could not restore your section memory: EBUSY; run node bench/run.mjs --restore-memory'])
  assert.equal(process.exitCode, 1)
  assert.deepEqual(['SIGINT', 'exit'].map(event => process.listenerCount(event)), listeners, 'its signal and exit handlers are removed')
})

test('checkVolumes accepts a memory folder that does not exist yet, by its nearest existing parent', t => {
  const root = tempRoot(t)
  assert.doesNotThrow(() => checkVolumes({ root: join(root, 'no', 'such', 'agent-memory'), others: [root] }))
})

// A --settings env value does not reach the plugin's hooks when the shell already sets the variable, so builder
// runs also get the round's switches in their process environment (checked by a preflight on 2026-10-30).
test('builderEnv drops session, key and switch variables, sets the round switches and the worktree, and keeps everything else', () => {
  const parent = { PATH: '/bin', CLAUDECODE: '1', ANTHROPIC_API_KEY: 'k', SECTION_TEAM_AUTO_INSTALL_SKILLS: '1', CLAUDE_CODE_PLUGIN_DIRS: 'C:/Users/Asus/claude-team' }
  const copy = { ...parent }
  assert.deepEqual(builderEnv(parent, { pluginDir: 'C:/w' }),
    { PATH: '/bin', SECTION_TEAM_AUTO_INSTALL_SKILLS: '0', ENABLE_CLAUDEAI_MCP_SERVERS: 'false', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_PLUGIN_DIRS: 'C:/w', CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0' })
  assert.deepEqual(parent, copy, 'the parent environment is not changed')
  assert.throws(() => builderEnv(parent, {}), /pluginDir/, 'no silent fallback to the live checkout')
})

// Every killTree test passes its platform and a fake kill or execFile: a real signal to pid 42's group could stop a
// process of this machine.
const NO_KILL = () => assert.fail('the Windows path never signals a process group')
const NO_TASKKILL = () => assert.fail('the Linux path never runs taskkill')

test('killTree is quiet when the process is already gone, and says so when it could not stop it', () => {
  const lines = []
  const gone = () => { throw Object.assign(new Error('not found'), { status: 128 }) }
  killTree({ pid: 42 }, { execFile: gone, kill: NO_KILL, platform: 'win32', log: line => lines.push(line) })
  assert.deepEqual(lines, [])
  const denied = () => { throw Object.assign(new Error('Access is denied'), { status: 1 }) }
  killTree({ pid: 42 }, { execFile: denied, kill: NO_KILL, platform: 'win32', log: line => lines.push(line) })
  assert.deepEqual(lines, ['could not stop claude (pid 42): Access is denied'])
})

// Linux has no taskkill. claude stays in the harness's process group (so a signal to the harness's group reaches it),
// and its Bash tool and hooks start shells in groups of their own, so a group kill alone misses them. killTree walks
// claude's descendants in /proc, stops each one (so none can start more or be orphaned), then kills every process
// and every group it found except the harness's own.
const TABLE = [
  { pid: 100, ppid: 1, pgrp: 100 }, // the harness
  { pid: 42, ppid: 100, pgrp: 100 }, // claude, in the harness's group
  { pid: 43, ppid: 42, pgrp: 43 }, // a Bash tool shell, in a group of its own
  { pid: 44, ppid: 43, pgrp: 43 }, // a server it started
  { pid: 45, ppid: 42, pgrp: 100 }, // a process left in claude's group
  { pid: 46, ppid: 1, pgrp: 46 }, // unrelated
]

test('killTree on Linux stops claude\'s whole tree, then kills every process and group in it but the harness\'s own', () => {
  const signals = []
  const lines = []
  killTree({ pid: 42 }, { execFile: NO_TASKKILL, kill: (target, signal) => signals.push([target, signal]), platform: 'linux', table: () => TABLE, self: 100, log: line => lines.push(line) })
  assert.deepEqual(signals, [
    [42, 'SIGSTOP'], [43, 'SIGSTOP'], [45, 'SIGSTOP'], [44, 'SIGSTOP'],
    [-43, 'SIGKILL'],
    [42, 'SIGKILL'], [43, 'SIGKILL'], [45, 'SIGKILL'], [44, 'SIGKILL'],
  ])
  assert.deepEqual(lines, [])
})

test('killTree on Linux finds processes started while it stops the tree, is quiet when claude is gone, and says when it could not', () => {
  let calls = 0
  // A process that appears in the second look (a child forked before its parent was stopped).
  const growing = () => (++calls === 1 ? TABLE.slice(0, 3) : [...TABLE.slice(0, 3), { pid: 47, ppid: 43, pgrp: 47 }])
  const signals = []
  killTree({ pid: 42 }, { execFile: NO_TASKKILL, kill: (target, signal) => signals.push([target, signal]), platform: 'linux', table: growing, self: 100, log: assert.fail })
  assert.deepEqual(signals.filter(([, signal]) => signal === 'SIGSTOP').map(([pid]) => pid), [42, 43, 47])
  assert.deepEqual(signals.filter(([, signal]) => signal === 'SIGKILL').map(([target]) => target), [-43, -47, 42, 43, 47])
  const lines = []
  killTree({ pid: 42 }, { execFile: NO_TASKKILL, kill: NO_KILL, platform: 'linux', table: () => TABLE.filter(p => p.pid !== 42), self: 100, log: line => lines.push(line) })
  assert.deepEqual(lines, [], 'claude already gone: nothing to stop')
  const denied = () => { throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' }) }
  killTree({ pid: 42 }, { execFile: NO_TASKKILL, kill: denied, platform: 'linux', table: () => TABLE, self: 100, log: line => lines.push(line) })
  assert.deepEqual(lines, ['could not stop claude (pid 42): kill EPERM'], 'one line, however many signals failed')
})

// A process is gone once /proc has no entry for it, or only a zombie that its new parent has not reaped yet.
const procGone = pid => {
  try {
    return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.startsWith('Z') ?? true
  } catch {
    return true
  }
}

// The real thing, not a fake: a run's time limit only binds if the kill reaches what claude started, also the shells
// its Bash tool starts in process groups of their own.
test('killTree on Linux stops a child, a process it started in its group and one it started in a group of its own', { skip: process.platform !== 'linux' && 'Linux process groups', timeout: 15_000 }, async () => {
  const script = [
    "const { spawn } = require('node:child_process')",
    "const keep = ['-e', 'setInterval(() => {}, 1000)']",
    "const same = spawn(process.execPath, keep, { stdio: 'ignore' })",
    "const own = spawn(process.execPath, keep, { stdio: 'ignore', detached: true })",
    "console.log(same.pid + ' ' + own.pid)",
    'setInterval(() => {}, 1000)',
  ].join('; ')
  const child = spawn(process.execPath, ['-e', script], spawnOptions(tmpdir(), process.env))
  const [line] = await once(child.stdout, 'data')
  const descendants = String(line).trim().split(' ').map(Number)
  assert.deepEqual(descendants.map(procGone), [false, false], 'both run before the kill')
  const closed = once(child, 'close')
  killTree(child)
  const [code, signal] = await closed
  assert.deepEqual([code, signal], [null, 'SIGKILL'])
  for (let i = 0; i < 50 && !descendants.every(procGone); i++) await new Promise(resolve => setTimeout(resolve, 20))
  assert.deepEqual(descendants.map(procGone), [true, true], 'both are stopped with claude')
})

// Builders start as they did before the cloud port: in the harness's process group, so Ctrl+C, a closed terminal or a
// stopped background job reaches claude too, even when the harness itself is killed outright.
test('spawnOptions starts claude in the harness\'s process group on every platform', () => {
  const env = { PATH: '/bin' }
  assert.deepEqual(spawnOptions('/root/run', env), { cwd: '/root/run', env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  assert.deepEqual(spawnOptions('C:/run', env), { cwd: 'C:/run', env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
})

test('isolateSectionMemory stops the running claude before it puts the memory back', t => {
  t.mock.method(console, 'log', () => {})
  const calls = []
  const release = isolateSectionMemory({ volumes: () => {}, backup: () => [], restore: () => calls.push('restore'), stop: () => calls.push('stop') })
  release()
  assert.deepEqual(calls, ['stop', 'restore'])
})

test('checkVolumes accepts results and home folders that do not exist yet', t => {
  const root = tempRoot(t)
  assert.doesNotThrow(() => checkVolumes({ root: join(root, 'agent-memory'), others: [join(root, 'no', 'results')] }))
})

test('parseArgs reads --sync, --no-sync and --redact-email', () => {
  const args = parseArgs(['--sync=bench/mode-round-cloud-results', '--redact-email'])
  assert.deepEqual([args.sync, args.noSync, args.redactEmail], ['bench/mode-round-cloud-results', false, true])
  const none = parseArgs(['--no-sync'])
  assert.deepEqual([none.sync, none.noSync, none.redactEmail], ['', true, false])
})

// Off Windows (the cloud machine) the machine can vanish: a round pushes every finished run unless told not to.
test('syncBranchOf: required off Windows, --no-sync opts out, Windows needs nothing, and a bad name is refused', () => {
  const branch = 'bench/mode-round-cloud-results'
  assert.equal(syncBranchOf({ sync: branch, noSync: false }, 'linux'), branch)
  assert.equal(syncBranchOf({ sync: branch, noSync: false }, 'win32'), branch)
  assert.equal(syncBranchOf({ sync: '', noSync: false }, 'win32'), null)
  assert.equal(syncBranchOf({ sync: '', noSync: true }, 'linux'), null)
  assert.throws(() => syncBranchOf({ sync: '', noSync: false }, 'linux'),
    { message: 'off Windows a round pushes every finished run: pass --sync=bench/mode-round-cloud-results (or --no-sync to keep results on this machine only)' })
  assert.throws(() => syncBranchOf({ sync: branch, noSync: true }, 'linux'), { message: '--sync= and --no-sync contradict each other: pass one' })
  assert.throws(() => syncBranchOf({ sync: '-x', noSync: false }, 'linux'), RangeError)
})

test('withPublish publishes after every run that left results, finished or stopped, and an email hit outranks the run\'s stop', async t => {
  const root = tempRoot(t)
  const outDir = join(root, 'h4-solo-mo-r1')
  const calls = []
  const done = async () => { mkdirSync(outDir, { recursive: true }); calls.push('run') }
  const stopped = async () => { mkdirSync(outDir, { recursive: true }); throw new BatchStop('h4-solo-mo-r1: usage limit') }
  const publish = (run, dir) => calls.push(`publish ${run.id} ${dir === outDir}`)
  const run = { id: 'h4-solo-mo-r1' }
  await withPublish(done, publish)(run, outDir)
  await assert.rejects(withPublish(stopped, publish)(run, outDir), { name: 'BatchStop' })
  assert.deepEqual(calls, ['run', 'publish h4-solo-mo-r1 true', 'publish h4-solo-mo-r1 true'])
  calls.length = 0
  await assert.rejects(withPublish(async () => { throw new Error('no folder') }, publish)(run, join(root, 'none')), { message: 'no folder' })
  assert.deepEqual(calls, [], 'nothing to publish without results')
  const emailFound = () => { throw Object.assign(new Error('the account email is in x'), { name: 'EmailFound' }) }
  await assert.rejects(withPublish(stopped, emailFound)(run, outDir), { name: 'EmailFound' })
  const lines = []
  const pushFailed = () => { throw Object.assign(new Error('could not push'), { name: 'PushFailed' }) }
  await assert.rejects(withPublish(stopped, pushFailed, { log: line => lines.push(line) })(run, outDir), { name: 'BatchStop' })
  assert.deepEqual(lines, ['h4-solo-mo-r1: could not push'])
  await assert.rejects(withPublish(done, pushFailed)(run, outDir), { name: 'BatchStop', message: 'batch stopped: h4-solo-mo-r1: could not push; resume once the network is back (the resume pushes first)' })
  assert.equal(withPublish(done, null), done, 'no sync, no wrapper')
})

// A batch start checks the sync before any paid run, then sends again every run of the batch that has results and the
// round's pin: a publish that failed earlier (network, machine stop) or a --rerun entry is pushed before work goes on.
test('publishAtStart checks the sync first, then publishes every run with results and the pin; a network failure stops the batch', t => {
  const root = tempRoot(t)
  const runs = plan({ tag: 'mo', conds: ['solo', 'lean'], tasks: ['h4'], reps: 1 })
  mkdirSync(join(root, runs[1].id), { recursive: true })
  writeFileSync(join(root, 'preflight-mo.json'), '{}')
  const calls = []
  const sync = {
    syncReady: options => calls.push(['ready', options]),
    publishRun: ({ id, outDir, runDir }, options) => { calls.push(['run', id, outDir, runDir, options]); return { pushed: true } },
    publishItems: ({ items, message }, options) => { calls.push(['items', items, message, options]); return { pushed: false } },
  }
  const options = { branch: 'bench/mode-round-cloud-results', redactEmail: true }
  const folder = run => join(root, 'runs', run.id)
  publishAtStart({ runs, results: root, folder, tag: 'mo', options, log: () => {} }, sync)
  assert.deepEqual(calls, [
    ['ready', options],
    ['run', runs[1].id, join(root, runs[1].id), folder(runs[1]), options],
    ['items', [{ from: join(root, 'preflight-mo.json'), to: 'results/preflight-mo.json' }], 'chore(results): pin round mo', options],
  ])
  const failing = { ...sync, publishRun: () => { throw Object.assign(new Error('could not reach origin'), { name: 'PushFailed' }) } }
  assert.throws(() => publishAtStart({ runs, results: root, folder, tag: 'mo', options, log: () => {} }, failing),
    { name: 'BatchStop', message: 'batch stopped: could not reach origin; resume once the network is back' })
  const noEmail = { ...sync, syncReady: () => { throw new Error('$CLAUDE_CODE_USER_EMAIL is not set') } }
  assert.throws(() => publishAtStart({ runs, results: root, folder, tag: 'mo', options, log: () => {} }, noEmail), { message: '$CLAUDE_CODE_USER_EMAIL is not set' })
})

test('checkConds refuses any setup but solo, lean, team and max, so a round never runs one initProblems cannot judge', () => {
  assert.doesNotThrow(() => checkConds(['solo', 'lean', 'team', 'max']))
  assert.doesNotThrow(() => checkConds(['team']))
  const message = 'a round runs solo, lean, team and max only, got "forced": pass --conds=solo,lean,team,max'
  assert.throws(() => checkConds(DEFAULT_CONDS), { name: 'RangeError', message }, 'the default setups include forced')
  assert.throws(() => checkConds(['solo', 'forced']), { name: 'RangeError', message })
})

test('stopping the round mid-run stops the child with the kill its run was given, never the real killTree', async t => {
  const { home, outDir, ctx, init, run, deps } = soloAttempt(t)
  const killed = []
  const kill = child => { killed.push(child.pid); endStreams(child) }
  const running = runOne(run, outDir, ctx, { ...deps, spawn: fakeClaude({ home, calls: [], init, hang: true }), kill, timeoutMs: 60_000 })
  await new Promise(resolve => setTimeout(resolve, 50))
  isolateSectionMemory({ volumes: () => {}, backup: () => [], restore: () => {} })()
  await running
  assert.deepEqual(killed, [FAKE_PID], 'the default stop used the run\'s own kill')
  const record = JSON.parse(readFileSync(join(outDir, 'run.json'), 'utf8'))
  assert.deepEqual([record.timedOut, record.exitCode, record.end], [false, null, 'crash'])
})

test('runOne stops the batch on an API failure that left no session file, instead of stopping for missing evidence', async t => {
  const { home, outDir, ctx, init, run, deps: base } = soloAttempt(t)
  const result = { type: 'result', subtype: 'success', is_error: true, result: 'API Error: 529 overloaded' }
  const deps = { ...base, spawn: fakeClaude({ home, calls: [], init, result, transcript: false }) }
  await assert.rejects(runOne(run, outDir, ctx, deps), err => err instanceof BatchStop && /API failure/.test(err.reason))
  assert.deepEqual(JSON.parse(readFileSync(join(outDir, 'attempts.json'), 'utf8')).map(e => e.kind), ['api-other'])
  assert.ok(!existsSync(join(outDir, 'run.json')))
})

// A missing session file after a run that did not hit the API is a harness or evidence error: exit 1, stop and report.
test('runOne stops with exit 1 when required evidence is missing, naming the init problems and listing the attempt uncapped', async t => {
  const { home, outDir, ctx, init, run, deps: base } = soloAttempt(t)
  const deps = { ...base, spawn: fakeClaude({ home, calls: [], init: { ...init, model: 'claude-sonnet-5' }, transcript: false }) }
  const err = await runOne(run, outDir, ctx, deps).then(() => assert.fail('runOne resolved'), e => e)
  const { sessionId } = JSON.parse(readFileSync(join(outDir, 'session.json'), 'utf8'))
  const path = join(projectDirFor(deps.dir, home), `${sessionId}.jsonl`)
  assert.ok(err instanceof EvidenceMissing && !(err instanceof BatchStop), 'not a batch or round stop')
  assert.equal(exitCodeOf(err), 1)
  assert.equal(err.message, `evidence missing for ${sessionId}: ${path}; init problems: model claude-sonnet-5, expected claude-opus-5-5`)
  const history = JSON.parse(readFileSync(join(outDir, 'attempts.json'), 'utf8'))
  assert.deepEqual(history.map(({ at, ...entry }) => entry), [{ kind: 'evidence-missing', attempt: 1, sessionId, path, reasons: ['model claude-sonnet-5, expected claude-opus-5-5'] }])
  assert.ok(!Number.isNaN(Date.parse(history[0].at)))
  assert.ok(!existsSync(join(outDir, 'run.json')) && !existsSync(join(outDir, 'void.json')))
  assert.equal(recordAttempt(outDir, { kind: 'void' }).capped, 1, 'the entry does not count toward the cap')
})

test('runOne kills a run at its time limit; raw.json keeps the init streamed before the kill and run.json ends timeout, not void', async t => {
  const { home, outDir, ctx, init, run, deps: base } = soloAttempt(t)
  const killed = []
  const kill = child => { killed.push(child.pid); endStreams(child) }
  const deps = { ...base, spawn: fakeClaude({ home, calls: [], init, hang: true }), kill, timeoutMs: 50 }
  await runOne(run, outDir, ctx, deps)
  assert.deepEqual(killed, [FAKE_PID], 'the injected kill stops the child once')
  const raw = outputMessages(readFileSync(join(outDir, 'raw.json'), 'utf8'))
  assert.deepEqual(raw.map(m => [m.type, m.subtype]), [['system', 'init']], 'the init line written before the kill is kept')
  const record = JSON.parse(readFileSync(join(outDir, 'run.json'), 'utf8'))
  assert.deepEqual([record.timedOut, record.exitCode, record.end, record.subtype, record.resultText], [true, null, 'timeout', null, null])
  assert.ok(!existsSync(join(outDir, 'void.json')), 'a timeout with a good init is a counted run')
})

test('runOne rejects with one friendly line when the pinned binary cannot start', async t => {
  const { outDir, ctx, run, deps } = soloAttempt(t)
  const calls = []
  // An injected spawn that fails as a missing binary does: no real process is ever started.
  const missing = command => {
    calls.push(command)
    const child = Object.assign(new EventEmitter(), { pid: undefined, stdout: new PassThrough(), stderr: new PassThrough() })
    setImmediate(() => child.emit('error', Object.assign(new Error(`spawn ${command} ENOENT`), { code: 'ENOENT' })))
    return child
  }
  await assert.rejects(runOne(run, outDir, ctx, { ...deps, spawn: missing }), { message: `could not start claude (${ctx.pin.binary}: ENOENT)` })
  // Rejected only once raw.json and stderr.txt are written and closed: a caller that moves or removes the results
  // folder next (a test's cleanup, or a resume) never races a stream still opening.
  assert.deepEqual([readFileSync(join(outDir, 'raw.json'), 'utf8'), readFileSync(join(outDir, 'stderr.txt'), 'utf8')], ['', ''])
  assert.deepEqual(calls, [ctx.pin.binary])
  assert.deepEqual(JSON.parse(readFileSync(join(outDir, 'session.json'), 'utf8')).attempt, 1)
  assert.ok(!existsSync(join(outDir, 'run.json')))
})

test('runOne spawns the pinned binary with builderArgs for its own session id, and a second attempt archives the first', async t => {
  const { pin, home, dir, outDir, ctx, init, run, deps: base } = soloAttempt(t)
  const calls = []
  const deps = { ...base, spawn: fakeClaude({ home, calls, init }) }

  await runOne(run, outDir, ctx, deps)
  const first = JSON.parse(readFileSync(join(outDir, 'session.json'), 'utf8'))
  assert.match(first.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(first.attempt, 1)
  const [{ command, args, options }] = calls
  assert.equal(command, pin.binary, 'the pinned binary, never claude from PATH')
  assert.ok(args[1].endsWith(readFileSync(join(import.meta.dirname, 'tasks', 'easy.md'), 'utf8')), 'the task prompt')
  assert.deepEqual(args, builderArgs('solo', args[1], { sessionId: first.sessionId, installedKeys: ctx.installedKeys, pluginDir: ctx.pluginDir }))
  assert.deepEqual(options, spawnOptions(dir, builderEnv(process.env, { pluginDir: ctx.pluginDir })))
  const record = JSON.parse(readFileSync(join(outDir, 'run.json'), 'utf8'))
  assert.deepEqual([record.end, record.sessionId, record.attempt, record.exitCode, record.pluginCommit], ['ok', first.sessionId, 1, 0, 'c0ffee1'])
  assert.ok(existsSync(join(outDir, 'evidence', `${first.sessionId}.jsonl`)), 'the session transcript is copied')

  await runOne(run, outDir, ctx, deps)
  const second = JSON.parse(readFileSync(join(outDir, 'session.json'), 'utf8'))
  assert.equal(second.attempt, 2)
  assert.notEqual(second.sessionId, first.sessionId, 'a fresh session id per attempt')
  assert.equal(calls[1].args[calls[1].args.indexOf('--session-id') + 1], second.sessionId)
  const slug = projectDirFor(dir, home).split(/[\\/]/).at(-1)
  for (const name of ['run.json', 'raw.json', 'session.json', `evidence/${first.sessionId}.jsonl`, `${slug}/${first.sessionId}.jsonl`]) {
    assert.ok(existsSync(join(outDir, 'attempt-1', name)), `attempt-1 keeps ${name}`)
  }
  assert.ok(!existsSync(join(projectDirFor(dir, home), `${first.sessionId}.jsonl`)), 'the second attempt starts without the first attempt\'s transcripts')
  assert.equal(git(`${dir}-attempt-1`, 'log', '--format=%s', '-1'), 'init', 'the first attempt\'s solution folder is kept, renamed, never wiped')
  assert.equal(git(dir, 'log', '--format=%s', '-1'), 'init', 'the second attempt gets a fresh folder')
})

// A fake home's ~/.claude with user skills and agents, and a synced folder a run may change.
function fakeClaudeHome(t) {
  const home = tempRoot(t)
  for (const file of ['skills/tdd/SKILL.md', 'skills/synced/s1/SKILL.md', 'agents/helper.md']) {
    mkdirSync(join(home, '.claude', file, '..'), { recursive: true })
    writeFileSync(join(home, '.claude', file), 'x')
  }
  return home
}

test('userListing lists ~/.claude skills and agents without synced/, sorted, and a missing folder as empty', t => {
  const home = fakeClaudeHome(t)
  assert.deepEqual(userListing(home), ['agents/helper.md', 'skills/tdd', 'skills/tdd/SKILL.md'])
  assert.deepEqual(userListing(join(home, 'no-such-home')), [])
})

test('watchUserLists stops the batch naming the run when user skills or agents change during or before it; synced/ is ignored', async t => {
  const home = fakeClaudeHome(t)
  const put = file => { mkdirSync(join(home, '.claude', file, '..'), { recursive: true }); writeFileSync(join(home, '.claude', file), 'x') }
  const ran = []
  const one = watchUserLists(async run => {
    ran.push(run.id)
    put('skills/synced/s2/SKILL.md')
    if (run.id === 'h5-lean-mo-r1') put('skills/found/SKILL.md')
  }, { home })
  await one({ id: 'h4-lean-mo-r1' }, 'out')
  await assert.rejects(one({ id: 'h5-lean-mo-r1' }, 'out'), err => {
    assert.ok(err instanceof BatchStop)
    assert.equal(err.reason, 'h5-lean-mo-r1: ~/.claude skills or agents changed during the run (added skills/found); put them back as the batch found them, then resume')
    return true
  })
  rmSync(join(home, '.claude', 'skills', 'found'), { recursive: true })
  rmSync(join(home, '.claude', 'agents', 'helper.md'))
  await assert.rejects(one({ id: 'h6-lean-mo-r1' }, 'out'), { reason: 'h6-lean-mo-r1: ~/.claude skills or agents changed before the run (removed agents/helper.md); put them back as the batch found them, then resume' })
  assert.deepEqual(ran, ['h4-lean-mo-r1', 'h5-lean-mo-r1'], 'no run starts after a change')
})

// A run that stops (a limit, a void) after changing the lists keeps its own stop and exit code; the change is still said.
test('watchUserLists names a change made by a run that then stops, and rethrows the run\'s own error', async t => {
  const home = fakeClaudeHome(t)
  const logged = []
  const stop = new BatchStop('h4-lean-mo-r1: usage or rate limit (x); resume in the next usage window')
  const one = watchUserLists(async () => {
    mkdirSync(join(home, '.claude', 'agents', 'extra'), { recursive: true })
    throw stop
  }, { home, log: line => logged.push(line) })
  await assert.rejects(one({ id: 'h4-lean-mo-r1' }, 'out'), err => err === stop)
  assert.deepEqual(logged, ['h4-lean-mo-r1: ~/.claude skills or agents changed during the run (added agents/extra); put them back as the batch found them, then resume'])
})

// A skill carries many files: the stop names the changed top-level entries, a few at most, and counts the rest.
test('watchUserLists names changed skills and agents by their top-level entry, five at most per list', async t => {
  const home = fakeClaudeHome(t)
  const one = watchUserLists(async () => {
    for (const name of ['s1', 's2', 's3', 's4', 's5', 's6', 's7']) {
      mkdirSync(join(home, '.claude', 'skills', name, 'assets'), { recursive: true })
      writeFileSync(join(home, '.claude', 'skills', name, 'assets', 'a.png'), 'x')
    }
    writeFileSync(join(home, '.claude', 'skills', 'tdd', 'extra.md'), 'x')
  }, { home })
  await assert.rejects(one({ id: 'h4-lean-mo-r1' }, 'out'), {
    reason: 'h4-lean-mo-r1: ~/.claude skills or agents changed during the run (added skills/s1, skills/s2, skills/s3, skills/s4, skills/s5 … and 3 more); put them back as the batch found them, then resume',
  })
})

// The run's own stop and exit code win even when ~/.claude cannot be listed after it.
test('watchUserLists logs a listing failure after a run that stops, and still rethrows the run\'s own error', async t => {
  const home = fakeClaudeHome(t)
  const logged = []
  const stop = new BatchStop('h4-lean-mo-r1: void (x); a resume reruns it (rerun 1 of 2)')
  const one = watchUserLists(async () => {
    rmSync(join(home, '.claude', 'agents'), { recursive: true })
    writeFileSync(join(home, '.claude', 'agents'), 'not a folder')
    throw stop
  }, { home, log: line => logged.push(line) })
  await assert.rejects(one({ id: 'h4-lean-mo-r1' }, 'out'), err => err === stop)
  assert.equal(logged.length, 1)
  assert.match(logged[0], /^h4-lean-mo-r1: could not list ~\/\.claude skills or agents after the run \(ENOTDIR\)$/)
})

// A rename that fails leaves outDir as it was, so the resume reuses the same attempt number and suffix.
test('runOne renames the earlier solution folder before it writes session.json', async t => {
  const { home, dir, outDir, ctx, init, run, deps: base } = soloAttempt(t)
  const deps = { ...base, spawn: fakeClaude({ home, calls: [], init }) }
  await runOne(run, outDir, ctx, deps)
  mkdirSync(join(`${dir}-attempt-1`, 'blocker'), { recursive: true })
  await assert.rejects(runOne(run, outDir, ctx, deps))
  assert.ok(!existsSync(join(outDir, 'session.json')), 'no session.json for an attempt that never started')
  rmSync(`${dir}-attempt-1`, { recursive: true })
  await runOne(run, outDir, ctx, deps)
  assert.equal(JSON.parse(readFileSync(join(outDir, 'session.json'), 'utf8')).attempt, 2)
  assert.equal(git(`${dir}-attempt-1`, 'log', '--format=%s', '-1'), 'init', 'attempt 1\'s folder kept under its own number')
})

test('checkPin refuses a --plugin other than the pinned worktree and a binary whose bytes differ from the pin, in one line each', t => {
  const root = tempRoot(t)
  const binary = join(root, 'claude-2.1.296.exe')
  writeFileSync(binary, 'claude bytes')
  const sha256 = createHash('sha256').update('claude bytes').digest('hex')
  const pin = { binary, sha256, pluginDir: 'C:/Users/Asus/section-team-v0.2.1' }
  assert.doesNotThrow(() => checkPin('C:\\Users\\Asus\\Section-Team-v0.2.1\\', pin), 'slashes and case do not matter')
  assert.throws(() => checkPin('C:/Users/Asus/section-team-v0.2.0', pin),
    { message: '--plugin=C:/Users/Asus/section-team-v0.2.0 is not the worktree the round pinned: pass --plugin=C:/Users/Asus/section-team-v0.2.1' })
  writeFileSync(binary, 'other bytes')
  assert.throws(() => checkPin(pin.pluginDir, pin), { message: `${binary} differs from the binary the round pinned: put the pinned copy back; never re-pin a started round` })
  rmSync(binary)
  assert.throws(() => checkPin(pin.pluginDir, pin), { message: `cannot read ${binary} (ENOENT)` })
})

// An installed pin (the cloud machine) is put back by installing its npm package again, never by re-pinning.
test('checkPin names the npm package to install again when an installed pin\'s binary is missing or differs', t => {
  const root = tempRoot(t)
  const binary = join(root, 'claude.exe')
  const pin = { binary, sha256: createHash('sha256').update('claude bytes').digest('hex'), pluginDir: 'C:/w', npmPackage: '@anthropic-ai/claude-code@2.1.296' }
  const hint = 'install it again with npm i -g @anthropic-ai/claude-code@2.1.296 (node bench/cloud-sync.mjs restore does); never re-pin a started round'
  assert.throws(() => checkPin('C:/w', pin), { message: `${binary} is missing: ${hint}` })
  writeFileSync(binary, 'other bytes')
  assert.throws(() => checkPin('C:/w', pin), { message: `${binary} differs from the binary the round pinned: ${hint}` })
  writeFileSync(binary, 'claude bytes')
  assert.doesNotThrow(() => checkPin('C:/w', pin))
})

test('checkPin on Linux compares the worktree path case for case', { skip: process.platform === 'win32' && 'Linux paths' }, t => {
  const root = tempRoot(t)
  const binary = join(root, 'claude.exe')
  writeFileSync(binary, 'claude bytes')
  const pin = { binary, sha256: createHash('sha256').update('claude bytes').digest('hex'), pluginDir: '/root/section-team-v0.2.1' }
  assert.doesNotThrow(() => checkPin('/root/section-team-v0.2.1/', pin))
  assert.throws(() => checkPin('/root/Section-Team-v0.2.1', pin),
    { message: '--plugin=/root/Section-Team-v0.2.1 is not the worktree the round pinned: pass --plugin=/root/section-team-v0.2.1' })
})
