// Hidden tests for task h10 (quick polls: server.mjs, a JSON API, one data file and a page). Servers run from TARGET_DIR and are
// driven through node:http, so paths such as /api/./polls arrive byte for byte; app.js runs in a vm against a DOM stand-in.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { request } from 'node:http'
import { once } from 'node:events'
import vm from 'node:vm'

const TARGET = process.env.TARGET_DIR, JSON_TYPE = 'application/json; charset=utf-8', NO_REPLY = 'Could not reach the server.', FAILED_REQ = 'Request failed.'
const E = { type: 'content type must be application/json', big: 'body too large', obj: 'body must be a JSON object', q: 'question must be 1 to 200 characters', list: 'answers must be a list of 2 to 6 items',
  each: 'each answer must be 1 to 80 characters', diff: 'answers must be different', voter: 'voter must be 1 to 40 characters', ans: 'answer must be the number of an answer, counting from 0',
  closed: 'poll is closed', dup: 'already voted', nf: 'not found', pnf: 'poll not found', mna: 'method not allowed', ise: 'internal error' }
const ROOT = mkdtempSync(join(tmpdir(), 'h10-')), running = new Set(), err = error => ({ error }), sleep = ms => new Promise(r => setTimeout(r, ms)), fresh = () => mkdtempSync(join(ROOT, 'c-')), U = String.fromCodePoint
const RM = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }
after(async () => { for (const s of running) await stopServer(s); rmSync(ROOT, RM) })
const it = (name, fn) => test(name, { timeout: 60_000 }, fn) // a hung test fails alone instead of running the whole file into the scorer's limit
const tryJson = text => { try { return JSON.parse(text) } catch { return `not JSON: ${String(text).slice(0, 200)}` } }, same = (label, got, want, msg) => assert.deepEqual({ label, ...got }, { label, ...want }, ...(msg === undefined ? [] : [msg]))

// --- Server processes and raw HTTP (helper listeners are unref'd: a failed assertion that skips close() cannot hold the process open) ---
const listenOn = port => new Promise((ok, no) => { const s = createServer().once('error', no); s.listen(port, '127.0.0.1', () => ok(s.unref())) })
const freePort = async () => { const s = await listenOn(0); const { port } = s.address(); await new Promise(r => s.close(r)); return port }, LINE = port => `listening on http://127.0.0.1:${port}\n`
// Spawns server.mjs; resolves once stdout holds a full line (one ending in "\n"), the process has closed, or 5 s have passed.
function boot(env, cwd = TARGET) {
  if (!TARGET) throw new Error('TARGET_DIR is not set')
  const full = Object.fromEntries([...Object.entries(process.env).filter(([k]) => !['PORT', 'DATA_FILE', 'NODE_TEST_CONTEXT'].includes(k)), ...Object.entries(env).filter(([, v]) => v !== undefined)])
  const s = { child: spawn(process.execPath, [join(TARGET, 'server.mjs')], { cwd, env: full, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }), out: '', err: '' }
  running.add(s); s.child.stdout.on('data', d => { s.out += d }); s.child.stderr.on('data', d => { s.err += d }); s.child.on('error', e => { s.err += `spawn error: ${e.message}` })
  return new Promise(done => {
    const finish = () => { clearTimeout(timer); s.child.stdout.off('data', check); done(s) }, check = () => { if (s.out.includes('\n')) finish() }, timer = setTimeout(finish, 5000)
    s.child.stdout.on('data', check); s.child.once('close', finish).once('error', finish); check()
  })
}
async function stopServer(s) {
  running.delete(s); if (s.child.pid === undefined || s.child.exitCode !== null || s.child.signalCode !== null) return
  const exited = once(s.child, 'exit', { signal: AbortSignal.timeout(5000) }).catch(() => {})
  s.child.kill('SIGKILL'); await exited // not taskkill: in a stripped environment (env -i) it can take seconds per call; the server has no child processes
}
async function startServer({ file = join(fresh(), 'data.json'), cwd, env = {} } = {}) {
  const port = await freePort(), s = await boot({ PORT: String(port), DATA_FILE: file, ...env }, cwd)
  if (s.child.exitCode === null && /listening on/i.test(s.out)) return Object.assign(s, { port })
  await stopServer(s); throw new Error(`server did not start: stdout ${JSON.stringify(s.out.slice(0, 300))} stderr ${JSON.stringify(s.err.slice(0, 800))}`)
}
let sharedP
const shared = () => (sharedP ??= startServer()), withServer = async (opts, fn) => { const s = await startServer(opts); try { return await fn(s) } finally { await stopServer(s) } }
const runToExit = async (env, cwd) => { const s = await boot({ PORT: String(await freePort()), ...env }, cwd), code = s.child.exitCode ?? 'still running'; await stopServer(s); return { code, out: s.out, err: s.err } }
// "one line of its choice": any non-empty stderr line will do; "cannot read data file <name>\n" must be a whole line of stderr (other lines are free).
const failed = r => ({ code: r.code, out: r.out, stderrLine: /[^\r\n]/.test(r.err) }), FAILED = { code: 1, out: '', stderrLine: true }, hasLine = (text, line) => `\n${text}`.includes(`\n${line}\n`)
const READ_FAIL = name => ({ code: 1, out: '', err: `cannot read data file ${name}` }), readFail = (r, name, { err } = READ_FAIL(name)) => ({ code: r.code, out: r.out, err: hasLine(r.err, err) ? err : r.err })
// body: object → JSON (type application/json unless `type` says otherwise; null: none), string/Buffer → raw. parts: writes `gap` ms apart; early: replied before the last.
function req(s, method, path, { body, parts, type, length, gap = 50 } = {}) {
  const chunks = parts ?? (body === undefined ? [] : [typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)])
  const headers = { ...(type !== null && (type !== undefined || chunks.length > 0) && { 'content-type': type ?? 'application/json' }), ...(length && { 'content-length': String(length) }) }
  let sent = false
  return new Promise((ok, no) => {
    const r = request({ host: '127.0.0.1', port: s.port, method, path, headers, agent: false }, res => {
      const early = !sent, got = []
      res.on('data', d => got.push(d)).on('error', no).on('end', () => ok({ status: res.statusCode, type: res.headers['content-type'], text: Buffer.concat(got).toString('utf8'), early }))
    })
    r.setTimeout(10000, () => r.destroy(new Error(`${method} ${path}: no reply within 10 s`))).on('error', no)
    ;(async () => { for (const c of chunks.slice(0, -1)) { r.write(c); await sleep(gap) } sent = true; r.end(chunks.at(-1)) })()
  })
}
const view = r => ({ status: r.status, type: r.type, body: tryJson(r.text) }), reply = (status, body) => ({ status, type: JSON_TYPE, body })
const expect = async (label, pending, status, body) => same(label, view(await pending), reply(status, body))
const get = (s, path) => req(s, 'GET', path), del = (s, id) => req(s, 'DELETE', `/api/polls/${id}`), post = (s, path, body, opts = {}) => req(s, 'POST', path, { body, ...opts })
const A = (text, votes = 0, percent = 0) => ({ text, votes, percent }), P = (id, question, answers, closed = false) => ({ id, question, closed, total: answers.reduce((n, a) => n + a.votes, 0), answers })
const newPoll = (id, question, texts) => P(id, question, texts.map(t => A(t)))
async function create(s, question = 'Lunch?', answers = ['Pizza', 'Sushi']) {
  const r = await post(s, '/api/polls', { question, answers }); assert.equal(r.status, 201, `POST /api/polls ${JSON.stringify({ question, answers })}: ${r.status} ${r.text.slice(0, 200)}`); return JSON.parse(r.text)
}
const vote = (s, id, voter, answer, opts = {}) => post(s, `/api/polls/${id}/votes`, { voter, answer }, opts)
async function voted(s, id, voter, answer) { const r = await vote(s, id, voter, answer); assert.equal(r.status, 201, `vote ${voter} ${answer}: ${r.status} ${r.text.slice(0, 200)}`); return JSON.parse(r.text) }
// Casts counts[i] votes for answer i, by fresh voters; returns the last reply.
async function castVotes(s, id, counts) { let last; for (const [i, n] of counts.entries()) for (let k = 0; k < n; k++) last = await voted(s, id, `v${i}-${k}`, i); return last }
const list = async s => { const r = await get(s, '/api/polls'); assert.equal(r.status, 200, r.text.slice(0, 200)); return JSON.parse(r.text).polls }
const pollOf = async (s, id) => { const r = await get(s, `/api/polls/${id}`); assert.equal(r.status, 200, r.text.slice(0, 200)); return JSON.parse(r.text) }

