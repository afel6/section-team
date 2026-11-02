// Black-box routing tests: path matching, query cut, 405 matrix, DELETE ids, big bodies, failed saves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, JSON_TYPE, JSON_HEADERS, boot, makeTmp, startServer, stopServer, request, post, valid,
  assertError, chunkedPost,
} from './helpers/server-harness.mjs';

const ROOMS = { rooms: ['Aurora', 'Borealis', 'Cosmos'] };
const ALL_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const BIG = Buffer.alloc(2_000_000, 0x61);

const NOT_FOUND_PATHS = [
  '/api/bookings/', '/api/bookings/1/', '/api/bookings/1/x', '/api/bookings//1', '/API/rooms',
  '/Api/bookings', '/api/./rooms', '/api/../api/rooms', '//api/rooms', '/api/rooms/',
  '/api/%62ookings', '/api/rooms%2F', '/index.html', '/app.js/', '/APP.JS', '/api', '/api/',
  '/api/roomsx', '/favicon.ico', '/%2F',
];

const ALLOWED = [
  ['/api/rooms', ['GET']],
  ['/api/bookings', ['GET', 'POST']],
  ['/api/bookings/1', ['DELETE']],
  ['/api/bookings/abc', ['DELETE']],
  ['/api/bookings/%31', ['DELETE']],
  ['/', ['GET']],
  ['/app.js', ['GET']],
];

const BAD_IDS = [
  '01', '001', '0', '-1', '+1', '1.0', '1e0', '0x1', '1abc', '1%20', '%31', '%2B1', '%D9%A1',
  '%EF%BC%99', '9007199254740993', `1${'0'.repeat(400)}`, '99',
];

const createAurora = async (port) => {
  const res = await post(port, valid());
  assert.equal(res.status, 201);
  return res.json;
};

test('unknown paths are 404 for every method', async (t) => {
  const { port } = await boot(t);
  for (const p of NOT_FOUND_PATHS) {
    for (const method of ['GET', 'POST', 'DELETE', 'PUT']) {
      assertError(await request(port, method, p), 404, 'not found', `${method} ${p}`);
    }
    const head = await request(port, 'HEAD', p);
    assert.equal(head.status, 404, `HEAD ${p}`);
  }
});

