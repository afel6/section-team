import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  useServer, request, postBooking, expectError, JSON_TYPE,
} from './helpers/server.mjs';

const DATE_ERROR = 'date must be a valid YYYY-MM-DD date';
const KEYS = ['date', 'end', 'id', 'room', 'start', 'title'];

function makeBooking(id, room, title, date, start, end) {
  return { id, room, title, date, start, end };
}

async function seed(port, bookings) {
  for (const b of bookings) {
    const { id, ...body } = b;
    const res = await postBooking(port, body);
    assert.equal(res.status, 201);
    assert.deepEqual(res.json(), b);
  }
}

const list = (port, query = '') => request(port, { path: `/api/bookings${query}` });

describe('GET /api/bookings ?date handling', () => {
  const ctx = useServer({ before, after });
  const b1 = makeBooking(1, 'Aurora', 'One', '2026-11-03', '09:00', '10:00');
  const b2 = makeBooking(2, 'Borealis', 'Two', '2026-11-04', '09:00', '10:00');
  const b3 = makeBooking(3, 'Cosmos', 'Leap', '2000-02-29', '09:00', '10:00');
  const b4 = makeBooking(4, 'Borealis', 'Four', '2026-11-03', '11:00', '12:00');
  const ALL = [b3, b1, b4, b2];
  const NOV3 = [b1, b4];

  before(() => seed(ctx.port, [b1, b2, b3, b4]));

  const OK = [
    ['?date=2026-11-03', NOV3],
    ['?date=2026%2D11%2D03', NOV3],
    ['?date=2026-11-03&date=bad', NOV3],
    ['?DATE=bad', ALL],
    ['?foo=1&bar', ALL],
    ['?x=1&date=2026-11-04', [b2]],
    ['?a=1?date=bad', ALL],
    ['?date=2000-02-29', [b3]],
    ['?date=2026-12-25', []],
    ['', ALL],
  ];
  for (const [query, expected] of OK) {
    test(`${query || '(no query)'} -> 200`, async () => {
      const res = await list(ctx.port, query);
      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], JSON_TYPE);
      assert.deepEqual(res.json(), { bookings: expected });
    });
  }

  const BAD = [
    '?date', '?date=', '?date=2026-11-3', '?date=%202026-11-03', '?date=2026-11-03+',
    '?date=2026-02-30', '?date=1999-12-31', '?date=2100-01-01', '?date=abc',
    '?date=bad&date=2026-11-03',
  ];
  for (const query of BAD) {
    test(`${query} -> 400`, async () => {
      const res = await list(ctx.port, query);
      expectError(res, 400, DATE_ERROR);
    });
  }

  test('POST ignores the query', async () => {
    const res = await request(ctx.port, {
      method: 'POST',
      path: '/api/bookings?date=bad',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: 'Cosmos', title: 'Q', date: '2026-05-05', start: '09:00', end: '10:00' }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.json().title, 'Q');
  });
});

describe('GET /api/bookings sorting', () => {
  const ctx = useServer({ before, after });
  const created = [
    makeBooking(1, 'Cosmos', 'a', '2026-11-03', '09:00', '10:00'),
    makeBooking(2, 'Borealis', 'b', '2026-11-03', '09:00', '09:30'),
    makeBooking(3, 'Aurora', 'c', '2026-11-03', '10:00', '11:00'),
    makeBooking(4, 'Aurora', 'd', '2026-11-03', '09:00', '09:15'),
    makeBooking(5, 'Aurora', 'e', '2026-11-02', '15:00', '16:00'),
    makeBooking(6, 'Cosmos', 'f', '2026-10-31', '23:00', '23:59'),
    makeBooking(7, 'Aurora', 'g', '2026-11-03', '09:30', '09:45'),
    makeBooking(8, 'Borealis', 'h', '2026-11-03', '08:59', '09:00'),
  ];
  const byId = (...ids) => ids.map((id) => created[id - 1]);

  before(() => seed(ctx.port, created));

  test('all bookings sorted by date, start, room', async () => {
    const res = await list(ctx.port);
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { bookings: byId(6, 5, 8, 4, 2, 1, 7, 3) });
  });

  test('filtered list is sorted the same way', async () => {
    const res = await list(ctx.port, '?date=2026-11-03');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { bookings: byId(8, 4, 2, 1, 7, 3) });
  });

  test('booking objects have exactly 6 keys and a numeric id', async () => {
    const { bookings } = (await list(ctx.port)).json();
    for (const b of bookings) {
      assert.deepEqual(Object.keys(b).sort(), KEYS);
      assert.equal(typeof b.id, 'number');
    }
  });
});

describe('DELETE /api/bookings/<id>', () => {
  const ctx = useServer({ before, after });
  const b1 = makeBooking(1, 'Aurora', 'One', '2026-11-03', '09:00', '10:00');
  const b2 = makeBooking(2, 'Borealis', 'Two', '2026-11-03', '09:00', '10:00');
  const del = (path, extra = {}) => request(ctx.port, { method: 'DELETE', path, ...extra });
  const ids = async () => (await list(ctx.port)).json().bookings.map((b) => b.id);

  before(() => seed(ctx.port, [b1, b2]));

  const BAD_IDS = ['0', '00', '01', '+1', '-1', '1.0', '1e0', '0x1', '%31', '1%20', 'abc',
    '99999999999999999999', '9007199254740993', '999'];
  for (const id of BAD_IDS) {
    test(`id ${id} -> 404 and booking 1 stays`, async () => {
      const res = await del(`/api/bookings/${id}`);
      expectError(res, 404, 'booking not found');
      assert.ok((await ids()).includes(1));
    });
  }

  test('delete lifecycle, ignored query and body, ids never reused', async () => {
    const first = await del('/api/bookings/1');
    assert.equal(first.status, 204);
    assert.equal(first.body.length, 0);
    assert.ok(!(await ids()).includes(1));

    const again = await del('/api/bookings/1');
    expectError(again, 404, 'booking not found');

    const withQuery = await del('/api/bookings/2?x=1', { body: 'junk', headers: { 'Content-Length': '4' } });
    assert.equal(withQuery.status, 204);
    assert.equal(withQuery.body.length, 0);
    assert.deepEqual(await ids(), []);

    const next = await postBooking(ctx.port, { ...b1, id: undefined });
    assert.equal(next.status, 201);
    assert.equal(next.json().id, 3);
  });
});
