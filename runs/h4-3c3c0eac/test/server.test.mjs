import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../server.mjs', import.meta.url));

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bookings-test-'));
}

function run(env, cwd = tmpDir()) {
  const child = spawn(process.execPath, [SERVER], {
    cwd,
    env: { ...process.env, PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', () => {
      const m = /^listening on http:\/\/127\.0\.0\.1:(\d+)\n$/.exec(stdout);
      if (m) resolve(`http://127.0.0.1:${m[1]}`);
    });
    exited.then((code) => reject(new Error(`exited ${code}: ${stderr}`)));
  });
  ready.catch(() => {});
  return { child, ready, exited, out: () => stdout, err: () => stderr, cwd };
}

async function start(t, env = {}) {
  const dir = tmpDir();
  const s = run({ DATA_FILE: path.join(dir, 'data.json'), ...env }, dir);
  t.after(() => s.child.kill());
  s.base = await s.ready;
  s.dir = dir;
  return s;
}

// Raw node:http so paths like /api/./rooms are sent unnormalised.
function req(base, method, url, body, headers = {}) {
  const hdrs = { ...headers };
  let data;
  if (body !== undefined) {
    data = typeof body === 'string' ? body : JSON.stringify(body);
    if (!('Content-Type' in hdrs)) hdrs['Content-Type'] = 'application/json';
  }
  return new Promise((resolve, reject) => {
    const r = http.request(base + '/', { method, path: url, headers: hdrs }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { text += d; });
      res.on('end', () => {
        const type = res.headers['content-type'];
        const json = text && type && type.startsWith('application/json') ? JSON.parse(text) : undefined;
        resolve({ status: res.statusCode, type, text, json });
      });
    });
    r.on('error', reject);
    r.end(data);
  });
}

const ok = { room: 'Aurora', title: '  Standup ', date: '2026-11-03', start: '09:00', end: '10:00' };

test('rooms and page', async (t) => {
  const { base } = await start(t);
  const r = await req(base, 'GET', '/api/rooms');
  assert.equal(r.status, 200);
  assert.equal(r.type, 'application/json; charset=utf-8');
  assert.deepEqual(r.json, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });

  const page = await req(base, 'GET', '/');
  assert.equal(page.type, 'text/html; charset=utf-8');
  assert.match(page.text, /<script src="\/app.js"><\/script>\s*<\/body>/);
  assert.doesNotMatch(page.text, /https?:\/\/|<option|Aurora/);
  const js = await req(base, 'GET', '/app.js?x=1');
  assert.equal(js.type, 'text/javascript; charset=utf-8');
  assert.doesNotMatch(js.text, /https?:\/\//);
});

