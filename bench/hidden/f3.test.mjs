// Hidden tests for held-out task f3: the poll service (node server.mjs, PORT and DATA_FILE). Each test starts its own server
// on a fresh data file and talks to it over HTTP only; replies are compared on status, body and the headers the spec names.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'

const TARGET = process.env.TARGET_DIR
if (!TARGET) throw new Error('TARGET_DIR is not set')
const JSON_TYPE = 'application/json; charset=utf-8'
const MAX_BODY = 16384
const Q = 'question must be a string of 1 to 200 characters'
const O = 'options must be 2 to 10 different strings of 1 to 100 characters'
const V = 'voter must be 1 to 32 characters of a-z, 0-9 and _'
const env0 = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'))

const freePort = () => new Promise((resolve, reject) => {
  const s = createServer().once('error', reject).listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
})

let root
let count = 0
before(() => { root = mkdtempSync(join(tmpdir(), 'f3-')) })
after(() => { if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })
const newFile = () => join(root, `data${++count}.json`)

// Starts node server.mjs; resolves { child, base, out } once it prints "listening on", or { exited: code, err } if it exits first.
function spawnServer(file, port) {
  const child = spawn(process.execPath, [join(TARGET, 'server.mjs')], { cwd: TARGET, env: { ...env0, PORT: String(port), DATA_FILE: file }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  return new Promise((resolve, reject) => {
    let [out, err] = ['', '']
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`server did not print "listening on" within 8 s. stdout: ${out} stderr: ${err}`)) }, 8000)
    child.stderr.setEncoding('utf8').on('data', d => { err += d })
    child.stdout.setEncoding('utf8').on('data', d => { out += d; if (/listening on/.test(out)) { clearTimeout(timer); resolve({ child, out, base: `http://127.0.0.1:${port}` }) } })
    child.once('error', e => { clearTimeout(timer); reject(e) })
    child.once('exit', code => { clearTimeout(timer); resolve({ exited: code, out, get err() { return err } }) })
  })
}
async function start(file = newFile()) {
  const s = await spawnServer(file, await freePort())
  if (s.exited !== undefined) throw new Error(`server exited (${s.exited}): ${s.err}`)
  return { ...s, file }
}
async function stop(s) {
  if (s.child.exitCode !== null || s.child.signalCode !== null) return
  const exited = once(s.child, 'exit')
  s.child.kill('SIGKILL')
  await exited
}
async function withServer(fn, file) {
  const s = await start(file)
  try { return await fn(s) } finally { await stop(s) }
}

// body: undefined (none), a string or Buffer (sent as is) or a value (sent as JSON). Returns { status, body, type, allow }.
async function call(s, method, path, body) {
  const init = { method, signal: AbortSignal.timeout(10000) }
  if (body !== undefined) init.body = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)
  const r = await fetch(s.base + path, init)
  const text = await r.text()
  let parsed
  try { parsed = text === '' ? '' : JSON.parse(text) } catch { parsed = `not JSON: ${text.slice(0, 200)}` }
  return { status: r.status, body: parsed, type: r.headers.get('content-type'), allow: r.headers.get('allow') }
}
const reply = async (...a) => { const r = await call(...a); return { status: r.status, body: r.body } }
const err = (status, error) => ({ status, body: { error } })
async function okBody(s, method, path, body, status) {
  const r = await call(s, method, path, body)
  assert.equal(r.status, status, `${method} ${path}: ${JSON.stringify(r.body)}`)
  return r.body
}
const create = (s, question = 'Lunch?', options = ['Pizza', 'Sushi']) => okBody(s, 'POST', '/polls', { question, options }, 201)
const voteOk = (s, id, voter, option) => okBody(s, 'POST', `/polls/${id}/votes`, { voter, option }, 201)
const poll = (id, question, options, votes = options.map(() => 0), closed = false) =>
  ({ id, question, options, closed, results: options.map((option, i) => ({ option, votes: votes[i] })), total: votes.reduce((a, b) => a + b, 0) })
