import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { ROOT, request, runToExit, startServer, tmpDir } from './helpers.mjs';

const JSON_TYPE = 'application/json; charset=utf-8';
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const BASE = { room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00' };
const DATE_ERR = 'date must be a valid YYYY-MM-DD date';
const ROOM_ERR = 'room must be one of Aurora, Borealis, Cosmos';
const TITLE_ERR = 'title must be 1 to 80 characters';

// ---------- helpers ----------

const omit = (obj, key) => Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));
const pad = (n) => String(n).padStart(2, '0');
const slot = (i) => ({ start: `${pad(i)}:00`, end: `${pad(i)}:30` });
const stored = (over = {}) => ({ id: 1, ...BASE, ...over });
const storeText = (bookings, nextId = 5) => JSON.stringify({ nextId, bookings });
const readStore = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function post(s, payload, headers = JSON_HEADERS) {
  const body = typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload);
  return s.req({ method: 'POST', path: '/api/bookings', headers, body });
}
const get = (s, target) => s.req({ path: target });
const book = (s, over = {}) => post(s, { ...BASE, ...over });

function expectJson(r, status, json, label = '') {
  assert.equal(r.status, status, `${label} status (body ${r.body})`);
  assert.equal(r.headers['content-type'], JSON_TYPE, `${label} content-type`);
  assert.deepEqual(r.json, json, `${label} body`);
}
const expectError = (r, status, message, label = '') => expectJson(r, status, { error: message }, label);

function paddedBody(total, obj = BASE) {
  const base = JSON.stringify(obj);
  return Buffer.from(base + ' '.repeat(total - Buffer.byteLength(base)));
}

async function startWithFile(t, content, env) {
  const dir = tmpDir(t);
  const dataFile = path.join(dir, 'data.json');
  fs.writeFileSync(dataFile, content);
  return startServer(t, { dir, dataFile, env });
}

function assertOneLine(stderr) {
  assert.match(stderr, /^[^\n]+\n$/, `stderr should be one line, got ${JSON.stringify(stderr)}`);
}

// ---------- startup: stdout and PORT ----------

test('stdout is exactly the listening line and nothing else', async (t) => {
  const s = await startServer(t);
  assert.ok(s.port > 0);
  await get(s, '/api/rooms');
  await book(s);
  await book(s);
  await post(s, 'junk', {});
  await s.req({ method: 'DELETE', path: '/api/bookings/1' });
  const stdout = await s.stop();
  assert.equal(stdout, `listening on http://127.0.0.1:${s.port}\n`);
});

for (const port of ['+80', ' 80', '80 ', '65536', 'abc', '-1', '1e3', '0x50']) {
  test(`invalid PORT ${JSON.stringify(port)} exits 1 with one stderr line`, async (t) => {
    const r = await runToExit(t, { env: { PORT: port } });
    assert.equal(r.code, 1);
    assert.equal(r.stdout, '');
    assertOneLine(r.stderr);
  });
}

test('PORT 00000 means port 0 and works', async (t) => {
  const s = await startServer(t, { env: { PORT: '00000' } });
  assert.ok(s.port > 0);
  assert.equal((await get(s, '/api/rooms')).status, 200);
});

test('port in use exits 1 with empty stdout', async (t) => {
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  t.after(() => blocker.close());
  const r = await runToExit(t, { env: { PORT: String(blocker.address().port) } });
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assertOneLine(r.stderr);
});

test('PORT is checked before the data file', async (t) => {
  const dir = tmpDir(t);
  const dataFile = path.join(dir, 'data.json');
  fs.writeFileSync(dataFile, 'not json');
  const r = await runToExit(t, { dir, dataFile, env: { PORT: 'abc' } });
  assert.equal(r.code, 1);
  assertOneLine(r.stderr);
  assert.ok(!r.stderr.includes('cannot read data file'), r.stderr);
});

test('data file is read before listening (bad file + port in use)', async (t) => {
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  t.after(() => blocker.close());
  const dir = tmpDir(t);
  const dataFile = path.join(dir, 'data.json');
  fs.writeFileSync(dataFile, 'not json');
  const r = await runToExit(t, { dir, dataFile, env: { PORT: String(blocker.address().port) } });
  assert.equal(r.code, 1);
  assert.equal(r.stderr, `cannot read data file ${dataFile}\n`);
});

