// Booking rules 4-10 and field handling for POST /api/bookings.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  useServer, postBooking, uniqueDate, expectError as assertErrorReply,
} from './helpers/server.mjs';

const MSG = {
  room: 'room must be one of Aurora, Borealis, Cosmos',
  title: 'title must be 1 to 80 characters',
  date: 'date must be a valid YYYY-MM-DD date',
  start: 'start must be HH:MM',
  end: 'end must be HH:MM',
  order: 'end must be after start',
};

function validFields(overrides = {}) {
  return { room: 'Aurora', title: 'Standup', date: uniqueDate(), start: '09:00', end: '10:00', ...overrides };
}

async function expectError(ctx, fields, status, message) {
  assertErrorReply(await postBooking(ctx.port, fields), status, message);
}

async function expectCreated(ctx, fields, expectedOverrides = {}) {
  const res = await postBooking(ctx.port, fields);
  assert.equal(res.status, 201);
  const json = res.json();
  assert.equal(typeof json.id, 'number');
  const { id, ...rest } = json;
  assert.deepEqual(Object.keys(json).sort(), ['date', 'end', 'id', 'room', 'start', 'title']);
  assert.deepEqual(rest, { ...fields, ...expectedOverrides });
  return id;
}

function errorTable(ctx, field, message, values) {
  for (const [name, value] of values) {
    test(`${field} invalid: ${name}`, async () => {
      await expectError(ctx, validFields({ [field]: value }), 400, message);
    });
  }
}

describe('room', () => {
  const ctx = useServer({ before, after });
  errorTable(ctx, 'room', MSG.room, [
    ['missing', undefined], ['lowercase', 'aurora'], ['uppercase', 'AURORA'],
    ['trailing space', 'Aurora '], ['leading space', ' Aurora'], ['empty', ''],
    ['number', 1], ['null', null], ['true', true], ['array', ['Aurora']], ['object', {}],
  ]);
  for (const room of ['Aurora', 'Borealis', 'Cosmos']) {
    test(`room valid: ${room}`, async () => {
      await expectCreated(ctx, validFields({ room }));
    });
  }
});

describe('title', () => {
  const ctx = useServer({ before, after });
  errorTable(ctx, 'title', MSG.title, [
    ['missing', undefined], ['null', null], ['number', 5], ['array', []], ['empty', ''],
    ['spaces', '   '], ['tab newline space', '\t\n '], ['ideographic space U+3000', '\u{3000}'],
    ['81 a', 'a'.repeat(81)], ['padded 81 a', `  ${'a'.repeat(81)}`], ['41 emoji (82 units)', '😀'.repeat(41)],
  ]);
  const valid = [
    ['80 a', 'a'.repeat(80), 'a'.repeat(80)],
    ['padded 80 a trimmed', `  ${'a'.repeat(80)}\n`, 'a'.repeat(80)],
    ['40 emoji (80 units)', '😀'.repeat(40), '😀'.repeat(40)],
    ['80 e-acute', 'é'.repeat(80), 'é'.repeat(80)],
    ['U+3000 and U+FEFF trimmed', '\u{3000}Team sync\u{FEFF}', 'Team sync'],
    ['inner NBSP U+00A0 kept, U+3000 and U+FEFF trimmed', '\u{3000}Team\u{A0}sync\u{FEFF}', 'Team\u{A0}sync'],
    ['inner spaces kept', 'a  b', 'a  b'],
    ['html kept as is', '<b>x</b>', '<b>x</b>'],
    ['one character', 'x', 'x'],
  ];
  for (const [name, title, stored] of valid) {
    test(`title valid: ${name}`, async () => {
      await expectCreated(ctx, validFields({ title }), { title: stored });
    });
  }
});

describe('date', () => {
  const ctx = useServer({ before, after });
  errorTable(ctx, 'date', MSG.date, [
    '1999-12-31', '2100-01-01', '2001-02-29', '2003-02-29', '2100-02-29', '2000-02-30',
    '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '2026-01-32', ' 2026-11-03',
    '2026-11-03 ', '2026-11-3', '26-11-03', '2026/11/03', '２０２６-11-03', '2026-11-03T00:00',
    '+2026-11-03', '',
  ].map((d) => [JSON.stringify(d), d]).concat([
    ['number 20261103', 20261103], ['null', null], ['missing', undefined],
  ]));
  for (const date of ['2000-01-01', '2099-12-31', '2000-02-29', '2004-02-29', '2096-02-29', '2026-04-30', '2026-12-31']) {
    test(`date valid: ${date}`, async () => {
      await expectCreated(ctx, validFields({ date }));
    });
  }
});

describe('start and end', () => {
  const ctx = useServer({ before, after });
  errorTable(ctx, 'start', MSG.start, [
    '24:00', '23:60', '9:00', '09:0', '09:00:00', ' 09:00', '09:00 ', '09h00', '０９:００', '-1:00', '',
  ].map((s) => [JSON.stringify(s), s]).concat([['number 900', 900], ['null', null], ['missing', undefined]]));
  errorTable(ctx, 'end', MSG.end, [
    '24:00', '23:60', '9:30', ' 10:00', '10:00 ',
  ].map((s) => [JSON.stringify(s), s]).concat([['null', null], ['missing', undefined]]));
  test('start valid: 00:00', async () => {
    await expectCreated(ctx, validFields({ start: '00:00', end: '00:30' }));
  });
  test('end valid: 23:59', async () => {
    await expectCreated(ctx, validFields({ start: '23:00', end: '23:59' }));
  });
  for (const [start, end] of [['10:00', '10:00'], ['10:00', '09:59'], ['00:00', '00:00']]) {
    test(`order invalid: ${start}-${end}`, async () => {
      await expectError(ctx, validFields({ start, end }), 400, MSG.order);
    });
  }
  for (const [start, end] of [['00:00', '00:01'], ['23:58', '23:59']]) {
    test(`order valid: ${start}-${end}`, async () => {
      await expectCreated(ctx, validFields({ start, end }));
    });
  }
});

