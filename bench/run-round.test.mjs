// A round's own setup: where its run folders live and what may sit above them. run.test.mjs has the rest of run.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkRunsRoot, instructionFilesAbove } from './clean-run.mjs'
import { projectDirFor } from './run-attempts.mjs'
import { fakeClaude, soloAttempt, tempRoot } from './run-fixtures.mjs'
import {
  CONDITIONS, ROUND_CONDS, TIMEOUT_MIN, armOf, batchArms, checkConds, copyRunEvidence, modeFileFor, parseArgs, plan, prepareRun, projectDirIn, runOne, seedOf, syncBranchOf,
  timeoutFor, watchUserLists,
} from './run.mjs'

const SOLO = { id: 'easy-solo-nx-r1', task: 'easy', cond: 'solo-nx', base: 'solo', rep: 1 }

const put = (file, text = 'x') => {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, text)
}
// Only what a test planted: the machine running it may hold such a file above its temp folder (this one has AGENTS.md
// in the home), and that one is the machine's, not the test's.
const planted = (found, root) => found.filter(path => path.startsWith(root))

test('the run folders live under BENCH_RUNS when it is set, else ~/bench-runs, with forward slashes', t => {
  const root = tempRoot(t)
  const runsOf = env => spawnSync(process.execPath, ['--input-type=module', '-e', "const { RUNS } = await import('./run.mjs'); process.stdout.write(RUNS)"],
    { cwd: import.meta.dirname, env: { ...process.env, ...env }, encoding: 'utf8' }).stdout
  assert.equal(runsOf({ BENCH_RUNS: join(root, 'bench-runs-nx'), HOME: root, USERPROFILE: root }), join(root, 'bench-runs-nx').replaceAll('\\', '/'))
  assert.equal(runsOf({ BENCH_RUNS: '', HOME: root, USERPROFILE: root }), join(root, 'bench-runs').replaceAll('\\', '/'))
})

test('instructionFilesAbove finds CLAUDE.md, CLAUDE.local.md, AGENTS.md and .claude/CLAUDE.md in the folder and every folder above it, nearest first', t => {
  const root = tempRoot(t)
  const runs = join(root, 'home', 'bench-runs')
  mkdirSync(runs, { recursive: true })
  assert.deepEqual(planted(instructionFilesAbove(runs), root), [])
  put(join(root, 'home', 'AGENTS.md'))
  put(join(root, 'CLAUDE.local.md'))
  put(join(root, 'home', '.claude', 'CLAUDE.md'))
  put(join(runs, 'CLAUDE.md'))
  put(join(root, 'home', 'README.md'))
  assert.deepEqual(planted(instructionFilesAbove(runs), root), [
    join(runs, 'CLAUDE.md'), join(root, 'home', 'AGENTS.md'), join(root, 'home', '.claude', 'CLAUDE.md'), join(root, 'CLAUDE.local.md'),
  ])
})

test('checkRunsRoot refuses a relative root and one with an instruction file above it, naming the file', t => {
  const root = tempRoot(t)
  const runs = join(root, 'home', 'bench-runs-nx')
  mkdirSync(runs, { recursive: true })
  assert.throws(() => checkRunsRoot('bench-runs'), { message: 'BENCH_RUNS takes an absolute path, got "bench-runs"' })
  const agents = join(root, 'home', 'AGENTS.md')
  put(agents)
  assert.throws(() => checkRunsRoot(runs), err => {
    assert.ok(err.message.startsWith(`${agents} sits above the run folders`), err.message)
    assert.match(err.message, /Claude Code reads it as instructions in every run: set BENCH_RUNS to a folder with no CLAUDE\.md, CLAUDE\.local\.md or AGENTS\.md above it$/)
    assert.doesNotMatch(err.message, /\n/)
    return true
  })
  assert.doesNotThrow(() => checkRunsRoot(runs, { found: () => [] }), 'a clean tree passes')
})

// The nx round: plain Claude Code, v0.5.1 (base) and the release candidate (team), each from its own worktree.
const NX = ['--tag=nx', '--conds=solo,base,team', '--tasks=h8', '--reps=1', '--plugin=C:/wt/rc', '--plugin-ref=v0.6.0-rc.1', '--base-plugin=C:/wt/v051', '--base-ref=v0.5.1', '--config-dir=C:/bench-profile-nx']

