// Black-box smoke tests: spawn `node server.mjs` and talk to it over HTTP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'server.mjs');
const JSON_TYPE = 'application/json; charset=utf-8';
const JSON_HEADERS = { 'content-type': 'application/json' };
const LISTEN_RE = /^listening on http:\/\/127\.0\.0\.1:(\d+)\n$/;

function makeTmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booking-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function spawnServer({ env = {}, cwd }, dir) {
  const fullEnv = { ...process.env, PORT: '0', DATA_FILE: path.join(dir, 'data.json'), ...env };
  return spawn(process.execPath, [SERVER], { env: fullEnv, cwd: cwd ?? dir });
}

function startServer(t, dir, opts = {}) {
  const child = spawnServer(opts, dir);
  t.after(() => child.kill('SIGKILL'));
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    child.stdout.on('data', (d) => {
      out += d;
      const m = LISTEN_RE.exec(out);
      if (m) resolve({ port: Number(m[1]), child, stdout: out });
    });
    child.on('exit', (code) => reject(new Error(`exited ${code} before listening: ${err}`)));
  });
}

function runToExit(t, dir, opts = {}) {
  const child = spawnServer(opts, dir);
  t.after(() => child.kill('SIGKILL'));
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => reject(new Error('server did not exit in 5s')), 5000);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => { // after stdio is drained, unlike 'exit'
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function request(port, method, reqPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: reqPath, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch { json = undefined; }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

const post = (port, obj, headers = JSON_HEADERS) => request(port, 'POST', '/api/bookings',
  { headers, body: typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj) });

const valid = (over = {}) => ({
  room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '10:00', end: '11:00', ...over,
});

async function boot(t, opts) {
  const dir = makeTmp(t);
  const srv = await startServer(t, dir, opts);
  return { dir, ...srv };
}

function assertError(res, status, message) {
  assert.equal(res.status, status);
  assert.deepEqual(res.json, { error: message });
}

function oneLine(stderr) {
  const lines = stderr.split('\n');
  return lines.length === 2 && lines[0] !== '' && lines[1] === '';
}

test('startup: invalid PORT values exit 1 with one stderr line', async (t) => {
  for (const port of ['abc', '65536', '-1', ' 80']) {
    const dir = makeTmp(t);
    const r = await runToExit(t, dir, { env: { PORT: port } });
    assert.equal(r.code, 1, `PORT=${JSON.stringify(port)}`);
    assert.ok(oneLine(r.stderr), `stderr for ${port}: ${JSON.stringify(r.stderr)}`);
    assert.equal(r.stdout, '');
  }
});

test('startup: PORT in use exits 1 with empty stdout', async (t) => {
  const blocker = net.createServer();
  await new Promise((res) => blocker.listen(0, '127.0.0.1', res));
  t.after(() => blocker.close());
  const dir = makeTmp(t);
  const r = await runToExit(t, dir, { env: { PORT: String(blocker.address().port) } });
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.ok(r.stderr.length > 0);
});

test('startup: unusable data files exit 1 with the given name', async (t) => {
  const contents = ['', 'not json', '[]', '{"nextId":1}'];
  const dir = makeTmp(t);
  const asDir = path.join(dir, 'adir');
  fs.mkdirSync(asDir);
  const cases = [asDir];
  contents.forEach((c, i) => {
    const f = path.join(dir, `bad${i}.json`);
    fs.writeFileSync(f, c);
    cases.push(f);
  });
  for (const file of cases) {
    const r = await runToExit(t, dir, { env: { DATA_FILE: file } });
    assert.equal(r.code, 1, file);
    assert.equal(r.stderr, `cannot read data file ${file}\n`);
    assert.equal(r.stdout, '');
  }
});

test('startup: relative DATA_FILE is echoed as given', async (t) => {
  const dir = makeTmp(t);
  fs.mkdirSync(path.join(dir, 'sub'));
  const r = await runToExit(t, dir, { env: { DATA_FILE: 'sub' }, cwd: dir });
  assert.equal(r.code, 1);
  assert.equal(r.stderr, 'cannot read data file sub\n');
});

test('startup: PORT is checked before the data file', async (t) => {
  const dir = makeTmp(t);
  fs.writeFileSync(path.join(dir, 'bad.json'), 'not json');
  const r = await runToExit(t, dir, { env: { PORT: 'abc', DATA_FILE: path.join(dir, 'bad.json') } });
  assert.equal(r.code, 1);
  assert.ok(!r.stderr.includes('cannot read data file'), r.stderr);
  assert.ok(r.stderr.length > 0);
});

test('missing data file or folder starts empty and is never created', async (t) => {
  for (const rel of ['data.json', path.join('nofolder', 'data.json')]) {
    const dir = makeTmp(t);
    const file = path.join(dir, rel);
    const { port } = await startServer(t, dir, { env: { DATA_FILE: file } });
    const res = await request(port, 'GET', '/api/bookings');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { bookings: [] });
    await request(port, 'GET', '/api/rooms');
    await request(port, 'GET', '/api/bookings?date=2026-11-03');
    assert.ok(!fs.existsSync(file), `${rel} must not exist`);
    assert.ok(!fs.existsSync(path.dirname(file)) || path.dirname(file) === dir);
  }
});

