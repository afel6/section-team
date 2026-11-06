// A test once ran the real stash of section memory (since removed) by leaving out its folder: the default moved the user's
// section notes into the test's temp folder, and the test's cleanup deleted them. So what moves, deletes or pushes real data names its
// target, with no default, and a forgetful caller throws.
// Every case here runs in a child whose home folder is a temp one holding one note. If a default comes back, the case
// fails against that temp note. Never make these calls in this process: that is how the notes were lost.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const HOME_NOT_FAKED = 3

function inFakeHome(t, body) {
  const home = mkdtempSync(join(tmpdir(), 'bench-home-'))
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 3 }))
  const note = join(home, '.claude', 'agent-memory', 'section-team-testing', 'MEMORY.md')
  mkdirSync(dirname(note), { recursive: true })
  writeFileSync(note, 'note')
  const script = `
    import { homedir } from 'node:os'
    import { join } from 'node:path'
    const home = homedir()
    if (home !== ${JSON.stringify(home)}) process.exit(${HOME_NOT_FAKED})
    ${body}
  `
  const env = { ...process.env, HOME: home, USERPROFILE: home, BENCH_RESULTS: join(home, 'results'), NODE_TEST_CONTEXT: '' }
  const { status, stderr } = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: import.meta.dirname, env, encoding: 'utf8' })
  return { status, stderr, noteKept: existsSync(note) }
}

function assertRefused(t, body, missing) {
  const { status, stderr, noteKept } = inFakeHome(t, body)
  assert.match(stderr, new RegExp(`${missing} is required`))
  assert.equal(status, 1)
  assert.equal(noteKept, true, 'the note in the fake home was moved')
}

const SECTION_MEMORY = "await import('./section-memory.mjs')"
const RUN = "await import('./run.mjs')"
const SYNC = "await import('./cloud-sync.mjs')"
const PREFLIGHT = "await import('./preflight.mjs')"
const JUDGE = "await import('./external-judge.mjs')"
const ATTEMPTS = "await import('./run-attempts.mjs')"
const SCORE = "await import('./score.mjs')"
const GIT = "await import('./cloud-git.mjs')"
const TEAM_RUN = "{ id: 'easy-team-mo-r1', task: 'easy', cond: 'team-mo', base: 'team', rep: 1 }"
const ROOT = "root: join(home, 'memory')"
const BACKUP = "backup: join(home, 'backup')"
const LEFTOVERS = "leftovers: join(home, 'leftovers')"

const STUB_SYNC = '{ syncReady: () => {}, publishRun: () => ({}), publishItems: () => ({}) }'
const PUBLISH = "runs: [], tag: 'zzguard', options: {}"
const PF_ROUND = "round: 'zzguard', plugin: join(home, 'no-worktree')"
const PF_RESULTS = "results: join(home, 'results')"
const PF_FOLDER = 'folder: run => run.id'
const PF_ROOT = "root: join(home, 'runs')"
const OUT = "out: join(home, 'out')"
const PIN = "file: join(home, 'pin.json'), round: 'zzguard', branch: 'zzguard'"