test('query is cut at the first question mark', async (t) => {
  const { port } = await boot(t);
  for (const p of ['/api/rooms?x', '/api/rooms?']) {
    const res = await request(port, 'GET', p);
    assert.equal(res.status, 200, p);
    assert.deepEqual(res.json, ROOMS, p);
  }
  const js = await request(port, 'GET', '/app.js?v=1');
  assert.equal(js.status, 200);
  assert.equal(js.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal(js.text, fs.readFileSync(path.join(ROOT, 'public', 'app.js')).toString('utf8'));
  const html = await request(port, 'GET', '/?x=1');
  assert.equal(html.status, 200);
  assert.equal(html.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(html.text, fs.readFileSync(path.join(ROOT, 'public', 'index.html')).toString('utf8'));
  const b = await createAurora(port);
  const list = await request(port, 'GET', '/api/bookings?/1');
  assert.equal(list.status, 200);
  assert.deepEqual(list.json, { bookings: [b] });
  for (const p of ['/api/bookings/?x', '/api/rooms/?x']) {
    assertError(await request(port, 'GET', p), 404, 'not found', p);
  }
  const del = await request(port, 'DELETE', '/api/bookings/1?x=1');
  assert.equal(del.status, 204);
  assert.deepEqual((await request(port, 'GET', '/api/bookings')).json, { bookings: [] });
});

test('405 matrix for every disallowed method', async (t) => {
  const { port } = await boot(t);
  for (const [p, allowed] of ALLOWED) {
    for (const method of ALL_METHODS.filter((m) => !allowed.includes(m))) {
      const res = await request(port, method, p);
      const name = `${method} ${p}`;
      if (method === 'HEAD') assert.equal(res.status, 405, name);
      else assertError(res, 405, 'method not allowed', name);
    }
  }
});

test('405 wins over body rules', async (t) => {
  const { port } = await boot(t);
  const put = await request(port, 'PUT', '/api/bookings', {
    headers: { 'content-type': 'text/plain' }, body: Buffer.alloc(20000, 0x61),
  });
  assertError(put, 405, 'method not allowed', 'PUT with big text body');
  const bad = await request(port, 'POST', '/api/rooms', { headers: JSON_HEADERS, body: '{nope' });
  assertError(bad, 405, 'method not allowed', 'POST /api/rooms with broken JSON');
});

test('DELETE with ids that are not valid or not present', async (t) => {
  const { port } = await boot(t);
  const b = await createAurora(port);
  assert.equal(b.id, 1);
  for (const id of BAD_IDS) {
    const res = await request(port, 'DELETE', `/api/bookings/${id}`);
    assertError(res, 404, 'booking not found', `id ${id.slice(0, 20)}`);
  }
  assert.deepEqual((await request(port, 'GET', '/api/bookings')).json, { bookings: [b] });
  const ok = await request(port, 'DELETE', '/api/bookings/1');
  assert.equal(ok.status, 204);
  assert.equal(ok.text, '');
  assert.deepEqual((await request(port, 'GET', '/api/bookings')).json, { bookings: [] });
  assertError(await request(port, 'DELETE', '/api/bookings/1'), 404, 'booking not found', 'delete again');
  assertError(await request(port, 'DELETE', '/api/bookings/2'), 404, 'booking not found', 'delete unknown');
});

test('every reply carries the JSON content type', async (t) => {
  const { port } = await boot(t);
  const cases = [
    ['200 rooms', await request(port, 'GET', '/api/rooms')],
    ['200 bookings', await request(port, 'GET', '/api/bookings')],
    ['201', await post(port, valid())],
    ['400', await post(port, '[]')],
    ['404', await request(port, 'GET', '/nope')],
    ['405', await request(port, 'PUT', '/api/rooms')],
    ['409', await post(port, valid())],
    ['413', await post(port, Buffer.alloc(10001, 0x20))],
    ['415', await post(port, '{}', { 'content-type': 'text/plain' })],
  ];
  for (const [name, res] of cases) {
    assert.equal(res.headers['content-type'], JSON_TYPE, name);
  }
  const del = await request(port, 'DELETE', '/api/bookings/1');
  assert.equal(del.status, 204);
  assert.equal(del.text, '');
});

test('replies arrive even when a big body is sent', async (t) => {
  const { port } = await boot(t);
  const text = { 'content-type': 'text/plain' };
  const cases = [
    ['POST /nope', 'POST', '/nope', {}, 404, 'not found'],
    ['PUT /api/rooms', 'PUT', '/api/rooms', {}, 405, 'method not allowed'],
    ['POST /api/rooms', 'POST', '/api/rooms', {}, 405, 'method not allowed'],
    ['415', 'POST', '/api/bookings', text, 415, 'content type must be application/json'],
    ['413', 'POST', '/api/bookings', JSON_HEADERS, 413, 'body too large'],
    ['DELETE', 'DELETE', '/api/bookings/1', {}, 404, 'booking not found'],
  ];
  for (const [name, method, p, headers, status, msg] of cases) {
    // Explicit length: node:http would otherwise send a DELETE body without framing.
    const framed = { ...headers, 'content-length': String(BIG.length) };
    const res = await request(port, method, p, { headers: framed, body: BIG });
    assertError(res, status, msg, name);
  }
  const pieces = Array.from({ length: 32 }, () => Buffer.alloc(65536, 0x61));
  assertError(await chunkedPost(port, pieces), 413, 'body too large', 'chunked 2 MB');
  const rooms = await request(port, 'GET', '/api/rooms');
  assert.equal(rooms.status, 200);
});

test('failed saves give 500 and change nothing', async (t) => {
  const dir = makeTmp(t);
  const sub = path.join(dir, 'd');
  const moved = path.join(dir, 'd2');
  const file = path.join(sub, 'data.json');
  fs.mkdirSync(sub);
  const env = { DATA_FILE: file };
  const first = await startServer(t, dir, { env });
  const { port } = first;
  const b1 = await post(port, valid());
  assert.equal(b1.status, 201);
  assert.equal(b1.json.id, 1);
  const snapshot = fs.readFileSync(file);
  fs.renameSync(sub, moved);
  assertError(await request(port, 'DELETE', '/api/bookings/1'), 500, 'internal error', 'DELETE with save failing');
  const other = valid({ start: '12:00', end: '13:00' });
  assertError(await post(port, other), 500, 'internal error', 'POST with save failing');
  const list = await request(port, 'GET', '/api/bookings');
  assert.deepEqual(list.json, { bookings: [b1.json] });
  assert.equal(fs.existsSync(sub), false);
  fs.renameSync(moved, sub);
  assert.deepEqual(fs.readFileSync(file), snapshot);
  const b2 = await post(port, other);
  assert.equal(b2.status, 201);
  assert.equal(b2.json.id, 2);
  assert.equal((await request(port, 'DELETE', '/api/bookings/1')).status, 204);
  await stopServer(first.child);
  const second = await startServer(t, dir, { env });
  const after = await request(second.port, 'GET', '/api/bookings');
  assert.deepEqual(after.json, { bookings: [b2.json] });
  const b3 = await post(second.port, valid({ start: '14:00', end: '15:00' }));
  assert.equal(b3.status, 201);
  assert.equal(b3.json.id, 3);
});

test('concurrent DELETE of one id succeeds exactly once', async (t) => {
  const { port } = await boot(t);
  await createAurora(port);
  const results = await Promise.all(
    Array.from({ length: 5 }, () => request(port, 'DELETE', '/api/bookings/1')),
  );
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [204, 404, 404, 404, 404]);
  for (const [i, r] of results.entries()) {
    if (r.status === 404) assertError(r, 404, 'booking not found', `concurrent DELETE #${i}`);
  }
});