// ---------- data file: missing, bad ----------

test('missing DATA_FILE: starts empty and never creates the file', async (t) => {
  const s = await startServer(t);
  assert.equal(fs.existsSync(s.dataFile), false, 'after startup');
  expectJson(await get(s, '/api/bookings'), 200, { bookings: [] });
  await get(s, '/api/rooms');
  assert.equal(fs.existsSync(s.dataFile), false, 'after GETs');
  await s.stop();
  assert.equal(fs.existsSync(s.dataFile), false, 'after stop');
});

test('missing parent folder: starts, POST gives 500 and rolls back, then works', async (t) => {
  const dir = tmpDir(t);
  const sub = path.join(dir, 'sub');
  const s = await startServer(t, { dir, dataFile: path.join(sub, 'x.json') });
  expectError(await book(s), 500, 'internal error');
  assert.equal(fs.existsSync(sub), false, 'folder must not be created');
  expectJson(await get(s, '/api/bookings'), 200, { bookings: [] });
  fs.mkdirSync(sub);
  expectJson(await book(s), 201, { id: 1, ...BASE });
  assert.equal(readStore(path.join(sub, 'x.json')).nextId, 2);
});

test('failed DELETE save gives 500, changes nothing, server keeps running', async (t) => {
  const dir = tmpDir(t);
  const sub = path.join(dir, 'sub');
  fs.mkdirSync(sub);
  const s = await startServer(t, { dir, dataFile: path.join(sub, 'x.json') });
  expectJson(await book(s), 201, { id: 1, ...BASE });
  fs.rmSync(sub, { recursive: true });
  expectError(await s.req({ method: 'DELETE', path: '/api/bookings/1' }), 500, 'internal error');
  assert.equal(fs.existsSync(sub), false);
  expectJson(await get(s, '/api/bookings'), 200, { bookings: [{ id: 1, ...BASE }] });
  fs.mkdirSync(sub);
  assert.equal((await s.req({ method: 'DELETE', path: '/api/bookings/1' })).status, 204);
  expectJson(await book(s), 201, { id: 2, ...BASE });
});

const BAD_DATA = [
  ['empty file', ''],
  ['not json', 'not json'],
  ['empty object', '{}'],
  ['array', '[]'],
  ['null', 'null'],
  ['missing bookings', '{"nextId":1}'],
  ['extra top-level key', '{"nextId":1,"bookings":[],"x":1}'],
  ['nextId 0', '{"nextId":0,"bookings":[]}'],
  ['nextId 1.5', '{"nextId":1.5,"bookings":[]}'],
  ['nextId string', '{"nextId":"2","bookings":[]}'],
  ['bookings not an array', '{"nextId":1,"bookings":{}}'],
  ['booking is null', storeText([null])],
  ['booking extra key', storeText([stored({ x: 1 })])],
  ['booking missing key', storeText([omit(stored(), 'title')])],
  ['id is a string', storeText([stored({ id: '1' })])],
  ['id 0', storeText([stored({ id: 0 })])],
  ['id equals nextId', storeText([stored({ id: 5 })])],
  ['id above nextId', storeText([stored({ id: 6 })])],
  ['duplicate ids', storeText([stored(), stored({ room: 'Cosmos' })])],
  ['bad room', storeText([stored({ room: 'aurora' })])],
  ['bad date 2100-02-29', storeText([stored({ date: '2100-02-29' })])],
  ['untrimmed title', storeText([stored({ title: ' T' })])],
  ['empty title', storeText([stored({ title: '' })])],
  ['end equals start', storeText([stored({ end: '09:00' })])],
  ['end before start', storeText([stored({ end: '08:00' })])],
  ['end 24:00', storeText([stored({ end: '24:00' })])],
  ['start 24:00', storeText([stored({ start: '24:00', end: '24:30' })])],
  ['overlapping bookings', storeText([stored({ id: 1 }), stored({ id: 2, start: '09:30', end: '10:30' })])],
  ['BOM prefixed valid json', `﻿${storeText([])}`],
];

for (const [label, content] of BAD_DATA) {
  test(`bad data file: ${label}`, async (t) => {
    const dir = tmpDir(t);
    const dataFile = path.join(dir, 'data.json');
    fs.writeFileSync(dataFile, content);
    const r = await runToExit(t, { dir, dataFile });
    assert.equal(r.code, 1);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, `cannot read data file ${dataFile}\n`);
  });
}