test('stdout is exactly the listening line with a real port', async (t) => {
  const { port, stdout } = await boot(t);
  assert.ok(port > 0);
  assert.equal(stdout, `listening on http://127.0.0.1:${port}\n`);
});

test('GET /api/rooms and query is ignored', async (t) => {
  const { port } = await boot(t);
  const res = await request(port, 'GET', '/api/rooms');
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], JSON_TYPE);
  assert.deepEqual(res.json, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
  assert.equal((await request(port, 'GET', '/api/rooms?x=1')).status, 200);
});

test('routing: 404 for unknown paths, 405 for wrong methods', async (t) => {
  const { port } = await boot(t);
  const missing = ['/api/%62ookings', '/api/./rooms', '/API/rooms', '/api/bookings/', '/api/bookings/1/', '/nope'];
  for (const p of missing) {
    for (const m of ['GET', 'POST']) {
      const res = await request(port, m, p);
      assertError(res, 404, 'not found');
      assert.equal(res.headers['content-type'], JSON_TYPE);
    }
  }
  const wrong = [['GET', '/api/bookings/abc'], ['PUT', '/api/rooms'], ['POST', '/api/rooms'],
    ['OPTIONS', '/api/bookings'], ['DELETE', '/api/bookings'], ['POST', '/']];
  for (const [m, p] of wrong) assertError(await request(port, m, p), 405, 'method not allowed');
  assert.equal((await request(port, 'HEAD', '/api/rooms')).status, 405);
});

test('DELETE: bad ids are 404, existing id is 204 once', async (t) => {
  const { port } = await boot(t);
  for (const id of ['abc', '0', '01', '999']) {
    assertError(await request(port, 'DELETE', `/api/bookings/${id}`), 404, 'booking not found');
  }
  assert.equal((await post(port, valid())).status, 201);
  const del = await request(port, 'DELETE', '/api/bookings/1');
  assert.equal(del.status, 204);
  assert.equal(del.text, '');
  assertError(await request(port, 'DELETE', '/api/bookings/1'), 404, 'booking not found');
});

test('rule 1 and 2: content type then size', async (t) => {
  const { port } = await boot(t);
  const msg = 'content type must be application/json';
  assertError(await post(port, valid(), {}), 415, msg);
  assertError(await post(port, valid(), { 'content-type': 'text/plain' }), 415, msg);
  const ok = await post(port, valid(), { 'content-type': ' APPLICATION/JSON \t; charset=x' });
  assert.equal(ok.status, 201);
  const big = 'x'.repeat(10001);
  assertError(await post(port, big, {}), 415, msg);
  assertError(await post(port, big, JSON_HEADERS), 413, 'body too large');
  const exact = JSON.stringify(valid({ title: 'Padded', start: '12:00', end: '13:00' }));
  const padded = exact + ' '.repeat(10000 - Buffer.byteLength(exact));
  assert.equal(Buffer.byteLength(padded), 10000);
  assert.equal((await post(port, padded)).status, 201);
});

