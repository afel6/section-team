import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MODE_OPTIONS, modeSummary, savedLine, saveFailedLine, unknownModeLine } from '../hooks/mode-lines.mjs'
import { MODE_LABELS } from '../hooks/lib/mode.mjs'

test('a failed save shows a given reason, else only the error code, never the engine message', () => {
  const pathy = Object.assign(new Error("EPERM: operation not permitted, open 'C:\\proj\\.team\\mode.json'"), { code: 'EPERM' })
  const line = reason => `section-team mode: could not save .team/mode.json: ${reason}`
  assert.equal(saveFailedLine(pathy), line('EPERM'))
  // The engine's refusals carry the code in the message only, after the engine's own prefix.
  assert.equal(saveFailedLine(new Error("section-team: $.fs.write: EPERM: operation not permitted, open 'C:\\proj\\.team\\mode.json'")), line('EPERM'))
  assert.equal(saveFailedLine(new Error("EISDIR: illegal operation on a directory, open 'C:\\proj\\.team\\mode.json'")), line('EISDIR'))
  assert.equal(saveFailedLine(new Error("denied at 'C:\\proj\\.team'")), line('the file system refused it'))
  assert.equal(saveFailedLine(new Error("C:\\EPERM: odd")), line('the file system refused it'))
  assert.equal(saveFailedLine({ code: 'C:\\proj' }), line('the file system refused it'))
  assert.equal(saveFailedLine('.team is not a folder'), line('.team is not a folder'))
  assert.equal(saveFailedLine(undefined), line('the file system refused it'))
})

test('only an unknown mode gets a line, and an odd one is not echoed', () => {
  for (const mode of ['lean', 'balanced', 'max']) assert.equal(unknownModeLine(mode), null)
  assert.equal(unknownModeLine('turbo'), 'unknown mode "turbo": pick lean, balanced or max')
  assert.equal(unknownModeLine('max extra'), 'unknown mode (not shown): pick lean, balanced or max')
  assert.equal(savedLine('max'), 'section-team mode: Max (applies from your next message)')
})

test('the picker offers the three modes in order with their labels, and the summary lists them', () => {
  assert.deepEqual(MODE_OPTIONS, [{ value: 'lean', label: MODE_LABELS.lean }, { value: 'balanced', label: MODE_LABELS.balanced }, { value: 'max', label: MODE_LABELS.max }])
  assert.equal(modeSummary('{"mode":"lean"}').split('\n')[0], 'section-team mode: Lean')
  assert.equal(modeSummary(null).split('\n').length, 5)
})