test('bad data file: path is a directory', async (t) => {
  const dir = tmpDir(t);
  const r = await runToExit(t, { dir, dataFile: dir });
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, `cannot read data file ${dir}\n`);
});

test('bad data file: relative DATA_FILE is reported as given', async (t) => {
  const dir = tmpDir(t);
  fs.writeFileSync(path.join(dir, 'data.json'), 'nope');
  const r = await runToExit(t, { dir, env: { DATA_FILE: 'data.json' } });
  assert.equal(r.code, 1);
  assert.equal(r.stderr, 'cannot read data file data.json\n');
});

for (const [label, value] of [['unset', undefined], ['empty', '']]) {
  test(`${label} DATA_FILE defaults to bookings.json in cwd`, async (t) => {
    const dir = tmpDir(t);
    fs.writeFileSync(path.join(dir, 'bookings.json'), 'nope');
    const r = await runToExit(t, { dir, env: { DATA_FILE: value } });
    assert.equal(r.code, 1);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, 'cannot read data file bookings.json\n');
  });
}

test('relative DATA_FILE resolves against the cwd', async (t) => {
  const dir = tmpDir(t);
  const s = await startServer(t, { dir, env: { DATA_FILE: 'rel.json' } });
  expectJson(await book(s), 201, { id: 1, ...BASE });
  assert.deepEqual(readStore(path.join(dir, 'rel.json')), { nextId: 2, bookings: [{ id: 1, ...BASE }] });
});

test('unset DATA_FILE writes bookings.json in the cwd', async (t) => {
  const dir = tmpDir(t);
  const s = await startServer(t, { dir, env: { DATA_FILE: undefined } });
  await book(s);
  assert.equal(readStore(path.join(dir, 'bookings.json')).bookings.length, 1);
});

// ---------- persistence ----------

test('file written by the server has exactly nextId and bookings and is reloaded', async (t) => {
  const s = await startServer(t);
  await book(s);
  assert.deepEqual(Object.keys(readStore(s.dataFile)).sort(), ['bookings', 'nextId']);
  await s.stop();
  const again = await startServer(t, { dir: s.dir, dataFile: s.dataFile });
  expectJson(await get(again, '/api/bookings'), 200, { bookings: [{ id: 1, ...BASE }] });
});

test('persistence: POST 2, DELETE 1, restart keeps the rest and next id 3', async (t) => {
  const s = await startServer(t);
  await book(s, { ...slot(1) });
  const second = await book(s, { ...slot(2) });
  assert.equal(second.json.id, 2);
  assert.equal((await s.req({ method: 'DELETE', path: '/api/bookings/1' })).status, 204);
  await s.stop();
  const again = await startServer(t, { dir: s.dir, dataFile: s.dataFile });
  expectJson(await get(again, '/api/bookings'), 200, { bookings: [{ id: 2, ...BASE, ...slot(2) }] });
  expectJson(await book(again, { ...slot(3) }), 201, { id: 3, ...BASE, ...slot(3) });
});

test('ids are not reused after delete and restart', async (t) => {
  const s = await startServer(t);
  await book(s);
  await s.req({ method: 'DELETE', path: '/api/bookings/1' });
  await s.stop();
  const again = await startServer(t, { dir: s.dir, dataFile: s.dataFile });
  assert.equal((await book(again)).json.id, 2);
});

test('hand-written valid file loads; next id is nextId', async (t) => {
  const content = `{ "nextId" : 5 ,\n  "bookings":[ ${JSON.stringify(stored({ id: 2 }))} ] }\n`;
  const s = await startWithFile(t, content);
  expectJson(await get(s, '/api/bookings'), 200, { bookings: [{ id: 2, ...BASE }] });
  expectError(await book(s), 409, 'room is already booked from 09:00 to 10:00');
  expectJson(await book(s, { room: 'Cosmos' }), 201, { id: 5, ...BASE, room: 'Cosmos' });
});

