// Hidden tests for task h4 (room bookings: server.mjs, a JSON API, one data file and a page). Servers run from TARGET_DIR and are
// driven through node:http, so paths such as /api/./rooms arrive byte for byte; app.js runs in a vm against a DOM stand-in.
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

const TARGET = process.env.TARGET_DIR, JSON_TYPE = 'application/json; charset=utf-8', ROOMS = ['Aurora', 'Borealis', 'Cosmos'], NO_REPLY = 'Could not reach the server.', FAILED_REQ = 'Request failed.'
const E = { type: 'content type must be application/json', big: 'body too large', obj: 'body must be a JSON object', room: 'room must be one of Aurora, Borealis, Cosmos', title: 'title must be 1 to 80 characters',
  date: 'date must be a valid YYYY-MM-DD date', start: 'start must be HH:MM', end: 'end must be HH:MM', order: 'end must be after start', nf: 'not found', mna: 'method not allowed', gone: 'booking not found', ise: 'internal error' }
const ROOT = mkdtempSync(join(tmpdir(), 'h4-')), running = new Set(), err = error => ({ error }), sleep = ms => new Promise(r => setTimeout(r, ms)), fresh = () => mkdtempSync(join(ROOT, 'c-')), U = String.fromCodePoint
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
let sharedP, day = 0
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
const booked = (r, body, label) => { const v = view(r); same(label, { ...v, body: { ...v.body, id: typeof v.body?.id } }, reply(201, { ...body, id: 'number' })) }
const get = (s, path) => req(s, 'GET', path), del = (s, id) => req(s, 'DELETE', `/api/bookings/${id}`), post = (s, body, opts = {}) => req(s, 'POST', '/api/bookings', { body, ...opts })
const freshDate = () => new Date(Date.UTC(2030, 0, 1 + day++)).toISOString().slice(0, 10), slot = (over = {}) => ({ room: 'Aurora', title: 'Standup', date: freshDate(), start: '09:00', end: '10:00', ...over })
const created = async (s, body) => { const r = await post(s, body); assert.equal(r.status, 201, `POST ${JSON.stringify(body)}: ${r.status} ${r.text.slice(0, 200)}`); return JSON.parse(r.text) }
const list = async (s, query = '') => { const r = await get(s, `/api/bookings${query}`); assert.equal(r.status, 200, r.text.slice(0, 200)); return JSON.parse(r.text).bookings }

