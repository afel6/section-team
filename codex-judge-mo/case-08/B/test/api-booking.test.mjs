// POST /api/bookings: the 201 reply and booking rules 1 to 3 (content type, size, JSON object).
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  setup, freshBooking, assertError, assertCreated, postRaw, paddedBody, request, postBooking,
  CT_JSON, BOOKING_KEYS, JSON_CT,
} from './helpers/booking-utils.mjs';
import { rawRequest } from './helpers/server.mjs';

const CT_MSG = 'content type must be application/json';
const BIG_MSG = 'body too large';
const OBJ_MSG = 'body must be a JSON object';

let env;
before(async () => { env = await setup(); });
after(async () => { await env.close(); });

// Values Node's http client refuses are written by hand over a raw socket.
// NBSP is sent as latin1 byte A0, the BOM as UTF-8 bytes EF BB BF.
const rawRejected = [
  ['leading NBSP', Buffer.from('\u{A0}application/json', 'latin1')],
  ['trailing NBSP', Buffer.from('application/json\u{A0}', 'latin1')],
  ['leading BOM', Buffer.from('\u{FEFF}application/json', 'utf8')],
];

function rawPost(value) {
  const payload = Buffer.from(JSON.stringify(freshBooking()), 'utf8');
  const head = Buffer.concat([
    Buffer.from('POST /api/bookings HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: ', 'latin1'),
    value,
    Buffer.from(`\r\nContent-Length: ${payload.length}\r\nConnection: close\r\n\r\n`, 'latin1'),
  ]);
  return rawRequest(env.port, Buffer.concat([head, payload]));
}

describe('201 reply', () => {
  test('first booking has id 1 and exactly the six keys, second has id 2', async () => {
    const sent = freshBooking();
    const res = await postBooking(env.port, sent);
    assert.equal(res.status, 201);
    assert.equal(res.headers['content-type'], JSON_CT);
    assert.deepEqual(res.json, { id: 1, ...sent });
    assert.deepEqual(Object.keys(res.json).sort(), BOOKING_KEYS);
    assert.equal(typeof res.json.id, 'number');
    const second = await postBooking(env.port, freshBooking());
    assert.equal(second.status, 201);
    assert.equal(second.json.id, 2);
  });

  test('extra keys in the body are ignored, id comes from the server', async () => {
    const sent = freshBooking();
    const res = await postBooking(env.port, { ...sent, id: 99, extra: 'x' });
    const id = assertCreated(res, sent);
    assert.notEqual(id, 99);
  });

  test('a __proto__ key in the raw body is ignored', async () => {
    const sent = freshBooking();
    const raw = `{"__proto__":{"a":1},${JSON.stringify(sent).slice(1)}`;
    const res = await postRaw(env.port, raw);
    assertCreated(res, sent);
    assert.equal(res.json.a, undefined);
  });
});

describe('rule 1: content type', () => {
  const rejected = [
    ['text/plain', 'text/plain'],
    ['application/jsonx', 'application/jsonx'],
    ['application/json-patch+json', 'application/json-patch+json'],
    ['application/x-json', 'application/x-json'],
    ['json', 'json'],
    ['empty value', ''],
    ['space inside', 'application/ json'],
  ];
  for (const [name, value] of rejected) {
    test(`rejects content type ${name}`, async () => {
      const res = await postRaw(env.port, JSON.stringify(freshBooking()), { 'Content-Type': value });
      assertError(res, 415, CT_MSG);
    });
  }

  test('rejects a missing content type header', async () => {
    const res = await postRaw(env.port, JSON.stringify(freshBooking()), {});
    assertError(res, 415, CT_MSG);
  });

  const accepted = [
    'application/json',
    'APPLICATION/JSON',
    'Application/Json; charset=utf-8',
    ' \tapplication/json\t ; x=y',
    'application/json;',
    'application/json;charset=latin1',
  ];
  for (const value of accepted) {
    test(`accepts content type ${JSON.stringify(value)}`, async () => {
      const sent = freshBooking();
      const res = await postRaw(env.port, JSON.stringify(sent), { 'Content-Type': value });
      assertCreated(res, sent);
    });
  }

  test('invalid content type with a 20000 byte body is 415, not 413', async () => {
    const res = await postRaw(env.port, paddedBody(freshBooking(), 20000), { 'Content-Type': 'text/plain' });
    assertError(res, 415, CT_MSG);
  });

  test('invalid content type with invalid JSON is 415', async () => {
    const res = await postRaw(env.port, 'not json', { 'Content-Type': 'text/plain' });
    assertError(res, 415, CT_MSG);
  });

  for (const [name, value] of rawRejected) {
    test(`rejects content type with ${name} over a raw socket`, async () => {
      const res = await rawPost(value);
      assert.equal(res.status, 415);
      assert.deepEqual(JSON.parse(res.body), { error: CT_MSG });
      assert.equal(res.headers['content-type'], JSON_CT);
    });
  }

  // Node's HTTP parser refuses VT and FF in a header value itself: 400 before the handler runs.
  for (const [name, value] of [['VT', '\v'], ['FF', '\f']]) {
    test(`leading ${name} in the content type is refused by the HTTP parser with 400`, async () => {
      const res = await rawPost(Buffer.from(`${value}application/json`, 'latin1'));
      assert.equal(res.status, 400);
    });
  }
});