test('the file is written only by successful POST and DELETE', async (t) => {
  const content = `{ "nextId" : 3 ,\n "bookings":[ ${JSON.stringify(stored({ id: 2 }))} ] }\n\n`;
  const s = await startWithFile(t, content);
  const before = fs.readFileSync(s.dataFile);
  const mtime = fs.statSync(s.dataFile).mtimeMs;
  const probes = [
    () => get(s, '/api/bookings'),
    () => get(s, '/api/bookings?date=2026-11-03'),
    () => get(s, '/api/rooms'),
    () => get(s, '/nope'),
    () => post(s, BASE, {}),
    () => post(s, paddedBody(10001)),
    () => post(s, 'junk'),
    () => post(s, { ...BASE, room: 'x' }),
    () => book(s),
    () => s.req({ method: 'DELETE', path: '/api/bookings/99' }),
    () => s.req({ method: 'DELETE', path: '/api/bookings/abc' }),
    () => s.req({ method: 'PUT', path: '/api/bookings' }),
    () => s.req({ method: 'POST', path: '/api/rooms' }),
  ];
  for (const probe of probes) await probe();
  assert.ok(fs.readFileSync(s.dataFile).equals(before), 'bytes changed');
  assert.equal(fs.statSync(s.dataFile).mtimeMs, mtime, 'mtime changed');
  await book(s, { room: 'Cosmos' });
  assert.ok(!fs.readFileSync(s.dataFile).equals(before), 'successful POST must write');
});

// ---------- API: rooms, content type, listing ----------

test('GET /api/rooms exact body and content type', async (t) => {
  const s = await startServer(t);
  const r = await get(s, '/api/rooms');
  expectJson(r, 200, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
  expectJson(await get(s, '/api/rooms?x'), 200, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
});

test('every JSON error reply has the exact content type', async (t) => {
  const s = await startServer(t);
  const replies = [
    await get(s, '/nope'),
    await get(s, '/api/bookings?date=x'),
    await s.req({ method: 'PUT', path: '/api/rooms' }),
    await s.req({ method: 'DELETE', path: '/api/bookings/5' }),
    await post(s, 'x', {}),
    await post(s, 'x'),
  ];
  for (const r of replies) {
    assert.equal(r.headers['content-type'], JSON_TYPE);
    assert.deepEqual(Object.keys(r.json), ['error']);
    assert.equal(typeof r.json.error, 'string');
  }
});

const SORT_FIXTURE = [
  { room: 'Aurora', date: '2026-11-04', start: '07:00', end: '08:00' },
  { room: 'Cosmos', date: '2026-11-03', start: '09:00', end: '10:00' },
  { room: 'Borealis', date: '2026-11-03', start: '09:00', end: '10:00' },
  { room: 'Aurora', date: '2026-11-03', start: '09:00', end: '10:00' },
  { room: 'Cosmos', date: '2026-11-03', start: '08:00', end: '08:30' },
];

test('bookings are sorted by date, then start, then room order', async (t) => {
  const s = await startServer(t);
  for (const b of SORT_FIXTURE) assert.equal((await book(s, b)).status, 201);
  const r = await get(s, '/api/bookings');
  const got = r.json.bookings.map(({ room, date, start }) => `${date} ${start} ${room}`);
  assert.deepEqual(got, [
    '2026-11-03 08:00 Cosmos',
    '2026-11-03 09:00 Aurora',
    '2026-11-03 09:00 Borealis',
    '2026-11-03 09:00 Cosmos',
    '2026-11-04 07:00 Aurora',
  ]);
});

test('date query parameter handling', async (t) => {
  const s = await startServer(t);
  for (const b of SORT_FIXTURE) await book(s, b);
  const count = async (q) => {
    const r = await get(s, `/api/bookings${q}`);
    assert.equal(r.status, 200, q);
    assert.equal(r.headers['content-type'], JSON_TYPE);
    return r.json.bookings.length;
  };
  assert.equal(await count('?date=2026-11-03'), 4);
  assert.equal(await count('?date=2026-11-04'), 1);
  assert.equal(await count('?date=2026-11-05'), 0);
  assert.equal(await count('?x=1'), 5);
  assert.equal(await count('?date=2026-11-03&date=bad'), 4);
  assert.equal(await count('?date=2026%2D11%2D03'), 4);
  assert.equal(await count('?x=1&date=2026-11-04'), 1);
  for (const q of ['?date', '?date=', '?date=2026-11-3', '?date=bad&date=2026-11-03', '?date=2026-02-30']) {
    expectError(await get(s, `/api/bookings${q}`), 400, DATE_ERR, q);
  }
});

// ---------- routing ----------

const UNROUTED = [
  '/api/%62ookings', '/api/./rooms', '/API/rooms', '/api/bookings/', '/api/bookings/1/',
  '/api/rooms/', '//api/rooms', '/index.html', '/api', '/app.js/', '/api/bookings/1/2',
];

test('paths are compared byte for byte: others are 404 not found for every method', async (t) => {
  const s = await startServer(t);
  await book(s);
  for (const target of UNROUTED) {
    for (const method of ['GET', 'DELETE', 'POST']) {
      const r = await s.req({ method, path: target, headers: JSON_HEADERS, body: method === 'POST' ? JSON.stringify(BASE) : undefined });
      expectError(r, 404, 'not found', `${method} ${target}`);
    }
  }
  expectJson(await get(s, '/api/bookings'), 200, { bookings: [{ id: 1, ...BASE }] });
});

const NOT_ALLOWED = [
  ['POST', '/api/rooms'], ['DELETE', '/api/rooms'], ['PUT', '/api/rooms'], ['HEAD', '/api/rooms'],
  ['OPTIONS', '/api/rooms'], ['PUT', '/api/bookings'], ['DELETE', '/api/bookings'], ['HEAD', '/api/bookings'],
  ['OPTIONS', '/api/bookings'], ['GET', '/api/bookings/abc'], ['POST', '/api/bookings/1'],
  ['GET', '/api/bookings/1'], ['PUT', '/api/bookings/1'], ['HEAD', '/api/bookings/1'],
  ['POST', '/'], ['HEAD', '/'], ['DELETE', '/app.js'], ['POST', '/app.js'],
];

test('methods not listed for a path give 405 method not allowed', async (t) => {
  const s = await startServer(t);
  for (const [method, target] of NOT_ALLOWED) {
    const r = await s.req({ method, path: target });
    const label = `${method} ${target}`;
    if (method === 'HEAD') assert.equal(r.status, 405, label);
    else expectError(r, 405, 'method not allowed', label);
  }
});

// ---------- pages ----------

for (const [target, file, type] of [
  ['/', 'index.html', 'text/html; charset=utf-8'],
  ['/app.js', 'app.js', 'text/javascript; charset=utf-8'],
]) {
  test(`GET ${target} serves public/${file}`, async (t) => {
    const full = path.join(ROOT, 'public', file);
    if (!fs.existsSync(full)) return t.skip(`${full} not present`);
    const s = await startServer(t);
    const r = await get(s, target);
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], type);
    assert.ok(r.raw.equals(fs.readFileSync(full)), 'body differs from file');
  });
}

