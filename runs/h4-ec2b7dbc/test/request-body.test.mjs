// Booking rules 1-3, body sizes, encodings and full reading of request bodies.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  useServer, request, postBooking, rawRequest, uniqueDate, expectError, JSON_TYPE,
} from './helpers/server.mjs';

const CT_MSG = 'content type must be application/json';
const JSON_CT = { 'Content-Type': 'application/json' };

function fields(extra = {}) {
  return { room: 'Aurora', title: 'Standup', date: uniqueDate(), start: '09:00', end: '10:00', ...extra };
}

/** JSON text of a booking padded with trailing spaces to exactly `size` bytes. */
function paddedBody(size, extra = {}) {
  const text = JSON.stringify(fields(extra));
  const padding = size - Buffer.byteLength(text);
  assert.ok(padding >= 0, 'fixture larger than requested size');
  return text + ' '.repeat(padding);
}

/** Raw POST /api/bookings bytes with an explicit Content-Type header line (string or Buffer). */
function rawPost(contentTypeLine, body, extraHeaders = '') {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  const head = Buffer.concat([
    Buffer.from('POST /api/bookings HTTP/1.1\r\nHost: x\r\nContent-Type: ', 'latin1'),
    Buffer.isBuffer(contentTypeLine) ? contentTypeLine : Buffer.from(contentTypeLine, 'latin1'),
    Buffer.from(`\r\nContent-Length: ${payload.length}\r\n${extraHeaders}Connection: close\r\n\r\n`, 'latin1'),
  ]);
  return Buffer.concat([head, payload]);
}