test('parseArgs reads the base worktree and ref and the profile, and refuses a relative profile or a bad ref', () => {
  const args = parseArgs(NX)
  assert.deepEqual([args.basePlugin, args.baseRef, args.configDir, args.conds], ['C:/wt/v051', 'v0.5.1', 'C:/bench-profile-nx', ['solo', 'base', 'team']])
  assert.deepEqual([parseArgs([]).basePlugin, parseArgs([]).baseRef, parseArgs([]).configDir], ['', '', null])
  assert.throws(() => parseArgs(['--config-dir=bench-profile']), { name: 'RangeError', message: '--config-dir takes the absolute path of the round\'s profile folder, got "bench-profile"' })
  assert.throws(() => parseArgs(['--base-ref=a b']), { name: 'RangeError', message: '--base-ref takes a branch, tag or commit, got "a b"' })
})

test('base is a setup of its own: planned like the others, a round setup, Balanced with no mode file', () => {
  assert.ok(CONDITIONS.includes('base'))
  assert.deepEqual(ROUND_CONDS, ['solo', 'team', 'max', 'base'])
  assert.doesNotThrow(() => checkConds(['solo', 'base', 'team']))
  assert.equal(modeFileFor('base'), null)
  const ids = plan({ tag: 'nx', conds: ['solo', 'base', 'team'], tasks: ['h8'], reps: 2 }).map(r => r.id)
  assert.deepEqual(ids, ['h8-solo-nx-r1', 'h8-base-nx-r1', 'h8-team-nx-r1', 'h8-team-nx-r2', 'h8-base-nx-r2', 'h8-solo-nx-r2'])
})

test('the nx tasks have their time limits: h8 60, h9 60, h10 120 minutes', () => {
  assert.deepEqual({ h8: TIMEOUT_MIN.h8, h9: TIMEOUT_MIN.h9, h10: TIMEOUT_MIN.h10 }, { h8: 60, h9: 60, h10: 120 })
  assert.equal(timeoutFor('h8', 'base'), 60)
})

// The pilot's L1 probe (h5p): h5's seed with only h5's first bug report as the request, so no seed is copied.
test('the probe h5p starts from h5\'s seed and has h5\'s time limit', t => {
  const root = tempRoot(t)
  const seeds = join(root, 'seeds')
  put(join(seeds, 'h5', 'lib', 'money.mjs'), 'export {}\n')
  const dir = join(root, 'runs', 'h5p-0123abcd')
  prepareRun({ id: 'h5p-team-pnx-r1', task: 'h5p', cond: 'team-pnx', base: 'team', rep: 1 }, { dir, root: join(root, 'runs'), seeds })
  assert.ok(existsSync(join(dir, 'lib', 'money.mjs')))
  assert.equal(seedOf('h5p'), 'h5')
  assert.equal(seedOf('h8'), 'h8')
  assert.equal(TIMEOUT_MIN.h5p, 60)
})

// Each arm's worktree is checked against its own pinned ref and commit; solo records none.
const PIN = {
  binary: 'C:/no-such/claude.exe', sha256: 'x', pluginDir: 'C:/wt/rc', pluginRef: 'v0.6.0-rc.1', pluginCommit: 'rc1',
  base: { pluginDir: 'C:/wt/v051', pluginRef: 'v0.5.1', pluginCommit: 'b51' },
}
// A fake git: every worktree is its own root, clean, at heads[dir]; a ref resolves to the commit the pin recorded.
const gitFor = heads => args => {
  if (args.includes('--show-toplevel')) return args[1]
  if (args.includes('HEAD')) return heads[args[1]]
  return args.includes('rev-parse') ? args[1].replace('^{commit}', '') : ''
}
const readVersion = dir => ({ 'C:/wt/rc': '0.5.1', 'C:/wt/v051': '0.5.1' })[dir]
const noBinary = () => {}