const summary = (id, question, closed, total) => ({ id, question, closed, total })
async function expectAll(s, cases) {
  for (const [method, path, body, want] of cases) assert.deepEqual(await reply(s, method, path, body), want, `${method} ${path} ${typeof body === 'string' ? body.slice(0, 60) : JSON.stringify(body)?.slice(0, 60)}`)
}

// --- Creating and reading polls ---
test('POST /polls creates poll 1 with JSON content type; GET /polls/1 shows it', () => withServer(async s => {
  const r = await call(s, 'POST', '/polls', { question: 'Lunch?', options: ['Pizza', 'Sushi', 'Tacos'] })
  assert.deepEqual([r.status, r.body, r.type], [201, poll(1, 'Lunch?', ['Pizza', 'Sushi', 'Tacos']), JSON_TYPE])
  const g = await call(s, 'GET', '/polls/1')
  assert.deepEqual([g.status, g.body, g.type], [200, poll(1, 'Lunch?', ['Pizza', 'Sushi', 'Tacos']), JSON_TYPE])
  const e = await call(s, 'GET', '/polls/2')
  assert.deepEqual([e.status, e.body, e.type], [404, { error: 'poll not found' }, JSON_TYPE])
}))
test('question and options are trimmed; length limits are counted after trimming', () => withServer(async s => {
  assert.deepEqual(await create(s, '  \t Where? \n', [' a ', '\tB\t']), poll(1, 'Where?', ['a', 'B']))
  const long = 'q'.repeat(200)
  const ten = Array.from({ length: 10 }, (_, i) => `${i}`.padEnd(100, 'x'))
  assert.deepEqual(await create(s, `  ${long}  `, [...ten.slice(0, 9).map(o => ` ${o} `), ten[9]]), poll(2, long, ten))
  assert.deepEqual(await create(s, 'x', ['é', ' e']).then(p => p.options), ['é', 'e'])
}))
test('question rule: a string of 1 to 200 characters after trim', () => withServer(async s => {
  const bodies = [{ options: ['a', 'b'] }, { question: null, options: ['a', 'b'] }, { question: '', options: ['a', 'b'] }, { question: ' \t\n ', options: ['a', 'b'] },
    { question: 'q'.repeat(201), options: ['a', 'b'] }, { question: 5, options: ['a', 'b'] }, { question: ['Lunch?'], options: ['a', 'b'] }, { question: { a: 1 }, options: ['a', 'b'] },
    { question: '', options: 'bad' }]
  await expectAll(s, bodies.map(b => ['POST', '/polls', b, err(400, Q)]))
  assert.deepEqual(await reply(s, 'GET', '/polls'), { status: 200, body: { polls: [] } })
}))
test('options rule: 2 to 10 strings of 1 to 100 characters, different after trim and lower case', () => withServer(async s => {
  const bad = [undefined, null, 'a,b', ['a'], [], Array.from({ length: 11 }, (_, i) => `o${i}`), ['a', 5], ['a', null], ['a', ['b']], ['a', ' '], ['a', ''],
    ['a', 'b'.repeat(101)], ['a', 'A'], ['Yes', ' yes '], ['a', 'b', 'a'], ['é', ' É'], { 0: 'a', 1: 'b' }]
  await expectAll(s, bad.map(options => ['POST', '/polls', options === undefined ? { question: 'Q' } : { question: 'Q', options }, err(400, O)]))
  assert.deepEqual(await create(s, 'Q', ['a', 'b'.repeat(100)]), poll(1, 'Q', ['a', 'b'.repeat(100)]))
}))
test('poll body: unknown field first (Object.keys order), then question, then options', () => withServer(async s => {
  await expectAll(s, [
    ['POST', '/polls', { question: 'Q', options: ['a', 'b'], zeta: 1, alpha: 2 }, err(400, 'unknown field zeta')],
    ['POST', '/polls', '{"b": 1, "2": 1, "question": "Q", "options": ["a", "b"]}', err(400, 'unknown field 2')],
    ['POST', '/polls', { question: '', options: [], Question: 'Q' }, err(400, 'unknown field Question')],
    ['POST', '/polls', { question: 'Q', options: ['a', 'b'], closed: true }, err(400, 'unknown field closed')],
    ['POST', '/polls', { question: 'Q', options: ['a', 'b'], id: 7 }, err(400, 'unknown field id')],
    ['POST', '/polls', { options: [], question: '' }, err(400, Q)],
    ['POST', '/polls', {}, err(400, Q)]])
}))
test('body checks: 413 over 16384 bytes, then invalid JSON, then not an object', () => withServer(async s => {
  const json = JSON.stringify({ question: 'Q', options: ['a', 'b'] })
  const padded = size => json + ' '.repeat(size - Buffer.byteLength(json))
  const notObject = err(400, 'body must be a JSON object')
  await expectAll(s, [
    ['POST', '/polls', padded(MAX_BODY + 1), err(413, 'body too large')], ['POST', '/polls', '{'.repeat(MAX_BODY + 1), err(413, 'body too large')],
    ['POST', '/polls', 'x'.repeat(200_000), err(413, 'body too large')], ['POST', '/polls', '', err(400, 'invalid JSON')], ['POST', '/polls', '{', err(400, 'invalid JSON')],
    ['POST', '/polls', "{'question': 'Q'}", err(400, 'invalid JSON')], ['POST', '/polls', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(json)]), err(400, 'invalid JSON')],
    ['POST', '/polls', Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]), err(400, 'invalid JSON')],
    ['POST', '/polls', Buffer.concat([Buffer.from('{"question": "'), Buffer.from([0xc3, 0x28]), Buffer.from('", "options": ["a", "b"]}')]), err(400, 'invalid JSON')],
    ['POST', '/polls', 'null', notObject], ['POST', '/polls', '[]', notObject], ['POST', '/polls', '"Q"', notObject], ['POST', '/polls', '12', notObject],
    ['POST', '/polls', 'true', notObject], ['POST', '/polls', ' {} ', err(400, Q)]])
  assert.deepEqual(await reply(s, 'POST', '/polls', padded(MAX_BODY)), { status: 201, body: poll(1, 'Q', ['a', 'b']) })
  await expectAll(s, [['POST', '/polls/1/votes', 'x'.repeat(MAX_BODY + 1), err(413, 'body too large')], ['POST', '/polls/1/votes', '[1]', notObject],
    ['POST', '/polls/1/votes', '', err(400, 'invalid JSON')]])
}))

