// Booking rules 1-10 for POST /api/bookings (first failing rule decides).
import { describe, it, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { postBooking, rawRequest, parseRaw, JSON_TYPE } from './support/harness.mjs';
import {
  BASE_BOOKING, JSON_HEADERS, expectError, listAll, useServer,
} from './support/fixtures.mjs';

const CHUNKED_TIMEOUT_MS = 5000;
const MSG = {
  type: 'content type must be application/json',
  large: 'body too large',
  obj: 'body must be a JSON object',
  room: 'room must be one of Aurora, Borealis, Cosmos',
  title: 'title must be 1 to 80 characters',
  date: 'date must be a valid YYYY-MM-DD date',
  start: 'start must be HH:MM',
  end: 'end must be HH:MM',
  after: 'end must be after start',
};

// A distinct date per call so successful bookings never collide with each other.
let freshCounter = 0;
function fresh(overrides = {}) {
  const index = freshCounter++;
  const month = String(1 + Math.floor(index / 28)).padStart(2, '0');
  const day = String(1 + (index % 28)).padStart(2, '0');
  return { ...BASE_BOOKING, date: `2030-${month}-${day}`, ...overrides };
}

function padTo(text, size) {
  return text + ' '.repeat(size - Buffer.byteLength(text));
}

function postChunked(port, chunks, headers = JSON_HEADERS) {
  return new Promise((resolve, reject) => {
    const options = { host: '127.0.0.1', port, method: 'POST', path: '/api/bookings', headers, agent: false };
    const req = http.request(options, (res) => {
      const parts = [];
      res.on('data', (chunk) => parts.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(parts).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) });
      });
      res.on('error', reject);
    });
    req.setTimeout(CHUNKED_TIMEOUT_MS, () => {
      req.destroy(new Error(`chunked POST timed out after ${CHUNKED_TIMEOUT_MS} ms`));
    });
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

