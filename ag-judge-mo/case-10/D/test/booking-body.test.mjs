// POST /api/bookings rules 1-3: content type, body size, JSON object, body read before reply.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { rm } from 'node:fs/promises';
import {
  JSON_HEADERS,
  JSON_TYPE,
  MSG,
  booking,
  delay,
  expectError,
  makeTmpDir,
  openSocket,
  postBooking,
  rawRequest,
  request,
  startServer,
  uniqueDate,
} from './helpers/server.mjs';

const LIMIT = 10000;

let tmp;
let srv;

before(async () => {
  tmp = await makeTmpDir();
  srv = await startServer({ cwd: tmp });
});

after(async () => {
  await srv?.stop();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

/** A valid booking on a never-used date so accepted cases never overlap. */
const freshBooking = (overrides = {}) => booking({ date: uniqueDate(), ...overrides });

function expect201(res) {
  assert.strictEqual(res.status, 201, res.text);
  assert.strictEqual(res.headers['content-type'], JSON_TYPE);
}

/** Valid booking JSON padded with trailing spaces to exactly `bytes` bytes. */
function paddedBody(bytes) {
  const base = JSON.stringify(freshBooking());
  return base + ' '.repeat(bytes - Buffer.byteLength(base));
}

/** Parses status line and JSON body out of a raw HTTP response. */
function parseRaw(text) {
  const status = Number(/^HTTP\/1\.1 (\d+)/.exec(text)?.[1]);
  const body = text.slice(text.indexOf('\r\n\r\n') + 4);
  return { status, body: JSON.parse(body) };
}

describe('rule 1: content type 415', () => {
  const bad = [
    'text/plain',
    'application/jsonx',
    'application/json-patch+json',
    'text/json',
    'application/x-json',
    'application/ json',
    'application /json',
    'application',
    '',
    '"application/json"',
    'application/json,',
  ];
  test('no Content-Type header', async () => {
    expectError(await postBooking(srv.port, booking(), {}), 415, MSG.contentType);
  });
  for (const type of bad) {
    test(`type ${JSON.stringify(type)}`, async () => {
      const res = await postBooking(srv.port, booking(), { 'Content-Type': type });
      expectError(res, 415, MSG.contentType);
    });
  }
  test('application/json followed by NBSP byte', async () => {
    const body = Buffer.from(JSON.stringify(booking()));
    const head = Buffer.from(
      'POST /api/bookings HTTP/1.1\r\nHost: x\r\nContent-Type: application/json',
      'latin1',
    );
    const tail = Buffer.from(
      `\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
      'latin1',
    );
    const text = await rawRequest(srv.port, Buffer.concat([head, Buffer.from([0xa0]), tail, body]));
    const parsed = parseRaw(text);
    assert.strictEqual(parsed.status, 415);
    assert.deepStrictEqual(parsed.body, { error: MSG.contentType });
  });
});

describe('rule 1: accepted content types', () => {
  const good = [
    'application/json',
    'APPLICATION/JSON',
    'Application/Json',
    'application/json; charset=utf-8',
    'Application/JSON ; charset=x',
    'application/json;',
    ' application/json',
    'application/json ',
    '\tapplication/json\t',
    ' \t application/json \t ;x',
    'application/json;charset=utf-8;foo=bar',
  ];
  for (const type of good) {
    test(`type ${JSON.stringify(type)}`, async () => {
      expect201(await postBooking(srv.port, freshBooking(), { 'Content-Type': type }));
    });
  }
});

describe('rule order 1 > 2 > 3', () => {
  test('wrong type + 20000-byte body -> 415', async () => {
    const res = await postBooking(srv.port, 'x'.repeat(20000), { 'Content-Type': 'text/plain' });
    expectError(res, 415, MSG.contentType);
  });
  test('wrong type + invalid JSON -> 415', async () => {
    const res = await postBooking(srv.port, '{oops', { 'Content-Type': 'text/plain' });
    expectError(res, 415, MSG.contentType);
  });
  test('10001 bytes of x with JSON type -> 413', async () => {
    expectError(await postBooking(srv.port, 'x'.repeat(LIMIT + 1)), 413, MSG.tooLarge);
  });
});

describe('rule 2: size limit', () => {
  test('exactly 10000 bytes -> 201', async () => {
    expect201(await postBooking(srv.port, paddedBody(LIMIT)));
  });
  test('10001 bytes -> 413', async () => {
    expectError(await postBooking(srv.port, paddedBody(LIMIT + 1)), 413, MSG.tooLarge);
  });

  /** Booking JSON with an ignored "pad" key of U+00E9 characters, sized to the target byte count. */
  function multiByteBody(bytes) {
    const base = JSON.stringify({ ...freshBooking(), pad: '' });
    const count = Math.floor((bytes - Buffer.byteLength(base)) / 2);
    let text = JSON.stringify({ ...JSON.parse(base), pad: '\u{e9}'.repeat(count) });
    text += ' '.repeat(bytes - Buffer.byteLength(text));
    return text;
  }
  test('multi-byte body of 10001 bytes (string shorter than 10000) -> 413', async () => {
    const text = multiByteBody(LIMIT + 1);
    assert.strictEqual(Buffer.byteLength(text), LIMIT + 1);
    assert.ok(text.length < LIMIT);
    expectError(await postBooking(srv.port, text), 413, MSG.tooLarge);
  });
  test('multi-byte body of exactly 10000 bytes -> 201', async () => {
    const text = multiByteBody(LIMIT);
    assert.strictEqual(Buffer.byteLength(text), LIMIT);
    assert.ok(text.length < LIMIT);
    expect201(await postBooking(srv.port, text));
  });

  /** Chunked POST with no Content-Length, body split in 4 writes. */
  function chunkedPost(text) {
    const buf = Buffer.from(text);
    const third = Math.floor(buf.length / 3);
    return request(srv.port, {
      method: 'POST',
      path: '/api/bookings',
      headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' },
      chunks: [
        buf.subarray(0, third),
        buf.subarray(third, 2 * third),
        buf.subarray(2 * third, buf.length - 1),
        buf.subarray(buf.length - 1),
      ],
    });
  }
  test('chunked totalling 10001 bytes -> 413', async () => {
    expectError(await chunkedPost(paddedBody(LIMIT + 1)), 413, MSG.tooLarge);
  });
  test('chunked totalling 10000 bytes -> 201', async () => {
    expect201(await chunkedPost(paddedBody(LIMIT)));
  });
});

describe('huge bodies', () => {
  const huge = Buffer.alloc(5 * 1024 * 1024, 0x78);
  test('5 MB with JSON type -> 413', async () => {
    expectError(await postBooking(srv.port, huge), 413, MSG.tooLarge);
  });
  test('5 MB with text/plain -> 415', async () => {
    const res = await postBooking(srv.port, huge, { 'Content-Type': 'text/plain' });
    expectError(res, 415, MSG.contentType);
  });
  test('5 MB to PUT /api/bookings -> 405', async () => {
    const res = await request(srv.port, {
      method: 'PUT',
      path: '/api/bookings',
      headers: JSON_HEADERS,
      body: huge,
    });
    assert.strictEqual(res.status, 405);
  });
  test('5 MB to POST /nope -> 404', async () => {
    const res = await request(srv.port, {
      method: 'POST',
      path: '/nope',
      headers: JSON_HEADERS,
      body: huge,
    });
    assert.strictEqual(res.status, 404);
  });
});

describe('body fully read before reply', () => {
  const cases = [
    { name: '415', path: '/api/bookings', type: 'text/plain', length: 100, first: 50, status: '415 Unsupported Media Type' },
    { name: '413', path: '/api/bookings', type: 'application/json', length: 20000, first: 10500, status: '413 Payload Too Large' },
    { name: '404', path: '/nope', type: 'text/plain', length: 100, first: 50, status: '404 Not Found' },
  ];
  for (const c of cases) {
    test(`${c.name}: no reply until the whole body arrived`, async () => {
      const { socket, received } = await openSocket(srv.port);
      const ended = new Promise((resolve) => socket.on('end', resolve));
      socket.write(
        `POST ${c.path} HTTP/1.1\r\nHost: x\r\nContent-Type: ${c.type}\r\n` +
          `Content-Length: ${c.length}\r\nConnection: close\r\n\r\n` +
          'x'.repeat(c.first),
      );
      await delay(300);
      assert.strictEqual(received(), '');
      socket.write('x'.repeat(c.length - c.first));
      await ended;
      const firstLine = received().split('\r\n')[0];
      assert.strictEqual(firstLine, `HTTP/1.1 ${c.status}`);
    });
  }
});

describe('rule 3: JSON object', () => {
  const valid = () => JSON.stringify(freshBooking());
  const bad = [
    ['empty', () => ''],
    ['space', () => ' '],
    ['null', () => 'null'],
    ['array', () => '[]'],
    ['array of object', () => '[{}]'],
    ['string', () => '"x"'],
    ['number', () => '1'],
    ['true', () => 'true'],
    ['false', () => 'false'],
    ['open brace', () => '{'],
    ['trailing comma', () => '{"room":"Aurora",}'],
    ['single quotes', () => "{'room':'Aurora'}"],
    ['NaN', () => 'NaN'],
    ['BOM + valid JSON', () => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(valid())])],
    ['0xFF + valid JSON', () => Buffer.concat([Buffer.from([0xff]), Buffer.from(valid())])],
    ['UTF-16LE JSON', () => Buffer.from(valid(), 'utf16le')],
  ];
  for (const [name, make] of bad) {
    test(`${name} -> 400`, async () => {
      expectError(await postBooking(srv.port, make()), 400, MSG.notObject);
    });
  }
  test('{} is an object -> room message', async () => {
    expectError(await postBooking(srv.port, '{}'), 400, MSG.room);
  });
  test('surrounding whitespace -> 201', async () => {
    expect201(await postBooking(srv.port, `\n ${valid()} \n`));
  });
  test('invalid UTF-8 in title becomes U+FFFD', async () => {
    const b = freshBooking();
    const text = JSON.stringify({ ...b, title: 'A#B' });
    const [pre, post] = text.split('#');
    const buf = Buffer.concat([Buffer.from(pre), Buffer.from([0xff]), Buffer.from(post)]);
    const res = await postBooking(srv.port, buf);
    expect201(res);
    assert.strictEqual(res.json.title, 'A\u{FFFD}B');
  });
});