// module, function, the target it names as missing, its arguments.
const TARGET_CASES = [
  [SECTION_MEMORY, 'restoreSectionMemory', 'root', `{ ${BACKUP}, ${LEFTOVERS} }`],
  [SECTION_MEMORY, 'restoreSectionMemory', 'backup', `{ ${ROOT}, ${LEFTOVERS} }`],
  [SECTION_MEMORY, 'restoreSectionMemory', 'leftovers', `{ ${ROOT}, ${BACKUP} }`],
  [SECTION_MEMORY, 'restoreSectionMemory', 'root', ''],
  [SECTION_MEMORY, 'restoreSectionMemory', 'backup', `{ ${ROOT}, backup: null, ${LEFTOVERS} }`],
  [SECTION_MEMORY, 'renameRetry', 'from', `undefined, join(home, 'to')`],
  [SECTION_MEMORY, 'renameRetry', 'to', `join(home, 'from')`],
  [SECTION_MEMORY, 'sameVolume', 'a', 'undefined, home'],
  [SECTION_MEMORY, 'sameVolume', 'b', 'home'],
  [RUN, 'freshRepo', 'dir', `undefined, { root: join(home, 'runs') }`],
  [RUN, 'freshRepo', 'dir', `null, { root: join(home, 'runs') }`],
  [RUN, 'checkVolumes', 'root', ''],
  [RUN, 'checkVolumes', 'others', `{ ${ROOT} }`],
  [RUN, 'watchUserLists', 'home', 'async () => {}'],
  [RUN, 'runAll', 'results', `[${TEAM_RUN}], { runOne: async () => {} }`],
  [RUN, 'publishAtStart', 'results', ''],
  [RUN, 'publishAtStart', 'results', `{ ${PUBLISH}, ${PF_FOLDER} }, ${STUB_SYNC}`],
  [RUN, 'publishAtStart', 'folder', `{ ${PUBLISH}, ${PF_RESULTS} }, ${STUB_SYNC}`],
  [SYNC, 'restore', 'results', ''],
  [PREFLIGHT, 'preflight', 'home', ''],
  [PREFLIGHT, 'preflight', 'home', `{ ${PF_ROUND}, ${PF_RESULTS} }, { ${PF_FOLDER}, ${PF_ROOT} }`],
  [PREFLIGHT, 'preflight', 'results', `{ ${PF_ROUND}, home }, { ${PF_FOLDER}, ${PF_ROOT} }`],
  [PREFLIGHT, 'preflight', 'folder', `{ ${PF_ROUND}, home, ${PF_RESULTS} }, { ${PF_ROOT} }`],
  [PREFLIGHT, 'preflight', 'root', `{ ${PF_ROUND}, home, ${PF_RESULTS} }, { ${PF_FOLDER} }`],
  [JUDGE, 'prepare', 'results', `{ round: 'zzguard', ${OUT} }`],
  [JUDGE, 'importRound', 'results', `{ round: 'zzguard', ${OUT}, as: 'zzguardas' }`],
  [JUDGE, 'rebuildHeldOut', 'results', `{ ${OUT} }`],
  [JUDGE, 'outsideCheck', 'results', `{ as: 'zzguardas' }`],
  [JUDGE, 'recordCheck', 'results', `{ as: 'zzguardas' }`],
  [PREFLIGHT, 'publishPin', 'publish', `{ ${PIN} }`],
  [PREFLIGHT, 'publishPin', 'publish', `{ ${PIN} }, {}`],
  [ATTEMPTS, 'projectDirFor', 'home', `'C:/runs/one'`],
  [ATTEMPTS, 'copyEvidence', 'home', `{ runDir: 'C:/runs/one', sessionId: 'sid', outDir: join(home, 'out'), base: 'solo' }`],
  [SCORE, 'scoreRun', 'results', `'zzguard'`],
  [SCORE, 'scoreRun', 'results', `'zzguard', { home }`],
  [SCORE, 'scoreRun', 'home', `'zzguard', { ${PF_RESULTS} }`],
  [GIT, 'scanAndPush', 'cwd', `{ branch: 'zzguard', email: 'a@b.c' }`],
  [GIT, 'scanAndPush', 'branch', `{ cwd: join(home, 'repo'), email: 'a@b.c' }`],
  [GIT, 'scanAndPush', 'email', `{ cwd: join(home, 'repo'), branch: 'zzguard' }`],
  [GIT, 'scanAndPush', 'cwd', ''],
  [GIT, 'openWorktree', 'repo', `{ branch: 'zzguard', dir: join(home, 'worktree') }`],
  [GIT, 'openWorktree', 'branch', `{ repo: join(home, 'repo'), dir: join(home, 'worktree') }`],
  [GIT, 'openWorktree', 'dir', `{ repo: join(home, 'repo'), branch: 'zzguard' }`],
  [GIT, 'openWorktree', 'repo', ''],
  [GIT, 'commitPaths', 'cwd', `{ paths: ['zzguard'], message: 'm' }`],
  [GIT, 'commitPaths', 'paths', `{ cwd: join(home, 'repo'), message: 'm' }`],
  [GIT, 'commitPaths', 'cwd', ''],
]

for (const [module, name, missing, args] of TARGET_CASES) {
  test(`${name}(${args}) says ${missing} is required`, t => {
    assertRefused(t, `const { ${name} } = ${module}; await ${name}(${args})`, missing)
  })
}

const RUN_ONE_DEPS = "{ dir: join(home, 'runs', 'one'), root: join(home, 'runs'), home, spawn: () => { throw new Error('spawned') }, kill: () => {}, timeoutMs: 1000 }"