// --- Routes ---
test('unknown paths get 404 not found, before any body check', () => withServer(async s => {
  await create(s)
  const paths = ['/', '/poll', '/polls/', '/polls//close', '/polls/1/votes/', '/polls/1/vote', '/Polls', '/polls/1/close/x', '/polls/1/votes/ann/x', '//polls', '/polls/1/', '/api/polls']
  await expectAll(s, paths.flatMap(p => [['GET', p, undefined, err(404, 'not found')], ['POST', p, 'x'.repeat(MAX_BODY + 1), err(404, 'not found')]]))
}))
test('a known path with another method gets 405 method not allowed and an Allow header, before the body', async () => withServer(async s => {
  const cases = [['PUT', '/polls', 'GET, POST'], ['DELETE', '/polls', 'GET, POST'], ['PATCH', '/polls', 'GET, POST'], ['POST', '/polls/1', 'GET'], ['DELETE', '/polls/9', 'GET'],
    ['GET', '/polls/1/votes', 'POST'], ['DELETE', '/polls/abc/votes', 'POST'], ['GET', '/polls/1/votes/ann', 'DELETE'], ['POST', '/polls/1/votes/ann', 'DELETE'],
    ['GET', '/polls/1/close', 'POST'], ['PUT', '/polls/x/close', 'POST']]
  for (const [method, path, allow] of cases) {
    const r = await call(s, method, path, method === 'GET' ? undefined : 'x'.repeat(MAX_BODY + 1))
    assert.deepEqual([r.status, r.body, r.allow], [405, { error: 'method not allowed' }, allow], `${method} ${path}`)
  }
}))
test(':id must be an existing id in plain decimal, else 404 poll not found', () => withServer(async s => {
  await create(s)
  await create(s, 'Two?')
  const ids = ['01', '+1', '1.0', '1e0', 'abc', '0', '-1', '3', '%31', ' 1', '99999999999999999999', '0x1']
  await expectAll(s, ids.flatMap(id => [['GET', `/polls/${id}`, undefined, err(404, 'poll not found')],
    ['POST', `/polls/${id}/votes`, { voter: 'ann', option: 'Pizza' }, err(404, 'poll not found')], ['POST', `/polls/${id}/close`, undefined, err(404, 'poll not found')],
    ['DELETE', `/polls/${id}/votes/ann`, undefined, err(404, 'poll not found')]]))
  assert.deepEqual((await reply(s, 'GET', '/polls/2?x=1')).body.question, 'Two?')
}))