// --- Startup and the data file ---
it('the listening line: PORT=0 prints the port the OS picked, leading zeros are dropped, an unset or empty PORT is 3000 (when taken: exit 1)', async () => {
  const want = await freePort()
  for (const PORT of ['0', `00${want}`]) {
    const s = await boot({ PORT, DATA_FILE: join(fresh(), 'd.json') }), port = PORT === '0' ? Number(/^listening on http:\/\/127\.0\.0\.1:([1-9]\d*)\n$/.exec(s.out)?.[1]) : want
    const rooms = port ? view(await get({ port }, '/api/rooms')) : null; await stopServer(s)
    same(PORT, { out: s.out, rooms }, { out: LINE(port), rooms: reply(200, { rooms: ROOMS }) }, `stderr: ${s.err.slice(0, 300)}`)
  }
  for (const PORT of [undefined, '']) {
    const free = await listenOn(3000).then(b => new Promise(r => b.close(() => r(true))), () => false), r = await runToExit({ PORT, DATA_FILE: join(fresh(), 'd.json') })
    if (free) same(PORT, { out: r.out }, { out: LINE(3000) }); else same(PORT, failed(r), FAILED)
  }
})
it('a bad PORT (not only ASCII digits, above 65535) or a port in use: exit 1, one stderr line; PORT is checked first, then the data file read', async () => {
  const dir = fresh(), DATA_FILE = join(dir, 'd.json'), blocker = await listenOn(0), busy = String(blocker.address().port)
  for (const PORT of ['abc', '-1', '+3000', ' 3000', '3000 ', '30.5', '1e3', '0x1F', '3000a', U(0xff13, 0xff10, 0xff10, 0xff10), '65536', '99999', '99999999999999999999', busy]) same(PORT, failed(await runToExit({ PORT, DATA_FILE })), FAILED)
  const order = [await runToExit({ PORT: busy, DATA_FILE: dir }), await runToExit({ PORT: 'x1', DATA_FILE: dir })]; blocker.close()
  assert.deepEqual(order.map(r => ({ ...failed(r), dataLine: hasLine(r.err, READ_FAIL(dir).err) })), [{ ...FAILED, dataLine: true }, { ...FAILED, dataLine: false }], 'a bad data file wins over a busy port, a bad PORT over a bad data file')
})
it('a data file that is a directory, empty or not valid JSON: "cannot read data file <DATA_FILE as given>", exit 1, file untouched', async () => {
  const cwd = fresh(); mkdirSync(join(cwd, 'data', 'folder.json'), { recursive: true })
  for (const [name, content] of [['data/folder.json'], ['data/empty.json', ''], ['data/broken.json', '{"bookings": ['], ['data/text.json', 'hello'], ['data/null.json', 'null'], [join(cwd, 'abs.json'), '']]) {
    if (content !== undefined) writeFileSync(resolve(cwd, name), content)
    same(name, { ...readFail(await runToExit({ DATA_FILE: name }, cwd), name), content: content === undefined ? undefined : readFileSync(resolve(cwd, name), 'utf8') }, { ...READ_FAIL(name), content })
  }
})
it('a data file holding valid JSON that is not in the server\'s layout (42, {"bookings":5}, "x", true): rejected the same way, file untouched', async () => {
  const cwd = fresh(), name = 'd.json', read = () => readFileSync(join(cwd, name), 'utf8')
  for (const content of ['42', '{"bookings":5}', '"x"', 'true']) { writeFileSync(join(cwd, name), content); same(content, { ...readFail(await runToExit({ DATA_FILE: name }, cwd), name), content: read() }, { ...READ_FAIL(name), content }) }
})
it('DATA_FILE: unset or empty is bookings.json in the working directory (not next to server.mjs); a relative one resolves against it', async () => {
  const blocked = fresh(), cwd = fresh(), beside = join(TARGET, 'bookings.json'), existed = existsSync(beside)
  mkdirSync(join(blocked, 'bookings.json')); mkdirSync(join(cwd, 'store'))
  for (const DATA_FILE of [undefined, '']) same(DATA_FILE, readFail(await runToExit({ DATA_FILE }, blocked), 'bookings.json'), READ_FAIL('bookings.json'))
  const a = await withServer({ cwd, env: { DATA_FILE: undefined } }, s => created(s, slot())), b = await withServer({ cwd, file: 'store/b.json' }, s => created(s, slot()))
  if (!existed && existsSync(beside)) { rmSync(beside, RM); assert.fail('bookings.json was written next to server.mjs') }
  assert.deepEqual([existsSync(join(cwd, 'bookings.json')), existsSync(join(cwd, 'store', 'b.json'))], [true, true], 'the files are written under the working directory')
  await withServer({ cwd, env: { DATA_FILE: '' } }, async s => assert.deepEqual(await list(s), [a])); await withServer({ file: join(cwd, 'store', 'b.json') }, async s => assert.deepEqual(await list(s), [b]))
})
it('a missing data file or folder means no bookings; a failed save is 500 internal error and changes nothing, the next id included', async () => {
  const dir = join(fresh(), 'sub'), b = slot()
  await withServer({ file: join(dir, 'd.json') }, async s => {
    assert.deepEqual(await list(s), []); await expect('POST, no folder', post(s, b), 500, err(E.ise)); assert.equal(existsSync(dir), false, 'no folder is created')
    mkdirSync(dir); const a = await created(s, slot()); rmSync(dir, RM)
    await expect('POST, folder removed', post(s, b), 500, err(E.ise)); await expect('DELETE, folder removed', del(s, a.id), 500, err(E.ise))
    assert.deepEqual(await list(s), [a], 'the server keeps running, unchanged'); mkdirSync(dir); assert.deepEqual(await created(s, b), { id: 2, ...b })
  })
})
it('only a POST that creates or a DELETE that removes writes the data file; edits made from outside are not noticed', async () => {
  const file = join(fresh(), 'd.json')
  await withServer({ file }, async s => {
    for (const [m, p, o] of [['GET', '/api/rooms'], ['GET', '/api/bookings'], ['GET', '/'], ['POST', '/api/bookings', { body: slot({ room: 'x' }) }], ['POST', '/api/bookings', { body: slot(), type: 'text/plain' }], ['DELETE', '/api/bookings/1'], ['PUT', '/api/bookings']]) await req(s, m, p, o)
    assert.equal(existsSync(file), false, 'no write at startup or for requests that change nothing')
    const b = await created(s, slot()); assert.ok(existsSync(file), 'a POST that creates writes the file')
    writeFileSync(file, 'outside edit'); await post(s, { ...b, start: '09:30' }); await del(s, b.id + 1)
    assert.deepEqual({ list: await list(s), file: readFileSync(file, 'utf8') }, { list: [b], file: 'outside edit' }, 'memory is the truth; a 409, a 404 and a GET do not write')
    assert.equal((await del(s, b.id)).status, 204); assert.notEqual(readFileSync(file, 'utf8'), 'outside edit', 'a DELETE that removes writes the file')
  })
  await withServer({ file }, async s => { assert.deepEqual(await list(s), []); assert.equal((await created(s, slot())).id, 2) })
})
it('bookings and the next id survive a restart (each change is saved before its reply); ids are never reused', async () => {
  const file = join(fresh(), 'd.json'), made = await withServer({ file }, async s => { const m = [await created(s, slot()), await created(s, slot()), await created(s, slot())]; for (const id of [3, 1]) assert.equal((await del(s, id)).status, 204); return m })
  assert.deepEqual(made.map(b => b.id), [1, 2, 3], 'the first booking gets id 1, each new one the next integer')
  await withServer({ file }, async s => { assert.deepEqual(await list(s), [made[1]]); assert.equal((await created(s, slot())).id, 4); assert.equal((await del(s, 4)).status, 204) })
  await withServer({ file }, async s => assert.equal((await created(s, slot())).id, 5))
})
it('requests at once: of overlapping POSTs one is 201 and the rest 409; distinct POSTs get distinct ids and survive a restart', async () => {
  const file = join(fresh(), 'd.json'), hh = i => String(i).padStart(2, '0')
  const times = [['09:00', '11:00'], ['10:00', '10:30'], ['09:30', '10:45'], ['10:15', '12:00'], ['08:00', '10:20'], ['10:10', '10:25'], ['07:00', '23:00'], ['10:15', '10:20']]
  const saved = await withServer({ file }, async s => {
    const rs = await Promise.all(times.map(([start, end]) => post(s, { room: 'Cosmos', title: 'Race', date: '2026-11-03', start, end }))), won = rs.filter(r => r.status === 201), b = tryJson(won[0]?.text)
    assert.deepEqual({ won: won.length, others: rs.filter(r => r !== won[0]).map(view) }, { won: 1, others: Array(times.length - 1).fill(reply(409, err(`room is already booked from ${b.start} to ${b.end}`))) })
    const more = await Promise.all(Array.from({ length: 15 }, (_, i) => post(s, slot({ room: ROOMS[i % 3], date: '2027-03-01', start: `${hh(i)}:00`, end: `${hh(i)}:30` }))))
    assert.deepEqual(more.map(r => [r.status, tryJson(r.text).id]).sort((x, y) => x[1] - y[1]), Array.from({ length: 15 }, (_, i) => [201, i + 2]))
    return list(s)
  })
  await withServer({ file }, async s => {
    assert.deepEqual(await list(s), saved); assert.equal((await created(s, slot())).id, 17)
    assert.deepEqual((await Promise.all(Array.from({ length: 5 }, () => del(s, 7)))).map(r => r.status).sort(), [204, 404, 404, 404, 404])
  })
})

