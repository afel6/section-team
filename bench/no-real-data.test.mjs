// A test once ran the real stashRunMemory by leaving out its folder: the default moved the user's section notes into
// the test's temp folder, and the test's cleanup deleted them. So what moves, deletes or pushes real data names its
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
  const env = { ...process.env, HOME: home, USERPROFILE: home, NODE_TEST_CONTEXT: '' }
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

// module, function, the target it names as missing, its arguments.
const TARGET_CASES = [
  [SECTION_MEMORY, 'stashRunMemory', 'root', `{ into: join(home, 'results') }`],
  [SECTION_MEMORY, 'stashRunMemory', 'into', `{ ${ROOT} }`],
  [SECTION_MEMORY, 'stashRunMemory', 'root', ''],
  [SECTION_MEMORY, 'stashRunMemory', 'root', `{ root: null, into: join(home, 'results') }`],
  [SECTION_MEMORY, 'backupSectionMemory', 'root', `{ ${BACKUP} }`],
  [SECTION_MEMORY, 'backupSectionMemory', 'backup', `{ ${ROOT} }`],
  [SECTION_MEMORY, 'backupSectionMemory', 'root', ''],
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
  [RUN, 'isolateSectionMemory', 'volumes', '{ backup: () => [], restore: () => {}, stop: () => {} }'],
  [RUN, 'runAll', 'results', `[${TEAM_RUN}], { runOne: async () => {}, isolate: () => () => {} }`],
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
]

for (const [module, name, missing, args] of TARGET_CASES) {
  test(`${name}(${args}) says ${missing} is required`, t => {
    assertRefused(t, `const { ${name} } = ${module}; await ${name}(${args})`, missing)
  })
}

const RUN_ONE_DEPS = "{ stash: () => [], dir: join(home, 'runs', 'one'), root: join(home, 'runs'), home, spawn: () => { throw new Error('spawned') }, kill: () => {}, timeoutMs: 1000 }"

for (const missing of ['stash', 'dir', 'root', 'home']) {
  test(`runOne refuses to run without ${missing}`, t => {
    assertRefused(t, `
      const { runOne } = ${RUN}
      const deps = ${RUN_ONE_DEPS}
      delete deps.${missing}
      await runOne(${TEAM_RUN}, join(home, 'out'), { pluginDir: 'x' }, deps)
    `, missing)
  })
}

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

test('isolateSectionMemory refuses to run without the backup it is given', t => {
  assertRefused(t, `const { isolateSectionMemory } = ${RUN}; isolateSectionMemory({ volumes: () => {}, restore: () => {}, stop: () => {} })`, 'backup')
})

test('isolateSectionMemory refuses to run without the restore it is given', t => {
  assertRefused(t, `const { isolateSectionMemory } = ${RUN}; isolateSectionMemory({ volumes: () => {}, backup: () => [], stop: () => {} })`, 'restore')
})

test('runAll refuses a team batch with no isolate', t => {
  assertRefused(t, `const { runAll } = ${RUN}; await runAll([${TEAM_RUN}], { runOne: async () => {} })`, 'isolate')
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

test('the outside-judge command line passes the results folder it is told to use', t => {
  const home = mkdtempSync(join(tmpdir(), 'bench-home-'))
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 3 }))
  const results = join(home, 'results')
  const out = `--out=${join(home, 'out')}`
  const env = { ...process.env, HOME: home, USERPROFILE: home, BENCH_RESULTS: results, NODE_TEST_CONTEXT: '' }
  const cli = (...args) => spawnSync(process.execPath, [join(import.meta.dirname, 'external-judge.mjs'), ...args], { env, encoding: 'utf8' }).stderr
  assert.match(cli('prepare', '--round=zzguard', out), /no folder .*bench-judge-zzguard: anonymize round zzguard first/)
  assert.ok(cli('import', '--round=zzguard', out, '--as=zzguardas').includes(`missing ${join(results, 'blind-key-zzguard.json')}`))
})

test('the fake home works on this platform', t => {
  const home = mkdtempSync(join(tmpdir(), 'bench-home-'))
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 3 }))
  const env = { ...process.env, HOME: home, USERPROFILE: home }
  const script = `import { homedir } from 'node:os'; process.stdout.write(homedir())`
  const { stdout } = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' })
  assert.equal(stdout, home, 'this platform ignores the fake home, so every case above would stop with no check')
})