// --- Startup and the data file ---
it('the listening line: PORT=0 prints the port the OS picked, leading zeros are dropped, an unset or empty PORT is 3000 (when taken: exit 1)', async () => {
  const want = await freePort()
  for (const PORT of ['0', `00${want}`]) {
    const s = await boot({ PORT, DATA_FILE: join(fresh(), 'd.json') }), port = PORT === '0' ? Number(/^listening on http:\/\/127\.0\.0\.1:([1-9]\d*)\n$/.exec(s.out)?.[1]) : want
    const polls = port ? view(await get({ port }, '/api/polls')) : null; await stopServer(s)
    same(PORT, { out: s.out, polls }, { out: LINE(port), polls: reply(200, { polls: [] }) }, `stderr: ${s.err.slice(0, 300)}`)
  }
  for (const PORT of [undefined, '']) {
    const free = await listenOn(3000).then(b => new Promise(r => b.close(() => r(true))), () => false), r = await runToExit({ PORT, DATA_FILE: join(fresh(), 'd.json') })
    if (free) same(PORT, { out: r.out }, { out: LINE(3000) }); else same(PORT, failed(r), FAILED)
  }
})
it('a bad PORT (not only ASCII digits, above 65535) or a port in use: exit 1 with one stderr line; a bad data file wins over a port in use', async () => {
  const dir = fresh(), DATA_FILE = join(dir, 'd.json'), blocker = await listenOn(0), busy = String(blocker.address().port)
  for (const PORT of ['abc', '-1', '+3000', ' 3000', '3000 ', '30.5', '1e3', '0x1F', '3000a', U(0xff13, 0xff10, 0xff10, 0xff10), '65536', '99999', '99999999999999999999', busy]) same(PORT, failed(await runToExit({ PORT, DATA_FILE })), FAILED)
  const r = await runToExit({ PORT: busy, DATA_FILE: dir }); blocker.close()
  same('busy port, data file is a directory', { ...failed(r), dataLine: hasLine(r.err, READ_FAIL(dir).err) }, { ...FAILED, dataLine: true })
})
it('a data file that is a directory, empty, not valid JSON, or valid JSON that no poll layout holds: "cannot read data file <DATA_FILE as given>", exit 1, file untouched', async () => {
  const cwd = fresh(); mkdirSync(join(cwd, 'data', 'folder.json'), { recursive: true })
  for (const [name, content] of [['data/folder.json'], ['data/empty.json', ''], ['data/broken.json', '{"polls": ['], ['data/text.json', 'hello'], ['data/null.json', 'null'], ['data/num.json', '42'], ['data/str.json', '"x"'],
    ['data/true.json', 'true'], [join(cwd, 'abs.json'), '']]) {
    if (content !== undefined) writeFileSync(resolve(cwd, name), content)
    same(name, { ...readFail(await runToExit({ DATA_FILE: name }, cwd), name), content: content === undefined ? undefined : readFileSync(resolve(cwd, name), 'utf8') }, { ...READ_FAIL(name), content })
  }
})
it('DATA_FILE: unset or empty is polls.json in the working directory (not next to server.mjs); a relative one resolves against it', async () => {
  const blocked = fresh(), cwd = fresh(), beside = join(TARGET, 'polls.json'), existed = existsSync(beside)
  mkdirSync(join(blocked, 'polls.json')); mkdirSync(join(cwd, 'store'))
  for (const DATA_FILE of [undefined, '']) same(DATA_FILE, readFail(await runToExit({ DATA_FILE }, blocked), 'polls.json'), READ_FAIL('polls.json'))
  const a = await withServer({ cwd, env: { DATA_FILE: undefined } }, s => create(s, 'A?')), b = await withServer({ cwd, file: 'store/b.json' }, s => create(s, 'B?'))
  if (!existed && existsSync(beside)) { rmSync(beside, RM); assert.fail('polls.json was written next to server.mjs') }
  assert.deepEqual([existsSync(join(cwd, 'polls.json')), existsSync(join(cwd, 'store', 'b.json'))], [true, true], 'the files are written under the working directory')
  await withServer({ cwd, env: { DATA_FILE: '' } }, async s => assert.deepEqual(await list(s), [a])); await withServer({ file: join(cwd, 'store', 'b.json') }, async s => assert.deepEqual(await list(s), [b]))
})
it('a missing data file or folder means no polls; a failed save is 500 internal error and changes nothing, the next id and the votes included', async () => {
  const dir = join(fresh(), 'sub')
  await withServer({ file: join(dir, 'd.json') }, async s => {
    assert.deepEqual(await list(s), []); await expect('POST, no folder', post(s, '/api/polls', { question: 'Q', answers: ['a', 'b'] }), 500, err(E.ise)); assert.equal(existsSync(dir), false, 'no folder is created')
    mkdirSync(dir); const p = await create(s, 'Q'); rmSync(dir, RM)
    await expect('vote, folder removed', vote(s, p.id, 'Ann', 0), 500, err(E.ise)); await expect('close, folder removed', post(s, `/api/polls/${p.id}/close`), 500, err(E.ise))
    await expect('DELETE, folder removed', del(s, p.id), 500, err(E.ise)); await expect('POST, folder removed', post(s, '/api/polls', { question: 'R', answers: ['a', 'b'] }), 500, err(E.ise))
    assert.deepEqual(await list(s), [p], 'the server keeps running, unchanged'); mkdirSync(dir)
    assert.deepEqual(await voted(s, p.id, 'Ann', 0), P(1, 'Q', [A('Pizza', 1, 100), A('Sushi')]), 'the failed vote was not counted'); assert.equal((await create(s, 'R')).id, 2)
  })
})
it('only a change writes the data file: reads, refused requests and closing a closed poll do not; edits made from outside are not noticed', async () => {
  const file = join(fresh(), 'd.json')
  await withServer({ file }, async s => {
    for (const [m, p, o] of [['GET', '/api/polls'], ['GET', '/'], ['GET', '/app.js'], ['POST', '/api/polls', { body: { question: '', answers: [] } }], ['POST', '/api/polls', { body: { question: 'Q', answers: ['a', 'b'] }, type: 'text/plain' }],
      ['GET', '/api/polls/1'], ['DELETE', '/api/polls/1'], ['POST', '/api/polls/1/close'], ['PUT', '/api/polls']]) await req(s, m, p, o)
    assert.equal(existsSync(file), false, 'no write at startup or for requests that change nothing')
    const p = await create(s, 'Q', ['a', 'b']); assert.ok(existsSync(file), 'creating a poll writes the file'); await voted(s, p.id, 'Ann', 1); await post(s, `/api/polls/${p.id}/close`)
    writeFileSync(file, 'outside edit')
    for (const [m, path, o] of [['GET', `/api/polls/${p.id}`], ['POST', `/api/polls/${p.id}/close`], ['POST', `/api/polls/${p.id}/votes`, { body: { voter: 'Ben', answer: 0 } }], ['POST', `/api/polls/${p.id}/votes`, { body: { voter: 'ann', answer: 0 } }],
      ['POST', `/api/polls/${p.id}/votes`, { body: { voter: '', answer: 0 } }], ['DELETE', '/api/polls/2'], ['GET', '/api/polls']]) await req(s, m, path, o)
    assert.deepEqual({ list: await list(s), file: readFileSync(file, 'utf8') }, { list: [P(1, 'Q', [A('a'), A('b', 1, 100)], true)], file: 'outside edit' }, 'memory is the truth; refused requests and a repeated close do not write')
    assert.equal((await del(s, p.id)).status, 204); assert.notEqual(readFileSync(file, 'utf8'), 'outside edit', 'a DELETE that removes writes the file')
  })
})
it('polls, votes, who voted and the next id survive a restart; ids are never given twice, also after deleting the newest poll', async () => {
  const file = join(fresh(), 'd.json')
  const kept = await withServer({ file }, async s => {
    const made = [await create(s, 'One?'), await create(s, 'Two?', ['x', 'y', 'z']), await create(s, 'Three?')]
    assert.deepEqual(made.map(p => p.id), [1, 2, 3], 'the first poll gets id 1, each new one the next integer')
    await voted(s, 2, 'Ann', 2); await voted(s, 2, 'Ben', 0); await post(s, '/api/polls/2/close')
    for (const id of [3, 1]) assert.equal((await del(s, id)).status, 204)
    return pollOf(s, 2)
  })
  assert.deepEqual(kept, P(2, 'Two?', [A('x', 1, 50), A('y'), A('z', 1, 50)], true))
  await withServer({ file }, async s => {
    assert.deepEqual(await list(s), [kept]); const four = await create(s, 'Four?'); assert.equal(four.id, 4)
    await voted(s, 4, 'Ann', 0); assert.equal((await del(s, 4)).status, 204)
  })
  await withServer({ file }, async s => { const five = await create(s, 'Five?'); assert.equal(five.id, 5); await expect('voters per poll', vote(s, 5, 'ann', 1), 201, P(5, 'Five?', [A('Pizza'), A('Sushi', 1, 100)])) })
  await withServer({ file }, async s => { await expect('who voted survives a restart', vote(s, 5, ' ANN ', 0), 409, err(E.dup)); await expect('closed survives', vote(s, 2, 'Cy', 0), 409, err(E.closed)) })
})
it('requests at once: of votes by one voter sent together exactly one counts; polls created together get distinct ids that survive a restart', async () => {
  const file = join(fresh(), 'd.json')
  const saved = await withServer({ file }, async s => {
    const p = await create(s, 'Race?', ['a', 'b', 'c'])
    const rs = await Promise.all(['Ann', 'ann', ' ANN ', 'Ann', 'aNN', 'Ann ', 'ANN', 'ann'].map((voter, i) => vote(s, p.id, voter, i % 3)))
    const won = rs.filter(r => r.status === 201)
    assert.deepEqual({ won: won.length, others: rs.filter(r => r !== won[0]).map(view) }, { won: 1, others: Array(7).fill(reply(409, err(E.dup))) })
    assert.equal((await pollOf(s, p.id)).total, 1)
    const more = await Promise.all(Array.from({ length: 12 }, (_, i) => post(s, '/api/polls', { question: `Q${i}`, answers: ['a', 'b'] })))
    assert.deepEqual(more.map(r => [r.status, tryJson(r.text).id]).sort((x, y) => x[1] - y[1]), Array.from({ length: 12 }, (_, i) => [201, i + 2]))
    return list(s)
  })
  await withServer({ file }, async s => { assert.deepEqual(await list(s), saved); assert.equal((await create(s)).id, 14) })
})