// --- Listing ---
test('GET /polls lists summaries by id; status=open or closed filters; other values are 400', () => withServer(async s => {
  await create(s, 'A?')
  await create(s, 'B?')
  await create(s, 'C?')
  await voteOk(s, 2, 'ann', 'Pizza')
  await voteOk(s, 2, 'bo', 'Sushi')
  await okBody(s, 'POST', '/polls/2/close', undefined, 200)
  const all = [summary(1, 'A?', false, 0), summary(2, 'B?', true, 2), summary(3, 'C?', false, 0)]
  await expectAll(s, [['GET', '/polls', undefined, { status: 200, body: { polls: all } }], ['GET', '/polls?status=open', undefined, { status: 200, body: { polls: [all[0], all[2]] } }],
    ['GET', '/polls?status=closed', undefined, { status: 200, body: { polls: [all[1]] } }], ['GET', '/polls?status=closed&status=bogus', undefined, { status: 200, body: { polls: [all[1]] } }],
    ['GET', '/polls?other=1&status=open', undefined, { status: 200, body: { polls: [all[0], all[2]] } }], ['GET', '/polls?sort=desc', undefined, { status: 200, body: { polls: all } }],
    ...['', 'OPEN', 'all', 'open ', 'opened', '1'].map(v => ['GET', `/polls?status=${encodeURIComponent(v)}`, undefined, err(400, 'status must be open or closed')]),
    ['GET', '/polls?status', undefined, err(400, 'status must be open or closed')]])
}))
test('GET /polls on an empty service and the content type of lists', () => withServer(async s => {
  const r = await call(s, 'GET', '/polls')
  assert.deepEqual([r.status, r.body, r.type], [200, { polls: [] }, JSON_TYPE])
  assert.deepEqual(await reply(s, 'GET', '/polls?status=closed'), { status: 200, body: { polls: [] } })
}))