for (const missing of ['dir', 'root', 'home']) {
  test(`runOne refuses to run without ${missing}`, t => {
    assertRefused(t, `
      const { runOne } = ${RUN}
      const deps = ${RUN_ONE_DEPS}
      delete deps.${missing}
      await runOne(${TEAM_RUN}, join(home, 'out'), { pluginDir: 'x' }, deps)
    `, missing)
  })
}

// The launcher is required too. These children cannot reach a real claude even if the check is missing: an empty PATH,
// a pin binary that does not exist, a fake which, and a stub git, so a red run fails on a missing file, never a paid call.
const NO_CLAUDE = "process.env.PATH = join(home, 'empty-path'); process.env.Path = process.env.PATH"

test('runOne refuses to run without a launcher', t => {
  assertRefused(t, `
    ${NO_CLAUDE}
    const { runOne } = ${RUN}
    const deps = ${RUN_ONE_DEPS}
    delete deps.spawn
    await runOne(${TEAM_RUN}, join(home, 'out'), { pluginDir: 'x', pin: { binary: join(home, 'no-claude') } }, deps)
  `, 'spawn')
})

test('preflight refuses to run without a launcher', t => {
  assertRefused(t, `
    ${NO_CLAUDE}
    const { preflight } = ${PREFLIGHT}
    const git = () => ({ status: 0, stdout: '', stderr: '' })
    await preflight({ ${PF_ROUND}, home, ${PF_RESULTS} }, { git, which: () => join(home, 'no-claude'), ${PF_FOLDER}, ${PF_ROOT} })
  `, 'spawn')
})

test('judgeCall refuses to run without a launcher', t => {
  assertRefused(t, `
    ${NO_CLAUDE}
    const { judgeCall } = await import('./judge.mjs')
    judgeCall({ pin: { binary: join(home, 'no-claude'), pluginDir: join(home, 'no-plugin') }, installedKeys: [], files: {}, home, log: () => {} })
  `, 'spawn')
})

test('runOne refuses to run without the folder it files its results in', t => {
  assertRefused(t, `const { runOne } = ${RUN}; await runOne(${TEAM_RUN}, undefined, { pluginDir: 'x' }, ${RUN_ONE_DEPS})`, 'outDir')
})

test('prepareRun refuses to wipe a folder it was not given', t => {
  assertRefused(t, `const { prepareRun } = ${RUN}; prepareRun(${TEAM_RUN}, { root: join(home, 'runs') })`, 'dir')
})

test('prepareRun refuses to run without the folder that bounds the wipe', t => {
  assertRefused(t, `const { prepareRun } = ${RUN}; prepareRun(${TEAM_RUN}, { dir: join(home, 'runs', 'one') })`, 'root')
})

test('freshRepo refuses to run without the folder that bounds the wipe', t => {
  assertRefused(t, `const { freshRepo } = ${RUN}; freshRepo(join(home, 'runs', 'one'))`, 'root')
})

// Every agent has `memory: local` since 0.2.0, so a run's notes stay in its own folder and nothing needs the user's moved.
test('a team batch leaves the section notes where they are', t => {
  const body = `
    const run = ${RUN}
    const memory = ${SECTION_MEMORY}
    if (run.isolateSectionMemory || memory.backupSectionMemory || memory.stashRunMemory) throw new Error('a move of the notes is back')
    await run.runAll([${TEAM_RUN}], { runOne: async () => {}, results: join(home, 'results') })
  `
  const { status, stderr, noteKept } = inFakeHome(t, body)
  assert.equal(status, 0, stderr)
  assert.equal(noteKept, true)
})

// What these reports write is a round's real file: a test that left out the folder would overwrite it.
for (const report of ['mode-check', 'test-strength', 'leak-scan', 'bars']) {
  test(`${report} main refuses to write without the results folder`, t => {
    assertRefused(t, `const { main } = await import('./${report}.mjs'); main(['--round=zzguard'])`, 'results')
  })
}

test('leak-scan main refuses to read without the home folder', t => {
  assertRefused(t, `const { main } = await import('./leak-scan.mjs'); main(['--round=zzguard'], { ${PF_RESULTS} })`, 'home')
})

for (const [missing, options] of [['repo', `{ syncRoot: join(home, 'sync') }`], ['syncRoot', `{ repo: join(home, 'repo') }`]]) {
  test(`cloud-sync refuses to reach a remote without ${missing}`, t => {
    assertRefused(t, `const { syncReady } = ${SYNC}; syncReady(${options})`, missing)
  })
}