// --- Routes ---
const unread = (path, type, status, message) => [['POST', path, { body: 'x'.repeat(1 << 20), type }, status, err(message)], ['POST', path, { parts: ['x'.repeat(11000), 'x'.repeat(1000)], type, length: 12000, gap: 400 }, status, err(message)]]
const SINGLE = {
  'paths are compared byte for byte: other spellings are 404 not found, whatever the method': [...['/api/%70olls', '/api/./polls', '/API/polls', '/api/Polls', '/api/polls/', '//api/polls', '/api/polls//votes', '/api/polls/1/',
    '/api/polls/1/votes/', '/api/polls/1/Votes', '/api/polls/1/vote', '/api/polls/1/close/x', '/api/polls/1/x', '/api', '/api/', '/index.html', '/app.js/', '/App.js', '/%61pp.js', '/api/polls%3Fx', '/api/polls/1/../2'].flatMap(p => ['GET', 'POST', 'DELETE', 'PUT'].map(m => [m, p, {}, 404, err(E.nf)])),
    ['HEAD', '/nope', {}, 404], ['HEAD', '/api/polls/', {}, 404]],
  'a known path with a method not listed for it is 405 method not allowed, HEAD and OPTIONS included, and wins over poll not found': [...['PUT /api/polls', 'DELETE /api/polls', 'PATCH /api/polls', 'OPTIONS /api/polls', 'POST /api/polls/1',
    'PUT /api/polls/1', 'PATCH /api/polls/1', 'PUT /api/polls/abc', 'GET /api/polls/1/votes', 'DELETE /api/polls/1/votes', 'GET /api/polls/abc/votes', 'GET /api/polls/1/close', 'PUT /api/polls/0/close', 'POST /', 'DELETE /', 'PUT /app.js',
    'POST /app.js?x=1', 'DELETE /api/polls?x'].map(mp => [...mp.split(' '), {}, 405, err(E.mna)]), ...['/api/polls', '/', '/app.js', '/api/polls/1', '/api/polls/1/votes', '/api/polls/1/close'].map(p => ['HEAD', p, {}, 405])],
  'the whole body is read before any reply, so 415, 413, 405, 404 and poll-not-found replies to large or slow bodies reach the client, never early': [...unread('/api/polls', 'text/plain', 415, E.type), ...unread('/api/polls', undefined, 413, E.big),
    ...unread('/api/polls/1', undefined, 405, E.mna), ...unread('/nope', undefined, 404, E.nf), ...unread('/api/polls/9999/votes', undefined, 404, E.pnf)],
  'rule 2: the media type must be application/json (letter case and spaces or tabs around it ignored), else 415': [...[null, '', 'text/plain', 'application/jsonx', 'application/json-patch+json', 'text/json', 'json', 'application/json, text/plain',
    'application /json'].map(type => ['POST', '/api/polls', { body: { question: 'Q', answers: ['a', 'b'] }, type }, 415, err(E.type)]), ...['application/json', 'Application/JSON', 'APPLICATION/JSON;', 'application/json; charset=utf-8',
    '\tapplication/json\t; charset=utf-8', 'application/json ; x=y'].map(type => ['POST', '/api/polls', { body: { question: `Type ${type}`, answers: ['a', 'b'] }, type }, 201, { question: `Type ${type}`.trim() }])],
  'rule 4: a body that is not a JSON object (a leading BOM included) is 400 body must be a JSON object': [...['', ' ', 'null', '[]', '[{"question":"Q"}]', '"x"', '42', 'true', '{', '{"question":"Q",}', "{'question':'Q'}", 'NaN'],
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify({ question: 'Q', answers: ['a', 'b'] }))])].map(body => ['POST', '/api/polls', { body }, 400, err(E.obj)]),
  [`rule 5: ${E.q} (UTF-16 code units, after trimming)`]: [undefined, null, 5, ['Q'], '', '   ', '\t\n\r', U(0xa0, 0x2003, 0xfeff), 'x'.repeat(201), ` ${'y'.repeat(201)} `, U(0x1f600).repeat(101)]
    .map(question => ['POST', '/api/polls', { body: { question, answers: ['a', 'b'] } }, 400, err(E.q)]),
  [`rule 6: ${E.list}`]: [undefined, null, 'a\nb', 5, { 0: 'a', 1: 'b', length: 2 }, [], ['only'], ['a', 'b', 'c', 'd', 'e', 'f', 'g']].map(answers => ['POST', '/api/polls', { body: { question: 'Q', answers } }, 400, err(E.list)]),
  [`rule 7: ${E.each}`]: [['a', 5], ['a', null], ['a', ''], ['a', '   '], ['x'.repeat(81), 'b'], ['a', ['b']], [{ text: 'a' }, 'b'], ['a', 'b', ` ${'z'.repeat(81)}`], ['a', 'a', 7]]
    .map(answers => ['POST', '/api/polls', { body: { question: 'Q', answers } }, 400, err(E.each)]),
  [`rule 8: ${E.diff} (after trimming, letter case ignored)`]: [['Pizza', 'pizza'], ['Pizza', ' Pizza '], ['A', 'B', 'a'], ['Äb', 'äB'], ['x', 'y', 'z', 'X\t']].map(answers => ['POST', '/api/polls', { body: { question: 'Q', answers } }, 400, err(E.diff)]),
}
for (const [name, cases] of Object.entries(SINGLE)) it(name, async () => {
  const s = await shared()
  if ((await list(s)).length === 0) await create(s, 'Seed?') // poll 1 exists, so /api/polls/1 paths name a real poll
  for (const [method, path, opts, status, body] of cases) {
    const r = await req(s, method, path, opts), label = `${method} ${path} ${JSON.stringify(opts.body ?? opts.parts?.length ?? '').slice(0, 120)} ${opts.type ?? ''}`
    if (method === 'HEAD') same(label, { status: r.status }, { status })
    else if (status === 201) { const v = view(r); same(label, { status: v.status, type: v.type, question: v.body?.question }, { status: 201, type: JSON_TYPE, question: body.question }) }
    else same(label, { ...view(r), early: r.early }, { ...reply(status, body), early: false })
  }
})
it('<id>: anything but a positive integer without a leading zero, or an id no poll has, is 404 poll not found on every poll route; the query is ignored', () => withServer({}, async s => {
  const p = await create(s, 'Q?')
  for (const id of ['0', '01', '001', '1.0', '1e0', '+1', '-1', '0x1', '%31', '1%2Fvotes', 'abc', '2', '99999999999999999999', ' 1']) {
    const enc = id.replace(' ', '%20')
    for (const [label, pending] of [['GET', get(s, `/api/polls/${enc}`)], ['vote', vote(s, enc, 'Ann', 0)], ['close', post(s, `/api/polls/${enc}/close`)], ['DELETE', del(s, enc)]]) await expect(`${label} ${id}`, pending, 404, err(E.pnf))
  }
  await expect('GET with a query', get(s, '/api/polls/1?x=1'), 200, p); await expect('list with a query', get(s, '/api/polls?x=1&y'), 200, { polls: [p] })
  const r = await del(s, '1?confirm=1'); assert.deepEqual({ status: r.status, text: r.text, left: await list(s) }, { status: 204, text: '', left: [] })
}))
it('rule 3: 10000 body bytes pass, 10001 are 413 (counted as received, chunked too); the body is decoded as UTF-8', async () => {
  const s = await shared()
  for (const chunked of [false, true]) {
    const b = { question: `Size ${chunked}`, answers: ['a', 'b'] }, send = n => { const t = JSON.stringify(b).padEnd(n, ' '); return post(s, '/api/polls', undefined, chunked ? { parts: [t.slice(0, 5000), t.slice(5000)] } : { body: t }) }
    await expect({ chunked, bytes: 10001 }, send(10001), 413, err(E.big)); assert.equal((await send(10000)).status, 201, `chunked ${chunked}, 10000 bytes`)
  }
  const q = `Caf${U(0xe9)} ${U(0x2615)} ok?`, bytes = Buffer.from(JSON.stringify({ question: q, answers: ['a', 'b'] })), at = bytes.indexOf(Buffer.from(U(0x2615))) + 1
  const r = await post(s, '/api/polls', undefined, { parts: [bytes.subarray(0, at), bytes.subarray(at)] }); assert.equal(tryJson(r.text).question, q, 'a character split across two writes')
})
it('POST /api/polls: 201 with exactly id, question, closed, total and answers, trimmed, other keys ignored; the first failing rule decides', () => withServer({}, async s => {
  await expect('created', post(s, '/api/polls', { question: '  Lunch?  ', answers: [' Pizza', 'Sushi ', '\tTacos\n'], id: 42, closed: true, total: 9, extra: 'x' }), 201, newPoll(1, 'Lunch?', ['Pizza', 'Sushi', 'Tacos']))
  await expect('edge sizes', post(s, '/api/polls', { question: 'q'.repeat(200), answers: ['a'.repeat(80), 'b', 'c', 'd', 'e', U(0x1f600).repeat(40)] }), 201, newPoll(2, 'q'.repeat(200), ['a'.repeat(80), 'b', 'c', 'd', 'e', U(0x1f600).repeat(40)]))
  await expect('not duplicates', post(s, '/api/polls', { question: 'Q', answers: ['Pizza', 'Pizzas', 'a b', 'ab'] }), 201, newPoll(3, 'Q', ['Pizza', 'Pizzas', 'a b', 'ab']))
  const big = '['.repeat(10001)
  for (const [label, body, opts, status, message] of [['415 before 413', big, { type: 'text/plain' }, 415, E.type], ['415 with no type', big, { type: null }, 415, E.type], ['413 before 400', big, {}, 413, E.big],
    ['question first', { question: '', answers: 'x' }, {}, 400, E.q], ['list next', { question: 'Q', answers: ['a'] }, {}, 400, E.list], ['each before different', { question: 'Q', answers: ['a', 'a', 5] }, {}, 400, E.each],
    ['different last', { question: 'Q', answers: ['a', 'b', 'A'] }, {}, 400, E.diff]]) await expect(label, post(s, '/api/polls', body, opts), status, err(message))
  assert.deepEqual((await list(s)).map(p => p.id), [3, 2, 1], 'refused polls take no id')
}))