test('create, list, delete, persist', async (t) => {
  const s = await start(t);
  let r = await req(s.base, 'POST', '/api/bookings', { ...ok, extra: 1 });
  assert.equal(r.status, 201);
  assert.deepEqual(r.json, { id: 1, room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00' });
  await req(s.base, 'POST', '/api/bookings', { ...ok, room: 'Cosmos', start: '08:00', end: '09:00' });
  await req(s.base, 'POST', '/api/bookings', { ...ok, room: 'Borealis', start: '08:00', end: '09:00' });
  await req(s.base, 'POST', '/api/bookings', { ...ok, date: '2026-11-02' });
  r = await req(s.base, 'GET', '/api/bookings');
  assert.deepEqual(r.json.bookings.map((b) => b.id), [4, 3, 2, 1]);
  r = await req(s.base, 'GET', '/api/bookings?date=2026-11-02&date=x');
  assert.deepEqual(r.json.bookings.map((b) => b.id), [4]);
  r = await req(s.base, 'GET', '/api/bookings?date');
  assert.equal(r.status, 400);
  assert.deepEqual(r.json, { error: 'date must be a valid YYYY-MM-DD date' });

  r = await req(s.base, 'DELETE', '/api/bookings/4');
  assert.equal(r.status, 204);
  assert.equal(r.text, '');
  r = await req(s.base, 'DELETE', '/api/bookings/4');
  assert.deepEqual([r.status, r.json], [404, { error: 'booking not found' }]);
  for (const id of ['01', 'abc', '-1', '1.0']) {
    assert.equal((await req(s.base, 'DELETE', `/api/bookings/${id}`)).status, 404);
  }

  s.child.kill();
  await s.exited;
  const s2 = run({ DATA_FILE: 'data.json' }, s.dir);
  t.after(() => s2.child.kill());
  const base2 = await s2.ready;
  r = await req(base2, 'GET', '/api/bookings');
  assert.deepEqual(r.json.bookings.map((b) => b.id), [3, 2, 1]);
  r = await req(base2, 'POST', '/api/bookings', { ...ok, date: '2026-12-01' });
  assert.equal(r.json.id, 5);
});

test('validation order and messages', async (t) => {
  const { base } = await start(t);
  const cases = [
    [{ ...ok }, { 'Content-Type': 'text/plain' }, 415, 'content type must be application/json'],
    ['x'.repeat(10001), {}, 413, 'body too large'],
    ['', {}, 400, 'body must be a JSON object'],
    ['null', {}, 400, 'body must be a JSON object'],
    ['[]', {}, 400, 'body must be a JSON object'],
    ['﻿{}', {}, 400, 'body must be a JSON object'],
    [{ ...ok, room: 'aurora' }, {}, 400, 'room must be one of Aurora, Borealis, Cosmos'],
    [{ ...ok, title: '   ' }, {}, 400, 'title must be 1 to 80 characters'],
    [{ ...ok, title: 'x'.repeat(81) }, {}, 400, 'title must be 1 to 80 characters'],
    [{ ...ok, date: '2100-01-01' }, {}, 400, 'date must be a valid YYYY-MM-DD date'],
    [{ ...ok, date: '2027-02-29' }, {}, 400, 'date must be a valid YYYY-MM-DD date'],
    [{ ...ok, date: ' 2026-11-03' }, {}, 400, 'date must be a valid YYYY-MM-DD date'],
    [{ ...ok, start: '9:00' }, {}, 400, 'start must be HH:MM'],
    [{ ...ok, end: '24:00' }, {}, 400, 'end must be HH:MM'],
    [{ ...ok, end: '09:00' }, {}, 400, 'end must be after start'],
  ];
  for (const [body, headers, status, error] of cases) {
    const r = await req(base, 'POST', '/api/bookings', body, { 'Content-Type': ' Application/JSON ; x=1', ...headers });
    assert.deepEqual([r.status, r.json], [status, { error }], JSON.stringify(body).slice(0, 60));
  }
  assert.equal((await req(base, 'POST', '/api/bookings', { ...ok, date: '2028-02-29' })).status, 201);
});

test('overlaps and concurrency', async (t) => {
  const { base } = await start(t);
  await req(base, 'POST', '/api/bookings', { ...ok, start: '10:00', end: '11:00' });
  await req(base, 'POST', '/api/bookings', { ...ok, start: '09:00', end: '10:00' });
  let r = await req(base, 'POST', '/api/bookings', { ...ok, start: '09:30', end: '10:30' });
  assert.deepEqual([r.status, r.json], [409, { error: 'room is already booked from 09:00 to 10:00' }]);
  r = await req(base, 'POST', '/api/bookings', { ...ok, start: '11:00', end: '12:00' });
  assert.equal(r.status, 201);

  const results = await Promise.all(Array.from({ length: 10 }, () =>
    req(base, 'POST', '/api/bookings', { ...ok, start: '14:00', end: '15:00' })));
  assert.equal(results.filter((x) => x.status === 201).length, 1);
  assert.equal(results.filter((x) => x.status === 409).length, 9);
});

test('routing', async (t) => {
  const { base } = await start(t);
  for (const p of ['/api/%62ookings', '/api/./rooms', '/API/rooms', '/api/bookings/', '/api/bookings/1/', '/nope']) {
    const r = await req(base, 'GET', p);
    assert.deepEqual([r.status, r.json], [404, { error: 'not found' }], p);
  }
  for (const [m, p] of [['GET', '/api/bookings/abc'], ['POST', '/api/rooms'], ['PUT', '/api/bookings'], ['DELETE', '/'], ['POST', '/app.js']]) {
    const r = await req(base, m, p);
    assert.deepEqual([r.status, r.json], [405, { error: 'method not allowed' }], `${m} ${p}`);
  }
  assert.equal((await req(base, 'HEAD', '/api/rooms')).status, 405);
});

test('save failure gives 500 and changes nothing', async (t) => {
  const dir = tmpDir();
  const s = run({ DATA_FILE: 'missing/data.json' }, dir);
  t.after(() => s.child.kill());
  const base = await s.ready;
  let r = await req(base, 'POST', '/api/bookings', ok);
  assert.deepEqual([r.status, r.json], [500, { error: 'internal error' }]);
  assert.deepEqual((await req(base, 'GET', '/api/bookings')).json, { bookings: [] });
  fs.mkdirSync(path.join(dir, 'missing'));
  r = await req(base, 'POST', '/api/bookings', ok);
  assert.equal(r.json.id, 1);
});

test('startup failures', async () => {
  for (const PORT of ['abc', '65536', ' 80', '-1']) {
    const s = run({ PORT });
    assert.equal(await s.exited, 1, PORT);
    assert.equal(s.out(), '');
  }
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'bookings.json'), '');
  let s = run({ DATA_FILE: '' }, dir);
  assert.equal(await s.exited, 1);
  assert.equal(s.err(), 'cannot read data file bookings.json\n');
  s = run({ DATA_FILE: '.' }, dir);
  assert.equal(await s.exited, 1);
  assert.equal(s.err(), 'cannot read data file .\n');

  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  s = run({ PORT: String(blocker.address().port), DATA_FILE: path.join(dir, 'none.json') });
  assert.equal(await s.exited, 1);
  blocker.close();
});
