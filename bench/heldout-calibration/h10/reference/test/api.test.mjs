import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../server.mjs'
import { loadStore } from '../lib/store.mjs'

// Runs fn(call, file) against an app on a free port with its own data file; call(method, path, body) returns { status, body }.
async function withApp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'polls-test-'))
  const file = join(dir, 'polls.json')
  const server = createApp(file, loadStore(file))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (method, path, body) => {
    const init = body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    const r = await fetch(base + path, init)
    const text = await r.text()
    return { status: r.status, body: text ? JSON.parse(text) : undefined }
  }
  try {
    await fn(call, file)
  } finally {
    await new Promise(resolve => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
}

test('create, vote, close and delete a poll', () => withApp(async call => {
  const made = await call('POST', '/api/polls', { question: 'Lunch?', answers: ['Pizza', 'Sushi'] })
  assert.equal(made.status, 201)
  assert.equal(made.body.id, 1)
  const voted = await call('POST', '/api/polls/1/votes', { voter: 'Ann', answer: 1 })
  assert.deepEqual([voted.status, voted.body.answers.map(a => a.percent)], [201, [0, 100]])
  assert.deepEqual((await call('POST', '/api/polls/1/votes', { voter: 'ann', answer: 0 })).body, { error: 'already voted' })
  assert.equal((await call('POST', '/api/polls/1/close')).body.closed, true)
  assert.deepEqual((await call('POST', '/api/polls/1/votes', { voter: 'Ben', answer: 0 })).body, { error: 'poll is closed' })
  assert.equal((await call('DELETE', '/api/polls/1')).status, 204)
  assert.deepEqual(await call('GET', '/api/polls/1'), { status: 404, body: { error: 'poll not found' } })
}))

test('unknown paths, wrong methods and bad ids', () => withApp(async call => {
  assert.deepEqual(await call('GET', '/api/nope'), { status: 404, body: { error: 'not found' } })
  assert.deepEqual(await call('PUT', '/api/polls/abc'), { status: 405, body: { error: 'method not allowed' } })
  assert.deepEqual(await call('GET', '/api/polls/01'), { status: 404, body: { error: 'poll not found' } })
}))

test('changes are saved: a new app on the same file sees them, and ids are never given twice', () => withApp(async (call, file) => {
  await call('POST', '/api/polls', { question: 'A?', answers: ['x', 'y'] })
  await call('POST', '/api/polls', { question: 'B?', answers: ['x', 'y'] })
  await call('DELETE', '/api/polls/2')
  const store = loadStore(file)
  assert.deepEqual([store.nextId, store.polls.map(p => p.id)], [3, [1]])
}))