// --- Votes ---
test('a vote is 201 {poll, voter, option}; results and total follow', () => withServer(async s => {
  await create(s, 'Lunch?', ['Pizza', 'Sushi', 'Tacos'])
  const r = await call(s, 'POST', '/polls/1/votes', { voter: 'ann', option: 'Sushi' })
  assert.deepEqual([r.status, r.body, r.type], [201, { poll: 1, voter: 'ann', option: 'Sushi' }, JSON_TYPE])
  await voteOk(s, 1, 'bo_2', 'Sushi')
  await voteOk(s, 1, 'z'.repeat(32), 'Tacos')
  await voteOk(s, 1, '0', 'Pizza')
  assert.deepEqual(await reply(s, 'GET', '/polls/1'), { status: 200, body: poll(1, 'Lunch?', ['Pizza', 'Sushi', 'Tacos'], [1, 2, 1]) })
}))
test('vote body: unknown field, then voter rule, then option must be a string', () => withServer(async s => {
  await create(s)
  const badVoters = [undefined, null, '', 'a'.repeat(33), 'Ann', 'ann-b', 'ann b', ' ann', 'ann\n', 'é', 5, ['ann'], { v: 'ann' }]
  await expectAll(s, [
    ['POST', '/polls/1/votes', { voter: 'ann', option: 'Pizza', poll: 1 }, err(400, 'unknown field poll')],
    ['POST', '/polls/1/votes', { voter: 'Bad Voter', Option: 'x' }, err(400, 'unknown field Option')],
    ...badVoters.map(voter => ['POST', '/polls/1/votes', voter === undefined ? { option: 5 } : { voter, option: 5 }, err(400, V)]),
    ...[undefined, null, 1, ['Pizza'], { o: 'Pizza' }, true].map(option => ['POST', '/polls/1/votes', option === undefined ? { voter: 'ann' } : { voter: 'ann', option }, err(400, 'option must be a string')]),
    ['POST', '/polls/9/votes', { voter: 'Ann', option: 'Pizza' }, err(400, V)], ['POST', '/polls/9/votes', { voter: 'ann', option: null }, err(400, 'option must be a string')],
    ['POST', '/polls/9/votes', { voter: 'ann', option: 'Nope' }, err(404, 'poll not found')]])
  assert.deepEqual((await reply(s, 'GET', '/polls/1')).body.total, 0)
}))
test('option must equal a stored option exactly: no trimming, letter case matters', () => withServer(async s => {
  await create(s, 'Q', [' Pizza ', 'Sushi'])
  await expectAll(s, ['pizza', ' Pizza ', 'Pizza ', 'PIZZA', '', 'Sushi\n', 'Tacos'].map(option => ['POST', '/polls/1/votes', { voter: 'ann', option }, err(400, 'unknown option')]))
  assert.deepEqual(await voteOk(s, 1, 'ann', 'Pizza'), { poll: 1, voter: 'ann', option: 'Pizza' })
}))
test('one vote per voter per poll: 409 already voted; other polls are independent', () => withServer(async s => {
  await create(s)
  await create(s, 'Dinner?')
  await voteOk(s, 1, 'ann', 'Pizza')
  await expectAll(s, [['POST', '/polls/1/votes', { voter: 'ann', option: 'Sushi' }, err(409, 'already voted')], ['POST', '/polls/1/votes', { voter: 'ann', option: 'Pizza' }, err(409, 'already voted')],
    ['POST', '/polls/1/votes', { voter: 'ann', option: 'Tacos' }, err(400, 'unknown option')]])
  assert.deepEqual(await voteOk(s, 2, 'ann', 'Sushi'), { poll: 2, voter: 'ann', option: 'Sushi' })
  assert.deepEqual(await reply(s, 'GET', '/polls/1'), { status: 200, body: poll(1, 'Lunch?', ['Pizza', 'Sushi'], [1, 0]) })
}))
test('a poll holds at most 100 votes: 409 poll is full, after already voted; a retracted vote frees a place', () => withServer(async s => {
  await create(s)
  for (let i = 0; i < 100; i++) await voteOk(s, 1, `v${i}`, i % 3 ? 'Pizza' : 'Sushi')
  await expectAll(s, [['POST', '/polls/1/votes', { voter: 'late', option: 'Pizza' }, err(409, 'poll is full')], ['POST', '/polls/1/votes', { voter: 'v5', option: 'Pizza' }, err(409, 'already voted')],
    ['POST', '/polls/1/votes', { voter: 'late', option: 'Tacos' }, err(400, 'unknown option')], ['DELETE', '/polls/1/votes/v0', undefined, { status: 204, body: '' }],
    ['POST', '/polls/1/votes', { voter: 'late', option: 'Pizza' }, { status: 201, body: { poll: 1, voter: 'late', option: 'Pizza' } }],
    ['POST', '/polls/1/votes', { voter: 'v0', option: 'Pizza' }, err(409, 'poll is full')]])
  assert.deepEqual((await reply(s, 'GET', '/polls/1')).body.results, [{ option: 'Pizza', votes: 67 }, { option: 'Sushi', votes: 33 }])
}))

