// API tests: routing, 404/405, page serving, DELETE, content types, GET /api/bookings and ?date.
// Booking rules 1-10 live in server-rules.test.mjs.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { request, postBooking, rawRequest, parseRaw, JSON_TYPE, SERVER_PATH } from './support/harness.mjs';
import { BASE_BOOKING, expectError, listAll, seedBookings, useServer } from './support/fixtures.mjs';

const PUBLIC_DIR = join(SERVER_PATH, '..', 'public');
const DATE_MSG = 'date must be a valid YYYY-MM-DD date';

async function raw(port, method, target) {
  const data = `${method} ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`;
  const parsed = parseRaw(await rawRequest(port, data));
  return { ...parsed, text: parsed.body, json: () => JSON.parse(parsed.body) };
}

function expectBodyless(res, status) {
  assert.equal(res.status, status);
  assert.equal(res.text, '');
}

describe('routing', () => {
  const ctx = {};
  useServer(ctx);

  it('GET /api/rooms lists the rooms', async () => {
    for (const path of ['/api/rooms', '/api/rooms?x=1', '/api/rooms?']) {
      const res = await request(ctx.port, { path });
      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], JSON_TYPE);
      assert.deepEqual(res.json(), { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
    }
  });

  const NOT_FOUND = [
    '/api/%62ookings', '/api/./rooms', '/API/rooms', '/api/bookings/', '/api/bookings/1/', '/api/bookings//1',
    '/api/rooms/', '/api', '/index.html', '/app.js/', '//api/rooms', '/api/bookings%2F1', '/api/bookings/?x',
    '/api/bookings/1/2', '/api/../api/rooms', '/api/rooms//', '/api/bookings/a/',
  ];
  for (const path of NOT_FOUND) {
    it(`404 not found for ${path} with every method`, async () => {
      for (const method of ['GET', 'POST', 'DELETE', 'PUT', 'OPTIONS', 'PATCH']) {
        expectError(await raw(ctx.port, method, path), 404, 'not found');
      }
      const head = await raw(ctx.port, 'HEAD', path);
      expectBodyless(head, 404);
    });
  }

  it('absolute-form target is not a known path', async () => {
    expectError(await raw(ctx.port, 'GET', 'http://127.0.0.1/api/rooms'), 404, 'not found');
  });

  const NOT_ALLOWED = [
    ['/api/rooms', ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']],
    ['/api/bookings', ['PUT', 'DELETE', 'PATCH', 'OPTIONS']],
    ['/api/bookings/1', ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS']],
    ['/api/bookings/abc', ['GET']],
    ['/api/bookings/%2F', ['GET', 'POST', 'PUT', 'OPTIONS']],
    ['/', ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']],
    ['/app.js', ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']],
  ];
  for (const [path, methods] of NOT_ALLOWED) {
    it(`405 method not allowed on ${path}`, async () => {
      for (const method of methods) {
        expectError(await raw(ctx.port, method, path), 405, 'method not allowed');
      }
    });
  }

  it('HEAD on every known path is 405 without a body', async () => {
    const paths = ['/api/rooms', '/api/bookings', '/api/bookings/1', '/api/bookings/abc', '/', '/app.js'];
    for (const path of paths) {
      expectBodyless(await raw(ctx.port, 'HEAD', path), 405);
    }
  });

  it('DELETE of an escaped slash id is a booking-not-found route', async () => {
    expectError(await raw(ctx.port, 'DELETE', '/api/bookings/%2F'), 404, 'booking not found');
  });

  it('the query is cut at the first question mark', async () => {
    const page = await request(ctx.port, { path: '/?a=b' });
    assert.equal(page.status, 200);
    assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal((await request(ctx.port, { path: '/app.js?x=1?y' })).status, 200);
  });
});

describe('page serving', () => {
  const ctx = {};
  useServer(ctx);

  it('GET / serves public/index.html', async () => {
    const res = await request(ctx.port, { path: '/' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
    assert.deepEqual(res.body, await readFile(join(PUBLIC_DIR, 'index.html')));
  });

  it('GET /app.js serves public/app.js', async () => {
    const res = await request(ctx.port, { path: '/app.js' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.deepEqual(res.body, await readFile(join(PUBLIC_DIR, 'app.js')));
  });
});

describe('DELETE /api/bookings/<id>', () => {
  const ctx = {};
  useServer(ctx);

  it('deletes a booking once, then reports it missing', async () => {
    const [one, two] = await seedBookings(ctx.port, [{ date: '2026-11-03' }, { date: '2026-11-04' }]);
    assert.equal(one.id, 1);
    assert.equal(two.id, 2);
    const first = await request(ctx.port, { method: 'DELETE', path: '/api/bookings/1?x' });
    assert.equal(first.status, 204);
    assert.equal(first.body.length, 0);
    assert.deepEqual(await listAll(ctx.port), [two]);
    const again = await request(ctx.port, { method: 'DELETE', path: '/api/bookings/1' });
    expectError(again, 404, 'booking not found');
    assert.deepEqual(await listAll(ctx.port), [two]);
  });

  const BAD_IDS = [
    '0', '02', '002', '+2', '2.0', '-2', '2e0', '%202', 'abc', '99999999999999999999999',
    '9007199254740993', '0x2', '2%20', '%32',
  ];
  for (const id of BAD_IDS) {
    it(`404 booking not found for id ${JSON.stringify(id)} and booking 2 stays`, async () => {
      const res = await raw(ctx.port, 'DELETE', `/api/bookings/${id}`);
      expectError(res, 404, 'booking not found');
      const ids = (await listAll(ctx.port)).map((item) => item.id);
      assert.deepEqual(ids, [2]);
    });
  }
});

describe('DELETE with a non-ASCII id', () => {
  const ctx = {};
  useServer(ctx);

  // Node's HTTP parser itself rejects raw non-ASCII bytes in the request target (400 before
  // server.mjs runs), so the best check is that Arabic-Indic digit two never deletes booking 2.
  it('never deletes booking 2 for the raw UTF-8 digit ٢', async () => {
    await seedBookings(ctx.port, [{ date: '2026-11-03' }, { date: '2026-11-04' }]);
    const res = await raw(ctx.port, 'DELETE', '/api/bookings/٢');
    assert.ok(res.status === 404 || res.status === 400);
    assert.deepEqual((await listAll(ctx.port)).map((item) => item.id), [1, 2]);
  });
});

describe('content types', () => {
  const ctx = {};
  useServer(ctx);

  it('JSON replies carry the exact JSON content type and 204 has no body', async () => {
    const created = await postBooking(ctx.port, BASE_BOOKING);
    assert.equal(created.status, 201);
    assert.equal(created.headers['content-type'], JSON_TYPE);
    const clash = await postBooking(ctx.port, BASE_BOOKING);
    assert.equal(clash.status, 409);
    assert.equal(clash.headers['content-type'], JSON_TYPE);
    const all = await request(ctx.port, { path: '/api/bookings' });
    assert.equal(all.status, 200);
    assert.equal(all.headers['content-type'], JSON_TYPE);
    expectError(await request(ctx.port, { path: '/api/bookings?date=x' }), 400, DATE_MSG);
    expectError(await request(ctx.port, { path: '/nope' }), 404, 'not found');
    expectError(await request(ctx.port, { method: 'PUT', path: '/api/rooms' }), 405, 'method not allowed');
    const del = await request(ctx.port, { method: 'DELETE', path: '/api/bookings/1' });
    assert.equal(del.status, 204);
    assert.equal(del.body.length, 0);
  });
});

describe('GET /api/bookings ordering', () => {
  const ctx = {};
  useServer(ctx);
  let made;

  before(async () => {
    made = await seedBookings(ctx.port, [
      { date: '2026-11-04', room: 'Aurora', start: '08:00', end: '09:00', title: 't1' },
      { date: '2026-11-03', room: 'Cosmos', start: '09:00', end: '10:00', title: 't2' },
      { date: '2026-11-03', room: 'Aurora', start: '09:00', end: '10:00', title: 't3' },
      { date: '2026-11-03', room: 'Borealis', start: '09:00', end: '10:00', title: 't4' },
      { date: '2026-11-03', room: 'Aurora', start: '07:00', end: '08:00', title: 't5' },
      { date: '2025-12-31', room: 'Cosmos', start: '23:00', end: '23:30', title: 't6' },
      // Same date: start order (8, 9, 10), end order (11, 12, 13) and id order (7, 8, 9) all differ.
      { date: '2026-11-05', room: 'Borealis', start: '09:00', end: '10:00', title: 't7' },
      { date: '2026-11-05', room: 'Aurora', start: '08:00', end: '12:00', title: 't8' },
      { date: '2026-11-05', room: 'Cosmos', start: '08:30', end: '08:45', title: 't9' },
    ]);
  });

  const byIds = (ids) => ids.map((id) => made[id - 1]);
  const ALL_IDS = [6, 5, 3, 4, 2, 1, 8, 9, 7];

  it('sorts by date, then start, then room', async () => {
    assert.deepEqual(made.map((item) => item.id), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual(await listAll(ctx.port), byIds(ALL_IDS));
  });

  it('sorts by start, not by end or creation order, on one date', async () => {
    assert.deepEqual(await listAll(ctx.port, '?date=2026-11-05'), byIds([8, 9, 7]));
  });

  it('filters by date and ignores other parameters', async () => {
    const day3 = byIds([5, 3, 4, 2]);
    assert.deepEqual(await listAll(ctx.port, '?date=2026-11-03'), day3);
    assert.deepEqual(await listAll(ctx.port, '?date=2026-11-03&date=2026-11-04'), day3);
    assert.deepEqual(await listAll(ctx.port, '?x=1&date=2026-11-04'), byIds([1]));
    assert.deepEqual(await listAll(ctx.port, '?date=2026-11-06'), []);
    assert.deepEqual(await listAll(ctx.port, '?dat=2026-11-03'), byIds(ALL_IDS));
    assert.deepEqual(await listAll(ctx.port, '?date=2026%2D11%2D03'), day3);
    assert.deepEqual(await listAll(ctx.port, '?a=1?date=2026-11-03'), byIds(ALL_IDS));
  });

  const BAD_DATES = [
    '?date', '?date=', '?date=2026-11-3', '?date=%202026-11-03', '?date=2026-02-29', '?date=2100-01-01',
    '?date=1999-12-31', '?date=2026-13-01', '?date=abc', '?date=2026-11-03T00:00', '?date=2026-11-03+',
    '?date=&date=2026-11-03',
  ];
  for (const query of BAD_DATES) {
    it(`400 for ${query}`, async () => {
      const res = await request(ctx.port, { path: `/api/bookings${query}` });
      expectError(res, 400, DATE_MSG);
    });
  }
});

describe('GET /api/bookings room order', () => {
  const ctx = {};
  useServer(ctx);

  it('orders rooms Aurora, Borealis, Cosmos, not by creation or id', async () => {
    const made = await seedBookings(ctx.port, [{ room: 'Cosmos' }, { room: 'Borealis' }, { room: 'Aurora' }]);
    assert.deepEqual(made.map((item) => item.id), [1, 2, 3]);
    assert.deepEqual(await listAll(ctx.port), [made[2], made[1], made[0]]);
  });

  it('an empty store lists no bookings', async () => {
    const res = await request(ctx.port, { method: 'DELETE', path: '/api/bookings/1' });
    assert.equal(res.status, 204);
    await request(ctx.port, { method: 'DELETE', path: '/api/bookings/2' });
    await request(ctx.port, { method: 'DELETE', path: '/api/bookings/3' });
    const all = await request(ctx.port, { path: '/api/bookings' });
    assert.deepEqual(all.json(), { bookings: [] });
  });
});
