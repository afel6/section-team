import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { outputMessages } from './clean-run.mjs'
import { BatchStop, EvidenceMissing, exitCodeOf, projectDirFor, recordAttempt } from './run-attempts.mjs'
import {
  CONDITIONS, DEFAULT_CONDS, TASKS, TIMEOUT_MIN, builderArgs, builderEnv, checkConds, checkPin, checkPluginWorktree, checkRoundTag, checkVolumes, killTree,
  freshRepo, isolateSectionMemory, modeFileFor, parseArgs, plan, pluginCommitOf, prepareRun, runAll, runFolder, runOne, taskProblems, userListing,
  watchUserLists,
} from './run.mjs'

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()

// A temp folder removed after the test, even when the test fails.
function tempRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'bench-run-'))
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }))
  return root
}

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
    env: { SECTION_TEAM_AUTO_INSTALL_SKILLS: '0', DISABLE_AUTOUPDATER: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false', CLAUDE_CODE_PLUGIN_DIRS: 'C:/Users/Asus/section-team-v0.2.1' },
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

  await runAll([solo], { runOne: ok, isolate })
  assert.deepEqual(calls, ['h1-solo-ho-r1'], 'a solo-only round leaves the memory alone')

  calls.length = 0
  await runAll([team, solo], { runOne: ok, isolate })
  assert.deepEqual(calls, ['aside', 'h1-team-ho-r1', 'h1-solo-ho-r1', 'back'])

  calls.length = 0
  const failing = async run => { calls.push(run.id); throw new Error('claude crashed') }
  await assert.rejects(runAll([team, solo], { runOne: failing, isolate }), /claude crashed/)
  assert.deepEqual(calls, ['aside', 'h1-team-ho-r1', 'back'])

  calls.length = 0
  await runAll([{ id: 'h1-lean-mo-r1', base: 'lean' }, { id: 'h1-max-mo-r1', base: 'max' }], { runOne: ok, isolate })
  assert.deepEqual(calls, ['aside', 'h1-lean-mo-r1', 'h1-max-mo-r1', 'back'], 'lean and max runs are team runs too')
})

test('runAll refuses to start without a runOne, before section memory moves', async () => {
  let moved = false
  const isolate = () => { moved = true; return () => {} }
  await assert.rejects(runAll([{ id: 'h4-team-mo-r1', base: 'team' }], { isolate }), { name: 'TypeError', message: 'runAll needs a runOne bound to the batch context' })
  assert.equal(moved, false)
  await assert.rejects(runAll([]), { name: 'TypeError', message: 'runAll needs a runOne bound to the batch context' }, 'also with no options at all')
})

test('pluginCommitOf with the real git says in one line that a worktree does not exist', t => {
  const missing = join(tempRoot(t), 'no-such-worktree')
  assert.throws(() => pluginCommitOf(missing), err => {
    assert.match(err.message, /^git -C .*no-such-worktree rev-parse HEAD failed: fatal: /)
    assert.doesNotMatch(err.message, /\n/)
    return true
  })
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
    { PATH: '/bin', SECTION_TEAM_AUTO_INSTALL_SKILLS: '0', ENABLE_CLAUDEAI_MCP_SERVERS: 'false', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_PLUGIN_DIRS: 'C:/w' })
  assert.deepEqual(parent, copy, 'the parent environment is not changed')
  assert.throws(() => builderEnv(parent, {}), /pluginDir/, 'no silent fallback to the live checkout')
})

test('pluginCommitOf refuses a missing or relative --plugin and a worktree not at v0.2.1, and returns its commit', () => {
  const worktree = join(tmpdir(), 'section-team-v0.2.1')
  const calls = []
  const gitWith = ({ head, tagged }) => args => { calls.push(args); return args.includes('HEAD') ? head : tagged }
  for (const bad of ['', 'section-team-v0.2.1', './w']) {
    assert.throws(() => pluginCommitOf(bad, { git: gitWith({}) }), { message: `--plugin= takes the absolute path of the v0.2.1 worktree, got "${bad}"` })
  }
  assert.deepEqual(calls, [], 'refused before any git call')
  assert.throws(() => pluginCommitOf(worktree, { git: gitWith({ head: 'aaa', tagged: 'bbb' }) }), { message: `${worktree} is at aaa, not at v0.2.1 (bbb)` })
  calls.length = 0
  assert.equal(pluginCommitOf(worktree, { git: gitWith({ head: 'bbb', tagged: 'bbb' }) }), 'bbb')
  assert.deepEqual(calls, [['-C', worktree, 'rev-parse', 'HEAD'], ['rev-parse', 'v0.2.1^{commit}']])
})