// --- Votes ---
it('POST /api/polls/<id>/votes: 201 with the poll after the vote; GET shows the same; other keys ignored', () => withServer({}, async s => {
  const p = await create(s, 'Lunch?', ['Pizza', 'Sushi', 'Tacos'])
  await expect('Ann', vote(s, p.id, 'Ann', 0), 201, P(1, 'Lunch?', [A('Pizza', 1, 100), A('Sushi'), A('Tacos')]))
  await expect('Ben', post(s, '/api/polls/1/votes', { voter: ' Ben ', answer: 2, extra: true, total: 7 }), 201, P(1, 'Lunch?', [A('Pizza', 1, 50), A('Sushi'), A('Tacos', 1, 50)]))
  await expect('GET', get(s, '/api/polls/1'), 200, P(1, 'Lunch?', [A('Pizza', 1, 50), A('Sushi'), A('Tacos', 1, 50)]))
  await expect('1.0 and -0 are integers', post(s, '/api/polls/1/votes', '{"voter":"Cy","answer":1.0}'), 201, P(1, 'Lunch?', [A('Pizza', 1, 34), A('Sushi', 1, 33), A('Tacos', 1, 33)]))
  await expect('-0', post(s, '/api/polls/1/votes', '{"voter":"Dee","answer":-0}'), 201, P(1, 'Lunch?', [A('Pizza', 2, 50), A('Sushi', 1, 25), A('Tacos', 1, 25)]))
  await expect('long names', vote(s, 1, 'x'.repeat(40), 1), 201, P(1, 'Lunch?', [A('Pizza', 2, 40), A('Sushi', 2, 40), A('Tacos', 1, 20)]))
}))
it('vote rules in order: unknown poll (404) before the content type (415), the size (413) and the JSON object (400); voter before answer', () => withServer({}, async s => {
  const p = await create(s), big = '['.repeat(10001)
  for (const [label, path, body, opts, status, message] of [['404 before 415', '/api/polls/2/votes', { voter: 'Ann', answer: 0 }, { type: 'text/plain' }, 404, E.pnf], ['404 before 413', '/api/polls/2/votes', big, {}, 404, E.pnf],
    ['415', `/api/polls/${p.id}/votes`, { voter: 'Ann', answer: 0 }, { type: 'text/plain' }, 415, E.type], ['415 before 413', `/api/polls/${p.id}/votes`, big, { type: null }, 415, E.type], ['413', `/api/polls/${p.id}/votes`, big, {}, 413, E.big],
    ['400 not an object', `/api/polls/${p.id}/votes`, '[]', {}, 400, E.obj], ['voter before answer', `/api/polls/${p.id}/votes`, { voter: '', answer: 'x' }, {}, 400, E.voter]]) await expect(label, post(s, path, body, opts), status, err(message))
  assert.equal((await pollOf(s, p.id)).total, 0)
}))
it(`vote rule 5: ${E.voter} (UTF-16 code units, after trimming)`, () => withServer({}, async s => {
  const p = await create(s)
  for (const voter of [undefined, null, 5, ['Ann'], '', '   ', '\t\n', U(0xa0, 0x3000), 'x'.repeat(41), ` ${'y'.repeat(41)} `, U(0x1f600).repeat(21)]) await expect(JSON.stringify(voter), vote(s, p.id, voter, 0), 400, err(E.voter))
  await expect('20 emoji', vote(s, p.id, U(0x1f600).repeat(20), 1), 201, P(1, 'Lunch?', [A('Pizza'), A('Sushi', 1, 100)]))
}))
it(`vote rule 6: ${E.ans}`, () => withServer({}, async s => {
  const p = await create(s, 'Q', ['a', 'b', 'c'])
  for (const answer of [undefined, null, '0', '1', -1, 3, 4, 0.5, 2.0001, true, false, [0], { i: 0 }, 1e21]) await expect(JSON.stringify(answer), vote(s, p.id, 'Ann', answer), 400, err(E.ans))
  await expect('2 is the last', vote(s, p.id, 'Ann', 2), 201, P(1, 'Q', [A('a'), A('b'), A('c', 1, 100)]))
}))
it('vote rules 7 and 8: a closed poll is 409 poll is closed (before already voted); a second vote by the same name, trimmed and in any letter case, is 409 already voted', () => withServer({}, async s => {
  const p = await create(s), q = await create(s, 'Other?', ['x', 'y'])
  await voted(s, p.id, 'Ann', 0)
  for (const voter of ['Ann', 'ann', ' ANN ', 'Ann\t', '\naNn']) await expect(JSON.stringify(voter), vote(s, p.id, voter, 1), 409, err(E.dup))
  await expect('Anne is someone else', vote(s, p.id, 'Anne', 1), 201, P(1, 'Lunch?', [A('Pizza', 1, 50), A('Sushi', 1, 50)]))
  await expect('the same name on another poll', vote(s, q.id, 'ANN', 1), 201, P(2, 'Other?', [A('x'), A('y', 1, 100)]))
  await expect('close', post(s, `/api/polls/${p.id}/close`), 200, P(1, 'Lunch?', [A('Pizza', 1, 50), A('Sushi', 1, 50)], true))
  await expect('closed, new voter', vote(s, p.id, 'Ben', 0), 409, err(E.closed)); await expect('closed wins over already voted', vote(s, p.id, 'ann', 0), 409, err(E.closed))
  await expect('field rules come before closed', vote(s, p.id, '', 0), 400, err(E.voter)); await expect('answer rule before closed', vote(s, p.id, 'Ben', 9), 400, err(E.ans))
}))

