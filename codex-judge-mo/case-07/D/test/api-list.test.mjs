import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request, postJson, booking } from './helpers.mjs';
import { fixture, assertJson, create, listBookings, BAD_DATE } from './api-util.mjs';

const fields = (b) => ({ room: b.room, title: b.title, date: b.date, start: b.start, end: b.end });

describe('GET /api/bookings ordering', () => {
  const fx = fixture();
  before(() => fx.start());
  after(() => fx.stop());

  it('sorts by date, start, then room order', async () => {
    const inputs = [
      booking({ room: 'Cosmos', title: 'c1', date: '2026-11-03', start: '09:00', end: '10:00' }),
      booking({ room: 'Aurora', title: 'a1', date: '2026-11-03', start: '09:00', end: '10:00' }),
      booking({ room: 'Borealis', title: 'b1', date: '2026-11-03', start: '09:00', end: '10:00' }),
      booking({ room: 'Cosmos', title: 'late', date: '2026-11-03', start: '14:00', end: '15:00' }),
      booking({ room: 'Aurora', title: 'early', date: '2026-11-03', start: '08:00', end: '08:30' }),
      booking({ room: 'Borealis', title: 'prev', date: '2026-11-02', start: '23:00', end: '23:59' }),
      booking({ room: 'Aurora', title: 'next', date: '2026-12-01', start: '00:00', end: '01:00' }),
      booking({ room: 'Cosmos', title: 'half', date: '2026-11-04', start: '09:00', end: '09:30' }),
      booking({ room: 'Borealis', title: 'full', date: '2026-11-04', start: '09:00', end: '10:00' }),
    ];
    const created = [];
    for (const input of inputs) created.push(await create(fx.port, input));
    created.forEach((b, i) => {
      assert.deepEqual(Object.keys(b).sort(), ['date', 'end', 'id', 'room', 'start', 'title']);
      assert.deepEqual(b, { id: i + 1, ...inputs[i] });
    });
    const byTitle = Object.fromEntries(created.map((b) => [b.title, b]));
    const expected = ['prev', 'early', 'a1', 'b1', 'c1', 'late', 'full', 'half', 'next'].map((t) => byTitle[t]);
    assert.deepEqual(await listBookings(fx.port), expected);
  });
});

describe('POST extra keys', () => {
  const fx = fixture();
  before(() => fx.start());
  after(() => fx.stop());

  it('ignores extra body keys including id', async () => {
    const res = await postJson(fx.port, { ...booking(), extra: 1, id: 99 });
    assertJson(res, 201, { id: 1, ...booking() });
    assert.deepEqual(await listBookings(fx.port), [{ id: 1, ...booking() }]);
  });
});

describe('?date filter', () => {
  const fx = fixture();
  let day3;
  let day4;
  before(async () => {
    await fx.start();
    const a = await create(fx.port, { date: '2026-11-03', start: '11:00', end: '12:00' });
    const b = await create(fx.port, { date: '2026-11-04', start: '09:00', end: '10:00' });
    const c = await create(fx.port, { date: '2026-11-03', start: '09:00', end: '10:00' });
    day3 = [c, a];
    day4 = [b];
  });
  after(() => fx.stop());

  const get = (q) => request(fx.port, { path: `/api/bookings${q}` });

  const ok = [
    ['?date=2026-11-03', () => day3],
    ['?date=2026-11-03&date=2026-11-04', () => day3],
    ['?x=1&date=2026-11-04', () => day4],
    ['?foo=bar', () => [...day3, ...day4]],
    ['?date=2026-11-05', () => []],
    ['?date=2026%2D11%2D03', () => day3],
    ['?DATE=bad', () => [...day3, ...day4]],
  ];
  for (const [q, want] of ok) {
    it(`200 for ${q}`, async () => {
      assertJson(await get(q), 200, { bookings: want() });
    });
  }

  const bad = ['?date', '?date=', '?date=bad', '?date=2026-02-30', '?date=2026-11-3',
    '?date=%202026-11-03', '?date=2026-11-03+', '?dat%65=bad'];
  for (const q of bad) {
    it(`400 for ${q}`, async () => {
      assertJson(await get(q), 400, BAD_DATE);
    });
  }

  it('POST with ?date=bad still creates', async () => {
    const res = await request(fx.port, {
      method: 'POST',
      path: '/api/bookings?date=bad',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking({ room: 'Cosmos', date: '2027-01-01' })),
    });
    assert.equal(res.status, 201);
    assert.deepEqual(fields(res.json), booking({ room: 'Cosmos', date: '2027-01-01' }));
  });
});
