import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CONDITIONS, DEFAULT_CONDS, TASKS, TIMEOUT_MIN, builderArgs, builderEnv, checkVolumes, killTree, freshRepo, isolateSectionMemory, modeFileFor, parseArgs, plan, prepareRun, runAll, runFolder, taskProblems } from './run.mjs'

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

test('lean and max builder runs get exactly the team run\'s arguments', () => {
  for (const base of ['lean', 'max']) assert.deepEqual(builderArgs(base, 'the prompt'), builderArgs('team', 'the prompt'), base)
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

test('every builder run turns automatic skill installs off; only solo turns the plugin off', () => {
  const settingsOf = base => {
    const args = builderArgs(base, 'the prompt')
    assert.deepEqual(args.slice(0, 2), ['-p', 'the prompt'])
    return JSON.parse(args[args.indexOf('--settings') + 1])
  }
  assert.deepEqual(settingsOf('team'), { env: { SECTION_TEAM_AUTO_INSTALL_SKILLS: '0' } })
  assert.deepEqual(settingsOf('solo'), { env: { SECTION_TEAM_AUTO_INSTALL_SKILLS: '0' }, enabledPlugins: { 'section-team@inline': false } })
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
  const release = isolateSectionMemory({ volumes: () => {}, backup: () => ['section-team-testing'], restore: () => { restores++; throw new Error('EBUSY') } })
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
// runs also get it in their process environment (checked by a preflight on 2026-10-30).
test('builderEnv turns automatic skill installs off in the process environment and keeps everything else', () => {
  assert.deepEqual(builderEnv({ PATH: '/bin', SECTION_TEAM_AUTO_INSTALL_SKILLS: '1', CLAUDE_CODE_PLUGIN_DIRS: 'C:/p' }),
    { PATH: '/bin', SECTION_TEAM_AUTO_INSTALL_SKILLS: '0', CLAUDE_CODE_PLUGIN_DIRS: 'C:/p' })
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