test('pushAll refuses to run without the results and runs it sends', t => {
  const options = `{ repo: join(home, 'repo'), syncRoot: join(home, 'sync') }`
  assertRefused(t, `const { pushAll } = ${SYNC}; pushAll({ runs: join(home, 'runs') }, ${options})`, 'results')
  assertRefused(t, `const { pushAll } = ${SYNC}; pushAll({ results: join(home, 'results') }, ${options})`, 'runs')
})

test('restore refuses to run without the results and runs it writes into', t => {
  const options = `{ repo: join(home, 'repo'), syncRoot: join(home, 'sync') }`
  assertRefused(t, `const { restore } = ${SYNC}; restore({ round: 'mo', runs: join(home, 'runs') }, ${options})`, 'results')
  assertRefused(t, `const { restore } = ${SYNC}; restore({ round: 'mo', results: join(home, 'results') }, ${options})`, 'runs')
})

// A temp home and results folder for a command-line run.
function cliHome(t) {
  const home = mkdtempSync(join(tmpdir(), 'bench-home-'))
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 3 }))
  const results = join(home, 'results')
  return { home, results, env: { ...process.env, HOME: home, USERPROFILE: home, BENCH_RESULTS: results, NODE_TEST_CONTEXT: '' } }
}

test('a results default that comes back lands in the temp home', t => {
  const { status, stderr } = inFakeHome(t, `const { RESULTS } = ${RUN}; if (RESULTS !== join(home, 'results')) throw new Error(RESULTS)`)
  assert.equal(status, 0, stderr)
})

test('the outside-judge command line passes the results folder it is told to use', t => {
  const { home, results, env } = cliHome(t)
  const out = `--out=${join(home, 'out')}`
  const cli = (...args) => spawnSync(process.execPath, [join(import.meta.dirname, 'external-judge.mjs'), ...args], { env, encoding: 'utf8' }).stderr
  assert.match(cli('prepare', '--round=zzguard', out), /no folder .*bench-judge-zzguard: anonymize round zzguard first/)
  assert.ok(cli('import', '--round=zzguard', out, '--as=zzguardas').includes(`missing ${join(results, 'blind-key-zzguard.json')}`))
  assert.ok(cli('rebuild-heldout', out).includes(`missing ${join(results, 'external-key-ho.json')}`))
  assert.ok(cli('check', '--as=zzguardas').includes(`missing ${join(results, 'judge-zzguardas.json')}`))
})

test('the score command line passes the results folder it is told to use, and a home', t => {
  const { home, results, env } = cliHome(t)
  mkdirSync(join(results, 'zz'), { recursive: true })
  writeFileSync(join(results, 'zz', 'run.json'), JSON.stringify({ id: 'zz', task: 'h4', dir: join(home, 'runs', 'zz') }))
  const { stderr } = spawnSync(process.execPath, [join(import.meta.dirname, 'score.mjs')], { env, encoding: 'utf8' })
  assert.ok(stderr.includes(`missing ${join(results, 'zz', 'raw.json')}`), stderr)
})

test('the report command lines use the results folder they are told to use', t => {
  const { results, env } = cliHome(t)
  mkdirSync(results, { recursive: true })
  const cli = (script, round) => spawnSync(process.execPath, [join(import.meta.dirname, script), `--round=${round}`], { env, encoding: 'utf8' })
  for (const [script, file] of [['mode-check.mjs', 'mode-check-zzguard.json'], ['test-strength.mjs', 'test-strength-zzguard.json']]) {
    const { status, stderr } = cli(script, 'zzguard')
    assert.equal(status, 0, stderr)
    assert.ok(existsSync(join(results, file)), file)
  }
  assert.ok(cli('leak-scan.mjs', 'zzguard').stderr.includes(join(results, 'blind-key-zzguard.json')))
  assert.ok(cli('bars.mjs', 'mo').stderr.includes(results))
})

test('the fake home works on this platform', t => {
  const home = mkdtempSync(join(tmpdir(), 'bench-home-'))
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 3 }))
  const env = { ...process.env, HOME: home, USERPROFILE: home }
  const script = `import { homedir } from 'node:os'; process.stdout.write(homedir())`
  const { stdout } = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' })
  assert.equal(stdout, home, 'this platform ignores the fake home, so every case above would stop with no check')
})