// ---------- DELETE ----------

test('DELETE removes the booking: 204 empty, then 404 booking not found', async (t) => {
  const s = await startServer(t);
  await book(s);
  const r = await s.req({ method: 'DELETE', path: '/api/bookings/1' });
  assert.equal(r.status, 204);
  assert.equal(r.body, '');
  expectJson(await get(s, '/api/bookings'), 200, { bookings: [] });
  expectError(await s.req({ method: 'DELETE', path: '/api/bookings/1' }), 404, 'booking not found');
});

test('DELETE with an id that is not a canonical positive integer is 404', async (t) => {
  const s = await startServer(t);
  await book(s);
  for (const id of ['01', '0', '-1', '1.0', 'abc', '%31', '%201', '99', '+1', '1e0', '0x1', '%EF%BC%91']) {
    expectError(await s.req({ method: 'DELETE', path: `/api/bookings/${id}` }), 404, 'booking not found', id);
  }
  assert.equal((await get(s, '/api/bookings')).json.bookings.length, 1);
});

// ---------- POST: content type, size ----------

test('415 for missing or wrong media type', async (t) => {
  const s = await startServer(t);
  const body = JSON.stringify(BASE);
  const cases = [undefined, 'text/plain', 'application/json5', 'application/jsonx', '', 'application/json,text/plain'];
  for (const ct of cases) {
    const headers = ct === undefined ? {} : { 'Content-Type': ct };
    const r = await s.req({ method: 'POST', path: '/api/bookings', headers, body });
    expectError(r, 415, 'content type must be application/json', String(ct));
  }
});