test('killTree is quiet when the process is already gone, and says so when it could not stop it', () => {
  const lines = []
  const gone = () => { throw Object.assign(new Error('not found'), { status: 128 }) }
  killTree({ pid: 42 }, { execFile: gone, log: line => lines.push(line) })
  assert.deepEqual(lines, [])
  const denied = () => { throw Object.assign(new Error('Access is denied'), { status: 1 }) }
  killTree({ pid: 42 }, { execFile: denied, log: line => lines.push(line) })
  assert.deepEqual(lines, ['could not stop claude (pid 42): Access is denied'])
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

test('checkPluginWorktree accepts the clean worktree root, whatever its slashes or case', () => {
  const calls = []
  const plugin = 'C:\\Users\\Asus\\Section-Team-v0.2.1\\'
  const git = args => { calls.push(args); return args.includes('--show-toplevel') ? 'C:/Users/Asus/section-team-v0.2.1' : '' }
  assert.doesNotThrow(() => checkPluginWorktree(plugin, { git }))
  assert.deepEqual(calls, [['-C', plugin, 'rev-parse', '--show-toplevel'], ['-C', plugin, 'status', '--porcelain'], ['-C', plugin, 'diff', '--stat', 'v0.2.1']])
})

test('checkPluginWorktree refuses a subfolder, uncommitted changes and a diff from v0.2.1, in one line each', () => {
  const top = 'C:/Users/Asus/section-team-v0.2.1'
  const gitWith = ({ status = '', diff = '' }) => args => (args.includes('--show-toplevel') ? top : args.includes('status') ? status : diff)
  const cases = [
    [`${top}/agents`, {}, `--plugin= must be the worktree's root folder ${top}, got ${top}/agents`],
    [top, { status: '?? stray.md' }, `${top} has uncommitted changes: a batch needs a clean v0.2.1 worktree`],
    [top, { diff: ' agents/backend.md | 2 +-' }, `${top} differs from v0.2.1: a batch needs a clean v0.2.1 worktree`],
  ]
  for (const [plugin, out, message] of cases) assert.throws(() => checkPluginWorktree(plugin, { git: gitWith(out) }), { message }, message)
})

test('checkConds refuses any setup but solo, lean, team and max, so a round never runs one initProblems cannot judge', () => {
  assert.doesNotThrow(() => checkConds(['solo', 'lean', 'team', 'max']))
  assert.doesNotThrow(() => checkConds(['team']))
  const message = 'a round runs solo, lean, team and max only, got "forced": pass --conds=solo,lean,team,max'
  assert.throws(() => checkConds(DEFAULT_CONDS), { name: 'RangeError', message }, 'the default setups include forced')
  assert.throws(() => checkConds(['solo', 'forced']), { name: 'RangeError', message })
})

// A stand-in for the pinned binary: it writes the session transcript where Claude Code would and streams an init and a result.
// With transcript false it writes no session file, as when the API fails before the first turn is saved. With hang
// true it streams only the init and runs until it is killed (its streams ended), then closes with code null.
function fakeClaude({ home, calls, init, result = { type: 'result', subtype: 'success', is_error: false, result: 'done' }, transcript = true, hang = false }) {
  return (command, args, options) => {
    calls.push({ command, args, options })
    const sessionId = args[args.indexOf('--session-id') + 1]
    const project = projectDirFor(options.cwd, home)
    mkdirSync(project, { recursive: true })
    if (transcript) writeFileSync(join(project, `${sessionId}.jsonl`), `${JSON.stringify({ type: 'assistant', effort: 'medium', message: { model: 'claude-opus-5-5' } })}\n`)
    const child = Object.assign(new EventEmitter(), { pid: 4242, stdout: new PassThrough(), stderr: new PassThrough() })
    const lines = hang ? [{ ...init, session_id: sessionId }] : [{ ...init, session_id: sessionId }, result]
    Promise.all([once(child.stdout, 'end'), once(child.stderr, 'end')]).then(() => child.emit('close', hang ? null : 0))
    const text = `${lines.map(line => JSON.stringify(line)).join('\n')}\n`
    // A hanging child's init is written at once (the stream holds it until runOne pipes it): written from setImmediate,
    // a 50 ms stop sometimes came first under the full suite's load, and the run was void with no init.
    if (hang) child.stdout.write(text)
    else setImmediate(() => {
      child.stdout.end(text)
      child.stderr.end()
    })
    return child
  }
}

// A kill for fake children: it ends their streams, so they close with code null. The real killTree would run
// taskkill on the fake pid 4242, which may belong to an unrelated process.
const endStreams = child => {
  child.stdout.end()
  child.stderr.end()
}

// A solo run of task easy into a temp root, with a pin and an init that pass the init check. deps always carry a
// fake kill and a short time limit, so no runOne test can hang or reach the real killTree.
function soloAttempt(t) {
  t.mock.method(console, 'log', () => {})
  const root = tempRoot(t)
  const builtins = ['cc-plugin-agents-md@builtin']
  const pin = { binary: 'C:/Users/Asus/bench-runs/claude-2.1.296.exe', version: '2.1.296', apiKeySource: 'none', builtins, setups: { solo: { agents: ['general-purpose'], skills: [] } } }
  const home = join(root, 'home')
  const dir = join(root, 'runs', 'easy-0123abcd')
  return {
    root, pin, home, dir, outDir: join(root, 'results', 'easy-solo-mo-r1'),
    ctx: { pin, installedKeys: ['a@market'], pluginDir: 'C:/Users/Asus/section-team-v0.2.1', pluginCommit: 'c0ffee1' },
    init: {
      type: 'system', subtype: 'init', model: 'claude-opus-5-5', claude_code_version: '2.1.296', apiKeySource: 'none', mcp_servers: [],
      plugins: [{ name: 'cc-plugin-agents-md', path: 'builtin', source: builtins[0] }], agents: ['general-purpose'], skills: [],
    },
    run: { id: 'easy-solo-mo-r1', task: 'easy', cond: 'solo-mo', base: 'solo', rep: 1 },
    deps: { kill: endStreams, timeoutMs: 5_000, home, dir, root: join(root, 'runs') },
  }
}

test('stopping the round mid-run stops the child with the kill its run was given, never the real killTree', async t => {
  const { home, outDir, ctx, init, run, deps } = soloAttempt(t)
  const killed = []
  const kill = child => { killed.push(child.pid); endStreams(child) }
  const running = runOne(run, outDir, ctx, { ...deps, spawn: fakeClaude({ home, calls: [], init, hang: true }), kill, timeoutMs: 60_000 })
  await new Promise(resolve => setTimeout(resolve, 50))
  isolateSectionMemory({ volumes: () => {}, backup: () => [], restore: () => {} })()
  await running
  assert.deepEqual(killed, [4242], 'the default stop used the run\'s own kill')
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
  assert.deepEqual(killed, [4242], 'the injected kill stops the child once')
  const raw = outputMessages(readFileSync(join(outDir, 'raw.json'), 'utf8'))
  assert.deepEqual(raw.map(m => [m.type, m.subtype]), [['system', 'init']], 'the init line written before the kill is kept')
  const record = JSON.parse(readFileSync(join(outDir, 'run.json'), 'utf8'))
  assert.deepEqual([record.timedOut, record.exitCode, record.end, record.subtype, record.resultText], [true, null, 'timeout', null, null])
  assert.ok(!existsSync(join(outDir, 'void.json')), 'a timeout with a good init is a counted run')
})

test('runOne rejects with one friendly line when the pinned binary cannot start', async t => {
  const { root, outDir, ctx, run, deps } = soloAttempt(t)
  const binary = join(root, 'no-such-folder', 'claude-2.1.296.exe')
  // The real spawn of a path that cannot exist: nothing runs.
  await assert.rejects(runOne(run, outDir, { ...ctx, pin: { ...ctx.pin, binary } }, deps),
    { message: `could not start claude (${binary}: ENOENT)` })
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
  assert.deepEqual([options.cwd, options.env], [dir, builderEnv(process.env, { pluginDir: ctx.pluginDir })])
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
    assert.equal(err.reason, 'h5-lean-mo-r1: ~/.claude skills or agents changed during the run (added skills/found, skills/found/SKILL.md); put them back as the batch found them, then resume')
    return true
  })
  rmSync(join(home, '.claude', 'skills', 'found'), { recursive: true })
  rmSync(join(home, '.claude', 'agents', 'helper.md'))
  await assert.rejects(one({ id: 'h6-lean-mo-r1' }, 'out'), { reason: 'h6-lean-mo-r1: ~/.claude skills or agents changed before the run (removed agents/helper.md); put them back as the batch found them, then resume' })
  assert.deepEqual(ran, ['h4-lean-mo-r1', 'h5-lean-mo-r1'], 'no run starts after a change')
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
