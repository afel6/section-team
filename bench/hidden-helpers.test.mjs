// The helpers of the h7 hidden sets, where a mistake shows only when a real run fails or two runs overlap.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expect, freePort, listenOn, portFree, same, tookPort } from './hidden/h7/lib.mjs'

test('a failing table row names itself and shows what differed, with or without a message', () => {
  const failsWith = (...msg) => err => {
    assert.equal(err.code, 'ERR_ASSERTION')
    assert.deepEqual([err.actual, err.expected], [{ label: 'row-A', a: 1 }, { label: 'row-A', a: 2 }])
    if (msg.length) assert.match(err.message, /why/)
    return true
  }
  assert.throws(() => same('row-A', { a: 1 }, { a: 2 }), failsWith())
  assert.throws(() => same('row-A', { a: 1 }, { a: 2 }, 'why'), failsWith('why'))
  assert.doesNotThrow(() => same('row-A', { a: 1 }, { a: 1 }))
})

test('a failing expect row names itself', async () => {
  const reply = Promise.resolve({ status: 200, type: 'text/plain', text: '{}' })
  await assert.rejects(expect('row-C', reply, 201, {}), err => err.code === 'ERR_ASSERTION' && err.actual.label === 'row-C')
})

test('exit 1 counts as a taken port only when a probe found it taken, before the server started or after it exited', async t => {
  const blocker = await listenOn(0)
  t.after(() => new Promise(resolve => blocker.close(resolve)))
  const busy = blocker.address().port
  const free = await freePort()
  assert.equal(await portFree(busy), false)
  assert.equal(await portFree(free), true)
  assert.equal(await tookPort({ code: 1 }, false, free), true, 'taken at the first probe')
  assert.equal(await tookPort({ code: 1 }, true, busy), true, 'lost the race: free at the first probe, taken at the second')
  assert.equal(await tookPort({ code: 1 }, true, free), false, 'free both times: a real failure')
  assert.equal(await tookPort({ code: 'still running' }, false, busy), false, 'the server did not exit')
})
