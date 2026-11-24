import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyLook, describeLook, lookFile, parseLook, serializeLook, NOT_VALID_LOOK } from '../hooks/lib/look.mjs'

test('the look file sits beside names.json', () => {
  assert.equal(lookFile('C:/Users/u'), 'C:/Users/u/.claude/section-team/office.json')
})

test('no file, or a good one, reads with no problem', () => {
  assert.deepEqual(parseLook(null), { look: 'night', problem: null })
  assert.deepEqual(parseLook('{"v":1,"look":"yellow"}'), { look: 'yellow', problem: null })
  assert.deepEqual(parseLook('{"v":1,"look":"night"}'), { look: 'night', problem: null })
})

test('a file that is not valid draws night and says so', () => {
  assert.equal(NOT_VALID_LOOK, 'office.json is not valid')
  for (const text of ['{', '', '[]', 'null', '{"v":2,"look":"yellow"}', '{"v":1,"look":"pink"}', '{"v":1,"look":"constructor"}', ' '.repeat(2000)]) {
    assert.deepEqual(parseLook(text), { look: 'night', problem: NOT_VALID_LOOK }, JSON.stringify(text.slice(0, 30)))
  }
})

test('saving writes the one shape the reader takes', () => {
  assert.equal(serializeLook('yellow'), '{"v":1,"look":"yellow"}')
  assert.deepEqual(parseLook(serializeLook('night')), { look: 'night', problem: null })
})

test('the command lines', () => {
  assert.equal(describeLook('night'), 'The office is night. /team office yellow|night changes it.')
  assert.deepEqual(applyLook('night', 'yellow'), { line: 'The office is yellow now.', next: 'yellow' })
  assert.deepEqual(applyLook('night', 'YELLOW'), { line: 'The office is yellow now.', next: 'yellow' })
  assert.deepEqual(applyLook('yellow', 'yellow'), { line: 'The office is already yellow.' })
  assert.deepEqual(applyLook('night', 'pink'), { line: 'No office look called pink. Looks: night, yellow.' })
  assert.equal(applyLook('night', 'x'.repeat(200)).line, `No office look called ${'x'.repeat(24)}. Looks: night, yellow.`)
})
