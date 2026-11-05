import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STAGES, hiddenSetsOf, isStaged, stageCopyOf, stageCountOf, stagePromptFile } from './stages.mjs'

test('stage counts: 1 unless registered', () => {
  assert.deepEqual(STAGES, { h7: 2, p1: 3 })
  assert.equal(stageCountOf('h7'), 2)
  assert.equal(stageCountOf('p1'), 3)
  assert.equal(stageCountOf('h4'), 1)
  assert.equal(stageCountOf('toString'), 1)
  assert.ok(isStaged('p1') && isStaged('h7') && !isStaged('h4'))
})

test('stage prompt files', () => {
  assert.equal(stagePromptFile('p1', 1), 'tasks/p1.md')
  assert.equal(stagePromptFile('p1', 3), 'tasks/p1-s3.md')
  assert.equal(stagePromptFile('h7', 2), 'tasks/h7-s2.md')
})

test('hidden sets and the folder each runs on', () => {
  assert.deepEqual(hiddenSetsOf('h7'), [{ set: 's1', from: 's1' }, { set: 's2', from: 'final' }, { set: 'reg', from: 'final' }])
  assert.deepEqual(hiddenSetsOf('p1'), [
    { set: 's1', from: 's1' }, { set: 's2', from: 's2' }, { set: 's3', from: 'final' },
    { set: 'reg2', from: 's2' }, { set: 'reg3', from: 'final' }])
  assert.deepEqual(hiddenSetsOf('h4'), [])
})

test('stage copy folder', () => {
  assert.equal(stageCopyOf('/x/run', 2), '/x/run-s2')
})