function chunkedPost(body, pieces) {
  const buf = Buffer.from(body, 'utf8');
  const size = Math.ceil(buf.length / pieces);
  const parts = [Buffer.from(
    'POST /api/bookings HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n'
    + 'Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n', 'latin1')];
  for (let i = 0; i < buf.length; i += size) {
    const piece = buf.subarray(i, i + size);
    parts.push(Buffer.from(`${piece.length.toString(16)}\r\n`), piece, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from('0\r\n\r\n'));
  return Buffer.concat(parts);
}

function statusOf(raw) {
  return Number(/^HTTP\/1\.1 (\d{3})/.exec(raw)?.[1]);
}

function bodyOf(raw) {
  const text = raw.slice(raw.indexOf('\r\n\r\n') + 4);
  return JSON.parse(text.slice(text.indexOf('{')));
}

/**
 * Splits raw text holding back-to-back HTTP/1.1 responses (all with Content-Length)
 * into { statusLine, headers, body } objects. The text is latin1, so one char is one byte.
 */
function splitResponses(raw) {
  const responses = [];
  let rest = raw;
  while (rest.length > 0) {
    const headEnd = rest.indexOf('\r\n\r\n');
    assert.notEqual(headEnd, -1, 'incomplete response head');
    const [statusLine, ...headerLines] = rest.slice(0, headEnd).split('\r\n');
    const headers = Object.fromEntries(headerLines.map((line) => {
      const colon = line.indexOf(':');
      return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
    }));
    assert.match(headers['content-length'] ?? '', /^\d+$/, 'missing Content-Length');
    const length = Number(headers['content-length']);
    const body = rest.slice(headEnd + 4, headEnd + 4 + length);
    assert.equal(body.length, length, 'truncated response body');
    responses.push({ statusLine, headers, body });
    rest = rest.slice(headEnd + 4 + length);
  }
  return responses;
}

describe('rule 1: content type', () => {
  const ctx = useServer({ before, after });
  const rejected = [
    ['text/plain', 'text/plain'], ['application/jsonx', 'application/jsonx'],
    ['application/json-patch+json', 'application/json-patch+json'],
    ['space inside', 'application/ json'], ['comma list', 'application/json,text/plain'],
    ['json', 'json'], ['empty', ''],
  ];
  test('missing Content-Type header', async () => {
    await expectError(await postBooking(ctx.port, fields(), {}), 415, CT_MSG);
  });
  for (const [name, value] of rejected) {
    test(`rejected: ${name}`, async () => {
      await expectError(await postBooking(ctx.port, fields(), { 'Content-Type': value }), 415, CT_MSG);
    });
  }
  const accepted = [
    'application/json', 'Application/JSON', 'APPLICATION/JSON; charset=utf-8',
    'application/json;charset=latin1', 'application/json ; x=y',
  ];
  for (const value of accepted) {
    test(`accepted: ${value}`, async () => {
      const f = fields();
      const res = await postBooking(ctx.port, f, { 'Content-Type': value });
      assert.equal(res.status, 201);
      assert.deepEqual(res.json(), { id: res.json().id, ...f });
    });
  }
  test('accepted: TAB before ; (raw)', async () => {
    const raw = await rawRequest(ctx.port, rawPost('application/json\t; charset=utf-8', JSON.stringify(fields())));
    assert.equal(statusOf(raw), 201);
  });
  test('accepted: leading TAB and spaces (raw)', async () => {
    const raw = await rawRequest(ctx.port, rawPost(' \tapplication/json \t', JSON.stringify(fields())));
    assert.equal(statusOf(raw), 201);
  });
  test('rejected: trailing byte 0xA0 (NBSP) (raw)', async () => {
    const line = Buffer.concat([Buffer.from('application/json'), Buffer.from([0xa0])]);
    const raw = await rawRequest(ctx.port, rawPost(line, JSON.stringify(fields())));
    assert.equal(statusOf(raw), 415);
    assert.deepEqual(bodyOf(raw), { error: CT_MSG });
  });
});

describe('rules 1-3 order', () => {
  const ctx = useServer({ before, after });
  const tooLarge = { error: 'body too large' };
  test('wrong type + 20000-byte body -> 415', async () => {
    const res = await postBooking(ctx.port, 'x'.repeat(20000), { 'Content-Type': 'text/plain' });
    await expectError(res, 415, CT_MSG);
  });
  test('wrong type + invalid JSON -> 415', async () => {
    await expectError(await postBooking(ctx.port, '{', { 'Content-Type': 'text/plain' }), 415, CT_MSG);
  });
  test('right type + 10001-byte invalid JSON -> 413', async () => {
    const res = await postBooking(ctx.port, ' '.repeat(10001), JSON_CT);
    assert.equal(res.status, 413);
    assert.deepEqual(res.json(), tooLarge);
  });
  test('right type + 10001-byte valid booking -> 413', async () => {
    const res = await postBooking(ctx.port, paddedBody(10001), JSON_CT);
    assert.equal(res.status, 413);
    assert.deepEqual(res.json(), tooLarge);
  });
  test('right type + 10001-byte non-object -> 413 (size before parse)', async () => {
    const res = await postBooking(ctx.port, `[${' '.repeat(9999)}]`, JSON_CT);
    assert.equal(res.status, 413);
    assert.deepEqual(res.json(), tooLarge);
  });
});

describe('size boundary', () => {
  const ctx = useServer({ before, after });
  const tooLarge = { error: 'body too large' };
  test('exactly 10000 bytes -> 201', async () => {
    const res = await postBooking(ctx.port, paddedBody(10000));
    assert.equal(res.status, 201);
  });
  test('exactly 10001 bytes -> 413', async () => {
    const res = await postBooking(ctx.port, paddedBody(10001));
    assert.equal(res.status, 413);
    assert.deepEqual(res.json(), tooLarge);
  });
  test('bytes not characters: 5000 e-acute (>10000 bytes, <10000 chars) -> 413', async () => {
    const text = JSON.stringify(fields({ note: 'é'.repeat(5000) }));
    assert.ok(Buffer.byteLength(text) > 10000 && text.length < 10000);
    const res = await postBooking(ctx.port, text);
    assert.equal(res.status, 413);
    assert.deepEqual(res.json(), tooLarge);
  });
  test('bytes not characters: 4900 e-acute within 10000 bytes -> 201', async () => {
    const text = JSON.stringify(fields({ note: 'é'.repeat(4900) }));
    assert.ok(Buffer.byteLength(text) <= 10000);
    const res = await postBooking(ctx.port, text);
    assert.equal(res.status, 201);
  });
  test('chunked body of 10000 bytes -> 201', async () => {
    const raw = await rawRequest(ctx.port, chunkedPost(paddedBody(10000), 7));
    assert.equal(statusOf(raw), 201);
  });
  test('chunked body of 10001 bytes -> 413', async () => {
    const raw = await rawRequest(ctx.port, chunkedPost(paddedBody(10001), 7));
    assert.equal(statusOf(raw), 413);
    assert.deepEqual(bodyOf(raw), tooLarge);
  });
});

describe('rule 3: body must be a JSON object', () => {
  const ctx = useServer({ before, after });
  const notObject = { error: 'body must be a JSON object' };
  const bad = [
    ['empty', ''], ['single space', ' '], ['nul', 'nul'], ['null', 'null'], ['empty array', '[]'],
    ['array of object', '[{}]'], ['string', '"s"'], ['number', '1'], ['true', 'true'], ['open brace', '{'],
    ['trailing comma', '{"room":"Aurora",}'],
    ['UTF-8 BOM prefix', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(fields()))])],
  ];
  for (const [name, body] of bad) {
    test(`rejected: ${name}`, async () => {
      const res = await postBooking(ctx.port, body);
      assert.equal(res.status, 400);
      assert.deepEqual(res.json(), notObject);
    });
  }
  test('invalid UTF-8 byte 0xFF becomes U+FFFD and is not an error', async () => {
    const f = fields({ title: 'A_B' });
    const [textBeforeByte, textAfterByte] = JSON.stringify(f).split('_');
    const body = Buffer.concat([Buffer.from(textBeforeByte), Buffer.from([0xff]), Buffer.from(textAfterByte)]);
    const res = await postBooking(ctx.port, body);
    assert.equal(res.status, 201);
    assert.equal(res.json().title, 'A\u{FFFD}B');
  });
  test('UTF-8 title is stored exactly', async () => {
    const f = fields({ title: 'Café ☕' });
    const res = await postBooking(ctx.port, Buffer.from(JSON.stringify(f), 'utf8'));
    assert.equal(res.status, 201);
    assert.deepEqual(res.json(), { id: res.json().id, ...f });
  });
});