describe('rule order', () => {
  const ctx = useServer({ before, after });
  const allBad = { room: 'x', title: '', date: 'x', start: 'x', end: 'x' };
  const cases = [
    ['all wrong -> room', allBad, MSG.room],
    ['room ok, rest wrong -> title', { ...allBad, room: 'Aurora' }, MSG.title],
    ['room, title ok -> date', { ...allBad, room: 'Aurora', title: 'T' }, MSG.date],
    ['room, title, date ok -> start', { ...allBad, room: 'Aurora', title: 'T', date: '2026-11-03' }, MSG.start],
    ['start ok -> end', { ...allBad, room: 'Aurora', title: 'T', date: '2026-11-03', start: '10:00' }, MSG.end],
    ['bad end format before start -> end, not order',
      { room: 'Aurora', title: 'T', date: '2026-11-03', start: '10:00', end: '9:00' }, MSG.end],
  ];
  for (const [name, fields, message] of cases) {
    test(`first failing rule decides: ${name}`, async () => {
      await expectError(ctx, fields, 400, message);
    });
  }
  test('invalid end beats overlap (400 end, not 409)', async () => {
    const date = uniqueDate();
    await expectCreated(ctx, validFields({ date }));
    await expectError(ctx, validFields({ date, end: '9:60' }), 400, MSG.end);
  });
  test('invalid order beats overlap (400 order, not 409)', async () => {
    const date = uniqueDate();
    await expectCreated(ctx, validFields({ date }));
    await expectError(ctx, validFields({ date, start: '09:30', end: '09:30' }), 400, MSG.order);
  });
});

describe('other keys', () => {
  const ctx = useServer({ before, after });
  test('extra keys are ignored and the id is assigned by the server', async () => {
    const fields = validFields();
    const res = await postBooking(ctx.port, { ...fields, id: 99, extra: 'x' });
    assert.equal(res.status, 201);
    const json = res.json();
    assert.deepEqual(Object.keys(json).sort(), ['date', 'end', 'id', 'room', 'start', 'title']);
    assert.equal(json.id, 1, 'first booking of a fresh server gets id 1, not the id sent');
    assert.deepEqual({ ...json, id: undefined }, { ...fields, id: undefined });
  });
});

describe('overlap', () => {
  const ctx = useServer({ before, after });
  const BASE = 'room is already booked from 09:00 to 10:00';
  const cases = [
    ['10:00-11:00 touching after', '10:00', '11:00', 201],
    ['08:00-09:00 touching before', '08:00', '09:00', 201],
    ['09:59-10:30 overlaps the end', '09:59', '10:30', 409],
    ['08:30-09:01 overlaps the start', '08:30', '09:01', 409],
    ['09:00-10:00 identical', '09:00', '10:00', 409],
    ['09:15-09:45 inside', '09:15', '09:45', 409],
    ['08:30-10:30 around', '08:30', '10:30', 409],
  ];
  for (const [name, start, end, status] of cases) {
    test(`existing 09:00-10:00, new ${name}`, async () => {
      const date = uniqueDate();
      await expectCreated(ctx, validFields({ date }));
      const fields = validFields({ date, start, end });
      if (status === 201) await expectCreated(ctx, fields);
      else await expectError(ctx, fields, 409, BASE);
    });
  }
  test('same time in another room is allowed', async () => {
    const date = uniqueDate();
    await expectCreated(ctx, validFields({ date }));
    await expectCreated(ctx, validFields({ date, room: 'Borealis' }));
  });
  test('same room on another date is allowed', async () => {
    await expectCreated(ctx, validFields({ date: uniqueDate() }));
    await expectCreated(ctx, validFields({ date: uniqueDate() }));
  });
  test('earliest overlapping booking is reported, not the first created', async () => {
    const date = uniqueDate();
    await expectCreated(ctx, validFields({ date, start: '11:00', end: '12:00' }));
    await expectCreated(ctx, validFields({ date, start: '09:00', end: '10:00' }));
    await expectCreated(ctx, validFields({ date, start: '13:00', end: '14:00' }));
    await expectError(ctx, validFields({ date, start: '08:00', end: '15:00' }), 409, BASE);
    await expectError(ctx, validFields({ date, start: '11:30', end: '13:30' }), 409,
      'room is already booked from 11:00 to 12:00');
  });
  test('a rejected booking is not stored and ids stay unique', async () => {
    const date = uniqueDate();
    const first = await expectCreated(ctx, validFields({ date }));
    await expectError(ctx, validFields({ date }), 409, BASE);
    await expectError(ctx, validFields({ date, end: '08:00' }), 400, MSG.order);
    const second = await expectCreated(ctx, validFields({ date, start: '10:00', end: '11:00' }));
    assert.equal(second, first + 1, 'a rejected POST must not use up an id');
  });
});