test('rule 3: body must be a JSON object', async (t) => {
  const { port } = await boot(t);
  for (const body of ['', 'null', '[]', '"s"', '1', 'true', '{bad', '\uFEFF{}']) {
    assertError(await post(port, body), 400, 'body must be a JSON object');
  }
});

test('rules 4-5: room and title', async (t) => {
  const { port } = await boot(t);
  const roomMsg = 'room must be one of Aurora, Borealis, Cosmos';
  assertError(await post(port, valid({ room: 'aurora' })), 400, roomMsg);
  const { room, ...noRoom } = valid();
  assertError(await post(port, noRoom), 400, roomMsg);
  const titleMsg = 'title must be 1 to 80 characters';
  for (const title of ['   ', 'x'.repeat(81), 5]) {
    assertError(await post(port, valid({ title })), 400, titleMsg);
  }
  const trimmed = await post(port, valid({ title: '  hi  ' }));
  assert.equal(trimmed.status, 201);
  assert.equal(trimmed.json.title, 'hi');
  const long = await post(port, valid({ title: ` ${'y'.repeat(80)} `, start: '12:00', end: '13:00' }));
  assert.equal(long.status, 201);
  assert.equal(long.json.title.length, 80);
});

test('rules 6-9: date, start, end, order', async (t) => {
  const { port } = await boot(t);
  const dateMsg = 'date must be a valid YYYY-MM-DD date';
  const badDates = ['2026-11-3', ' 2026-11-03', '2100-01-01', '1999-12-31', '2026-02-29', '2026-13-01', '2026-04-31'];
  for (const date of badDates) assertError(await post(port, valid({ date })), 400, dateMsg);
  for (const [i, date] of ['2028-02-29', '2000-02-29'].entries()) {
    assert.equal((await post(port, valid({ date }))).status, 201, `date ${i}`);
  }
  for (const start of ['9:00', '24:00', '12:60']) {
    assertError(await post(port, valid({ start })), 400, 'start must be HH:MM');
  }
  for (const end of ['9:00', '24:00', '12:60', 5]) {
    assertError(await post(port, valid({ end })), 400, 'end must be HH:MM');
  }
  assertError(await post(port, valid({ start: '10:00', end: '10:00' })), 400, 'end must be after start');
  assertError(await post(port, valid({ start: '10:00', end: '09:59' })), 400, 'end must be after start');
  assertError(await post(port, valid({ room: 'x', date: 'bad' })), 400, 'room must be one of Aurora, Borealis, Cosmos');
});

test('201 body is exactly the booking; ids count up; extra keys ignored', async (t) => {
  const { port } = await boot(t);
  const first = await post(port, { ...valid(), extra: 1, id: 99 });
  assert.equal(first.status, 201);
  assert.equal(first.headers['content-type'], JSON_TYPE);
  assert.deepEqual(first.json, { id: 1, ...valid() });
  const second = await post(port, valid({ room: 'Cosmos' }));
  assert.deepEqual(second.json, { id: 2, ...valid({ room: 'Cosmos' }) });
});

test('rule 10: overlaps', async (t) => {
  const { port } = await boot(t);
  await post(port, valid({ start: '10:00', end: '11:00' }));
  await post(port, valid({ start: '09:00', end: '09:30' }));
  const clash = await post(port, valid({ start: '09:15', end: '10:30' }));
  assertError(clash, 409, 'room is already booked from 09:00 to 09:30');
  assert.equal((await post(port, valid({ start: '11:00', end: '12:00' }))).status, 201);
  assert.equal((await post(port, valid({ room: 'Borealis', start: '10:00', end: '11:00' }))).status, 201);
  assert.equal((await post(port, valid({ date: '2026-11-04', start: '10:00', end: '11:00' }))).status, 201);
});