test('media type matching ignores case, surrounding blanks and parameters', async (t) => {
  const s = await startServer(t);
  const types = ['Application/JSON', ' application/json ; charset=utf-8', '\tapplication/json\t;x', 'application/json;', 'APPLICATION/JSON;a=b'];
  for (const [i, ct] of types.entries()) {
    const r = await post(s, { ...BASE, ...slot(i) }, { 'Content-Type': ct });
    assert.equal(r.status, 201, JSON.stringify(ct));
  }
});

test('415 beats 413 and beats an invalid body', async (t) => {
  const s = await startServer(t);
  const headers = { 'Content-Type': 'text/plain' };
  expectError(await post(s, paddedBody(10001), headers), 415, 'content type must be application/json');
  expectError(await post(s, 'garbage', headers), 415, 'content type must be application/json');
  expectError(await post(s, '', {}), 415, 'content type must be application/json');
});

test('415 with a 1 MB body still delivers the reply', async (t) => {
  const s = await startServer(t);
  const r = await post(s, Buffer.alloc(1024 * 1024, 0x61), { 'Content-Type': 'text/plain' });
  expectError(r, 415, 'content type must be application/json');
});

test('413 at 10001 bytes, accepted at exactly 10000', async (t) => {
  const s = await startServer(t);
  expectError(await post(s, paddedBody(10001)), 413, 'body too large');
  expectJson(await post(s, paddedBody(10000)), 201, { id: 1, ...BASE });
});

test('413 counts bytes, not characters', async (t) => {
  const s = await startServer(t);
  expectError(await post(s, { ...BASE, x: 'é'.repeat(5001) }), 413, 'body too large');
  const r = await post(s, { ...BASE, x: 'é'.repeat(4900) });
  assert.equal(r.status, 201);
});

test('413 beats 400 for an oversized garbage body', async (t) => {
  const s = await startServer(t);
  expectError(await post(s, 'x'.repeat(10001)), 413, 'body too large');
});

test('413 with a 1 MB body still delivers the reply', async (t) => {
  const s = await startServer(t);
  expectError(await post(s, paddedBody(1024 * 1024)), 413, 'body too large');
  assert.equal((await get(s, '/api/rooms')).status, 200);
});

test('chunked bodies are counted by bytes received', async (t) => {
  const s = await startServer(t);
  const big = paddedBody(10001);
  const split = (buf) => [buf.subarray(0, 100), buf.subarray(100, 5000), buf.subarray(5000)];
  const over = await s.req({ method: 'POST', path: '/api/bookings', headers: JSON_HEADERS, chunks: split(big) });
  expectError(over, 413, 'body too large');
  const exact = paddedBody(10000);
  const ok = await s.req({ method: 'POST', path: '/api/bookings', headers: JSON_HEADERS, chunks: split(exact) });
  assert.equal(ok.status, 201);
});

// ---------- POST: body and field rules ----------

test('400 body must be a JSON object', async (t) => {
  const s = await startServer(t);
  const valid = Buffer.from(JSON.stringify(BASE));
  const bodies = [
    ['empty', ''], ['null', 'null'], ['array', '[]'], ['string', '"s"'], ['number', '1'],
    ['true', 'true'], ['broken', '{bad'], ['BOM', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), valid])],
  ];
  for (const [label, body] of bodies) {
    expectError(await post(s, body), 400, 'body must be a JSON object', label);
  }
});

test('invalid UTF-8 becomes U+FFFD and is not a body error', async (t) => {
  const s = await startServer(t);
  const body = Buffer.concat([
    Buffer.from('{"room":"Aurora","title":"a'),
    Buffer.from([0xff]),
    Buffer.from('","date":"2026-11-03","start":"09:00","end":"10:00"}'),
  ]);
  const r = await post(s, body);
  expectJson(r, 201, { id: 1, ...BASE, title: 'a�' });
});

test('room must be an exact room name', async (t) => {
  const s = await startServer(t);
  const bad = [undefined, 'aurora', 'Aurora ', 5, null, ['Aurora'], '', 'Delta'];
  for (const room of bad) {
    const payload = room === undefined ? omit(BASE, 'room') : { ...BASE, room };
    expectError(await post(s, payload), 400, ROOM_ERR, JSON.stringify(room));
  }
  for (const [i, room] of ['Aurora', 'Borealis', 'Cosmos'].entries()) {
    assert.equal((await book(s, { room })).json.id, i + 1);
  }
});