describe('rule 2: body size', () => {
  test('exactly 10000 bytes is accepted', async () => {
    const sent = freshBooking();
    const body = paddedBody(sent, 10000);
    assert.equal(Buffer.byteLength(body), 10000);
    assertCreated(await postRaw(env.port, body), sent);
  });

  test('exactly 10001 bytes is 413', async () => {
    const body = paddedBody(freshBooking(), 10001);
    assert.equal(Buffer.byteLength(body), 10001);
    assertError(await postRaw(env.port, body), 413, BIG_MSG);
  });

  test('10001 bytes of invalid JSON is 413, not 400', async () => {
    const body = '{'.padEnd(10001, 'x');
    assertError(await postRaw(env.port, body), 413, BIG_MSG);
  });

  test('a 20000 byte body is 413', async () => {
    assertError(await postRaw(env.port, paddedBody(freshBooking(), 20000)), 413, BIG_MSG);
  });

  function multiByteBody(totalBytes) {
    const base = JSON.stringify({ ...freshBooking(), x: '' });
    const rest = totalBytes - Buffer.byteLength(base);
    const body = JSON.stringify({ ...JSON.parse(base), x: 'é'.repeat(Math.floor(rest / 2)) });
    return body + ' '.repeat(totalBytes - Buffer.byteLength(body));
  }

  test('10001 UTF-8 bytes but fewer than 10000 characters is 413', async () => {
    const body = multiByteBody(10001);
    assert.equal(Buffer.byteLength(body), 10001);
    assert.ok(body.length < 10000);
    assertError(await postRaw(env.port, body), 413, BIG_MSG);
  });

  test('10000 UTF-8 bytes of multi-byte text is accepted', async () => {
    const body = multiByteBody(10000);
    assert.equal(Buffer.byteLength(body), 10000);
    assert.equal(JSON.parse(body).x.length > 0, true);
    assert.equal((await postRaw(env.port, body)).status, 201);
  });
});

describe('rule 3: JSON object', () => {
  const bad = [
    ['empty body', ''],
    ['not json', 'not json'],
    ['null', 'null'],
    ['empty array', '[]'],
    ['array of objects', '[{}]'],
    ['string', '"str"'],
    ['number', '42'],
    ['true', 'true'],
    ['false', 'false'],
    ['unterminated object', '{'],
  ];
  for (const [name, body] of bad) {
    test(`rejects ${name}`, async () => {
      assertError(await postRaw(env.port, body), 400, OBJ_MSG);
    });
  }

  test('rejects a UTF-8 byte order mark before a valid object', async () => {
    const body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(freshBooking()))]);
    assertError(await postRaw(env.port, body), 400, OBJ_MSG);
  });

  test('invalid UTF-8 byte becomes U+FFFD and is not an error', async () => {
    const sent = freshBooking({ title: 'A#B' });
    const json = JSON.stringify(sent);
    const [head, tail] = json.split('#');
    const body = Buffer.concat([Buffer.from(head), Buffer.from([0xff]), Buffer.from(tail)]);
    assertCreated(await postRaw(env.port, body), sent, { title: 'A�B' });
  });

  test('whitespace around a valid object is accepted', async () => {
    const sent = freshBooking();
    assertCreated(await postRaw(env.port, ` \t\r\n${JSON.stringify(sent)}\n \t`), sent);
  });
});

describe('failed POSTs leave the store unchanged', () => {
  let fresh;
  before(async () => { fresh = await setup(); });
  after(async () => { await fresh.close(); });

  test('only the created bookings exist and ids are consecutive', async () => {
    const a = freshBooking({ date: '2031-05-01', start: '09:00', end: '10:00' });
    const b = freshBooking({ date: '2031-05-01', start: '11:00', end: '12:00' });
    assert.equal((await postBooking(fresh.port, a)).json.id, 1);
    assertError(await postBooking(fresh.port, { ...a, room: 'x' }), 400, 'room must be one of Aurora, Borealis, Cosmos');
    assertError(await postRaw(fresh.port, 'null'), 400, OBJ_MSG);
    assertError(await postRaw(fresh.port, '{}', {}), 415, CT_MSG);
    assertError(await postRaw(fresh.port, paddedBody(a, 10001)), 413, BIG_MSG);
    assertError(await postBooking(fresh.port, { ...a, start: '09:30' }), 409, 'room is already booked from 09:00 to 10:00');
    assert.equal((await postBooking(fresh.port, b)).json.id, 2);
    const list = await request(fresh.port, { target: '/api/bookings' });
    assert.equal(list.status, 200);
    assert.deepEqual(list.json, { bookings: [{ id: 1, ...a }, { id: 2, ...b }] });
  });
});