test('GET /api/bookings: sorting and date filter', async (t) => {
  const { port } = await boot(t);
  const items = [
    valid({ date: '2026-11-04', room: 'Aurora', start: '09:00', end: '09:30', title: 'a' }),
    valid({ room: 'Cosmos', start: '10:00', title: 'b' }),
    valid({ room: 'Borealis', start: '10:00', title: 'c' }),
    valid({ room: 'Aurora', start: '10:00', title: 'd' }),
    valid({ room: 'Cosmos', start: '09:00', end: '09:30', title: 'e' }),
  ];
  for (const it of items) assert.equal((await post(port, it)).status, 201);
  const all = await request(port, 'GET', '/api/bookings?x=1');
  assert.equal(all.headers['content-type'], JSON_TYPE);
  assert.deepEqual(all.json.bookings.map((b) => b.title), ['e', 'd', 'c', 'b', 'a']);
  const day = await request(port, 'GET', '/api/bookings?date=2026-11-03');
  assert.deepEqual(day.json.bookings.map((b) => b.title), ['e', 'd', 'c', 'b']);
  const first = await request(port, 'GET', '/api/bookings?date=2026-11-03&date=bad');
  assert.equal(first.json.bookings.length, 4);
  for (const q of ['?date', '?date=', '?date=bad']) {
    assertError(await request(port, 'GET', `/api/bookings${q}`), 400, 'date must be a valid YYYY-MM-DD date');
  }
});

test('persistence across restart, atomic file, ids never reused', async (t) => {
  const dir = makeTmp(t);
  const file = path.join(dir, 'data.json');
  const first = await startServer(t, dir, { env: { DATA_FILE: file } });
  await post(first.port, valid());
  await post(first.port, valid({ room: 'Cosmos' }));
  assert.equal((await request(first.port, 'DELETE', '/api/bookings/2')).status, 204);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.nextId, 3);
  assert.equal(saved.bookings.length, 1);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
  const before = (await request(first.port, 'GET', '/api/bookings')).json;
  first.child.kill('SIGKILL');
  const second = await startServer(t, dir, { env: { DATA_FILE: file } });
  assert.deepEqual((await request(second.port, 'GET', '/api/bookings')).json, before);
  const next = await post(second.port, valid({ room: 'Borealis' }));
  assert.equal(next.json.id, 3);
});

test('concurrency: one winner among overlapping, all succeed when disjoint', async (t) => {
  const { port } = await boot(t);
  const overlapping = Array.from({ length: 10 }, (_, i) => post(port, valid({ start: '10:00', end: `11:0${i}` })));
  const results = await Promise.all(overlapping);
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 9);
  const disjoint = Array.from({ length: 10 }, (_, i) => post(port, valid({
    date: '2026-12-01', start: `${String(8 + i).padStart(2, '0')}:00`, end: `${String(8 + i).padStart(2, '0')}:30`,
  })));
  const done = await Promise.all(disjoint);
  assert.ok(done.every((r) => r.status === 201));
  assert.equal(new Set(done.map((r) => r.json.id)).size, 10);
});

test('save failure: 500, nothing changes, recovers once folder exists', async (t) => {
  const dir = makeTmp(t);
  const folder = path.join(dir, 'missing-dir');
  const { port } = await startServer(t, dir, { env: { DATA_FILE: path.join(folder, 'data.json') } });
  assertError(await post(port, valid()), 500, 'internal error');
  assert.deepEqual((await request(port, 'GET', '/api/bookings')).json, { bookings: [] });
  assert.ok(!fs.existsSync(folder));
  fs.mkdirSync(folder);
  const ok = await post(port, valid());
  assert.equal(ok.status, 201);
  assert.equal(ok.json.id, 1);
});

test('static page and script', async (t) => {
  const { port } = await boot(t);
  const files = [['/', 'index.html', 'text/html; charset=utf-8'], ['/app.js', 'app.js', 'text/javascript; charset=utf-8']];
  for (const [url, file, type] of files) {
    if (!fs.existsSync(path.join(ROOT, 'public', file))) {
      t.diagnostic(`public/${file} missing, skipped`);
      continue;
    }
    const res = await request(port, 'GET', url);
    assert.equal(res.status, 200, url);
    assert.equal(res.headers['content-type'], type);
  }
  assertError(await request(port, 'POST', '/'), 405, 'method not allowed');
});
