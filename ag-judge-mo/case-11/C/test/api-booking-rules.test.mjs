// Booking rules 1-5 (content type, size, JSON object, room, title) + rule order + ids.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { postBooking } from './helpers/server-harness.mjs';
import {
  MSG, assertJsonError, assertCreated, listBookings, freshBooking, label, useServer,
} from './helpers/api-assert.mjs';

/** Bytes of `value` as JSON padded with spaces inside the object to exactly `size` bytes. */
function paddedBody(value, size) {
  const json = JSON.stringify(value);
  const padding = size - Buffer.byteLength(json);
  assert.ok(padding >= 0);
  const text = '{' + ' '.repeat(padding) + json.slice(1);
  assert.equal(Buffer.byteLength(text), size);
  return Buffer.from(text);
}

/** Body with an ignored "pad" key of U+00E9 (2 bytes each) plus spaces, exactly `size` bytes. */
function accentBody(value, size) {
  const baseBytes = Buffer.byteLength(JSON.stringify({ ...value, pad: '' }));
  const count = Math.floor((size - baseBytes) / 2);
  const text = JSON.stringify({ ...value, pad: '\u{e9}'.repeat(count) });
  const full = ' '.repeat(size - Buffer.byteLength(text)) + text;
  assert.equal(Buffer.byteLength(full), size);
  return { buffer: Buffer.from(full), text: full };
}

function chunked(buffer, chunkSize = 1000) {
  const chunks = [];
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    chunks.push(buffer.subarray(offset, offset + chunkSize));
  }
  return chunks;
}

describe('rule order ladder', () => {
  const ctx = useServer();
  const validFields = { room: 'Aurora', title: 'ok', date: '2030-12-01', start: '09:00', end: '10:00' };
  const invalid = 'x';
  const rawCases = [
    ['no content type, 20000 bytes', undefined, Buffer.alloc(20000, 'x'), 415, MSG.type],
    ['text/plain, 20000 bytes', 'text/plain', Buffer.alloc(20000, 'x'), 415, MSG.type],
    ['json, 10001 bytes invalid', 'application/json', Buffer.alloc(10001, 'x'), 413, MSG.size],
    ['json, "[1"', 'application/json', '[1', 400, MSG.object],
  ];
  for (const [name, contentType, body, status, message] of rawCases) {
    it(name, async () => {
      const res = await postBooking(ctx.port, body, { contentType, raw: true });
      assertJsonError(res, status, message);
    });
  }

  const fieldCases = [
    ['room first', { room: invalid, title: '', date: invalid, start: invalid, end: invalid }, MSG.room],
    ['title next', { ...validFields, title: '', date: invalid, start: invalid, end: invalid }, MSG.title],
    ['date next', { ...validFields, date: invalid, start: invalid, end: invalid }, MSG.date],
    ['start next', { ...validFields, start: invalid, end: invalid }, MSG.start],
    ['end next', { ...validFields, end: invalid }, MSG.end],
  ];
  for (const [name, body, message] of fieldCases) {
    it(name, async () => assertJsonError(await postBooking(ctx.port, body), 400, message));
  }

  it('end before start beats an overlap (400, not 409)', async () => {
    assertCreated(await postBooking(ctx.port, validFields), validFields);
    const res = await postBooking(ctx.port, { ...validFields, start: '10:00', end: '09:00' });
    assertJsonError(res, 400, MSG.order);
  });
});

describe('rule 1 content type', () => {
  const ctx = useServer();
  const rejected = [
    undefined, '', 'text/plain', 'application/jsonx', 'application/json-patch+json',
    'application/x-json', 'json', 'application/json, text/plain', 'application/ json', 'text/json',
  ];
  for (const contentType of rejected) {
    it(`rejects ${label(contentType)}`, async () => {
      const res = await postBooking(ctx.port, freshBooking(), { contentType });
      assertJsonError(res, 415, MSG.type);
    });
  }
  const accepted = [
    'application/json', 'Application/JSON ; charset=x', 'APPLICATION/JSON',
    'application/json;charset=utf-8', 'application/json;', 'application/json\t;x',
    ' application/json', '\tapplication/json\t',
  ];
  for (const contentType of accepted) {
    it(`accepts ${label(contentType)}`, async () => {
      const value = freshBooking();
      assertCreated(await postBooking(ctx.port, value, { contentType }), value);
    });
  }
});

describe('rule 2 body size', () => {
  const ctx = useServer();
  const post = (body) => postBooking(ctx.port, body, { raw: true });
  function check(res, status, value) {
    if (status === 201) assertCreated(res, value);
    else assertJsonError(res, 413, MSG.size);
  }
  const sized = [[10000, 201], [10001, 413]];
  for (const [size, status] of sized) {
    it(`space padded body of ${size} bytes`, async () => {
      const value = freshBooking();
      const body = paddedBody(value, size);
      assert.equal(body.length, size);
      check(await post(body), status, value);
    });
    it(`multi-byte padded body of ${size} bytes`, async () => {
      const value = freshBooking();
      const { buffer, text } = accentBody(value, size);
      assert.equal(Buffer.byteLength(text), size);
      assert.ok(text.length < 10000);
      check(await post(buffer), status, value);
    });
    it(`chunked body of ${size} bytes`, async () => {
      const value = freshBooking();
      const chunks = chunked(paddedBody(value, size));
      assert.equal(chunks.reduce((total, chunk) => total + chunk.length, 0), size);
      check(await post(chunks), status, value);
    });
  }
});