// --- Percentages ---
it('percentages: 0 everywhere with no votes; otherwise whole numbers that add up to 100, the missing points going to the largest remainders, ties to the earlier answer', () => withServer({}, async s => {
  await expect('no votes', get(s, `/api/polls/${(await create(s, 'None?', ['a', 'b', 'c'])).id}`), 200, newPoll(1, 'None?', ['a', 'b', 'c']))
  const cases = [[[1, 1, 1], [34, 33, 33]], [[2, 1], [67, 33]], [[1, 2], [33, 67]], [[1, 1, 1, 1, 1, 1], [17, 17, 17, 17, 16, 16]], [[3, 3, 1], [43, 43, 14]], [[1, 0], [100, 0]], [[0, 5, 0], [0, 100, 0]],
    [[1, 1, 0, 1], [34, 33, 0, 33]], [[2, 2, 3], [29, 28, 43]], [[0, 0, 1, 1, 1, 0], [0, 0, 34, 33, 33, 0]], [[5, 3, 1, 1, 1], [46, 27, 9, 9, 9]], [[1, 2, 2], [20, 40, 40]], [[0, 1, 1, 1], [0, 34, 33, 33]], [[2, 1, 2, 1], [33, 17, 33, 17]]]
  for (const [counts, percents] of cases) {
    const texts = counts.map((_, i) => `a${i}`), p = await create(s, `Votes ${counts.join(' ')}`, texts), last = await castVotes(s, p.id, counts)
    same(counts.join(' '), { answers: last.answers, total: last.total }, { answers: texts.map((t, i) => A(t, counts[i], percents[i])), total: counts.reduce((a, b) => a + b, 0) })
  }
}))

// --- Close, delete and the list ---
it('close: 200 and the poll, closed, votes kept; closing again is 200 and the same; GET and the list show it closed', () => withServer({}, async s => {
  const p = await create(s); await voted(s, p.id, 'Ann', 1)
  const closed = P(1, 'Lunch?', [A('Pizza'), A('Sushi', 1, 100)], true)
  await expect('close', post(s, '/api/polls/1/close', { ignored: true }), 200, closed); await expect('again', post(s, '/api/polls/1/close'), 200, closed)
  await expect('GET', get(s, '/api/polls/1'), 200, closed); assert.deepEqual(await list(s), [closed])
}))
it('DELETE: 204 with an empty body, then the poll is gone everywhere; GET /api/polls lists every poll, newest first', () => withServer({}, async s => {
  const a = await create(s, 'A?'), b = await create(s, 'B?', ['x', 'y', 'z']), c = await create(s, 'C?')
  await voted(s, b.id, 'Ann', 2)
  assert.deepEqual(await list(s), [c, P(2, 'B?', [A('x'), A('y'), A('z', 1, 100)]), a])
  const r = await del(s, 2); assert.deepEqual({ status: r.status, text: r.text }, { status: 204, text: '' })
  await expect('again', del(s, 2), 404, err(E.pnf)); await expect('GET', get(s, '/api/polls/2'), 404, err(E.pnf)); await expect('vote', vote(s, 2, 'Ben', 0), 404, err(E.pnf))
  assert.deepEqual(await list(s), [c, a]); assert.equal((await create(s)).id, 4)
}))

