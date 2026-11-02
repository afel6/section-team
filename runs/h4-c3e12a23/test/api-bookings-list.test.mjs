import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { request, postBooking } from './helpers/server-harness.mjs';
import { assertJsonError, listBookings, useServer, MSG } from './helpers/api-assert.mjs';

// Posted in this scrambled order, so ids are 1..9 in this order.
const INPUTS = [
  ['Cosmos', '2026-11-04', '08:00', '09:00'],
  ['Aurora', '2026-11-03', '10:00', '11:00'],
  ['Borealis', '2026-11-03', '09:00', '10:00'],
  ['Cosmos', '2026-11-03', '09:00', '09:30'],
  ['Aurora', '2026-11-03', '09:00', '09:30'],
  ['Borealis', '2026-11-10', '07:00', '08:00'],
  ['Aurora', '2026-11-09', '23:00', '23:59'],
  ['Aurora', '2025-12-31', '12:00', '13:00'],
  ['Aurora', '2026-11-04', '08:00', '09:00'],
];

function booking(id) {
  const [room, date, start, end] = INPUTS[id - 1];
  return { id, room, title: `Meeting ${id}`, date, start, end };
}

// Sorted by date, then start, then room order.
const ALL_ORDER = [8, 5, 3, 4, 2, 9, 1, 7, 6];
const ON_1103 = [5, 3, 4, 2];
const ON_1104 = [9, 1];
const expected = (ids) => ids.map(booking);

describe('GET /api/bookings', () => {
  const ctx = useServer();

  const get = (query) => request(ctx.port, { path: `/api/bookings${query}` });

  async function assertList(query, ids) {
    assert.deepEqual(await listBookings(ctx.port, query), expected(ids));
  }

  it('is empty at first', async () => {
    await assertList('', []);
  });

  it('sorts by date, then start, then room', async () => {
    for (let id = 1; id <= INPUTS.length; id += 1) {
      const { room, date, start, end } = booking(id);
      const res = await postBooking(ctx.port, { room, title: `Meeting ${id}`, date, start, end });
      assert.equal(res.status, 201);
      assert.deepEqual(res.json(), booking(id));
    }
    await assertList('', ALL_ORDER);
  });

  describe('date filter', () => {
    const cases = [
      ['?date=2026-11-03', ON_1103],
      ['?date=2026-11-03&date=2026-11-04', ON_1103],
      ['?x=1&date=2026-11-04', ON_1104],
      ['?Date=2026-11-03', ALL_ORDER],
      ['?date=2026%2D11%2D03', ON_1103],
      ['?date=2030-01-01', []],
      ['?', ALL_ORDER],
      ['?dates=2026-11-03', ALL_ORDER],
    ];
    for (const [query, ids] of cases) {
      it(`${query} lists ${JSON.stringify(ids)}`, async () => {
        await assertList(query, ids);
      });
    }
  });

  describe('invalid date', () => {
    const queries = [
      '?date', '?date=', '?date=&date=2026-11-03', '?date=bad&date=2026-11-03',
      '?date=2026-02-30', '?date=2026-11-3', '?date=2026-11-03+', '?date=+2026-11-03',
      '?date=%202026-11-03', '?date=1999-12-31', '?date=2100-01-01', '?date=2001-02-29',
      '?date=%E0', '?a&date',
    ];
    for (const query of queries) {
      it(`${query} is 400`, async () => {
        assertJsonError(await get(query), 400, MSG.date);
      });
    }
  });

  describe('valid date edges', () => {
    for (const date of ['2000-02-29', '2096-02-29', '2000-01-01', '2099-12-31']) {
      it(`accepts ${date}`, async () => {
        await assertList(`?date=${date}`, []);
      });
    }
  });
});