// POSTs with a Content-Type header sent as raw latin1 bytes (so 0xA0 reaches the server as one byte).
async function postRawType(port, contentType, body) {
  const head = 'POST /api/bookings HTTP/1.1\r\nHost: x\r\nConnection: close\r\n'
    + `Content-Type: ${contentType}\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
  const parsed = parseRaw(await rawRequest(port, Buffer.from(head + body, 'latin1')));
  return { ...parsed, json: () => JSON.parse(parsed.body) };
}

// Runs a list of [label, body] cases that must be rejected with (status, message) and create nothing.
function rejectionCases(ctx, cases, status, message, headers = JSON_HEADERS) {
  for (const [label, body] of cases) {
    it(`${status} for ${label}`, async () => {
      expectError(await postBooking(ctx.port, body, headers), status, message);
    });
  }
}

async function created(ctx, body, expected) {
  const res = await postBooking(ctx.port, body);
  assert.equal(res.status, 201);
  assert.equal(res.headers['content-type'], JSON_TYPE);
  const booking = res.json();
  assert.deepEqual(booking, { id: booking.id, ...expected });
  return booking;
}

describe('rule 1: content type', () => {
  const ctx = {};
  useServer(ctx);

  const BAD = ['text/plain', 'application/jsonx', 'application/json-patch+json', 'application/ json', 'json', ''];
  for (const type of BAD) {
    it(`415 for ${JSON.stringify(type)}`, async () => {
      const res = await postBooking(ctx.port, fresh(), { 'Content-Type': type });
      expectError(res, 415, MSG.type);
      assert.deepEqual(await listAll(ctx.port), []);
    });
  }

  // Only spaces and tabs are stripped around the media type, so a trim() implementation fails here.
  for (const type of ['application/json\xa0', '\xa0application/json']) {
    it(`415 for ${JSON.stringify(type)} sent as a raw 0xA0 byte`, async () => {
      const res = await postRawType(ctx.port, type, JSON.stringify(fresh()));
      expectError(res, 415, MSG.type);
      assert.deepEqual(await listAll(ctx.port), []);
    });
  }

  it('415 when the header is missing', async () => {
    expectError(await postBooking(ctx.port, fresh(), {}), 415, MSG.type);
    assert.deepEqual(await listAll(ctx.port), []);
  });

  it('415 beats 413 and 400', async () => {
    const headers = { 'Content-Type': 'text/plain' };
    expectError(await postBooking(ctx.port, 'x'.repeat(20000), headers), 415, MSG.type);
    expectError(await postBooking(ctx.port, 'not json', headers), 415, MSG.type);
    assert.deepEqual(await listAll(ctx.port), []);
  });

  const GOOD = [
    'application/json', 'APPLICATION/JSON', 'Application/Json; charset=utf-8', ' \tapplication/json\t ; x=y',
    'application/json;',
  ];
  for (const type of GOOD) {
    it(`accepts ${JSON.stringify(type)}`, async () => {
      const body = fresh();
      const res = await postBooking(ctx.port, body, { 'Content-Type': type });
      assert.equal(res.status, 201);
      assert.deepEqual(res.json(), { id: res.json().id, ...body });
    });
  }
});

describe('rule 2: body size', () => {
  const ctx = {};
  useServer(ctx);

  it('413 for 10001 bytes, nothing created', async () => {
    const res = await postBooking(ctx.port, padTo(JSON.stringify(fresh()), 10001));
    expectError(res, 413, MSG.large);
    assert.deepEqual(await listAll(ctx.port), []);
  });

  it('accepts exactly 10000 bytes', async () => {
    const body = fresh();
    const res = await postBooking(ctx.port, padTo(JSON.stringify(body), 10000));
    assert.equal(res.status, 201);
    assert.deepEqual(res.json(), { id: 1, ...body });
  });

  it('counts bytes, not characters', async () => {
    const text = padTo(JSON.stringify({ title: 'é'.repeat(4994) }), 10001);
    assert.ok(text.length < 10000);
    assert.equal(Buffer.byteLength(text), 10001);
    expectError(await postBooking(ctx.port, text), 413, MSG.large);
  });

  it('413 beats 400', async () => {
    expectError(await postBooking(ctx.port, 'x'.repeat(10001)), 413, MSG.large);
  });

  it('413 for a chunked body of 10001 bytes', async () => {
    const text = padTo(JSON.stringify(fresh()), 10001);
    const buf = Buffer.from(text);
    const res = await postChunked(ctx.port, [buf.subarray(0, 3000), buf.subarray(3000, 7000), buf.subarray(7000)]);
    expectError(res, 413, MSG.large);
  });

  it('a chunked body of exactly 10000 bytes is accepted', async () => {
    const buf = Buffer.from(padTo(JSON.stringify(fresh({ date: '2031-01-01' })), 10000));
    const res = await postChunked(ctx.port, [buf.subarray(0, 5000), buf.subarray(5000)]);
    assert.equal(res.status, 201);
  });

  it('created only the one valid booking', async () => {
    assert.equal((await listAll(ctx.port)).length, 2);
  });
});

describe('rule 3: JSON object', () => {
  const ctx = {};
  useServer(ctx);
  afterEach(async () => assert.deepEqual(await listAll(ctx.port), []));

  const BOM_BODY = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(BASE_BOOKING))]);
  const CASES = [
    ['empty', ''], ['space', ' '], ['not json', 'not json'], ['null', 'null'], ['array', '[]'],
    ['array of object', '[{}]'], ['string', '"s"'], ['number', '1'], ['true', 'true'], ['truncated', '{'],
    ['BOM prefixed', BOM_BODY],
  ];
  rejectionCases(ctx, CASES, 400, MSG.obj);

  it('{} passes rule 3 and fails the room rule', async () => {
    expectError(await postBooking(ctx.port, '{}'), 400, MSG.room);
  });
});

describe('rule 3: invalid UTF-8', () => {
  const ctx = {};
  useServer(ctx);

  it('replaces bad bytes with U+FFFD', async () => {
    const body = fresh();
    const head = Buffer.from(`{"room":"Aurora","date":"${body.date}","start":"09:00","end":"10:00","title":"A`);
    const buf = Buffer.concat([head, Buffer.from([0xff]), Buffer.from('B"}')]);
    const res = await postBooking(ctx.port, buf);
    assert.equal(res.status, 201);
    assert.deepEqual(res.json(), { id: 1, ...body, title: 'A�B' });
  });
});