// --- Single requests on one shared server: [method, path, options, status, body]; a 201 is checked as a booking, a HEAD by status ---
const BAD_TIME = ['24:00', '23:60', '9:00', '09:0', '09:00:00', ' 09:00', '09:00 ', '0900', '09.00', U(0x660, 0x669, 0x3a, 0x660, 0x660), '-1:00', '', 900, null, undefined]
const reject = (field, values) => values.map(v => ['POST', '/api/bookings', { body: slot(field === 'order' ? v : { [field]: v }) }, 400, err(E[field])])
const accept = (over, stored = {}, opts = {}) => (body => ['POST', '/api/bookings', { body, ...opts }, 201, { ...body, ...stored }])(slot(over))
const unread = (path, type, status, message) => [['POST', path, { body: 'x'.repeat(1 << 20), type }, status, err(message)], ['POST', path, { parts: ['x'.repeat(11000), 'x'.repeat(1000)], type, length: 12000, gap: 400 }, status, err(message)]]
const SINGLE = {
  'GET /api/rooms: 200 {"rooms": ["Aurora", "Borealis", "Cosmos"]} with the JSON content type; the query is ignored': ['/api/rooms', '/api/rooms?x=1&y', '/api/rooms?'].map(p => ['GET', p, {}, 200, { rooms: ROOMS }]),
  'paths are compared byte for byte: other spellings are 404 not found, whatever the method': [...['/api/%62ookings', '/api/./rooms', '/API/rooms', '/api/Rooms', '/api/rooms/', '//api/rooms', '/api/bookings/', '/api/bookings/1/',
    '/api/bookings//', '/api/bookings/1/x', '/api', '/api/', '/index.html', '/app.js/', '/App.js', '/%61pp.js', '/api/rooms%3Fx', '/api/bookings/../rooms'].flatMap(p => ['GET', 'POST', 'DELETE', 'PUT'].map(m => [m, p, {}, 404, err(E.nf)])),
    ['HEAD', '/nope', {}, 404], ['HEAD', '/api/bookings/', {}, 404]],
  'a known path with a method not listed for it is 405 method not allowed, HEAD and OPTIONS included': [...['POST /api/rooms', 'DELETE /api/rooms', 'OPTIONS /api/rooms', 'PUT /api/bookings', 'DELETE /api/bookings', 'PATCH /api/bookings',
    'OPTIONS /api/bookings', 'GET /api/bookings/1', 'GET /api/bookings/abc', 'POST /api/bookings/1', 'PUT /api/bookings/%31', 'POST /', 'DELETE /', 'PUT /app.js', 'POST /app.js?x=1', 'DELETE /api/rooms?x'].map(mp => [...mp.split(' '), {}, 405, err(E.mna)]),
    ...['/api/rooms', '/api/bookings', '/', '/app.js', '/api/bookings/1'].map(p => ['HEAD', p, {}, 405])],
  'the whole body is read before any reply, so 415, 413, 405 and 404 replies to large or slow bodies reach the client, never early': [...unread('/api/bookings', 'text/plain', 415, E.type), ...unread('/api/bookings', undefined, 413, E.big),
    ...unread('/api/rooms', undefined, 405, E.mna), ...unread('/nope', undefined, 404, E.nf)],
  'rule 1: the media type must be application/json (letter case and spaces or tabs around it ignored), else 415': [...[null, '', 'text/plain', 'application/jsonx', 'application/json-patch+json', 'application/ld+json', 'text/json', 'json',
    'application/json, text/plain', 'application /json'].map(type => ['POST', '/api/bookings', { body: slot(), type }, 415, err(E.type)]), ...['application/json', 'Application/JSON', 'APPLICATION/JSON;', 'application/json; charset=utf-8',
    '\tapplication/json\t; charset=utf-8', 'application/json ; x=y'].map(type => accept({}, {}, { type }))],
  'rule 3: a body that is not a JSON object (a leading BOM included) is 400 body must be a JSON object': [...['', ' ', 'null', '[]', '[{"room":"Aurora"}]', '"x"', '42', 'true', '{', '{"room":"Aurora",}', "{'room':'Aurora'}", 'NaN'],
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(slot()))])].map(body => ['POST', '/api/bookings', { body }, 400, err(E.obj)]),
  [`rule 4: ${E.room}`]: reject('room', ['aurora', 'AURORA', ' Aurora', 'Aurora ', 'Andromeda', '', 'toString', '__proto__', 'constructor', 5, null, true, ['Aurora'], { name: 'Aurora' }, undefined]),
  [`rule 5: ${E.title} (UTF-16 code units, after trimming)`]: reject('title', [undefined, null, 5, ['x'], '', '   ', '\t\n\r', U(0xa0, 0x2003, 0xfeff), 'x'.repeat(81), ` ${'y'.repeat(81)} `, U(0x1f600).repeat(41)]),
  [`rule 6: ${E.date}`]: reject('date', ['1999-12-31', '2100-01-01', '2026-02-29', '2027-02-29', '2026-04-31', '2026-06-31', '2026-13-01', '2026-00-10', '2026-01-00', '2026-01-32', '2026-1-05', '2026-01-5', '26-01-05', '02026-01-05',
    ' 2026-11-03', '2026-11-03 ', '2026/11/03', '2026-11-03T09:00', `${U(0xff12, 0xff10, 0xff12, 0xff16)}-11-03`, `2026-11-${U(0x660, 0x663)}`, 20261103, null, '', undefined]),
  [`rule 7: ${E.start}`]: reject('start', BAD_TIME), [`rule 8: ${E.end}`]: reject('end', BAD_TIME),
  [`rule 9: ${E.order}`]: reject('order', [['10:00', '10:00'], ['10:00', '09:59'], ['23:59', '00:00'], ['12:00', '02:00']].map(([start, end]) => ({ start, end }))),
  'rules 4 to 9: valid edge values are stored as sent, except the title, which is stored trimmed': [...ROOMS.map(room => accept({ room })), accept({ title: 'x' }), accept({ title: 'x'.repeat(80) }), accept({ title: U(0x1f600).repeat(40) }),
    accept({ title: `\t ${'y'.repeat(80)}\n${U(0xa0)}` }, { title: 'y'.repeat(80) }), accept({ title: '  <b>x</b> & "q"  ' }, { title: '<b>x</b> & "q"' }), accept({ title: `${U(0x2003)}Team sync${U(0x3000)}` }, { title: 'Team sync' }),
    ...['2000-01-01', '2099-12-31', '2000-02-29', '2024-02-29', '2096-02-29', '2026-04-30', '2026-12-31'].map(date => accept({ date })), ...[['00:00', '23:59'], ['23:58', '23:59'], ['00:00', '00:01'], ['09:59', '10:00']].map(([start, end]) => accept({ start, end }))],
}
for (const [name, cases] of Object.entries(SINGLE)) it(name, async () => {
  const s = await shared()
  for (const [method, path, opts, status, body] of cases) {
    const r = await req(s, method, path, opts), label = `${method} ${path} ${JSON.stringify(opts.body ?? opts.parts?.length ?? '').slice(0, 120)} ${opts.type ?? ''}`
    if (method === 'HEAD') same(label, { status: r.status }, { status }); else if (status === 201) booked(r, body, label); else same(label, { ...view(r), early: r.early }, { ...reply(status, body), early: false })
  }
})
it('413 counts the bytes received (10000 pass, 10001 do not, chunked too); the body is decoded whole as UTF-8, bad bytes becoming U+FFFD', async () => {
  const s = await shared()
  for (const chunked of [false, true]) {
    const b = slot(), send = n => { const t = JSON.stringify(b).padEnd(n, ' '); return post(s, undefined, chunked ? { parts: [t.slice(0, 5000), t.slice(5000)] } : { body: t }) }
    await expect({ chunked, bytes: 10001 }, send(10001), 413, err(E.big)); booked(await send(10000), b, { chunked, bytes: 10000 })
  }
  const b = slot({ title: `Caf${U(0xe9)} ${U(0x2615)} ok` }), bytes = Buffer.from(JSON.stringify(b)), at = bytes.indexOf(Buffer.from(U(0x2615))) + 1, bad = Buffer.from(JSON.stringify(slot({ title: 'A#B' })))
  booked(await post(s, undefined, { parts: [bytes.subarray(0, at), bytes.subarray(at)] }), b, 'a character split across two writes')
  bad[bad.indexOf('#')] = 0xff; assert.equal(view(await post(s, bad)).body.title, `A${U(0xfffd)}B`)
})
it('the first failing rule decides the reply', async () => {
  const s = await shared(), big = '['.repeat(10001), x = { room: 'x', title: '', date: 'x', start: 'x', end: 'x' }, ok = { room: 'Aurora', title: 't', date: '2026-03-01' }, a = await created(s, slot())
  for (const [label, body, opts, status, message] of [['415 before 413', big, { type: 'text/plain' }, 415, E.type], ['415 with no type', big, { type: null }, 415, E.type], ['413 before 400', big, {}, 413, E.big], ['room first', x, {}, 400, E.room],
    ['title next', { ...x, room: 'Aurora' }, {}, 400, E.title], ['date next', { ...x, ...ok, date: '2026-02-30' }, {}, 400, E.date], ['start next', { ...x, ...ok, start: '25:00' }, {}, 400, E.start], ['end next', { ...x, ...ok, start: '23:00', end: '24:00' }, {}, 400, E.end],
    ['400 before 409 (order)', { ...a, end: a.start }, {}, 400, E.order], ['400 before 409 (title)', { ...a, title: ' ' }, {}, 400, E.title]]) await expect(label, post(s, body, opts), status, err(message))
})
it('rule 10: no overlap with a booking of the same room and date; the 409 names the overlapping booking that starts earliest', async () => {
  const s = await shared(), date = freshDate(), at = (start, end, room = 'Aurora', d = date) => ({ room, title: 'Meet', date: d, start, end }), a = await created(s, at('09:00', '10:00'))
  await created(s, at('10:00', '11:00')); await created(s, at('08:00', '09:00'))
  const busy = [[['09:30', '09:45'], ['09:00', '10:00']], [['09:00', '10:00'], ['09:00', '10:00']], [['08:59', '09:01'], ['08:00', '09:00']], [['07:00', '12:00'], ['08:00', '09:00']], [['10:59', '11:30'], ['10:00', '11:00']]]
  for (const [[start, end], [from, to]] of busy) await expect(`${start}-${end}`, post(s, at(start, end)), 409, err(`room is already booked from ${from} to ${to}`))
  for (const b of [at('09:00', '10:00', 'Borealis'), at('09:00', '10:00', 'Aurora', freshDate()), at('11:00', '12:00'), at('07:00', '08:00')]) booked(await post(s, b), b, b)
  assert.equal((await del(s, a.id)).status, 204); booked(await post(s, at('09:15', '09:45')), at('09:15', '09:45'), 'after the delete')
})
it('POST creates exactly id, room, title (trimmed), date, start and end, ids from 1, other keys ignored; DELETE is 204, or 404 for a bad or unknown id', () => withServer({}, async s => {
  const one = { id: 1, room: 'Borealis', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00' }, two = { ...one, id: 2, room: 'Cosmos' }
  await expect('first', post(s, { ...one, id: 42, extra: true, title: '  Standup  ', created: 'now' }), 201, one); await expect('second', post(s, { ...two, id: undefined }), 201, two)
  for (const id of ['0', '01', '001', '1.0', '1e0', '+1', '-1', '0x1', '%31', '1%20', '1,', 'abc', '3', '99999999999999999999']) await expect(id, del(s, id), 404, err(E.gone))
  assert.deepEqual(await list(s), [one, two]); const r = await del(s, '1?confirm=1')
  assert.deepEqual({ status: r.status, text: r.text, left: await list(s) }, { status: 204, text: '', left: [two] }); await expect('again', del(s, 1), 404, err(E.gone))
}))
it('GET /api/bookings: sorted by date, start, room order; ?date= keeps that date (first value, decoded as URLSearchParams does); a bad date is 400', () => withServer({}, async s => {
  const seed = [['Cosmos', '2026-12-01', '09:00', '10:00'], ['Aurora', '2027-01-15', '08:00', '09:00'], ['Borealis', '2026-12-01', '09:00', '09:30'], ['Aurora', '2026-12-01', '10:00', '11:00'],
    ['Aurora', '2026-12-01', '09:00', '09:45'], ['Cosmos', '2026-11-30', '23:00', '23:59'], ['Borealis', '2026-12-01', '08:59', '09:00'], ['Cosmos', '2026-12-01', '10:00', '10:30']], made = []
  for (const [i, [room, date, start, end]] of seed.entries()) made.push(await created(s, { room, title: `T${i + 1}`, date, start, end }))
  const sorted = [6, 7, 5, 3, 1, 4, 8, 2].map(id => made[id - 1]), on = d => sorted.filter(b => b.date === d)
  const good = { '': sorted, '?date=2026-12-01': on('2026-12-01'), '?date=2027-01-15&date=2026-12-01': on('2027-01-15'), '?x=1&date=2026-11-30&y': on('2026-11-30'), '?date=2026%2D12%2D01': on('2026-12-01'), '?date=2099-12-31': [], '?Date=x&dates=x': sorted }
  for (const [q, bookings] of Object.entries(good)) await expect(q, get(s, `/api/bookings${q}`), 200, { bookings })
  for (const q of ['?date', '?date=', '?x=1&date', '?date=&date=2026-12-01', '?date=2026-02-29', '?date=2026-12-1', '?date=+2026-12-01', '?date=2026-12-01%20', '?date=1999-12-31', '?date=2100-01-01']) await expect(q, get(s, `/api/bookings${q}`), 400, err(E.date))
}))

// --- Page: a tolerant HTML parser and a DOM stand-in offering only the listed browser APIs (any other member throws) ---
let assetsP
const assets = () => (assetsP ??= (async () => { const s = await shared(); return { html: (await get(s, '/')).text, js: (await get(s, '/app.js')).text } })())
const VOID = new Set('area base br col embed hr img input link meta source track wbr'.split(' ')), CLOSES_P = new Set('address article aside blockquote div dl fieldset footer form h1 h2 h3 h4 h5 h6 header hr main nav ol p pre section table ul'.split(' '))
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
const realOf = new WeakMap(), options = n => all(n).filter(o => o.tag === 'option')
const strict = (obj, name, refuse = k => { throw new Error(`app.js used ${name}.${String(k)}, which is not among the browser APIs the task allows`) }) =>
  new Proxy(obj, { get: (t, k) => (typeof k === 'symbol' || k === 'then' || k in t ? t[k] : refuse(k)), set: (t, k, v) => (k in t ? ((t[k] = v), true) : refuse(k)) })
const valueIn = n => (n.tag === 'select' ? (o => (o ? valueIn(o) : ''))(options(n)[n.selected ?? 0]) : n.value ?? n.attrs.value ?? (n.tag === 'option' ? norm(n) : ''))
const setValue = (n, v) => { if (n.tag === 'select') n.selected = options(n).findIndex(o => valueIn(o) === v); else n.value = v }
function api(n) {
  const adopt = xs => xs.forEach(x => put(n, realOf.get(x) ?? textNode(String(x))))
  n.api ??= strict({
    get textContent() { return textOf(n) }, set textContent(v) { n.kids = []; if (v != null && v !== '') put(n, textNode(String(v))) },
    get value() { return valueIn(n) }, set value(v) { setValue(n, String(v)) },
    get type() { return n.attrs.type ?? { button: 'submit', input: 'text' }[n.tag] ?? '' }, set type(v) { n.attrs.type = String(v) },
    get disabled() { return isDisabled(n) }, set disabled(v) { n.disabled = Boolean(v) },
    append: (...xs) => adopt(xs), replaceChildren: (...xs) => { n.kids = []; adopt(xs) }, addEventListener: (type, fn) => { (n.on[type] ??= []).push(fn) },
  }, `<${n.tag}${n.attrs.id ? ` id=${n.attrs.id}` : ''}>`)
  realOf.set(n.api, n); return n.api
}
const fire = (n, type) => { let prevented = false; const ev = strict({ preventDefault: () => { prevented = true } }, `the ${type} event`); for (const fn of n.on[type] ?? []) fn.call(n.api, ev); return prevented }
const flush = async () => { for (let i = 0; i < 3; i++) await new Promise(r => setImmediate(r)) }
it('GET / and GET /app.js are 200 text/html and text/javascript (charset=utf-8), query ignored; one <title> and one <h1>, both Room bookings; one script', async () => {
  const s = await shared(), { html, js } = await assets(), root = parseHtml(html), scripts = all(root).filter(n => n.tag === 'script'), body = all(root).find(n => n.tag === 'body') ?? root
  for (const [path, type, text] of [['/', 'text/html', html], ['/?v=1', 'text/html', html], ['/app.js', 'text/javascript', js], ['/app.js?v=1', 'text/javascript', js]]) {
    const r = await get(s, path); same(path, { status: r.status, type: r.type, same: r.text === text, empty: text === '' }, { status: 200, type: `${type}; charset=utf-8`, same: true, empty: false })
  }
  assert.deepEqual(['title', 'h1'].map(t => all(root).filter(n => n.tag === t).map(norm)), [['Room bookings'], ['Room bookings']])
  assert.deepEqual(scripts.map(n => ({ src: n.attrs.src, inline: textOf(n).trim(), flags: ['type', 'defer', 'async'].filter(a => a in n.attrs) })), [{ src: '/app.js', inline: '', flags: [] }], 'one <script src="/app.js">, no type, defer or async')
  assert.ok(body.kids.filter(isEl).at(-1) === scripts[0], 'the script is the last element in <body>')
  assert.deepEqual(all(root).flatMap(n => Object.keys(n.attrs).filter(a => a.startsWith('on')).map(a => `<${n.tag} ${a}>`)), [], 'no on… attributes')
  assert.deepEqual({ page: /https?:\/\//.test(html), script: /https?:\/\//.test(js) }, { page: false, script: false })
  assert.doesNotThrow(() => new vm.Script(js, { filename: 'app.js' }), 'app.js compiles as a classic script (no import or export)')
})
it('page markup: the form, its five fields with their own labels and Book; outside it the filter, Show all, the list and an empty #error', async () => {
  const { html } = await assets(), root = parseHtml(html), form = byId(root, 'booking-form')
  const about = (id, keys) => (n => n && Object.fromEntries(keys.map(k => [k, { tag: n.tag, type: n.attrs.type?.toLowerCase(), name: n.attrs.name, role: n.attrs.role, text: norm(n), kids: n.kids.length, inForm: within(n, form) }[k]])))(byId(root, id))
  const labels = id => all(root).filter(n => n.tag === 'label' && n.attrs.for === id).map(l => ({ text: norm(l), holdsField: all(l).some(n => n.attrs.id === id) }))
  assert.deepEqual({ tag: form?.tag, novalidate: Boolean(form && 'novalidate' in form.attrs) }, { tag: 'form', novalidate: true })
  for (const [id, tag, type, label] of [['room', 'select', undefined, 'Room'], ['title', 'input', 'text', 'Title'], ['date', 'input', 'date', 'Date'], ['start', 'input', 'time', 'Start'], ['end', 'input', 'time', 'End']]) same(id,
    { ...about(id, ['tag', 'type', 'name', 'inForm']), labels: labels(id) }, { tag, type, name: id, inForm: true, labels: [{ text: label, holdsField: false }] })
  for (const [id, want] of [['book', { tag: 'button', type: 'submit', text: 'Book', inForm: true }], ['filter-date', { tag: 'input', type: 'date', inForm: false }], ['show-all', { tag: 'button', type: 'button', text: 'Show all', inForm: false }],
    ['booking-list', { tag: 'ul', inForm: false }], ['error', { tag: 'p', role: 'alert', kids: 0, inForm: false }]]) same(id, about(id, Object.keys(want)), want)
  assert.deepEqual({ filterLabel: labels('filter-date'), options: all(root).filter(n => n.tag === 'option').length, names: ROOMS.filter(r => html.includes(r)) }, { filterLabel: [{ text: 'Show date', holdsField: false }], options: 0, names: [] })
})

// --- Page behaviour: app.js in a vm; each fetch call waits for call.reply(status, body) or call.fail() ---
async function openPage() {
  const { html, js } = await assets(), root = parseHtml(html), page = { calls: [], el: id => byId(root, id) }, ctx = vm.createContext({}), [P, J, TypeErr] = vm.runInContext('[Promise, JSON, TypeError]', ctx)
  ctx.document = strict({ getElementById: id => { const n = byId(root, String(id)); return n ? api(n) : null }, createElement: tag => api(elem(String(tag).toLowerCase())) }, 'document')
  ctx.fetch = (url, opts) => new P((ok, no) => page.calls.push({ url, opts, method: String(opts?.method ?? 'GET').toUpperCase(), bookDisabled: isDisabled(page.el('book') ?? elem('none')), fail: () => no(new TypeErr('Failed to fetch')),
    reply: (status, body = '', text = typeof body === 'string' ? body : JSON.stringify(body)) => ok(strict({ status, json: () => new P((yes, fail) => { try { yes(J.parse(text)) } catch (e) { fail(e) } }) }, 'the fetch reply')) }))
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
const answer = async (call, how) => { how(call); await flush() }, ok = bookings => c => c.reply(200, { bookings }), B = (id, room, date, start, end, title) => ({ id, room, title, date, start, end })
const SAMPLE = [B(3, 'Aurora', '2026-11-03', '09:00', '10:00', 'Standup'), B(1, 'Cosmos', '2026-11-03', '09:30', '11:00', '<b>x</b> & co')], FORM = { room: 'Cosmos', title: '  Plan <i>it</i> ', date: '2026-11-05', start: '13:00', end: '14:30' }
const ready = async (bookings = SAMPLE) => { const page = await openPage(); take(page, 'GET', '/api/rooms').reply(200, { rooms: ROOMS }); await answer(take(page, 'GET', '/api/bookings'), ok(bookings)); return page }
const rows = page => page.el('booking-list').kids.map(li => [li.tag, ...(li.kids ?? []).map(k => (isEl(k) ? `<${k.tag} type=${k.attrs.type}>${textOf(k)}` : k.text))])
const row = b => ['li', `${b.date} ${b.start}-${b.end} ${b.room}: ${b.title}`, '<button type=button>Cancel'], NONE = [['li', 'No bookings.']], LIST = SAMPLE.map(row), errorText = page => textOf(page.el('error'))
const state = page => ({ error: errorText(page), book: isDisabled(page.el('book')) ? 'disabled' : 'enabled', values: Object.fromEntries(Object.keys(FORM).map(id => [id, valueIn(page.el(id))])), rows: rows(page), fetches: pending(page) })
const fill = (page, values) => Object.entries(values).forEach(([id, v]) => setValue(page.el(id), v)), submit = async page => { const prevented = fire(page.el('booking-form'), 'submit'); await flush(); return prevented }
const cancel = async (page, i) => { const button = page.el('booking-list').kids[i].kids[1]; fire(button, 'click'); await flush(); return button }
const refetch = async (page, date) => { setValue(page.el('filter-date'), date); fire(page.el('filter-date'), 'change'); await flush(); return take(page, 'GET', `/api/bookings?date=${date}`) }
const sentFields = body => (b => (b && typeof b === 'object' ? Object.fromEntries(Object.keys(FORM).map(k => [k, b[k]])) : b))(tryJson(body)) // the five keys; other keys are free
const failBooking = async page => { fill(page, FORM); await submit(page); await answer(take(page, 'POST', '/api/bookings'), c => c.reply(409, err('busy'))) }
it('page: at load app.js requests GET /api/rooms and GET /api/bookings at once; #room gets one <option> per room, the list one <li> per booking', async () => {
  const page = await openPage(); assert.deepEqual(pending(page).sort(), ['GET /api/bookings', 'GET /api/rooms'], 'both requests start before any reply')
  await answer(take(page, 'GET', '/api/rooms'), c => c.reply(200, { rooms: ROOMS })); await answer(take(page, 'GET', '/api/bookings'), ok(SAMPLE))
  assert.deepEqual({ options: options(page.el('room')).map(o => [valueIn(o), textOf(o)]), rows: rows(page), error: errorText(page) }, { options: ROOMS.map(r => [r, r]), rows: LIST, error: '' })
  await answer(await refetch(page, '2026-11-04'), ok([]))
  assert.deepEqual(rows(page), NONE, 'no bookings: one <li> "No bookings."')
})
it('page: a rooms or list request with an error status or no reply shows the message, leaving #room or the list as it was; a list success leaves #error alone', async () => {
  const cases = [[c => c.reply(500, err('boom')), 'boom'], [c => c.reply(201, { rooms: ROOMS, bookings: [] }), FAILED_REQ], [c => c.reply(404, err(404)), FAILED_REQ], [c => c.reply(400, ['x']), FAILED_REQ],
    [c => c.reply(200, '<h1>oops</h1>'), NO_REPLY], [c => c.reply(500, 'Internal Server Error'), NO_REPLY], [c => c.fail(), NO_REPLY]]
  for (const [i, [how, error]] of cases.entries()) {
    const page = await openPage(), other = await ready()
    await answer(take(page, 'GET', '/api/rooms'), how); await answer(take(page, 'GET', '/api/bookings'), ok([])); await answer(await refetch(other, '2026-11-04'), how)
    same(i, { rooms: errorText(page), options: options(page.el('room')).length, list: errorText(other), rows: rows(other) }, { rooms: error, options: 0, list: error, rows: LIST }, 'the rooms request; a list request')
    await answer(await refetch(other, '2026-11-05'), ok([])); same(i, { error: errorText(other), rows: rows(other) }, { error, rows: NONE }, 'a later list success')
  }
})
it('page: change on #filter-date fetches ?date=<value> at once, input does nothing, Show all empties it and fetches once; only the last list fetch counts', async () => {
  const page = await ready(), filter = page.el('filter-date')
  setValue(filter, '2026-11-04'); fire(filter, 'input'); await flush()
  assert.deepEqual(pending(page), [], 'an input event fetches nothing')
  const [a, b] = [await refetch(page, '2026-11-04'), await refetch(page, '2026-11-05')]
  await answer(a, ok([])); assert.deepEqual(rows(page), LIST, 'an earlier list fetch that succeeds while a later one runs is ignored')
  await answer(b, ok([SAMPLE[1]])); assert.deepEqual(rows(page), [row(SAMPLE[1])])
  for (const how of [c => c.reply(500, err('stale')), c => c.fail(), c => c.reply(200, 'garbage')]) {
    const [c, d] = [await refetch(page, '2026-11-06'), await refetch(page, '2026-11-07')]
    await answer(d, ok([SAMPLE[0]])); await answer(c, how)
    same(String(how), { rows: rows(page), error: errorText(page) }, { rows: [row(SAMPLE[0])], error: '' }, 'an earlier list fetch that fails later is ignored')
  }
  fire(page.el('show-all'), 'click'); await flush()
  assert.deepEqual({ filter: valueIn(filter), fetches: pending(page) }, { filter: '', fetches: ['GET /api/bookings'] })
})
it('page: submit never reloads; it disables Book and POSTs exactly Content-Type: application/json and the values unchanged; a submit while disabled sends nothing', async () => {
  const page = await ready(); fill(page, FORM)
  assert.equal(await submit(page), true, 'preventDefault is called')
  const c = take(page, 'POST', '/api/bookings'), headers = (h => (Array.isArray(h) ? h : Object.entries(h ?? {})).map(([k, v]) => [String(k).toLowerCase(), v]))(c.opts?.headers)
  assert.deepEqual({ headers, body: sentFields(c.opts?.body), bookWhenSent: c.bookDisabled, book: state(page).book }, { headers: [['content-type', 'application/json']], body: FORM, bookWhenSent: true, book: 'disabled' })
  assert.equal(await submit(page), true, 'preventDefault on a submit while Book is disabled')
  await answer(c, x => x.reply(409, err('busy'))); page.el('book').disabled = true; await submit(page)
  assert.deepEqual(pending(page), [], 'a submit while Book is disabled sends nothing')
})
it('page: on 201 Book is enabled before anything else, only the title is emptied, #error is emptied and the list is fetched again with the filter', async () => {
  const page = await ready(); await failBooking(page); setValue(page.el('filter-date'), '2026-11-05'); await submit(page)
  await answer(take(page, 'POST', '/api/bookings'), c => c.reply(201, { id: 9, ...FORM, title: FORM.title.trim() }))
  const again = take(page, 'GET', '/api/bookings?date=2026-11-05')
  assert.deepEqual({ bookAtRefetch: again.bookDisabled, ...state(page) }, { bookAtRefetch: false, error: '', book: 'enabled', values: { ...FORM, title: '' }, rows: LIST, fetches: [] })
})
it('page: a booking reply with another status, or no reply, shows the message exactly and keeps the form and the list; no field is checked by the script', async () => {
  const cases = [[c => c.reply(409, err('room is already booked from 09:00 to 10:00')), 'room is already booked from 09:00 to 10:00'], [c => c.reply(400, err(E.title)), E.title, { ...FORM, title: ' ', date: '', start: '', end: '' }],
    [c => c.reply(200, { id: 1, ...FORM }), FAILED_REQ], [c => c.reply(500, err(['x'])), FAILED_REQ], [c => c.fail(), NO_REPLY], [c => c.reply(201, ''), NO_REPLY], [c => c.reply(409, '<html>'), NO_REPLY]]
  for (const [i, [how, error, values = FORM]] of cases.entries()) {
    const page = await ready(); fill(page, values); await submit(page)
    const c = take(page, 'POST', '/api/bookings'); await answer(c, how)
    same(i, { sent: sentFields(c.opts?.body), ...state(page) }, { sent: values, error, book: 'enabled', values, rows: LIST, fetches: [] })
  }
})
it('page: Cancel disables its button and sends DELETE /api/bookings/<its id>; then #error is emptied (204) or shows the message, and the list is fetched again', async () => {
  const cases = [[c => c.reply(204), ''], [c => c.reply(404, err('booking not found')), 'booking not found'], [c => c.reply(200, {}), FAILED_REQ], [c => c.reply(500, err(7)), FAILED_REQ], [c => c.fail(), NO_REPLY], [c => c.reply(500, 'oops'), NO_REPLY]]
  for (const [i, [how, error]] of cases.entries()) {
    const page = await ready(); await failBooking(page); setValue(page.el('filter-date'), '2026-11-03')
    const button = await cancel(page, 1), during = isDisabled(button)
    await answer(take(page, 'DELETE', '/api/bookings/1'), how)
    same(i, { during, after: isDisabled(button), error: errorText(page), fetches: pending(page) }, { during: true, after: false, error, fetches: error === NO_REPLY ? [] : ['GET /api/bookings?date=2026-11-03'] })
  }
})
it('the solution has a package.json (type module, start runs node server.mjs, a test script), a README with usage and node:test tests', () => {
  const pkg = JSON.parse(readFileSync(join(TARGET, 'package.json'), 'utf8')), readme = readdirSync(TARGET).find(f => /^readme(\.[a-z]+)?$/i.test(f))
  const sources = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? (['node_modules', '.git'].includes(e.name) ? [] : sources(join(dir, e.name))) : /\.[cm]?js$/.test(e.name) ? [join(dir, e.name)] : []))
  assert.deepEqual({ type: pkg.type, start: /^node (\.\/)?server\.mjs$/.test(pkg.scripts?.start?.trim() ?? ''), test: Boolean(pkg.scripts?.test?.trim()), readme: Boolean(readme && /npm start|server\.mjs/.test(readFileSync(join(TARGET, readme), 'utf8'))),
    nodeTest: sources(TARGET).some(f => /['"]node:test['"]/.test(readFileSync(f, 'utf8'))) }, { type: 'module', start: true, test: true, readme: true, nodeTest: true })
})
it('the listening line is the only thing the server wrote to stdout, after every request above', async () => {
  const s = await shared(); await get(s, '/nope'); await post(s, 'garbage')
  assert.equal(s.out, LINE(s.port))
})
