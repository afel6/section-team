// POST /api/bookings: booking rules 4 to 10 (fields, order of rules, overlaps).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setup, freshBooking, nextDate, assertError, assertCreated, postBooking, postRaw,
} from './helpers/booking-utils.mjs';

const ROOM_MSG = 'room must be one of Aurora, Borealis, Cosmos';
const TITLE_MSG = 'title must be 1 to 80 characters';
const DATE_MSG = 'date must be a valid YYYY-MM-DD date';
const START_MSG = 'start must be HH:MM';
const END_MSG = 'end must be HH:MM';
const ORDER_MSG = 'end must be after start';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

/** One test per value: `field` set to `value` (undefined means missing) must give 400 `message`. */
function rejectCases(field, values, message) {
  for (const value of values) {
    const label = value === undefined ? 'missing' : JSON.stringify(value);
    test(`${field} ${label.length > 40 ? `${label.slice(0, 40)}...` : label} is rejected`, async () => {
      const res = await postBooking(env.port, freshBooking({ [field]: value }));
      assertError(res, 400, message);
    });
  }
}

/** One test per [value, stored]: `field` set to `value` must give 201. */
function acceptCases(field, cases) {
  for (const [value, stored = value] of cases) {
    test(`${field} ${JSON.stringify(value).slice(0, 40)} is accepted`, async () => {
      const sent = freshBooking({ [field]: value });
      const res = await postBooking(env.port, sent);
      assertCreated(res, sent, { [field]: stored });
    });
  }
}

describe('rule 4: room', () => {
  rejectCases('room', ['aurora', 'AURORA', ' Aurora', 'Aurora ', '', undefined, null, 1, ['Aurora'], 'Dawn'], ROOM_MSG);
  acceptCases('room', [['Aurora'], ['Borealis'], ['Cosmos']]);
});

describe('rule 5: title', () => {
  rejectCases('title', [undefined, null, 5, '', '   ', '\t\n', 'a'.repeat(81), ` ${'a'.repeat(81)} `,
    '😀'.repeat(41), 'é'.repeat(81), ['x'], {}], TITLE_MSG);
  acceptCases('title', [
    ['a'.repeat(80)],
    [`  ${'a'.repeat(80)}  `, 'a'.repeat(80)],
    [' X ', 'X'],
    ['\u{A0}X\u{A0}', 'X'],
    ['\u{FEFF}X', 'X'],
    ['\t\nX\r\n', 'X'],
    ['  two  words  ', 'two  words'],
    ['😀'.repeat(40)],
    ['é'.repeat(80)],
    ['<b>x</b>'],
  ]);
});

describe('rule 6: date', () => {
  rejectCases('date', ['2100-02-29', '2001-02-29', '1999-12-31', '2100-01-01', '2026-04-31', '2026-13-01',
    '2026-00-10', '2026-01-00', '2026-01-32', ' 2026-11-03', '2026-11-03 ', '2026-11-3', '26-11-03',
    '2026/11/03', '20261103', '２０２６-11-03', '2026-11-03T00:00', 20261103, null, undefined, ''], DATE_MSG);
  acceptCases('date', [['2000-02-29'], ['2096-02-29'], ['2004-02-29'], ['2000-01-01'], ['2099-12-31'],
    ['2026-04-30']]);
});

describe('rule 7: start', () => {
  rejectCases('start', ['24:00', '9:00', '09:0', '09:60', '0900', '09.00', ' 09:00', '09:00 ', '09:00:00',
    '-1:00', '٠٩:٠٠', 900, null, undefined, ''], START_MSG);
  test('00:00 to 00:01 is accepted', async () => {
    const sent = freshBooking({ start: '00:00', end: '00:01' });
    assertCreated(await postBooking(env.port, sent), sent);
  });
  test('23:58 to 23:59 is accepted', async () => {
    const sent = freshBooking({ start: '23:58', end: '23:59' });
    assertCreated(await postBooking(env.port, sent), sent);
  });
});

describe('rule 8: end', () => {
  rejectCases('end', ['24:00', '9:00', '23:60', '10:00 ', '10.00', 1000, null, undefined, ''], END_MSG);
});

describe('rule 9: end after start', () => {
  test('end equal to start is rejected', async () => {
    assertError(await postBooking(env.port, freshBooking({ start: '09:00', end: '09:00' })), 400, ORDER_MSG);
  });
  test('end before start is rejected', async () => {
    assertError(await postBooking(env.port, freshBooking({ start: '10:00', end: '09:00' })), 400, ORDER_MSG);
  });
});

