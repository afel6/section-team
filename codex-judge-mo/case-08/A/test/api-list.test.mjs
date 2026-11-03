import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  JSON_TYPE,
  MSG,
  booking,
  expectError,
  getBookings,
  makeTmpDir,
  postBooking,
  request,
  startServer,
  withServer,
  withTmpDir,
  writeStore,
} from './helpers/server.mjs';

const SEED = [
  ['Cosmos', '2026-11-04', '09:00', '10:00'],
  ['Aurora', '2026-11-04', '08:00', '09:00'],
  ['Borealis', '2026-11-03', '10:00', '11:00'],
  ['Cosmos', '2026-11-03', '09:00', '10:00'],
  ['Borealis', '2026-11-03', '09:00', '10:00'],
  ['Aurora', '2026-11-03', '09:00', '10:00'],
  ['Aurora', '2026-10-31', '23:00', '23:59'],
  ['Aurora', '2026-12-01', '00:00', '00:30'],
  ['Aurora', '2025-12-31', '12:00', '13:00'],
  ['Cosmos', '2026-11-05', '08:00', '12:00'],
  ['Borealis', '2026-11-05', '08:30', '09:00'],
  ['Aurora', '2026-11-05', '09:00', '09:30'],
];
const ORDER = [9, 7, 6, 5, 4, 3, 2, 1, 10, 11, 12, 8];
const ALL_IDS = Array.from({ length: SEED.length }, (_, i) => i + 1);

const expected = (id) => {
  const [room, date, start, end] = SEED[id - 1];
  return { id, room, title: 'Standup', date, start, end };
};

let dir;
let srv;

before(async () => {
  dir = await makeTmpDir();
  srv = await startServer({ cwd: dir });
  for (const [room, date, start, end] of SEED) {
    const res = await postBooking(srv.port, booking({ room, date, start, end }));
    assert.strictEqual(res.status, 201);
  }
});

after(async () => {
  if (srv) await srv.stop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const ids = async (query = '') => (await getBookings(srv.port, query)).map((b) => b.id);

describe('GET /api/bookings sorting', () => {
  test('sorted by date, start, room with exact objects', async () => {
    const res = await request(srv.port, { path: '/api/bookings' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['content-type'], JSON_TYPE);
    assert.deepStrictEqual(res.json, { bookings: ORDER.map(expected) });
  });
});

describe('?date filter', () => {
  const filters = [
    ['?date=2026-11-03', [6, 5, 4, 3]],
    ['?date=2026-11-03&date=2026-11-04', [6, 5, 4, 3]],
    ['?x=1&date=2026-11-04', [2, 1]],
    ['?&date=2026-11-03', [6, 5, 4, 3]],
    ['?date=%32026-11-03', [6, 5, 4, 3]],
    ['?date=2026%2D11%2D03', [6, 5, 4, 3]],
    ['?date=2024-02-29', []],
    ['?date=2000-01-01', []],
    ['?date=2099-12-31', []],
  ];
  for (const [query, want] of filters) {
    test(`${query} -> ${JSON.stringify(want)}`, async () => {
      assert.deepStrictEqual(await ids(query), want);
    });
  }

  test('filtered result has exact objects', async () => {
    const res = await request(srv.port, { path: '/api/bookings?date=2026-11-04' });
    assert.deepStrictEqual(res.json, { bookings: [expected(2), expected(1)] });
  });

  const bad = [
    '?date=bad&date=2026-11-03',
    '?date',
    '?date=',
    '?date=2026-02-30',
    '?date=2023-02-29',
    '?date=1999-12-31',
    '?date=2100-01-01',
    '?date=2026-11-3',
    '?date=+2026-11-03',
    '?date=2026-11-03+',
    '?date=%202026-11-03',
    '?date=2026-11-03?x',
    '?date=2026-13-01',
    '?date=%D9%A2%D9%A0%D9%A2%D9%A6-%D9%A1%D9%A1-%D9%A0%D9%A3',
  ];
  for (const query of bad) {
    test(`400 for ${query}`, async () => {
      const res = await request(srv.port, { path: `/api/bookings${query}` });
      expectError(res, 400, MSG.date);
    });
  }

  for (const query of ['?Date=bad', '?dates=bad', '?a=1?date=bad', '?x']) {
    test(`ignored ${query}`, async () => {
      assert.deepStrictEqual(await ids(query), ORDER);
    });
  }
});

/** Runs fn({ port }) against a fresh server whose data file holds the 12 seeded bookings. */
function withSeededServer(fn) {
  return withTmpDir(async (tmp) => {
    const file = join(tmp, 'data.json');
    await writeStore(file, ALL_IDS.map(expected));
    return withServer({ cwd: tmp, env: { DATA_FILE: file } }, fn);
  });
}

const del = (port, path) => request(port, { method: 'DELETE', path });
const idsOf = async (port) => (await getBookings(port)).map((b) => b.id);

describe('DELETE id rules', () => {
  const invalid = [
    '01', '0', '00', '-1', '1.0', '%31', '+1', '%201', '1e0', '0x1', 'abc', '99', '13',
    '18446744073709551617',
  ];

  test('invalid or unknown ids are 404 booking not found', () =>
    withSeededServer(async ({ port }) => {
      for (const id of invalid) {
        expectError(await del(port, `/api/bookings/${id}`), 404, MSG.bookingNotFound);
      }
      assert.deepStrictEqual(await idsOf(port), ORDER);
    }));

  test('delete, then delete again', () =>
    withSeededServer(async ({ port }) => {
      const res = await del(port, '/api/bookings/1');
      assert.strictEqual(res.status, 204);
      assert.strictEqual(res.text, '');
      assert.deepStrictEqual(await idsOf(port), ORDER.filter((id) => id !== 1));
      expectError(await del(port, '/api/bookings/1'), 404, MSG.bookingNotFound);
    }));

  test('query is ignored', () =>
    withSeededServer(async ({ port }) => {
      const res = await del(port, '/api/bookings/2?x=1');
      assert.strictEqual(res.status, 204);
      assert.strictEqual(res.text, '');
      assert.deepStrictEqual(await idsOf(port), ORDER.filter((id) => id !== 2));
    }));

  test('trailing slash is not found and keeps the booking', () =>
    withSeededServer(async ({ port }) => {
      expectError(await del(port, '/api/bookings/3/'), 404, MSG.notFound);
      assert.deepStrictEqual(await idsOf(port), ORDER);
    }));

  test('GET /api/bookings/4 is 405 and keeps the booking', () =>
    withSeededServer(async ({ port }) => {
      expectError(await request(port, { path: '/api/bookings/4' }), 405, MSG.method);
      const kept = (await getBookings(port)).find((b) => b.id === 4);
      assert.deepStrictEqual(kept, expected(4));
    }));
});