// --- Page: a tolerant HTML parser and a DOM stand-in offering only the listed browser APIs (any other member throws) ---
let assetsP
const assets = () => (assetsP ??= (async () => { const s = await shared(); return { html: (await get(s, '/')).text, js: (await get(s, '/app.js')).text } })())
const VOID = new Set('area base br col embed hr img input link meta source track wbr'.split(' ')), CLOSES_P = new Set('address article aside blockquote div dl fieldset footer form h1 h2 h3 h4 h5 h6 header hr main nav ol p pre table ul'.split(' '))
const elem = (tag, attrs = {}) => ({ tag, attrs, kids: [], parent: null, on: {} }), textNode = text => ({ tag: '#text', text }), isEl = n => n.tag !== '#text'
const put = (parent, n) => { if (n.parent) n.parent.kids = n.parent.kids.filter(k => k !== n); n.parent = parent; parent.kids.push(n) }
const textOf = n => (isEl(n) ? n.kids.map(textOf).join('') : n.text), norm = n => textOf(n).replace(/[\t\n\f\r ]+/g, ' ').trim()
const all = n => n.kids.filter(isEl).flatMap(k => [k, ...all(k)]), byId = (root, id) => all(root).find(n => n.attrs.id === id), isDisabled = n => n.disabled ?? 'disabled' in n.attrs
const within = (n, outer) => { for (let p = n?.parent; p; p = p.parent) if (p === outer) return true; return false }
function parseHtml(html) {
  const root = elem('#document'), re = /<!--[\s\S]*?(?:-->|$)|<[!?][^>]*>|<\/([a-z][^\s/>]*)[^>]*>|<([a-z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</gi
  let cur = root; const close = tag => { for (let n = cur; n !== root; n = n.parent) if (n.tag === tag) { cur = n.parent; return } }
  for (let m; (m = re.exec(html));) {
    if (m[1]) close(m[1].toLowerCase())
    else if (!m[2]) { if (m[0][0] !== '<' || m[0] === '<') put(cur, textNode(m[0])) }
    else {
      const tag = m[2].toLowerCase(), attrs = {}, n = elem(tag, attrs)
      for (const [, k, ...v] of m[3].matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) if (!Object.hasOwn(attrs, k.toLowerCase())) attrs[k.toLowerCase()] = v.find(x => x !== undefined) ?? ''
      if (CLOSES_P.has(tag)) close('p')
      put(cur, n)
      if (['script', 'style', 'title', 'textarea'].includes(tag)) {
        const end = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex), stop = end < 0 ? html.length : end, gt = html.indexOf('>', stop)
        if (stop > re.lastIndex) put(n, textNode(html.slice(re.lastIndex, stop)))
        re.lastIndex = gt < 0 ? html.length : gt + 1
      } else if (!VOID.has(tag)) cur = n
    }
  }
  return root
}
const realOf = new WeakMap()
const strict = (obj, name, refuse = k => { throw new Error(`app.js used ${name}.${String(k)}, which is not among the browser APIs the task allows`) }) =>
  new Proxy(obj, { get: (t, k) => (typeof k === 'symbol' || k === 'then' || k in t ? t[k] : refuse(k)), set: (t, k, v) => (k in t ? ((t[k] = v), true) : refuse(k)) })
const valueIn = n => n.value ?? n.attrs.value ?? (n.tag === 'textarea' ? textOf(n) : '')
function api(n) {
  const adopt = xs => xs.forEach(x => put(n, realOf.get(x) ?? textNode(String(x))))
  n.api ??= strict({
    get textContent() { return textOf(n) }, set textContent(v) { n.kids = []; if (v != null && v !== '') put(n, textNode(String(v))) },
    get value() { return valueIn(n) }, set value(v) { n.value = String(v) },
    get type() { return n.attrs.type ?? { button: 'submit', input: 'text' }[n.tag] ?? '' }, set type(v) { n.attrs.type = String(v) },
    get disabled() { return isDisabled(n) }, set disabled(v) { n.disabled = Boolean(v) },
    append: (...xs) => adopt(xs), replaceChildren: (...xs) => { n.kids = []; adopt(xs) }, addEventListener: (type, fn) => { (n.on[type] ??= []).push(fn) },
  }, `<${n.tag}${n.attrs.id ? ` id=${n.attrs.id}` : ''}>`)
  realOf.set(n.api, n); return n.api
}
const fire = (n, type) => { let prevented = false; const ev = strict({ preventDefault: () => { prevented = true } }, `the ${type} event`); for (const fn of n.on[type] ?? []) fn.call(n.api, ev); return prevented }
const flush = async () => { for (let i = 0; i < 3; i++) await new Promise(r => setImmediate(r)) }
it('GET / and GET /app.js are 200 text/html and text/javascript (charset=utf-8), query ignored; one <title> and one <h1>, both Quick polls; one script', async () => {
  const s = await shared(), { html, js } = await assets(), root = parseHtml(html), scripts = all(root).filter(n => n.tag === 'script'), body = all(root).find(n => n.tag === 'body') ?? root
  for (const [path, type, text] of [['/', 'text/html', html], ['/?v=1', 'text/html', html], ['/app.js', 'text/javascript', js], ['/app.js?v=1', 'text/javascript', js]]) {
    const r = await get(s, path); same(path, { status: r.status, type: r.type, same: r.text === text, empty: text === '' }, { status: 200, type: `${type}; charset=utf-8`, same: true, empty: false })
  }
  assert.deepEqual(['title', 'h1'].map(t => all(root).filter(n => n.tag === t).map(norm)), [['Quick polls'], ['Quick polls']])
  assert.deepEqual(scripts.map(n => ({ src: n.attrs.src, inline: textOf(n).trim(), flags: ['type', 'defer', 'async'].filter(a => a in n.attrs) })), [{ src: '/app.js', inline: '', flags: [] }], 'one <script src="/app.js">, no type, defer or async')
  assert.ok(body.kids.filter(isEl).at(-1) === scripts[0], 'the script is the last element in <body>')
  assert.deepEqual(all(root).flatMap(n => Object.keys(n.attrs).filter(a => a.startsWith('on')).map(a => `<${n.tag} ${a}>`)), [], 'no on… attributes')
  assert.deepEqual({ page: /https?:\/\//.test(html), script: /https?:\/\//.test(js) }, { page: false, script: false })
  assert.doesNotThrow(() => new vm.Script(js, { filename: 'app.js' }), 'app.js compiles as a classic script (no import or export)')
})
it('page markup: the form with its two fields, their own labels and Create poll; outside it the list, the poll view, Your name, Close poll (disabled) and an empty #error', async () => {
  const { html } = await assets(), root = parseHtml(html), form = byId(root, 'poll-form')
  const about = (id, keys) => (n => n && Object.fromEntries(keys.map(k => [k, { tag: n.tag, type: n.attrs.type?.toLowerCase(), name: n.attrs.name, role: n.attrs.role, text: norm(n), kids: n.kids.length, inForm: within(n, form), disabled: 'disabled' in n.attrs }[k]])))(byId(root, id))
  const labels = id => all(root).filter(n => n.tag === 'label' && n.attrs.for === id).map(l => ({ text: norm(l), holdsField: all(l).some(n => n.attrs.id === id) }))
  assert.deepEqual({ tag: form?.tag, novalidate: Boolean(form && 'novalidate' in form.attrs) }, { tag: 'form', novalidate: true })
  for (const [id, tag, type, label] of [['question', 'input', 'text', 'Question'], ['answers', 'textarea', undefined, 'Answers, one per line']]) same(id, { ...about(id, ['tag', 'type', 'name', 'inForm']), labels: labels(id) }, { tag, type, name: id, inForm: true, labels: [{ text: label, holdsField: false }] })
  for (const [id, want] of [['create', { tag: 'button', type: 'submit', text: 'Create poll', inForm: true }], ['poll-list', { tag: 'ul', inForm: false }], ['poll-question', { tag: 'h2', kids: 0, inForm: false }], ['results', { tag: 'ul', kids: 0, inForm: false }],
    ['voter', { tag: 'input', type: 'text', inForm: false }], ['close-poll', { tag: 'button', type: 'button', text: 'Close poll', disabled: true, inForm: false }], ['error', { tag: 'p', role: 'alert', kids: 0, inForm: false }]]) same(id, about(id, Object.keys(want)), want)
  assert.deepEqual(labels('voter'), [{ text: 'Your name', holdsField: false }])
})

// --- Page behaviour: app.js in a vm; each fetch call waits for call.reply(status, body) or call.fail() ---
async function openPage() {
  const { html, js } = await assets(), root = parseHtml(html), page = { calls: [], el: id => byId(root, id) }, ctx = vm.createContext({}), [Pr, J, TypeErr] = vm.runInContext('[Promise, JSON, TypeError]', ctx)
  ctx.document = strict({ getElementById: id => { const n = byId(root, String(id)); return n ? api(n) : null }, createElement: tag => api(elem(String(tag).toLowerCase())) }, 'document')
  ctx.fetch = (url, opts) => new Pr((ok, no) => page.calls.push({ url, opts, method: String(opts?.method ?? 'GET').toUpperCase(), createDisabled: isDisabled(page.el('create') ?? elem('none')), fail: () => no(new TypeErr('Failed to fetch')),
    reply: (status, body = '', text = typeof body === 'string' ? body : JSON.stringify(body)) => ok(strict({ status, json: () => new Pr((yes, fail) => { try { yes(J.parse(text)) } catch (e) { fail(e) } }) }, 'the fetch reply')) }))
  vm.runInContext(js, ctx, { filename: 'app.js', timeout: 5000 }); await flush()
  return page
}
const pending = page => page.calls.filter(c => !c.taken).map(c => `${c.method} ${c.url}`)
function take(page, method, url) {
  const call = page.calls.find(c => !c.taken && c.method === method && c.url === url)
  assert.ok(call, `expected fetch ${method} ${url}; open fetch calls: ${JSON.stringify(pending(page))}`); call.taken = true
  assert.deepEqual(Object.keys(call.opts ?? {}).filter(k => !['method', 'headers', 'body'].includes(k)), [], `fetch options of ${method} ${url}`)
  return call
}
const answer = async (call, how) => { how(call); await flush() }, okList = polls => c => c.reply(200, { polls })
const SAMPLE = [P(3, 'Lunch <b>?</b>', [A('Pizza', 2, 67), A('Sushi', 1, 33)]), P(1, 'Team day', [A('Mon'), A('Fri')], true)]
const kids = el => el.kids.map(li => [li.tag, ...(li.kids ?? []).map(k => (isEl(k) ? `<${k.tag} type=${k.attrs.type}${isDisabled(k) ? ' disabled' : ''}>${textOf(k)}` : k.text))])
const LIST = [['li', 'Lunch <b>?</b> (3 votes)', '<button type=button>Open'], ['li', 'Team day (0 votes, closed)', '<button type=button>Open']], NONE = [['li', 'No polls yet.']]
const shown = p => ({ question: p.question, results: p.answers.map(a => ['li', `${a.text}: ${a.votes} (${a.percent}%)`, `<button type=button${p.closed ? ' disabled' : ''}>Vote`]), close: p.closed ? 'disabled' : 'enabled' })
const NOTHING = { question: '', results: [], close: 'disabled' }
const errorText = page => textOf(page.el('error'))
const state = page => ({ error: errorText(page), question: textOf(page.el('poll-question')), results: kids(page.el('results')), close: isDisabled(page.el('close-poll')) ? 'disabled' : 'enabled', list: kids(page.el('poll-list')), fetches: pending(page) })
const ready = async (polls = SAMPLE) => { const page = await openPage(); await answer(take(page, 'GET', '/api/polls'), okList(polls)); return page }
const openPoll = async (page, index, poll) => { fire(page.el('poll-list').kids[index].kids[1], 'click'); await flush(); await answer(take(page, 'GET', `/api/polls/${poll.id}`), c => c.reply(200, poll)) }
const voteButton = (page, i) => page.el('results').kids[i].kids[1]
const headersOf = c => (h => (Array.isArray(h) ? h : Object.entries(h ?? {})).map(([k, v]) => [String(k).toLowerCase(), v]))(c.opts?.headers)
// The ways a request can fail, for a request whose success status is okStatus: [how the reply comes, the #error text].
const errorCases = okStatus => [[c => c.reply(500, err('boom')), 'boom'], [c => c.reply(404, err(E.pnf)), E.pnf], [c => c.reply(okStatus === 200 ? 201 : 200, { polls: [] }), FAILED_REQ], [c => c.reply(400, err(7)), FAILED_REQ],
  [c => c.reply(400, ['x']), FAILED_REQ], [c => c.reply(okStatus, '<h1>oops</h1>'), NO_REPLY], [c => c.reply(500, 'Internal Server Error'), NO_REPLY], [c => c.fail(), NO_REPLY]]
it('page: at load app.js requests only GET /api/polls and fills #poll-list with one <li> per poll (question, total, closed, an Open button); none: No polls yet.', async () => {
  const page = await openPage(); assert.deepEqual(pending(page), ['GET /api/polls'])
  await answer(take(page, 'GET', '/api/polls'), okList(SAMPLE))
  assert.deepEqual(state(page), { error: '', ...NOTHING, list: LIST, fetches: [] })
  const empty = await ready([]); assert.deepEqual(kids(empty.el('poll-list')), NONE)
})
it('page: a list fetch with an error status or no reply shows the message and keeps the list; a later success leaves #error alone', async () => {
  for (const [i, [how, error]] of errorCases(200).entries()) {
    const page = await openPage(); await answer(take(page, 'GET', '/api/polls'), how)
    same(i, { error: errorText(page), list: kids(page.el('poll-list')) }, { error, list: [] })
    const other = await ready(); await openPoll(other, 0, SAMPLE[0]); fire(voteButton(other, 0), 'click'); await flush()
    await answer(take(other, 'POST', '/api/polls/3/votes'), c => c.reply(201, SAMPLE[0])); await answer(take(other, 'GET', '/api/polls'), how)
    same(i, { error: errorText(other), list: kids(other.el('poll-list')) }, { error, list: LIST }, 'a list fetch after a vote')
  }
})
it('page: Open requests GET /api/polls/<id> and shows the poll: question, one <li> per answer with its votes, percent and a Vote button (disabled when closed), Close poll enabled only when open', async () => {
  const page = await ready(); await openPoll(page, 0, SAMPLE[0])
  assert.deepEqual(state(page), { error: '', ...shown(SAMPLE[0]), list: LIST, fetches: [] })
  await openPoll(page, 1, SAMPLE[1]); assert.deepEqual(state(page), { error: '', ...shown(SAMPLE[1]), list: LIST, fetches: [] })
  assert.deepEqual(shown(SAMPLE[1]).results, [['li', 'Mon: 0 (0%)', '<button type=button disabled>Vote'], ['li', 'Fri: 0 (0%)', '<button type=button disabled>Vote']])
})
it('page: an Open that gets an error status or no reply shows the message and keeps what is shown; a later Open that succeeds empties #error', async () => {
  for (const [i, [how, error]] of errorCases(200).entries()) {
    const page = await ready(); await openPoll(page, 1, SAMPLE[1]); fire(page.el('poll-list').kids[0].kids[1], 'click'); await flush(); await answer(take(page, 'GET', '/api/polls/3'), how)
    same(i, state(page), { error, ...shown(SAMPLE[1]), list: LIST, fetches: [] })
    await openPoll(page, 0, SAMPLE[0]); same(i, state(page), { error: '', ...shown(SAMPLE[0]), list: LIST, fetches: [] })
  }
})
it('page: Vote disables its button and POSTs exactly Content-Type: application/json, the voter unchanged and the answer index; on 201 it shows the reply, empties #error and fetches the list again', async () => {
  const page = await ready(); await openPoll(page, 0, SAMPLE[0]); page.el('voter').value = '  ann '
  const button = voteButton(page, 1); fire(button, 'click'); await flush()
  const c = take(page, 'POST', '/api/polls/3/votes')
  assert.deepEqual({ headers: headersOf(c), body: tryJson(c.opts?.body), during: isDisabled(button) }, { headers: [['content-type', 'application/json']], body: { voter: '  ann ', answer: 1 }, during: true })
  const after = P(3, 'Lunch <b>?</b>', [A('Pizza', 2, 50), A('Sushi', 2, 50)]); await answer(c, x => x.reply(201, after))
  assert.deepEqual(state(page), { error: '', ...shown(after), list: LIST, fetches: ['GET /api/polls'] })
  page.el('voter').value = ''; fire(voteButton(page, 0), 'click'); await flush()
  assert.deepEqual(tryJson(take(page, 'POST', '/api/polls/3/votes').opts?.body), { voter: '', answer: 0 }, 'the script never checks the name itself')
})
it('page: a vote with an error status or no reply shows the message, enables the button again and keeps the poll shown and the list', async () => {
  for (const [i, [how, error]] of [[c => c.reply(409, err(E.dup)), E.dup], [c => c.reply(409, err(E.closed)), E.closed], ...errorCases(201)].entries()) {
    const page = await ready(); await openPoll(page, 0, SAMPLE[0]); page.el('voter').value = 'Ann'
    const button = voteButton(page, 0); fire(button, 'click'); await flush(); await answer(take(page, 'POST', '/api/polls/3/votes'), how)
    same(i, { ...state(page), button: isDisabled(button), inView: within(button, page.el('results')) }, { error, ...shown(SAMPLE[0]), list: LIST, fetches: [], button: false, inView: true })
  }
})
it('page: Close poll disables itself and POSTs /api/polls/<id>/close with no body; on 200 it shows the closed poll and fetches the list again; otherwise it shows the message and enables itself again', async () => {
  const page = await ready(); await openPoll(page, 0, SAMPLE[0]); fire(page.el('close-poll'), 'click'); await flush()
  const c = take(page, 'POST', '/api/polls/3/close'), closed = { ...SAMPLE[0], closed: true }
  assert.deepEqual({ body: c.opts?.body, during: isDisabled(page.el('close-poll')) }, { body: undefined, during: true })
  await answer(c, x => x.reply(200, closed)); assert.deepEqual(state(page), { error: '', ...shown(closed), list: LIST, fetches: ['GET /api/polls'] })
  for (const [i, [how, error]] of errorCases(200).entries()) {
    const p = await ready(); await openPoll(p, 0, SAMPLE[0]); fire(p.el('close-poll'), 'click'); await flush(); await answer(take(p, 'POST', '/api/polls/3/close'), how)
    same(i, state(p), { error, ...shown(SAMPLE[0]), list: LIST, fetches: [] })
  }
})
it('page: submit never reloads; it disables Create poll and POSTs the question unchanged and the non-blank lines of #answers, one \\r at a line end removed, unchanged otherwise; a submit while disabled sends nothing', async () => {
  const page = await ready(); page.el('question').value = '  Lunch <i>?</i> '; page.el('answers').value = 'Pizza\r\n  Sushi \n\n   \n\tTacos\r\r\n\r\n \t\r\nIce cream'
  assert.equal(fire(page.el('poll-form'), 'submit'), true, 'preventDefault is called'); await flush()
  const c = take(page, 'POST', '/api/polls')
  assert.deepEqual({ headers: headersOf(c), body: tryJson(c.opts?.body), createWhenSent: c.createDisabled, create: isDisabled(page.el('create')) },
    { headers: [['content-type', 'application/json']], body: { question: '  Lunch <i>?</i> ', answers: ['Pizza', '  Sushi ', '\tTacos\r', 'Ice cream'] }, createWhenSent: true, create: true })
  assert.equal(fire(page.el('poll-form'), 'submit'), true, 'preventDefault on a submit while Create poll is disabled'); await flush()
  assert.deepEqual(pending(page), [], 'a submit while Create poll is disabled sends nothing')
  page.el('question').value = ''; page.el('answers').value = '\n \n'; await answer(c, x => x.reply(400, err(E.q))); fire(page.el('poll-form'), 'submit'); await flush()
  assert.deepEqual(tryJson(take(page, 'POST', '/api/polls').opts?.body), { question: '', answers: [] }, 'the script never checks the fields itself')
})
it('page: on 201 Create poll is enabled before anything else, the fields and #error are emptied, the new poll is shown and the list is fetched again', async () => {
  const page = await ready(); page.el('question').value = 'Q'; page.el('answers').value = 'a\nb'; fire(page.el('poll-form'), 'submit'); await flush()
  await answer(take(page, 'POST', '/api/polls'), c => c.reply(409, err('nope'))); assert.equal(errorText(page), 'nope')
  page.el('answers').value = 'a\nb\nc'; fire(page.el('poll-form'), 'submit'); await flush()
  const made = newPoll(9, 'Q', ['a', 'b', 'c']); await answer(take(page, 'POST', '/api/polls'), c => c.reply(201, made))
  const again = take(page, 'GET', '/api/polls')
  assert.deepEqual({ createAtRefetch: again.createDisabled, create: isDisabled(page.el('create')), values: [valueIn(page.el('question')), valueIn(page.el('answers'))], ...state(page) },
    { createAtRefetch: false, create: false, values: ['', ''], error: '', ...shown(made), list: LIST, fetches: [] })
})
it('page: a create with another status, or no reply, shows the message exactly and keeps the form, the poll shown and the list', async () => {
  for (const [i, [how, error]] of [[c => c.reply(400, err(E.diff)), E.diff], ...errorCases(201)].entries()) {
    const page = await ready(); await openPoll(page, 0, SAMPLE[0]); page.el('question').value = ' Q '; page.el('answers').value = 'a\nA'; fire(page.el('poll-form'), 'submit'); await flush()
    await answer(take(page, 'POST', '/api/polls'), how)
    same(i, { ...state(page), create: isDisabled(page.el('create')), values: [valueIn(page.el('question')), valueIn(page.el('answers'))] }, { error, ...shown(SAMPLE[0]), list: LIST, fetches: [], create: false, values: [' Q ', 'a\nA'] })
  }
})

// --- Deliverables ---
it('the solution has a package.json (type module, start runs node server.mjs, a test script), a README with usage and node:test tests', () => {
  const pkg = JSON.parse(readFileSync(join(TARGET, 'package.json'), 'utf8')), readme = readdirSync(TARGET).find(f => /^readme(\.[a-z]+)?$/i.test(f))
  const sources = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? (['node_modules', '.git'].includes(e.name) ? [] : sources(join(dir, e.name))) : /\.[cm]?js$/.test(e.name) ? [join(dir, e.name)] : []))
  assert.deepEqual({ type: pkg.type, start: /^node (\.\/)?server\.mjs$/.test(pkg.scripts?.start?.trim() ?? ''), test: Boolean(pkg.scripts?.test?.trim()), readme: Boolean(readme && /npm start|server\.mjs/.test(readFileSync(join(TARGET, readme), 'utf8'))),
    nodeTest: sources(TARGET).some(f => /['"]node:test['"]/.test(readFileSync(f, 'utf8'))) }, { type: 'module', start: true, test: true, readme: true, nodeTest: true })
})
it('the listening line is the only thing the server wrote to stdout, after every request above', async () => {
  const s = await shared(); await get(s, '/nope'); await post(s, '/api/polls', 'garbage')
  assert.equal(s.out, LINE(s.port))
})