describe('rules 4-9: field validation', () => {
  const ctx = {};
  useServer(ctx);
  afterEach(async () => assert.deepEqual(await listAll(ctx.port), []));

  const withField = (key, values) => values.map(([label, value]) => [`${key} ${label}`, { ...BASE_BOOKING, [key]: value }]);
  const KINDS = [['missing', undefined], ['number', 900], ['null', null]];

  rejectionCases(ctx, withField('room', [
    ...KINDS, ['lowercase', 'aurora'], ['trailing space', 'Aurora '], ['leading space', ' Aurora'],
    ['array', ['Aurora']], ['unknown', 'Dune'], ['one', 1],
    ['toString', 'toString'], ['constructor', 'constructor'], ['__proto__', '__proto__'],
    ['hasOwnProperty', 'hasOwnProperty'],
  ]), 400, MSG.room);

  rejectionCases(ctx, withField('title', [
    ...KINDS, ['empty', ''], ['blanks', '   '], ['81 chars', 'a'.repeat(81)],
    ['space and 81 chars', ` ${'a'.repeat(81)}`], ['82 units', '\u{1F600}'.repeat(41)],
    ['array', ['x']], ['only NBSP and BOM', ' ﻿'],
  ]), 400, MSG.title);

  rejectionCases(ctx, withField('date', [
    ...KINDS, [' leading space', ' 2026-11-03'], ['one-digit day', '2026-11-3'], ['trailing space', '2026-11-03 '],
    ['compact', '20261103'], ['slashes', '2026/11/03'], ['1999', '1999-12-31'], ['2100', '2100-01-01'],
    ['2001-02-29', '2001-02-29'], ['2100-02-29', '2100-02-29'], ['02-30', '2026-02-30'], ['04-31', '2026-04-31'],
    ['month 0', '2026-00-10'], ['month 13', '2026-13-01'], ['day 0', '2026-11-00'], ['fullwidth', '２026-11-03'],
    ['numeric', 20261103], ['empty', ''],
  ]), 400, MSG.date);

  const BAD_TIMES = [
    ...KINDS, ['9:00', '9:00'], ['09:0', '09:0'], ['24:00', '24:00'], ['23:60', '23:60'], ['trailing space', '09:00 '],
    ['leading space', ' 09:00'], ['0900', '0900'], ['dash', '09-00'], ['seconds', '09:00:00'],
    ['arabic digits', '٠٩:00'], ['empty', ''],
  ];
  rejectionCases(ctx, withField('start', BAD_TIMES), 400, MSG.start);
  rejectionCases(ctx, withField('end', BAD_TIMES), 400, MSG.end);

  rejectionCases(ctx, [
    ['equal times', { ...BASE_BOOKING, start: '09:00', end: '09:00' }],
    ['end before start', { ...BASE_BOOKING, start: '10:00', end: '09:00' }],
    ['overlap-looking reversed times', { ...BASE_BOOKING, start: '23:59', end: '00:00' }],
  ], 400, MSG.after);

  it('24:00 end with a 23:00 start is an end error, not an order error', async () => {
    expectError(await postBooking(ctx.port, { ...BASE_BOOKING, start: '23:00', end: '24:00' }), 400, MSG.end);
  });
});

describe('rules 4-8: precedence', () => {
  const ctx = {};
  useServer(ctx);
  afterEach(async () => assert.deepEqual(await listAll(ctx.port), []));

  const CASES = [
    ['room before title', { ...BASE_BOOKING, room: 'x', title: '' }, MSG.room],
    ['title before date', { ...BASE_BOOKING, title: '', date: 'bad' }, MSG.title],
    ['date before start', { ...BASE_BOOKING, date: 'x', start: 'x' }, MSG.date],
    ['start before end', { ...BASE_BOOKING, start: 'x', end: 'x' }, MSG.start],
    ['end format before order', { ...BASE_BOOKING, start: '10:00', end: 'x' }, MSG.end],
    ['everything missing', {}, MSG.room],
  ];
  for (const [label, body, message] of CASES) {
    it(label, async () => expectError(await postBooking(ctx.port, body), 400, message));
  }
});

