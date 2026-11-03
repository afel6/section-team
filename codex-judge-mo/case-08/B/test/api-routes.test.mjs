// HTTP route tests for server.mjs: rooms, listing/sorting/filtering, path and method rules, DELETE, pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assertError } from './helpers/booking-utils.mjs';
import { startServer, request, postBooking, booking, makeTempDir, JSON_CT, ROOT } from './helpers/server.mjs';

const HTML_CT = 'text/html; charset=utf-8';
const JS_CT = 'text/javascript; charset=utf-8';
const DATE_ERR = 'date must be a valid YYYY-MM-DD date';

/** Runs fn(port, tmpDir) against a fresh server with its own temp data file; always cleans up. */
async function withServer(fn, { cwd } = {}) {
  const dir = makeTempDir();
  const server = await startServer({ env: { DATA_FILE: path.join(dir, 'data.json') }, cwd });
  try {
    await fn(server.port, dir);
  } finally {
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function create(port, overrides) {
  const res = await postBooking(port, booking(overrides));
  assert.equal(res.status, 201);
  return res.json;
}

function assertJson(res, status, json) {
  assert.equal(res.status, status);
  assert.equal(res.headers['content-type'], JSON_CT);
  assert.deepEqual(res.json, json);
}

const get = (port, target) => request(port, { target });

test('GET /api/rooms returns the fixed rooms, with or without a query', () =>
  withServer(async (port) => {
    for (const target of ['/api/rooms', '/api/rooms?x=1']) {
      assertJson(await get(port, target), 200, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
    }
  }));

test('bookings are sorted by date, then start, then room order', () =>
  withServer(async (port) => {
    const a = await create(port, { room: 'Cosmos', date: '2026-01-05', start: '09:00', end: '10:00' });
    const b = await create(port, { room: 'Aurora', date: '2026-01-05', start: '09:00', end: '10:00' });
    const c = await create(port, { room: 'Borealis', date: '2026-01-05', start: '09:00', end: '10:00' });
    const d = await create(port, { room: 'Aurora', date: '2025-12-31', start: '23:00', end: '23:30' });
    const e = await create(port, { room: 'Aurora', date: '2026-01-05', start: '10:00', end: '11:00' });
    const f = await create(port, { room: 'Borealis', date: '2025-12-31', start: '09:00', end: '10:00' });
    assert.deepEqual([a.id, b.id, c.id, d.id, e.id, f.id], [1, 2, 3, 4, 5, 6]);
    assertJson(await get(port, '/api/bookings'), 200, { bookings: [f, d, b, c, a, e] });
  }));

test('same date and start: room order wins over id and insertion order', () =>
  withServer(async (port) => {
    const cosmos = await create(port, { room: 'Cosmos' });
    const aurora = await create(port, { room: 'Aurora' });
    assert.equal(cosmos.id, 1);
    assert.equal(aurora.id, 2);
    assertJson(await get(port, '/api/bookings'), 200, { bookings: [aurora, cosmos] });
  }));

test('a later date with an earlier start sorts after an earlier date', () =>
  withServer(async (port) => {
    const late = await create(port, { date: '2026-01-05', start: '08:00', end: '08:30' });
    const early = await create(port, { date: '2025-12-31', start: '22:00', end: '23:00' });
    assertJson(await get(port, '/api/bookings'), 200, { bookings: [early, late] });
  }));

async function seedDates(port) {
  const x = await create(port, { room: 'Cosmos', date: '2026-11-03', start: '10:00', end: '11:00' });
  const y = await create(port, { room: 'Aurora', date: '2026-11-03', start: '09:00', end: '10:00' });
  const z = await create(port, { room: 'Aurora', date: '2026-11-04', start: '09:00', end: '10:00' });
  return { on3: [y, x], on4: [z], all: [y, x, z] };
}

test('date filter selects the first date value and decodes like URLSearchParams', () =>
  withServer(async (port) => {
    const { on3, on4, all } = await seedDates(port);
    const cases = [
      ['/api/bookings', all],
      ['/api/bookings?date=2026-11-03', on3],
      ['/api/bookings?date=2026-11-03&date=2026-11-04', on3],
      ['/api/bookings?date=2026-11-04&date=2026-11-03', on4],
      ['/api/bookings?x=1&date=2026-11-04', on4],
      ['/api/bookings?date=2026-11-0%33', on3],
      ['/api/bookings?date=2026%2D11%2D03', on3],
      ['/api/bookings?dates=x', all],
      ['/api/bookings?Date=x', all],
      ['/api/bookings?date=2099-12-31', []],
      ['/api/bookings?date=2000-01-01', []],
      ['/api/bookings?date=2026-11-05', []],
    ];
    for (const [target, bookings] of cases) {
      assertJson(await get(port, target), 200, { bookings });
    }
  }));

test('invalid date filters are 400', () =>
  withServer(async (port) => {
    await seedDates(port);
    const targets = ['?date', '?date=', '?date=bad', '?date=2026-02-30', '?date=2026-11-3',
      '?date=+2026-11-03', '?date=1999-12-31', '?date=2100-01-01', '?date=x&date=2026-11-03'];
    for (const q of targets) {
      assertError(await get(port, `/api/bookings${q}`), 400, DATE_ERR);
    }
  }));

test('valid date with no bookings gives an empty list', () =>
  withServer(async (port) => {
    assertJson(await get(port, '/api/bookings?date=2026-11-03'), 200, { bookings: [] });
  }));

const UNKNOWN_PATHS = ['/api/%62ookings', '/api/./rooms', '/API/rooms', '/api/rooms/', '/api//rooms',
  '/api/bookings/', '/api/bookings/1/', '/api/bookings//', '//api/rooms', '/index.html', '/app.js/', '/nope'];

test('paths are compared byte for byte: unknown paths are 404', () =>
  withServer(async (port) => {
    for (const target of UNKNOWN_PATHS) {
      assertError(await get(port, target), 404, 'not found');
    }
  }));

test('404 for every method on paths with an empty or slashed id and other paths', () =>
  withServer(async (port) => {
    for (const target of ['/api/bookings/', '/api/bookings/1/', '/x']) {
      for (const method of ['POST', 'DELETE', 'PUT', 'PATCH', 'OPTIONS']) {
        assertError(await request(port, { method, target }), 404, 'not found');
      }
      assert.equal((await request(port, { method: 'HEAD', target })).status, 404);
    }
  }));

const METHOD_CASES = [
  ['/api/rooms', ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']],
  ['/api/bookings', ['PUT', 'DELETE', 'PATCH', 'OPTIONS']],
  ['/api/bookings/1', ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS']],
  ['/api/bookings/abc', ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS']],
  ['/', ['POST', 'DELETE', 'OPTIONS']],
  ['/app.js', ['POST', 'DELETE', 'OPTIONS']],
];

test('unlisted methods on known paths are 405', () =>
  withServer(async (port) => {
    for (const [target, methods] of METHOD_CASES) {
      for (const method of methods) {
        assertError(await request(port, { method, target }), 405, 'method not allowed');
      }
    }
  }));

test('HEAD on known paths is 405', () =>
  withServer(async (port) => {
    for (const target of ['/api/rooms', '/api/bookings', '/api/bookings/1', '/', '/app.js']) {
      assert.equal((await request(port, { method: 'HEAD', target })).status, 405);
    }
  }));

const BAD_IDS = ['0', '01', 'abc', '-1', '1.0', '+1', '%31', '1%2F', '%EF%BC%99', '99999999999999999999', '2'];

test('DELETE ids that are not a positive plain integer or do not exist are 404', () =>
  withServer(async (port) => {
    const made = await create(port);
    assert.equal(made.id, 1);
    for (const id of BAD_IDS) {
      const res = await request(port, { method: 'DELETE', target: `/api/bookings/${id}` });
      assertError(res, 404, 'booking not found');
    }
    assertJson(await get(port, '/api/bookings'), 200, { bookings: [made] });
    const viaQuery = await request(port, { method: 'DELETE', target: '/api/bookings/1?x' });
    assert.equal(viaQuery.status, 204);
    assertJson(await get(port, '/api/bookings'), 200, { bookings: [] });
  }));

test('valid DELETE is 204 with no body or content type, then 404', () =>
  withServer(async (port) => {
    await create(port);
    const kept = await create(port, { room: 'Borealis' });
    const res = await request(port, { method: 'DELETE', target: '/api/bookings/1' });
    assert.equal(res.status, 204);
    assert.equal(res.raw.length, 0);
    assert.equal(res.headers['content-type'], undefined);
    const again = await request(port, { method: 'DELETE', target: '/api/bookings/1' });
    assertError(again, 404, 'booking not found');
    assertJson(await get(port, '/api/bookings'), 200, { bookings: [kept] });
  }));

test('pages are served byte for byte, independent of cwd and query', async () => {
  const cwd = makeTempDir();
  try {
    await withServer(async (port) => {
      const pages = [
        ['/', 'index.html', HTML_CT], ['/?x=1', 'index.html', HTML_CT],
        ['/app.js', 'app.js', JS_CT], ['/app.js?v=2', 'app.js', JS_CT],
      ];
      for (const [target, file, type] of pages) {
        const res = await get(port, target);
        assert.equal(res.status, 200);
        assert.equal(res.headers['content-type'], type);
        assert.ok(res.raw.equals(fs.readFileSync(path.join(ROOT, 'public', file))));
      }
    }, { cwd });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('every JSON reply status carries the JSON content type', () =>
  withServer(async (port) => {
    const json = { 'Content-Type': 'application/json' };
    assertJson(await get(port, '/api/rooms'), 200, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
    const created = await postBooking(port, booking());
    assertJson(created, 201, { id: 1, ...booking() });
    assertError(await get(port, '/api/bookings?date=bad'), 400, DATE_ERR);
    assertError(await get(port, '/nope'), 404, 'not found');
    assertError(await request(port, { method: 'PUT', target: '/api/rooms' }), 405, 'method not allowed');
    assertError(await postBooking(port, booking()), 409, 'room is already booked from 09:00 to 10:00');
    const big = await request(port, { method: 'POST', target: '/api/bookings', headers: json, body: 'x'.repeat(10001) });
    assertError(big, 413, 'body too large');
    const noType = await request(port, { method: 'POST', target: '/api/bookings', body: '{}' });
    assertError(noType, 415, 'content type must be application/json');
  }));