test('batchArms checks both worktrees at their pinned commits and gives each setup its plugin, ref, commit and version', () => {
  const git = gitFor({ 'C:/wt/rc': 'rc1', 'C:/wt/v051': 'b51' })
  const checked = []
  const args = parseArgs(NX)
  const arms = batchArms(args, PIN, { git, readVersion, checkBinary: (plugin, armPin) => checked.push([plugin, armPin.pluginDir]) })
  assert.deepEqual(checked, [['C:/wt/rc', 'C:/wt/rc'], ['C:/wt/v051', 'C:/wt/v051']], 'each worktree against its own pin')
  assert.deepEqual(arms.team, { pluginDir: 'C:/wt/rc', pluginRef: 'v0.6.0-rc.1', pluginCommit: 'rc1', pluginVersion: '0.5.1' })
  assert.deepEqual(arms.base, { pluginDir: 'C:/wt/v051', pluginRef: 'v0.5.1', pluginCommit: 'b51', pluginVersion: '0.5.1' })
  assert.deepEqual(arms.solo, { pluginDir: 'C:/wt/rc', pluginRef: null, pluginCommit: null, pluginVersion: null })
  assert.deepEqual(['solo', 'base', 'team', 'max'].map(base => armOf(arms, base)), [arms.solo, arms.base, arms.team, arms.team])
  const deps = { git, readVersion, checkBinary: noBinary }
  assert.throws(() => batchArms(args, PIN, { ...deps, git: gitFor({ 'C:/wt/rc': 'rc1', 'C:/wt/v051': 'other' }) }), { message: 'C:/wt/v051 is at other, not at v0.5.1 (b51)' })
  assert.throws(() => batchArms({ ...args, baseRef: 'v0.5.0' }, PIN, deps), { message: '--base-ref=v0.5.0 is not the ref the round pinned: pass --base-ref=v0.5.1 or leave it out' })
  assert.throws(() => batchArms({ ...args, basePlugin: '' }, PIN, deps), { message: '--plugin= takes the absolute path of the v0.5.1 worktree, got ""' })
  assert.throws(() => batchArms({ ...args, basePlugin: 'C:/WT/rc/' }, PIN, deps), { message: '--base-plugin= and --plugin= name one folder, C:/WT/rc/: each arm needs its own worktree' })
  const { base, ...noBase } = PIN
  assert.throws(() => batchArms(args, noBase, deps), { message: 'round nx pinned no base setup: run its preflight with --conds naming base' })
  assert.equal(batchArms({ ...args, conds: ['solo', 'team'] }, noBase, deps).base, null)
  assert.throws(() => batchArms({ ...args, live: 'C:/wt' }, PIN, deps), /^Error: C:\/wt\/rc is the live checkout C:\/wt/)
})

test('a run in the round\'s profile writes its transcript there, keeps the mode record from the home, and run.json records its setup', async t => {
  const { home, dir, outDir, ctx: soloCtx, init, deps: base, root } = soloAttempt(t)
  const configDir = join(root, 'bench-profile-nx')
  const calls = []
  const ctx = { ...soloCtx, pluginRef: 'v0.6.0-rc.1', pluginVersion: '0.5.1', pluginCommit: 'rc1', configDir, memoryLimitMb: '12288' }
  await runOne(SOLO, outDir, ctx, { ...base, spawn: fakeClaude({ home, calls, init, claudeDir: configDir }) })
  const [{ args, options }] = calls
  assert.equal(options.env.CLAUDE_CONFIG_DIR, configDir)
  assert.equal(options.env.SECTION_TEAM_MEMORY_LIMIT_MB, '12288')
  assert.equal(JSON.parse(args[args.indexOf('--settings') + 1]).env.SECTION_TEAM_MEMORY_LIMIT_MB, '12288')
  const record = JSON.parse(readFileSync(join(outDir, 'run.json'), 'utf8'))
  assert.deepEqual([record.end, record.pluginRef, record.pluginCommit, record.pluginVersion, record.configDir, record.memoryLimitMb],
    ['ok', 'v0.6.0-rc.1', 'rc1', '0.5.1', configDir, '12288'])
  assert.ok(record.envNames.includes('CLAUDE_CONFIG_DIR') && record.envNames.includes('SECTION_TEAM_MEMORY_LIMIT_MB'))
  assert.ok(existsSync(join(outDir, 'evidence', `${record.sessionId}.jsonl`)), 'the transcript is copied from the profile')
  assert.equal(existsSync(projectDirFor(dir, home)), false, 'nothing was looked for under ~/.claude')
})

test('projectDirIn names the folder projectDirFor does for ~/.claude, and the profile\'s for a profile', () => {
  const home = 'C:/Users/me'
  assert.equal(projectDirIn(join(home, '.claude'), 'C:/bench-runs-nx/h8-0123abcd'), projectDirFor('C:/bench-runs-nx/h8-0123abcd', home))
  assert.equal(projectDirIn('C:/bench-profile-nx', 'C:/bench-runs-nx/h8-0123abcd'), join('C:/bench-profile-nx', 'projects', 'C--bench-runs-nx-h8-0123abcd'))
})