// --- Taking a vote back ---
test('DELETE takes the vote back: 204 with no body; then 404 vote not found', () => withServer(async s => {
  await create(s)
  await voteOk(s, 1, 'ann', 'Pizza')
  await voteOk(s, 1, 'bo', 'Pizza')
  const r = await call(s, 'DELETE', '/polls/1/votes/ann', 'ignored body {')
  assert.deepEqual([r.status, r.body], [204, ''])
  await expectAll(s, [['DELETE', '/polls/1/votes/ann', undefined, err(404, 'vote not found')], ['DELETE', '/polls/1/votes/BO', undefined, err(404, 'vote not found')],
    ['DELETE', '/polls/1/votes/%62o', undefined, err(404, 'vote not found')], ['DELETE', '/polls/1/votes/nobody', undefined, err(404, 'vote not found')],
    ['GET', '/polls/1', undefined, { status: 200, body: poll(1, 'Lunch?', ['Pizza', 'Sushi'], [1, 0]) }],
    ['POST', '/polls/1/votes', { voter: 'ann', option: 'Sushi' }, { status: 201, body: { poll: 1, voter: 'ann', option: 'Sushi' } }],
    ['GET', '/polls/1', undefined, { status: 200, body: poll(1, 'Lunch?', ['Pizza', 'Sushi'], [1, 1]) }]])
}))

// --- Closing ---
test('close: 200 the closed poll; a closed poll refuses votes, retractions and a second close with 409 poll closed', () => withServer(async s => {
  await create(s)
  await voteOk(s, 1, 'ann', 'Sushi')
  const closed = poll(1, 'Lunch?', ['Pizza', 'Sushi'], [0, 1], true)
  const r = await call(s, 'POST', '/polls/1/close', '{not json')
  assert.deepEqual([r.status, r.body, r.type], [200, closed, JSON_TYPE])
  await expectAll(s, [['POST', '/polls/1/close', undefined, err(409, 'poll closed')], ['POST', '/polls/1/votes', { voter: 'bo', option: 'Pizza' }, err(409, 'poll closed')],
    ['POST', '/polls/1/votes', { voter: 'ann', option: 'Pizza' }, err(409, 'poll closed')], ['POST', '/polls/1/votes', { voter: 'bo', option: 'pizza' }, err(400, 'unknown option')],
    ['DELETE', '/polls/1/votes/ann', undefined, err(409, 'poll closed')], ['DELETE', '/polls/1/votes/nobody', undefined, err(409, 'poll closed')],
    ['GET', '/polls/1', undefined, { status: 200, body: closed }]])
}))