describe('order of rules: the first failing rule wins', () => {
  const bad = { room: 'Dawn', title: '', date: 'x', start: 'x', end: 'x' };
  const cases = [
    ['empty object gives the room error', null, ROOM_MSG],
    ['bad room and bad title: room', bad, ROOM_MSG],
    ['good room, bad title, date, start, end: title', { ...bad, room: 'Aurora' }, TITLE_MSG],
    ['good room and title, bad date, start, end: date', { ...bad, room: 'Aurora', title: 'T' }, DATE_MSG],
    ['good up to date, bad start and end: start', { ...bad, room: 'Aurora', title: 'T', date: '2030-01-01' }, START_MSG],
    ['good up to start, bad end: end', { ...bad, room: 'Aurora', title: 'T', date: '2030-01-01', start: '09:00' }, END_MSG],
    ['all valid but end before start: order', { room: 'Aurora', title: 'T', date: '2030-01-01', start: '10:00', end: '09:00' }, ORDER_MSG],
  ];
  for (const [name, body, message] of cases) {
    test(name, async () => {
      const res = body === null ? await postRaw(env.port, '{}') : await postBooking(env.port, body);
      assertError(res, 400, message);
    });
  }

  test('rule 9 comes before rule 10', async () => {
    const date = nextDate();
    const first = await postBooking(env.port, freshBooking({ date, start: '09:00', end: '10:00' }));
    assert.equal(first.status, 201);
    const res = await postBooking(env.port, freshBooking({ date, start: '09:30', end: '09:30' }));
    assertError(res, 400, ORDER_MSG);
  });
});

describe('rule 10: overlaps', () => {
  const at = (date, start, end, room = 'Aurora') => freshBooking({ date, start, end, room });
  const conflict = (start, end) => `room is already booked from ${start} to ${end}`;

  test('overlapping starts, ends, adjacency before and after', async () => {
    const date = nextDate();
    assert.equal((await postBooking(env.port, at(date, '09:00', '10:00'))).status, 201);
    assertError(await postBooking(env.port, at(date, '09:30', '10:30')), 409, conflict('09:00', '10:00'));
    assertError(await postBooking(env.port, at(date, '08:00', '09:01')), 409, conflict('09:00', '10:00'));
    assert.equal((await postBooking(env.port, at(date, '10:00', '11:00'))).status, 201);
    assert.equal((await postBooking(env.port, at(date, '08:00', '09:00'))).status, 201);
  });

  test('same times in another room or on another date are fine', async () => {
    const date = nextDate();
    assert.equal((await postBooking(env.port, at(date, '09:00', '10:00'))).status, 201);
    assert.equal((await postBooking(env.port, at(date, '09:00', '10:00', 'Borealis'))).status, 201);
    assert.equal((await postBooking(env.port, at(nextDate(), '09:00', '10:00'))).status, 201);
  });

  test('reports the overlapping booking that starts earliest, not the first created', async () => {
    const date = nextDate();
    assert.equal((await postBooking(env.port, at(date, '10:00', '11:00'))).status, 201);
    assert.equal((await postBooking(env.port, at(date, '08:00', '09:00'))).status, 201);
    assertError(await postBooking(env.port, at(date, '08:30', '10:30')), 409, conflict('08:00', '09:00'));
  });

  test('a booking containing an existing one conflicts with it', async () => {
    const date = nextDate();
    assert.equal((await postBooking(env.port, at(date, '09:00', '10:00'))).status, 201);
    assertError(await postBooking(env.port, at(date, '08:00', '11:00')), 409, conflict('09:00', '10:00'));
  });

  test('a booking inside an existing one conflicts with it', async () => {
    const date = nextDate();
    assert.equal((await postBooking(env.port, at(date, '09:00', '12:00'))).status, 201);
    assertError(await postBooking(env.port, at(date, '10:00', '11:00')), 409, conflict('09:00', '12:00'));
  });

  test('an identical booking conflicts', async () => {
    const date = nextDate();
    assert.equal((await postBooking(env.port, at(date, '09:00', '10:00'))).status, 201);
    assertError(await postBooking(env.port, at(date, '09:00', '10:00')), 409, conflict('09:00', '10:00'));
  });
});

describe('fields other than title are stored unchanged', () => {
  test('room, date, start and end equal the input', async () => {
    const sent = freshBooking({ room: 'Cosmos', start: '07:05', end: '08:59' });
    const res = await postBooking(env.port, sent);
    assertCreated(res, sent);
    assert.equal(res.json.date, sent.date);
    assert.equal(res.json.room, 'Cosmos');
    assert.equal(res.json.start, '07:05');
    assert.equal(res.json.end, '08:59');
  });
});