describe('whole body is read before replying', () => {
  const ctx = useServer({ before, after });
  const getRooms ='GET /api/rooms HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n';
  function pipelined(head, size) {
    const first = Buffer.concat([
      Buffer.from(`${head}Host: x\r\nContent-Length: ${size}\r\n\r\n`, 'latin1'), Buffer.alloc(size, 0x20),
    ]);
    return Buffer.concat([first, Buffer.from(getRooms, 'latin1')]);
  }
  const cases = [
    ['POST wrong type, 50000 bytes -> 415', 'POST /api/bookings HTTP/1.1\r\nContent-Type: text/plain\r\n', 50000, 415, CT_MSG],
    ['POST JSON type, 50000 bytes -> 413', 'POST /api/bookings HTTP/1.1\r\nContent-Type: application/json\r\n', 50000, 413, 'body too large'],
    ['GET /nope with 30000 bytes -> 404', 'GET /nope HTTP/1.1\r\n', 30000, 404, 'not found'],
    ['POST /api/rooms with 30000 bytes -> 405', 'POST /api/rooms HTTP/1.1\r\n', 30000, 405, 'method not allowed'],
  ];
  for (const [name, head, size, status, message] of cases) {
    test(`pipelined: ${name}, then 200 rooms`, async () => {
      const responses = splitResponses(await rawRequest(ctx.port, pipelined(head, size)));
      assert.equal(responses.length, 2);
      const [first, second] = responses;
      assert.match(first.statusLine, new RegExp(`^HTTP/1\\.1 ${status}( |$)`));
      assert.equal(first.headers['content-type'], JSON_TYPE);
      assert.deepEqual(JSON.parse(first.body), { error: message });
      assert.match(second.statusLine, /^HTTP\/1\.1 200( |$)/);
      assert.deepEqual(JSON.parse(second.body), { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
    });
  }
  test('2 MB body with wrong type gets 415 and the full error body', async () => {
    const res = await request(ctx.port, {
      method: 'POST', path: '/api/bookings', headers: { 'Content-Type': 'text/plain' },
      body: Buffer.alloc(2 * 1024 * 1024, 0x61),
    });
    await expectError(res, 415, CT_MSG);
  });
  test('2 MB JSON body gets 413 and the full error body', async () => {
    const res = await request(ctx.port, {
      method: 'POST', path: '/api/bookings', headers: JSON_CT, body: Buffer.alloc(2 * 1024 * 1024, 0x20),
    });
    await expectError(res, 413, 'body too large');
  });
  test('server is still alive', async () => {
    const res = await request(ctx.port, { path: '/api/rooms' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
  });
});