// --- Data file ---
test('every change survives a killed server; ids continue after a restart', async () => {
  const file = newFile()
  await withServer(async s => {
    await create(s, 'A?')
    await create(s, 'B?', ['x', 'y', 'z'])
    await voteOk(s, 2, 'ann', 'z')
    await voteOk(s, 2, 'bo', 'x')
    await voteOk(s, 2, 'cy', 'z')
    assert.equal((await reply(s, 'DELETE', '/polls/2/votes/bo')).status, 204)
    assert.equal((await reply(s, 'POST', '/polls/1/close')).status, 200)
  }, file)
  await withServer(async s => {
    await expectAll(s, [['GET', '/polls', undefined, { status: 200, body: { polls: [summary(1, 'A?', true, 0), summary(2, 'B?', false, 2)] } }],
      ['GET', '/polls/2', undefined, { status: 200, body: poll(2, 'B?', ['x', 'y', 'z'], [0, 0, 2]) }],
      ['POST', '/polls/2/votes', { voter: 'ann', option: 'x' }, err(409, 'already voted')], ['DELETE', '/polls/2/votes/bo', undefined, err(404, 'vote not found')]])
    assert.deepEqual(await create(s, 'C?'), poll(3, 'C?', ['Pizza', 'Sushi']))
  }, file)
  await withServer(async s => assert.deepEqual((await reply(s, 'GET', '/polls/3')).body.id, 3), file)
})
test('a data file that cannot be loaded: cannot load <DATA_FILE> on stderr, exit 1', async () => {
  const dir = join(root, 'loads')
  mkdirSync(dir)
  const cases = [['empty.json', ''], ['broken.json', '{ broken'], ['text.json', 'hello']]
  for (const [name, text] of cases) writeFileSync(join(dir, name), text)
  mkdirSync(join(dir, 'folder.json'))
  for (const name of [...cases.map(c => c[0]), 'folder.json']) {
    const file = join(dir, name)
    const s = await spawnServer(file, await freePort())
    if (s.exited === undefined) { await stop(s); assert.fail(`${name}: the server started`) }
    assert.deepEqual([s.exited, s.err, s.out], [1, `cannot load ${file}\n`, ''], name)
  }
})
test('a missing data file is an empty service; PORT=0 prints the port in use', async () => {
  const file = newFile()
  const s = await spawnServer(file, 0)
  try {
    assert.equal(s.exited, undefined, `server exited: ${s.exited}`)
    const m = /^listening on http:\/\/127\.0\.0\.1:(\d+)\n/.exec(s.out)
    assert.ok(m && Number(m[1]) > 0, `bad first line: ${JSON.stringify(s.out)}`)
    const r = await reply({ base: `http://127.0.0.1:${m[1]}` }, 'GET', '/polls')
    assert.deepEqual(r, { status: 200, body: { polls: [] } })
  } finally { await stop(s) }
})
test('when the data file cannot be written: 500 cannot save, and the change is not made', () => withServer(async s => {
  await expectAll(s, [['POST', '/polls', { question: 'Q', options: ['a', 'b'] }, err(500, 'cannot save')], ['GET', '/polls', undefined, { status: 200, body: { polls: [] } }],
    ['GET', '/polls/1', undefined, err(404, 'poll not found')], ['POST', '/polls', { question: 'Q', options: ['a'] }, err(400, O)],
    ['POST', '/polls', { question: 'Q', options: ['a', 'b'] }, err(500, 'cannot save')]])
}, join(root, 'no-such-folder', 'data.json')))

