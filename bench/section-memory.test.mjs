import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backupSectionMemory, renameRetry, restoreMessage, restoreSectionMemory, sameVolume, stashRunMemory } from './section-memory.mjs'

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

test('a round moves the user\'s section memory aside, gives each team run empty memory, and puts it back', t => {
  const paths = sandbox(t)
  assert.deepEqual(backupSectionMemory(paths), ['section-team-backend', 'section-team-testing'])
  assert.deepEqual(readdirSync(paths.root), ['other-agent'], 'only section-team folders move')

  runWrites(paths, 'section-team-testing', 'run 1 note')
  stashRunMemory({ ...paths, into: join(paths.results, 'h1-team-ho-r1') })
  assert.deepEqual(readdirSync(paths.root), ['other-agent'], 'the next team run starts empty')
  assert.equal(note(join(paths.results, 'h1-team-ho-r1', 'section-memory'), 'section-team-testing'), 'run 1 note')

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
  backupSectionMemory(paths)
  runWrites(paths, 'section-team-docs', 'run note')
  // The first restore moved backend back, then stopped.
  renameSync(join(paths.backup, 'section-team-backend'), join(paths.root, 'section-team-backend'))
  const result = restoreSectionMemory(paths)
  assert.deepEqual(result, { restored: ['section-team-testing'], notes: ['section-team-docs'] })
  userIsBack(paths)
})

test('a backup that fails half way puts back what it moved, removes the backup and says so', t => {
  const paths = sandbox(t)
  let moves = 0
  const failSecond = (from, to) => {
    if (++moves === 2) throw Object.assign(new Error('rename failed'), { code: 'ENOENT' })
    renameSync(from, to)
  }
  assert.throws(() => backupSectionMemory({ ...paths, rename: failSecond }), /could not move your section memory aside \(ENOENT\); it is back in/)
  userIsBack(paths)
  assert.ok(!existsSync(paths.backup))
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

test('a round refuses to start while an earlier backup still exists, and changes nothing', t => {
  const paths = sandbox(t)
  backupSectionMemory(paths)
  runWrites(paths, 'section-team-testing', 'written by a run')
  assert.throws(() => backupSectionMemory(paths), /--restore-memory/)
  assert.equal(note(paths.backup, 'section-team-testing'), 'user testing note')
  assert.equal(note(paths.root, 'section-team-testing'), 'written by a run')
})

test('a restore refuses while the round that made the backup is still running, unless forced', t => {
  const paths = sandbox(t)
  backupSectionMemory({ ...paths, pid: 999_999 })
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

test('a user with no section memory gets an empty backup, and the restore leaves no section folder behind', t => {
  const paths = sandbox(t)
  rmSync(join(paths.root, 'section-team-testing'), { recursive: true })
  rmSync(join(paths.root, 'section-team-backend'), { recursive: true })
  assert.deepEqual(backupSectionMemory(paths), [])
  runWrites(paths, 'section-team-testing', 'run note')
  restoreSectionMemory(paths)
  assert.deepEqual(readdirSync(paths.root), ['other-agent'])
})

test('a rerun of the same run files its notes next to the first attempt\'s, not over them', t => {
  const paths = sandbox(t)
  backupSectionMemory(paths)
  const into = join(paths.results, 'h1-team-ho-r1')
  runWrites(paths, 'section-team-testing', 'attempt 1')
  stashRunMemory({ ...paths, into })
  runWrites(paths, 'section-team-testing', 'attempt 2')
  stashRunMemory({ ...paths, into })
  assert.equal(note(join(into, 'section-memory'), 'section-team-testing'), 'attempt 1')
  assert.equal(note(join(into, 'section-memory-2'), 'section-team-testing'), 'attempt 2')
})

test('stashing with no run notes does nothing', t => {
  const paths = sandbox(t)
  backupSectionMemory(paths)
  stashRunMemory({ ...paths, into: join(paths.results, 'h1-team-ho-r1') })
  assert.ok(!existsSync(join(paths.results, 'h1-team-ho-r1')))
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