test('title rules and trimming', async (t) => {
  const s = await startServer(t);
  const bad = [undefined, 5, null, '', '   ', '\t\n', 'a'.repeat(81), '😀'.repeat(41), ['a']];
  for (const title of bad) {
    const payload = title === undefined ? omit(BASE, 'title') : { ...BASE, title };
    expectError(await post(s, payload), 400, TITLE_ERR, JSON.stringify(title));
  }
  const good = [
    ['a'.repeat(80), 'a'.repeat(80)],
    [`  ${'a'.repeat(80)}  `, 'a'.repeat(80)],
    ['😀'.repeat(40), '😀'.repeat(40)],
    ['　 x\n', 'x'],
    [` ${'😀'.repeat(40)} `, '😀'.repeat(40)],
  ];
  for (const [i, [title, expected]] of good.entries()) {
    const r = await book(s, { title, ...slot(i) });
    expectJson(r, 201, { id: i + 1, ...BASE, ...slot(i), title: expected }, JSON.stringify(title));
  }
  assert.equal((await get(s, '/api/bookings')).json.bookings[0].title, 'a'.repeat(80));
});

test('date rules', async (t) => {
  const s = await startServer(t);
  const bad = ['2026-11-3', ' 2026-11-03', '2026-11-03 ', '2026-11-03\n', '2100-02-29', '2100-01-01', '1999-12-31',
    '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '２０２６-11-03', '2026/11/03', '', 'x'];
  for (const date of [...bad, 20261103, null]) {
    expectError(await book(s, { date }), 400, DATE_ERR, JSON.stringify(date));
  }
  expectError(await post(s, omit(BASE, 'date')), 400, DATE_ERR, 'missing');
  for (const date of ['2096-02-29', '2000-02-29', '2000-01-01', '2099-12-31', '2026-02-28', '2025-12-31']) {
    const r = await book(s, { date });
    assert.equal(r.status, 201, date);
    assert.equal(r.json.date, date);
  }
});

test('start and end rules', async (t) => {
  const s = await startServer(t);
  const badTimes = ['9:00', '24:00', '12:60', '09:00 ', ' 09:00', '0900', '09-00', '', '０９:００', 900, null];
  for (const value of badTimes) {
    expectError(await book(s, { start: value, end: '23:59' }), 400, 'start must be HH:MM', `start ${JSON.stringify(value)}`);
    expectError(await book(s, { end: value }), 400, 'end must be HH:MM', `end ${JSON.stringify(value)}`);
  }
  expectError(await post(s, omit(BASE, 'start')), 400, 'start must be HH:MM');
  expectError(await post(s, omit(BASE, 'end')), 400, 'end must be HH:MM');
  expectJson(await book(s, { start: '00:00', end: '23:59' }), 201, { id: 1, ...BASE, start: '00:00', end: '23:59' });
  expectJson(await book(s, { room: 'Cosmos', start: '23:58', end: '23:59' }), 201, { id: 2, ...BASE, room: 'Cosmos', start: '23:58', end: '23:59' });
});

test('end must be after start', async (t) => {
  const s = await startServer(t);
  for (const [start, end] of [['09:00', '09:00'], ['09:00', '08:59'], ['23:59', '00:00'], ['10:00', '09:00']]) {
    expectError(await book(s, { start, end }), 400, 'end must be after start', `${start}-${end}`);
  }
  expectJson(await book(s, { start: '00:00', end: '00:01' }), 201, { id: 1, ...BASE, start: '00:00', end: '00:01' });
});

test('the first failing rule decides the reply', async (t) => {
  const s = await startServer(t);
  await book(s);
  const bad = { room: 'x', title: '', date: 'x', start: 'x', end: 'x' };
  const steps = [
    [['room'], ROOM_ERR],
    [['title'], TITLE_ERR],
    [['date'], DATE_ERR],
    [['start'], 'start must be HH:MM'],
    [['end'], 'end must be HH:MM'],
  ];
  for (let i = 0; i < steps.length; i += 1) {
    const payload = { ...BASE };
    for (const key of steps.slice(i).flatMap(([keys]) => keys)) payload[key] = bad[key];
    expectError(await post(s, payload), 400, steps[i][1], `step ${i}`);
  }
  expectError(await book(s, { start: '09:30', end: '09:30' }), 400, 'end must be after start', 'beats 409');
  expectError(await book(s, { start: '09:30', end: '09:00' }), 400, 'end must be after start', 'beats 409 (before)');
});

test('extra keys are ignored and the reply has exactly the booking keys', async (t) => {
  const s = await startServer(t);
  const r = await post(s, { ...BASE, id: 99, extra: 1, nested: { a: 1 } });
  expectJson(r, 201, { id: 1, ...BASE });
  assert.equal(typeof r.json.id, 'number');
  assert.deepEqual(Object.keys(r.json).sort(), ['date', 'end', 'id', 'room', 'start', 'title']);
});

// ---------- POST: conflicts, ids, concurrency ----------

test('409 names the overlapping booking that starts earliest', async (t) => {
  const s = await startServer(t);
  const forward = [['09:00', '10:00'], ['10:30', '11:00']];
  for (const [room, order] of [['Aurora', forward], ['Borealis', [...forward].reverse()]]) {
    for (const [start, end] of order) assert.equal((await book(s, { room, start, end })).status, 201);
    const r = await book(s, { room, start: '09:30', end: '10:45' });
    expectError(r, 409, 'room is already booked from 09:00 to 10:00', room);
  }
});

test('409 for contained, containing and equal ranges', async (t) => {
  const s = await startServer(t);
  await book(s, { start: '09:00', end: '12:00' });
  const cases = [['10:00', '11:00'], ['08:00', '13:00'], ['09:00', '12:00'], ['08:00', '09:01'], ['11:59', '13:00']];
  for (const [start, end] of cases) {
    expectError(await book(s, { start, end }), 409, 'room is already booked from 09:00 to 12:00', `${start}-${end}`);
  }
});

test('touching, other room and other date are allowed', async (t) => {
  const s = await startServer(t);
  await book(s, { start: '10:00', end: '10:30' });
  for (const over of [{ start: '09:00', end: '10:00' }, { start: '10:30', end: '11:00' }, { room: 'Cosmos' }, { date: '2026-11-04' }]) {
    const r = await book(s, over.start || over.end ? over : { start: '10:00', end: '10:30', ...over });
    assert.equal(r.status, 201, JSON.stringify(over));
  }
});

test('ids: 1, 2, a 409 consumes none, after DELETE of 2 the next is 3', async (t) => {
  const s = await startServer(t);
  assert.equal((await book(s, slot(1))).json.id, 1);
  assert.equal((await book(s, slot(2))).json.id, 2);
  assert.equal((await book(s, slot(2))).status, 409);
  assert.equal((await post(s, 'junk')).status, 400);
  await s.req({ method: 'DELETE', path: '/api/bookings/2' });
  assert.equal((await book(s, slot(2))).json.id, 3);
});

test('20 concurrent overlapping POSTs: exactly one 201, the rest 409', async (t) => {
  const s = await startServer(t);
  const replies = await Promise.all(Array.from({ length: 20 }, (_, i) => book(s, { title: `t${i}`, start: '09:00', end: '12:00' })));
  const statuses = replies.map((r) => r.status);
  assert.equal(statuses.filter((x) => x === 201).length, 1);
  assert.equal(statuses.filter((x) => x === 409).length, 19);
  assert.equal(readStore(s.dataFile).bookings.length, 1);
});

test('20 concurrent non-overlapping POSTs: distinct ids 1..20, nextId 21', async (t) => {
  const s = await startServer(t);
  const replies = await Promise.all(Array.from({ length: 20 }, (_, i) => book(s, slot(i))));
  assert.ok(replies.every((r) => r.status === 201));
  const ids = replies.map((r) => r.json.id).sort((a, b) => a - b);
  assert.deepEqual(ids, Array.from({ length: 20 }, (_, i) => i + 1));
  const saved = readStore(s.dataFile);
  assert.equal(saved.nextId, 21);
  assert.equal(saved.bookings.length, 20);
});

test('server keeps running after a 500', async (t) => {
  const dir = tmpDir(t);
  const s = await startServer(t, { dir, dataFile: path.join(dir, 'missing', 'x.json') });
  expectError(await book(s), 500, 'internal error');
  assert.equal(s.child.exitCode, null);
  expectJson(await get(s, '/api/rooms'), 200, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
});

test('request helper sanity: raw path is sent unchanged', async (t) => {
  const s = await startServer(t);
  const r = await request(s.port, { path: '/api/rooms' });
  assert.equal(r.status, 200);
});