describe('rules 4-9: accepted values', () => {
  const ctx = {};
  useServer(ctx);

  it('stores an 80 character title', async () => {
    const title = 'a'.repeat(80);
    const body = fresh({ title });
    await created(ctx, body, body);
  });

  it('trims the title', async () => {
    const body = fresh({ title: `  ${'a'.repeat(80)}\t\n ` });
    await created(ctx, body, { ...body, title: 'a'.repeat(80) });
    const other = fresh({ title: ' x  ﻿' });
    await created(ctx, other, { ...other, title: 'x' });
  });

  it('counts UTF-16 units: 40 emoji are fine', async () => {
    const body = fresh({ title: '\u{1F600}'.repeat(40) });
    await created(ctx, body, body);
  });

  it('stores markup as is', async () => {
    const body = fresh({ title: '<b>x</b>' });
    await created(ctx, body, body);
  });

  for (const date of ['2000-01-01', '2099-12-31', '2000-02-29', '2004-02-29', '2096-02-29', '2026-12-31', '2026-01-31']) {
    it(`accepts date ${date}`, async () => {
      await created(ctx, { ...BASE_BOOKING, date }, { ...BASE_BOOKING, date });
    });
  }

  it('accepts the edges of the day', async () => {
    const late = fresh({ start: '23:58', end: '23:59' });
    await created(ctx, late, late);
    const early = fresh({ start: '00:00', end: '00:01' });
    await created(ctx, early, early);
  });
});

describe('rule 10: overlaps', () => {
  const ctx = {};
  useServer(ctx);
  let seeded;

  before(async () => {
    const late = await postBooking(ctx.port, { ...BASE_BOOKING, start: '11:00', end: '12:00', title: 'late' });
    const early = await postBooking(ctx.port, { ...BASE_BOOKING, start: '09:00', end: '10:00', title: 'early' });
    assert.equal(late.status, 201);
    assert.equal(early.status, 201);
    seeded = await listAll(ctx.port);
  });

  const CLASH = 'room is already booked from 09:00 to 10:00';
  const OVERLAPS = [['09:30', '11:30'], ['09:59', '10:00'], ['08:00', '09:01'], ['09:00', '12:00'], ['09:15', '09:45']];
  for (const [start, end] of OVERLAPS) {
    it(`409 for ${start}-${end} names the earliest overlap`, async () => {
      expectError(await postBooking(ctx.port, { ...BASE_BOOKING, start, end }), 409, CLASH);
      assert.deepEqual(await listAll(ctx.port), seeded);
    });
  }

  it('409 for the later booking when only it overlaps', async () => {
    const res = await postBooking(ctx.port, { ...BASE_BOOKING, start: '11:30', end: '11:45' });
    expectError(res, 409, 'room is already booked from 11:00 to 12:00');
  });

  it('400 order error beats the overlap', async () => {
    expectError(await postBooking(ctx.port, { ...BASE_BOOKING, start: '11:30', end: '09:30' }), 400, MSG.after);
    assert.deepEqual(await listAll(ctx.port), seeded);
  });

  it('touching and separate bookings are accepted', async () => {
    const cases = [
      { start: '10:00', end: '11:00' }, { start: '08:00', end: '09:00' },
      { room: 'Borealis', start: '09:00', end: '10:00' }, { date: '2026-11-04', start: '09:00', end: '10:00' },
    ];
    for (const extra of cases) {
      const body = { ...BASE_BOOKING, ...extra };
      await created(ctx, body, body);
    }
  });
});

describe('reply shape and ids', () => {
  const ctx = {};
  useServer(ctx);

  it('first id is 1, then 2; extra keys are ignored', async () => {
    const first = await postBooking(ctx.port, BASE_BOOKING);
    assert.equal(first.status, 201);
    assert.deepEqual(first.json(), { id: 1, ...BASE_BOOKING });
    const input = fresh();
    const second = await postBooking(ctx.port, { ...input, id: 999, extra: 'x' });
    assert.equal(second.status, 201);
    assert.deepEqual(second.json(), { id: 2, ...input });
  });

  it('the 201 reply equals the stored booking', async () => {
    const res = await postBooking(ctx.port, fresh({ title: ' padded ' }));
    assert.equal(res.status, 201);
    const stored = (await listAll(ctx.port)).find((item) => item.id === res.json().id);
    assert.deepEqual(stored, res.json());
    assert.equal(stored.title, 'padded');
  });
});
