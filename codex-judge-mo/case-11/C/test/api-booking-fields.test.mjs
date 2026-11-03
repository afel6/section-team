// Booking rules 6-10 (date, start, end, end-after-start order, overlaps).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { request, postBooking, validBooking } from './helpers/server-harness.mjs';
import {
  MSG, assertJsonError, assertCreated, freshDate, freshBooking, label, useServer,
} from './helpers/api-assert.mjs';

function assertBooked(res, start, end) {
  assertJsonError(res, 409, `room is already booked from ${start} to ${end}`);
}

describe('rule 6 date', () => {
  const ctx = useServer();
  const accepted = [
    '2000-01-01', '2099-12-31', '2000-02-29', '2096-02-29', '2024-02-29',
    '2026-12-31', '2026-04-30', '2026-01-31',
  ];
  for (const date of accepted) {
    it(`accepts ${date}`, async () => {
      const value = validBooking({ date });
      assertCreated(await postBooking(ctx.port, value), value);
    });
  }
  const rejected = [
    '1999-12-31', '2100-01-01', '2100-02-28', '2001-02-29', '2026-02-29', '2026-02-30',
    '2026-04-31', '2026-06-31', '2026-13-01', '2026-00-10', '2026-11-00', '2026-11-32',
    '2026-11-3', ' 2026-11-03', '2026-11-03 ', '2026/11/03', '26-11-03', '+2026-11-03',
    '2026-11-03T00:00', '\u{ff12}\u{ff10}\u{ff12}\u{ff16}-11-03', '', 20261103, null, undefined,
  ];
  for (const date of rejected) {
    it(`rejects ${label(date)}`, async () => {
      assertJsonError(await postBooking(ctx.port, validBooking({ date })), 400, MSG.date);
    });
  }
});

describe('rules 7 and 8 start and end', () => {
  const ctx = useServer();
  const pairs = [['00:00', '00:01'], ['23:58', '23:59'], ['00:00', '23:59']];
  for (const [start, end] of pairs) {
    it(`accepts ${start}-${end}`, async () => {
      const value = freshBooking({ start, end });
      assertCreated(await postBooking(ctx.port, value), value);
    });
  }
  const badTimes = [
    '24:00', '12:60', '9:00', '09:0', '09:00 ', ' 09:00', '0900', '09:00:00', '09-00',
    '-1:00', '\u{660}\u{669}:\u{660}\u{660}', '', 900, null, undefined,
  ];
  for (const bad of badTimes) {
    it(`rejects start ${label(bad)}`, async () => {
      const res = await postBooking(ctx.port, freshBooking({ start: bad, end: '23:59' }));
      assertJsonError(res, 400, MSG.start);
    });
    it(`rejects end ${label(bad)}`, async () => {
      const res = await postBooking(ctx.port, freshBooking({ start: '00:00', end: bad }));
      assertJsonError(res, 400, MSG.end);
    });
  }
  it('reports start when start and end are both invalid', async () => {
    const res = await postBooking(ctx.port, freshBooking({ start: '9:00', end: '25:00' }));
    assertJsonError(res, 400, MSG.start);
  });
});

describe('rule 9 end after start', () => {
  const ctx = useServer();
  const cases = [['09:00', '09:00'], ['10:00', '09:00'], ['23:59', '00:00'], ['00:01', '00:00']];
  for (const [start, end] of cases) {
    it(`rejects ${start}-${end}`, async () => {
      assertJsonError(await postBooking(ctx.port, freshBooking({ start, end })), 400, MSG.order);
    });
  }
});

describe('rule 10 overlaps', () => {
  const ctx = useServer();
  const post = (value) => postBooking(ctx.port, value);

  it('allows touching, other room and other date; names the earliest overlap', async () => {
    const date = freshDate();
    const bookingAt = (start, end, extra = {}) => validBooking({ date, start, end, ...extra });
    const accepted = [
      bookingAt('09:00', '10:00'), bookingAt('10:00', '11:00'), bookingAt('08:00', '09:00'),
      bookingAt('09:00', '10:00', { room: 'Borealis' }), bookingAt('09:00', '10:00', { date: freshDate() }),
    ];
    for (const value of accepted) assertCreated(await post(value), value);

    const conflicts = [
      ['09:30', '10:30', '09:00', '10:00'],
      ['08:30', '09:30', '08:00', '09:00'],
      ['09:00', '10:00', '09:00', '10:00'],
      ['09:59', '10:01', '09:00', '10:00'],
      ['10:59', '11:30', '10:00', '11:00'],
      ['07:00', '08:01', '08:00', '09:00'],
      ['08:00', '11:00', '08:00', '09:00'],
      ['09:10', '09:20', '09:00', '10:00'],
    ];
    for (const [start, end, busyStart, busyEnd] of conflicts) {
      assertBooked(await post(bookingAt(start, end)), busyStart, busyEnd);
    }
  });

  it('names the earliest-starting overlap, not the first created', async () => {
    const date = freshDate();
    const later = validBooking({ date, start: '12:00', end: '13:00' });
    const earlier = validBooking({ date, start: '10:00', end: '11:00' });
    assertCreated(await post(later), later);
    assertCreated(await post(earlier), earlier);
    assertBooked(await post({ ...later, start: '10:30', end: '12:30' }), '10:00', '11:00');
  });

  it('detects containing and contained requests, and frees the slot after DELETE', async () => {
    const date = freshDate();
    const existing = validBooking({ date, start: '12:00', end: '13:00' });
    const created = assertCreated(await post(existing), existing);
    assertBooked(await post({ ...existing, start: '08:00', end: '18:00' }), '12:00', '13:00');
    assertBooked(await post({ ...existing, start: '12:15', end: '12:45' }), '12:00', '13:00');
    const deleteRes = await request(ctx.port, { method: 'DELETE', path: `/api/bookings/${created.id}` });
    assert.equal(deleteRes.status, 204);
    const again = { ...existing, start: '08:00', end: '18:00' };
    assertCreated(await post(again), again);
  });
});