describe('rule 3 body must be a JSON object', () => {
  const ctx = useServer();
  const notObjects = ['', ' ', 'not json', 'null', '[]', '[{}]', '"str"', '1', 'true', 'false', '{', '{"room":"Aurora",}'];
  for (const text of notObjects) {
    it(`rejects ${label(text)}`, async () => {
      assertJsonError(await postBooking(ctx.port, text, { raw: true }), 400, MSG.object);
    });
  }

  it('rejects a body with a byte order mark', async () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const body = Buffer.concat([bom, Buffer.from(JSON.stringify(freshBooking()))]);
    assertJsonError(await postBooking(ctx.port, body, { raw: true }), 400, MSG.object);
  });

  it('turns invalid UTF-8 inside a string into U+FFFD', async () => {
    const value = freshBooking();
    const head = JSON.stringify({ ...value, title: 'A_B' }).split('A_B');
    const body = Buffer.concat([Buffer.from(head[0] + 'A'), Buffer.from([0xff]), Buffer.from('B' + head[1])]);
    assertCreated(await postBooking(ctx.port, body, { raw: true }), { ...value, title: 'A\u{fffd}B' });
  });

  it('accepts surrounding whitespace and newlines', async () => {
    const value = freshBooking();
    const body = ' \n\t\r\n' + JSON.stringify(value) + '\n \r\n';
    assertCreated(await postBooking(ctx.port, body, { raw: true }), value);
  });

  it('ignores extra keys and assigns its own id', async () => {
    const value = freshBooking();
    const res = await postBooking(ctx.port, { ...value, id: 99, extra: 'x', nextId: 5 });
    const created = assertCreated(res, value);
    assert.notEqual(created.id, 99);
  });
});

describe('rule 4 room', () => {
  const ctx = useServer();
  const rejected = ['aurora', 'AURORA', ' Aurora', 'Aurora ', 'Dune', '', undefined, null, 1, ['Aurora'], {}];
  for (const room of rejected) {
    it(`rejects ${label(room)}`, async () => {
      assertJsonError(await postBooking(ctx.port, freshBooking({ room })), 400, MSG.room);
    });
  }
  for (const room of ['Aurora', 'Borealis', 'Cosmos']) {
    it(`accepts ${room}`, async () => {
      const value = freshBooking({ room });
      assertCreated(await postBooking(ctx.port, value), value);
    });
  }
});

describe('rule 5 title', () => {
  const ctx = useServer();
  const emoji = '\u{1F600}';
  const rejected = [
    undefined, null, 5, true, [], '', ' ', '   \t\n ', '\u{a0}', '\u{3000}\u{feff}',
    'a'.repeat(81), emoji.repeat(40) + 'a',
  ];
  for (const title of rejected) {
    it(`rejects ${label(title).slice(0, 30)}`, async () => {
      assertJsonError(await postBooking(ctx.port, freshBooking({ title })), 400, MSG.title);
    });
  }

  const accepted = [
    ['a'.repeat(80), 'a'.repeat(80)],
    ['  ' + 'a'.repeat(80) + '\t\n', 'a'.repeat(80)],
    ['\u{a0}x\u{a0}', 'x'],
    ['\u{2028}x\u{2029}', 'x'],
    [' x ', 'x'],
    ['\tx\n', 'x'],
    [emoji.repeat(40), emoji.repeat(40)],
    ['\u{200b}', '\u{200b}'],
    ['<b>x</b>', '<b>x</b>'],
    ['a  b', 'a  b'],
  ];
  for (const [title, stored] of accepted) {
    it(`accepts ${label(title).slice(0, 30)}`, async () => {
      const value = freshBooking({ title });
      const created = assertCreated(await postBooking(ctx.port, value), { ...value, title: stored });
      assert.deepEqual(await listBookings(ctx.port, `?date=${value.date}`), [created]);
    });
  }
});

describe('failed POSTs do not consume ids', () => {
  const ctx = useServer();
  it('next valid booking gets last id + 1', async () => {
    const first = freshBooking();
    const last = assertCreated(await postBooking(ctx.port, first), first);
    const failing = [
      () => postBooking(ctx.port, freshBooking(), { contentType: 'text/plain' }),
      () => postBooking(ctx.port, Buffer.alloc(10001, ' '), { raw: true }),
      () => postBooking(ctx.port, '[1', { raw: true }),
      () => postBooking(ctx.port, freshBooking({ room: 'x' })),
      () => postBooking(ctx.port, first),
    ];
    const statuses = [];
    for (const send of failing) statuses.push((await send()).status);
    assert.deepEqual(statuses, [415, 413, 400, 400, 409]);
    const next = freshBooking();
    const created = assertCreated(await postBooking(ctx.port, next), next);
    assert.equal(created.id, last.id + 1);
  });
});