// --- Requests at the same time ---
test('concurrent votes by 60 voters are all counted', () => withServer(async s => {
  await create(s)
  const replies = await Promise.all(Array.from({ length: 60 }, (_, i) => reply(s, 'POST', '/polls/1/votes', { voter: `v${i}`, option: i < 25 ? 'Pizza' : 'Sushi' })))
  assert.deepEqual(replies.map(r => r.status), Array(60).fill(201))
  assert.deepEqual((await reply(s, 'GET', '/polls/1')).body, poll(1, 'Lunch?', ['Pizza', 'Sushi'], [25, 35]))
}))
test('concurrent votes by one voter: exactly one 201, the rest 409 already voted', () => withServer(async s => {
  await create(s)
  const replies = await Promise.all(Array.from({ length: 12 }, (_, i) => reply(s, 'POST', '/polls/1/votes', { voter: 'ann', option: i % 2 ? 'Pizza' : 'Sushi' })))
  const wins = replies.filter(r => r.status === 201)
  assert.equal(wins.length, 1)
  assert.deepEqual(replies.filter(r => r.status !== 201), Array(11).fill(err(409, 'already voted')))
  assert.equal((await reply(s, 'GET', '/polls/1')).body.total, 1)
}))
test('concurrent votes past the limit: exactly 100 counted, the rest 409 poll is full', () => withServer(async s => {
  await create(s)
  const replies = await Promise.all(Array.from({ length: 115 }, (_, i) => reply(s, 'POST', '/polls/1/votes', { voter: `v${i}`, option: 'Pizza' })))
  assert.equal(replies.filter(r => r.status === 201).length, 100)
  assert.deepEqual(replies.filter(r => r.status !== 201), Array(15).fill(err(409, 'poll is full')))
  assert.equal((await reply(s, 'GET', '/polls/1')).body.total, 100)
}))
test('concurrent poll creations get ids 1 to 25, each once, and all of them are saved', async () => {
  const file = newFile()
  await withServer(async s => {
    const replies = await Promise.all(Array.from({ length: 25 }, (_, i) => reply(s, 'POST', '/polls', { question: `Q${i}`, options: ['a', 'b'] })))
    assert.deepEqual(replies.map(r => r.status), Array(25).fill(201))
    assert.deepEqual(replies.map(r => r.body.id).sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i + 1))
    for (const r of replies) assert.deepEqual(r.body, poll(r.body.id, r.body.question, ['a', 'b']))
  }, file)
  await withServer(async s => {
    const { polls } = (await reply(s, 'GET', '/polls')).body
    assert.deepEqual(polls.map(p => p.id), Array.from({ length: 25 }, (_, i) => i + 1))
    assert.deepEqual(new Set(polls.map(p => p.question)), new Set(Array.from({ length: 25 }, (_, i) => `Q${i}`)))
  }, file)
})
test('concurrent mixed changes: a close racing votes leaves results that match the replies', () => withServer(async s => {
  await create(s)
  const votes = Array.from({ length: 30 }, (_, i) => reply(s, 'POST', '/polls/1/votes', { voter: `v${i}`, option: 'Sushi' }))
  const closing = reply(s, 'POST', '/polls/1/close')
  const replies = await Promise.all(votes)
  const close = await closing
  assert.equal(close.status, 200)
  const accepted = replies.filter(r => r.status === 201).length
  assert.deepEqual(replies.filter(r => r.status !== 201), Array(30 - accepted).fill(err(409, 'poll closed')))
  assert.equal(close.body.total, accepted)
  assert.deepEqual((await reply(s, 'GET', '/polls/1')).body, poll(1, 'Lunch?', ['Pizza', 'Sushi'], [0, accepted], true))
}))

// --- Deliverables ---
test('the solution has a package.json (type module, a test script), a README listing the routes, and node:test tests', () => {
  const pkg = JSON.parse(readFileSync(join(TARGET, 'package.json'), 'utf8'))
  assert.equal(pkg.type, 'module')
  assert.ok(typeof pkg.scripts?.test === 'string' && pkg.scripts.test.trim() !== '', 'no test script')
  const readme = readdirSync(TARGET).find(f => /^readme(\.[a-z]+)?$/i.test(f))
  assert.ok(readme, 'no README file')
  const text = readFileSync(join(TARGET, readme), 'utf8')
  for (const route of ['POST /polls', 'GET /polls', 'GET /polls/:id', 'POST /polls/:id/votes', 'DELETE /polls/:id/votes/:voter', 'POST /polls/:id/close']) assert.ok(text.includes(route), `README lacks ${route}`)
  const sources = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.isDirectory()) return ['node_modules', '.git'].includes(e.name) ? [] : sources(join(dir, e.name))
    return /\.[cm]?js$/.test(e.name) ? [join(dir, e.name)] : []
  })
  assert.ok(sources(TARGET).some(f => /['"]node:test['"]/.test(readFileSync(f, 'utf8'))), 'no source file imports node:test')
})
