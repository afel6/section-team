import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { renameRetry, restoreMessage, restoreSectionMemory, sameVolume } from './section-memory.mjs'

// Children run with CLAUDE_* stripped, so their agent memory is always ~/.claude/agent-memory, whatever the parent's
// CLAUDE_CONFIG_DIR says: MEMORY_ROOT must follow the child, not the parent.
test('MEMORY_ROOT is ~/.claude/agent-memory even when CLAUDE_CONFIG_DIR is set', () => {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: join(tmpdir(), 'other-config') }
  delete env.NODE_TEST_CONTEXT
  const script = "import('./section-memory.mjs').then(m => process.stdout.write(m.MEMORY_ROOT))"
  const root = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: import.meta.dirname, env, encoding: 'utf8' })
  assert.equal(root, join(homedir(), '.claude', 'agent-memory'))
})

// A fake home with the user's own section memory, another agent's memory, and a results folder.
function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), 'bench-mem-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const paths = { root: join(root, 'agent-memory'), backup: join(root, 'backup'), results: join(root, 'results') }
  for (const [agent, note] of [['section-team-testing', 'user testing note'], ['section-team-backend', 'user backend note'], ['other-agent', 'not ours']]) {
    mkdirSync(join(paths.root, agent), { recursive: true })
    writeFileSync(join(paths.root, agent, 'MEMORY.md'), note)
  }
  mkdirSync(paths.results)
  return { ...paths, leftovers: join(paths.results, 'leftover') }
}

const note = (dir, agent) => readFileSync(join(dir, agent, 'MEMORY.md'), 'utf8')
const runWrites = (paths, agent, text) => {
  mkdirSync(join(paths.root, agent), { recursive: true })
  writeFileSync(join(paths.root, agent, 'MEMORY.md'), text)
}
const userIsBack = paths => {
  assert.equal(note(paths.root, 'section-team-testing'), 'user testing note')
  assert.equal(note(paths.root, 'section-team-backend'), 'user backend note')
  assert.equal(note(paths.root, 'other-agent'), 'not ours')
}

// What an older harness left behind: the user's section folders in a backup, with the manifest it wrote first.
function movedAside(paths, pid = process.pid) {
  const names = readdirSync(paths.root).filter(name => name.startsWith('section-team-')).sort()
  mkdirSync(paths.backup)
  writeFileSync(join(paths.backup, 'manifest.json'), JSON.stringify({ names, pid, startedAt: '2026-11-01T00:00:00.000Z' }))
  for (const name of names) renameSync(join(paths.root, name), join(paths.backup, name))
  return names
}

test('a restore puts back what an older round moved aside, and files what its runs left', t => {
  const paths = sandbox(t)
  movedAside(paths)
  // An interrupted run left a note under a name the user also has, and one under a new name.
  runWrites(paths, 'section-team-testing', 'left by an interrupted run')
  runWrites(paths, 'section-team-docs', 'also left')
  const result = restoreSectionMemory(paths)
  assert.deepEqual(result, { restored: ['section-team-backend', 'section-team-testing'], notes: ['section-team-docs', 'section-team-testing'] })
  userIsBack(paths)
  assert.ok(!existsSync(join(paths.root, 'section-team-docs')), 'run notes never stay in the user\'s memory')
  assert.equal(note(paths.leftovers, 'section-team-testing'), 'left by an interrupted run')
  assert.ok(!existsSync(paths.backup), 'the backup folder is gone once everything is back')
  assert.match(restoreMessage(result, paths.leftovers), /run notes filed under .*leftover: section-team-docs section-team-testing$/)
})

test('a restore that stopped half way can run again without filing the user\'s own folders as run notes', t => {
  const paths = sandbox(t)
  movedAside(paths)
  runWrites(paths, 'section-team-docs', 'run note')
  // The first restore moved backend back, then stopped.
  renameSync(join(paths.backup, 'section-team-backend'), join(paths.root, 'section-team-backend'))
  const result = restoreSectionMemory(paths)
  assert.deepEqual(result, { restored: ['section-team-testing'], notes: ['section-team-docs'] })
  userIsBack(paths)
})

test('a backup that stopped before its manifest moved nothing, so the restore leaves root alone', t => {
  const paths = sandbox(t)
  mkdirSync(paths.backup)
  const result = restoreSectionMemory(paths)
  assert.deepEqual(result, { restored: [], notes: [] })
  userIsBack(paths)
  assert.ok(!existsSync(paths.backup))
  assert.ok(!existsSync(paths.leftovers))
})

test('a restore refuses while the round that made the backup is still running, unless forced', t => {
  const paths = sandbox(t)
  movedAside(paths, 999_999)
  assert.throws(() => restoreSectionMemory({ ...paths, alive: () => true }), /pid 999999.*--force/)
  assert.ok(existsSync(join(paths.backup, 'section-team-testing')), 'nothing moved')
  restoreSectionMemory({ ...paths, alive: () => true, force: true })
  userIsBack(paths)
})

test('restoring without a backup is refused, so a user\'s memory is never moved out as run notes', t => {
  const paths = sandbox(t)
  assert.throws(() => restoreSectionMemory(paths), /no backup/)
  userIsBack(paths)
  assert.ok(!existsSync(paths.leftovers))
})

test('a user with no section memory had an empty backup, and the restore leaves no section folder behind', t => {
  const paths = sandbox(t)
  rmSync(join(paths.root, 'section-team-testing'), { recursive: true })
  rmSync(join(paths.root, 'section-team-backend'), { recursive: true })
  assert.deepEqual(movedAside(paths), [])
  runWrites(paths, 'section-team-testing', 'run note')
  restoreSectionMemory(paths)
  assert.deepEqual(readdirSync(paths.root), ['other-agent'])
})

test('renameRetry retries a busy folder with a growing wait, and gives up on other errors at once', () => {
  const waits = []
  let calls = 0
  const busyTwice = () => { if (++calls <= 2) throw Object.assign(new Error('busy'), { code: 'EBUSY' }) }
  renameRetry('a', 'b', { rename: busyTwice, wait: ms => waits.push(ms) })
  assert.deepEqual(waits, [200, 400])
  const missing = () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }) }
  assert.throws(() => renameRetry('a', 'b', { rename: missing, wait: () => assert.fail('no wait') }), /gone/)
  let tries = 0
  const alwaysBusy = () => { tries++; throw Object.assign(new Error('busy'), { code: 'EPERM' }) }
  assert.throws(() => renameRetry('a', 'b', { rename: alwaysBusy, wait: () => {} }), /busy/)
  assert.equal(tries, 5, 'gives up after exactly 5 attempts')
})

test('sameVolume is true for two folders in the temp folder', t => {
  const paths = sandbox(t)
  assert.equal(sameVolume(paths.root, paths.results), true)
})

test('a corrupt manifest is named in the error, with how to recover', t => {
  const paths = sandbox(t)
  mkdirSync(paths.backup)
  writeFileSync(join(paths.backup, 'manifest.json'), '{"names": [')
  assert.throws(() => restoreSectionMemory(paths), /manifest\.json is not valid JSON .*remove it/)
})