test('copyRunEvidence refuses a builder run whose mode record is missing from the home, and copies it when there', t => {
  const root = tempRoot(t)
  const home = join(root, 'home')
  const claudeDir = join(root, 'profile')
  const runDir = join(root, 'runs', 'h8-0123abcd')
  const project = projectDirIn(claudeDir, runDir)
  put(join(project, 'sid-1.jsonl'), '{}\n')
  put(join(project, 'sid-1', 'subagents', 'agent-a.jsonl'), '{}\n')
  const outDir = join(root, 'out')
  const record = join(home, '.claude', 'section-team', 'modes', 'sid-1.json')
  assert.throws(() => copyRunEvidence({ runDir, sessionId: 'sid-1', outDir, base: 'base', home, claudeDir }), { name: 'EvidenceMissing', message: `evidence missing for sid-1: ${record}` })
  assert.equal(existsSync(join(outDir, 'evidence')), false, 'a stop copies nothing')
  put(record, '{"mode":"balanced"}')
  const copied = copyRunEvidence({ runDir, sessionId: 'sid-1', outDir, base: 'base', home, claudeDir })
  assert.equal(copied.length, 3)
  for (const rel of ['sid-1.jsonl', 'sid-1/subagents/agent-a.jsonl', '.claude/section-team/modes/sid-1.json']) assert.ok(existsSync(join(outDir, 'evidence', rel)), rel)
  assert.throws(() => copyRunEvidence({ runDir, sessionId: '../x', outDir, base: 'solo', home, claudeDir }), TypeError)
})

test('watchUserLists watches the profile\'s skills and agents when the round has one', async t => {
  const root = tempRoot(t)
  const claudeDir = join(root, 'profile')
  put(join(claudeDir, 'skills', 'a', 'SKILL.md'))
  const one = watchUserLists(async () => put(join(claudeDir, 'agents', 'new.md')), { home: join(root, 'home'), claudeDir, log: () => {} })
  await assert.rejects(one({ id: 'h8-solo-nx-r1' }, join(root, 'out')), { name: 'BatchStop', message: /h8-solo-nx-r1: ~\/\.claude skills or agents changed during the run \(added agents\/new\.md\)/ })
})

// The command line, on paths that refuse before any paid run: no PATH to find claude on, a pin whose binary does not exist.
test('run.mjs refuses a bad memory limit, and on Windows a missing SECTION_TEAM_LIVE_CHECKOUT, before any run', t => {
  const home = tempRoot(t)
  const results = join(home, 'results')
  put(join(results, 'preflight-zzlive.json'), JSON.stringify({ binary: join(home, 'no-claude.exe'), sha256: 'none', pluginDir: join(home, 'wt'), memoryLimitMb: '12288' }))
  const env = { PATH: join(home, 'empty-path'), HOME: home, USERPROFILE: home, SystemRoot: process.env.SystemRoot, BENCH_RESULTS: results }
  const run = extra => spawnSync(process.execPath, [join(import.meta.dirname, 'run.mjs'), '--tag=zzlive', `--plugin=${join(home, 'wt')}`, '--conds=solo', '--tasks=easy', '--reps=1', '--no-sync'],
    { cwd: home, env: { ...env, ...extra }, encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  const bad = run({ SECTION_TEAM_MEMORY_LIMIT_MB: '12GB', SECTION_TEAM_LIVE_CHECKOUT: join(home, 'live') })
  assert.deepEqual([bad.status, bad.stderr], [1, 'SECTION_TEAM_MEMORY_LIMIT_MB takes a whole number of megabytes such as 12288, got "12GB"\n'])
  if (process.platform === 'win32') {
    const unset = run({ SECTION_TEAM_MEMORY_LIMIT_MB: '12288' })
    assert.equal(unset.status, 1)
    assert.match(unset.stderr, /^set SECTION_TEAM_LIVE_CHECKOUT to the absolute path of your own section-team checkout/)
  }
})

// Pushes reach the public remote, so the round's own command line pushes nothing: only --sync=<branch> opts in.
test('the nx round\'s command line on Windows publishes nothing unless --sync names a branch', () => {
  assert.equal(syncBranchOf(parseArgs(NX), 'win32'), null)
  assert.equal(syncBranchOf(parseArgs([...NX, '--sync=bench/nx-results']), 'win32'), 'bench/nx-results')
})
