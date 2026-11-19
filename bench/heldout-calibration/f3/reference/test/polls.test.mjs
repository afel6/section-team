import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../server.mjs'

async function withApp(fn, file) {
  const dir = mkdtempSync(join(tmpdir(), 'polls-test-'))
  const server = createApp(file ?? join(dir, 'polls.json'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) })
    const text = await r.text()
    return { status: r.status, body: text ? JSON.parse(text) : '', allow: r.headers.get('allow') }
  }
  try { await fn(call, dir) } finally {
    await new Promise(resolve => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
}

test('create, vote, retract, close', () => withApp(async call => {
  assert.equal((await call('POST', '/polls', { question: ' Lunch? ', options: ['Pizza', 'Sushi'] })).body.question, 'Lunch?')
  assert.deepEqual((await call('POST', '/polls/1/votes', { voter: 'ann', option: 'Pizza' })).body, { poll: 1, voter: 'ann', option: 'Pizza' })
  assert.deepEqual(await call('POST', '/polls/1/votes', { voter: 'ann', option: 'Sushi' }), { status: 409, body: { error: 'already voted' }, allow: null })
  assert.equal((await call('DELETE', '/polls/1/votes/ann')).status, 204)
  const closed = await call('POST', '/polls/1/close')
  assert.deepEqual([closed.status, closed.body.closed, closed.body.total], [200, true, 0])
  assert.equal((await call('POST', '/polls/1/votes', { voter: 'bo', option: 'Sushi' })).status, 409)
}))

test('validation order and routes', () => withApp(async call => {
  assert.deepEqual((await call('POST', '/polls', { question: '', options: [], x: 1 })).body, { error: 'unknown field x' })
  assert.deepEqual((await call('POST', '/polls', { question: 'Q', options: ['a', 'A'] })).body.error, 'options must be 2 to 10 different strings of 1 to 100 characters')
  assert.deepEqual((await call('POST', '/polls', 'x'.repeat(16385))).status, 413)
  assert.deepEqual(await call('PUT', '/polls'), { status: 405, body: { error: 'method not allowed' }, allow: 'GET, POST' })
  assert.deepEqual((await call('GET', '/polls/01')).body, { error: 'poll not found' })
  assert.deepEqual((await call('GET', '/polls?status=all')).status, 400)
}))

test('the 100-vote limit', () => withApp(async call => {
  await call('POST', '/polls', { question: 'Q', options: ['a', 'b'] })
  await Promise.all(Array.from({ length: 100 }, (_, i) => call('POST', '/polls/1/votes', { voter: `v${i}`, option: 'a' })))
  assert.deepEqual((await call('POST', '/polls/1/votes', { voter: 'x', option: 'a' })).body, { error: 'poll is full' })
}))

test('a failed save changes nothing', () => withApp(async call => {
  assert.deepEqual(await call('POST', '/polls', { question: 'Q', options: ['a', 'b'] }), { status: 500, body: { error: 'cannot save' }, allow: null })
  assert.deepEqual((await call('GET', '/polls')).body, { polls: [] })
}, join(tmpdir(), 'no-such-folder-polls-test', 'polls.json')))
