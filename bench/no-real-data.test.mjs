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
const TEAM_RUN = "{ id: 'easy-team-mo-r1', task: 'easy', cond: 'team-mo', base: 'team', rep: 1 }"
const ROOT = "root: join(home, 'memory')"
const BACKUP = "backup: join(home, 'backup')"
const LEFTOVERS = "leftovers: join(home, 'leftovers')"

const SECTION_MEMORY_CASES = [
  ['stashRunMemory', 'root', `{ into: join(home, 'results') }`],
  ['stashRunMemory', 'into', `{ ${ROOT} }`],
  ['backupSectionMemory', 'root', `{ ${BACKUP} }`],
  ['backupSectionMemory', 'backup', `{ ${ROOT} }`],
  ['restoreSectionMemory', 'root', `{ ${BACKUP}, ${LEFTOVERS} }`],
  ['restoreSectionMemory', 'backup', `{ ${ROOT}, ${LEFTOVERS} }`],
  ['restoreSectionMemory', 'leftovers', `{ ${ROOT}, ${BACKUP} }`],
]

for (const [name, missing, args] of SECTION_MEMORY_CASES) {
  test(`${name} refuses to run without ${missing}`, t => {
    assertRefused(t, `const { ${name} } = ${SECTION_MEMORY}; ${name}(${args})`, missing)
  })
}

test('backupSectionMemory with no arguments at all refuses to run', t => {
  assertRefused(t, `const { backupSectionMemory } = ${SECTION_MEMORY}; backupSectionMemory()`, 'root')
})

for (const missing of ['stash', 'dir', 'root', 'home']) {
  test(`runOne refuses to run without ${missing}`, t => {
    assertRefused(t, `
      const { runOne } = ${RUN}
      const deps = { stash: () => [], dir: join(home, 'runs', 'one'), root: join(home, 'runs'), home, spawn: () => { throw new Error('spawned') }, kill: () => {}, timeoutMs: 1000 }
      delete deps.${missing}
      await runOne(${TEAM_RUN}, join(home, 'out'), { pluginDir: 'x' }, deps)
    `, missing)
  })
}

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

test('the fake home works on this platform', t => {
  const home = mkdtempSync(join(tmpdir(), 'bench-home-'))
  t.after(() => rmSync(home, { recursive: true, force: true, maxRetries: 3 }))
  const env = { ...process.env, HOME: home, USERPROFILE: home }
  const script = `import { homedir } from 'node:os'; process.stdout.write(homedir())`
  const { stdout } = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' })
  assert.equal(stdout, home, 'this platform ignores the fake home, so every case above would stop with no check')
})
