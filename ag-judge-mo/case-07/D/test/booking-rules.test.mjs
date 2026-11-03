// Booking rules 1-10 of POST /api/bookings (see .team/notes/spec.md).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {
  startServer, postJson, booking, JSON_CT, makeTempDir, removeDir,
} from './helpers.mjs';

const E = {
  ct: 'content type must be application/json',
  big: 'body too large',
  obj: 'body must be a JSON object',
  room: 'room must be one of Aurora, Borealis, Cosmos',
  title: 'title must be 1 to 80 characters',
  date: 'date must be a valid YYYY-MM-DD date',
  start: 'start must be HH:MM',
  end: 'end must be HH:MM',
  after: 'end must be after start',
};
const JSON_H = { 'Content-Type': 'application/json' };

let dayCounter = 0;
// A fresh valid date per call, so accepted bookings never collide (409).
function freshDate() {
  return new Date(Date.UTC(2030, 0, 1 + dayCounter++)).toISOString().slice(0, 10);
}

function setup() {
  const ctx = {};
  before(async () => {
    ctx.dir = await makeTempDir();
    ctx.server = await startServer({ env: { DATA_FILE: path.join(ctx.dir, 'd.json') } });
    ctx.port = ctx.server.port;
  });
  after(async () => {
    await ctx.server.stop();
    await removeDir(ctx.dir);
  });
  return ctx;
}

function assertError(res, status, message) {
  assert.equal(res.status, status);
  assert.equal(res.headers['content-type'], JSON_CT);
  assert.deepEqual(res.json, { error: message });
}

function assertCreated(res, expected) {
  assert.equal(res.status, 201, res.text);
  assert.equal(res.headers['content-type'], JSON_CT);
  assert.equal(typeof res.json.id, 'number');
  assert.deepEqual(res.json, { id: res.json.id, ...expected });
}

// Table helpers: each rejected value / accepted value gets its own test.
function rejectCases(ctx, field, values, message, base = () => ({})) {
  for (const [label, value] of values) {
    it(`rejects ${field}=${label}`, async () => {
      const body = booking({ date: freshDate(), ...base(), [field]: value });
      if (value === undefined) delete body[field];
      assertError(await postJson(ctx.port, body), 400, message);
    });
  }
}

function acceptCases(ctx, field, values, extra = {}) {
  for (const [label, sent, stored] of values) {
    it(`accepts ${field}=${label}`, async () => {
      const body = booking({ date: freshDate(), ...extra, [field]: sent });
      assertCreated(await postJson(ctx.port, body), { ...body, [field]: stored });
    });
  }
}

const same = (list) => list.map((v) => [JSON.stringify(v), v, v]);
const rej = (list) => list.map((v) => [JSON.stringify(v) ?? 'missing', v]);

function rawBody(obj, bytes, fill = ' ') {
  const base = Buffer.from(JSON.stringify(obj));
  return Buffer.concat([base, Buffer.from(fill.repeat(bytes - base.length))]);
}

function chunkedPost(port, chunks) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, method: 'POST', path: '/api/bookings', agent: false,
      headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' },
    }, (res) => {
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => {
        const text = Buffer.concat(parts).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, text, json: JSON.parse(text) });
      });
    });
    req.on('error', reject);
    for (const c of chunks) req.write(c);
    req.end();
  });
}

describe('rule 1: content type', () => {
  const ctx = setup();
  const bad = [
    ['missing', {}], ['text/plain', { 'Content-Type': 'text/plain' }],
    ['application/json5', { 'Content-Type': 'application/json5' }],
    ['application/jsonx', { 'Content-Type': 'application/jsonx' }],
    ['application/json-patch+json', { 'Content-Type': 'application/json-patch+json' }],
    ['application/javascript', { 'Content-Type': 'application/javascript' }],
    ['json', { 'Content-Type': 'json' }], ['empty', { 'Content-Type': '' }],
    ['application/ json', { 'Content-Type': 'application/ json' }],
  ];
  for (const [label, headers] of bad) {
    it(`415 for ${label}`, async () => {
      assertError(await postJson(ctx.port, booking({ date: freshDate() }), headers), 415, E.ct);
    });
  }
  const good = [
    'application/json', 'Application/JSON', 'APPLICATION/JSON; charset=x',
    'Application/JSON ; charset=x', '\tapplication/json\t;x', ' application/json ',
    'application/json;',
  ];
  for (const ct of good) {
    it(`accepts ${JSON.stringify(ct)}`, async () => {
      const body = booking({ date: freshDate() });
      assertCreated(await postJson(ctx.port, body, { 'Content-Type': ct }), body);
    });
  }
  it('415 beats 413', async () => {
    const res = await postJson(ctx.port, 'x'.repeat(10001), { 'Content-Type': 'text/plain' });
    assertError(res, 415, E.ct);
  });
  it('415 beats 400', async () => {
    assertError(await postJson(ctx.port, 'not json', { 'Content-Type': 'text/plain' }), 415, E.ct);
  });
});

describe('rule 2: body size', () => {
  const ctx = setup();
  it('accepts exactly 10000 bytes (space padded)', async () => {
    const body = booking({ date: freshDate() });
    const buf = rawBody(body, 10000);
    assert.equal(buf.length, 10000);
    assertCreated(await postJson(ctx.port, buf), body);
  });
  it('accepts exactly 10000 bytes (ignored key)', async () => {
    const body = booking({ date: freshDate() });
    const empty = Buffer.byteLength(JSON.stringify({ ...body, pad: '' }));
    const text = JSON.stringify({ ...body, pad: 'a'.repeat(10000 - empty) });
    assert.equal(Buffer.byteLength(text), 10000);
    assertCreated(await postJson(ctx.port, text), body);
  });
  it('413 for 10001 bytes', async () => {
    const buf = rawBody(booking({ date: freshDate() }), 10001);
    assert.equal(buf.length, 10001);
    assertError(await postJson(ctx.port, buf), 413, E.big);
  });
  it('413 beats invalid JSON', async () => {
    assertError(await postJson(ctx.port, 'x'.repeat(10001)), 413, E.big);
  });
  it('counts bytes, not characters', async () => {
    const b = booking({ date: freshDate() });
    const baseLen = Buffer.byteLength(JSON.stringify({ ...b, pad: '' }));
    const room = 10001 - baseLen;
    const pad = (room % 2 ? 'a' : '') + 'é'.repeat(Math.floor(room / 2));
    const text = JSON.stringify({ ...b, pad });
    assert.equal(Buffer.byteLength(text), 10001);
    assert.ok(text.length < 10001);
    assertError(await postJson(ctx.port, text), 413, E.big);
  });
  it('413 for chunked 10001 bytes without content-length', async () => {
    const buf = rawBody(booking({ date: freshDate() }), 10001);
    const res = await chunkedPost(ctx.port, [buf.subarray(0, 5000), buf.subarray(5000)]);
    assertError(res, 413, E.big);
  });
});

describe('rule 3: JSON object', () => {
  const ctx = setup();
  const bad = ['', 'not json', 'null', '[]', '[{}]', '"str"', '42', 'true', '{'];
  for (const text of bad) {
    it(`400 for ${JSON.stringify(text)}`, async () => {
      assertError(await postJson(ctx.port, text), 400, E.obj);
    });
  }
  it('400 for a BOM before valid JSON', async () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(booking()))]);
    assertError(await postJson(ctx.port, buf), 400, E.obj);
  });
  it('invalid UTF-8 inside a string becomes U+FFFD', async () => {
    const date = freshDate();
    const buf = Buffer.concat([
      Buffer.from('{"room":"Aurora","title":"a'), Buffer.from([0xff]),
      Buffer.from(`b","date":"${date}","start":"09:00","end":"10:00"}`),
    ]);
    assertCreated(await postJson(ctx.port, buf), booking({ date, title: 'a�b' }));
  });
  it('400 for invalid UTF-8 between tokens', async () => {
    const buf = Buffer.concat([Buffer.from('{'), Buffer.from([0xff]), Buffer.from('"room":"Aurora"}')]);
    assertError(await postJson(ctx.port, buf), 400, E.obj);
  });
  it('{} passes rule 3 and fails rule 4', async () => {
    assertError(await postJson(ctx.port, '{}'), 400, E.room);
  });
});

describe('rule 4: room', () => {
  const ctx = setup();
  rejectCases(ctx, 'room', rej([
    undefined, 'aurora', 'AURORA', ' Aurora', 'Aurora ', 'Aurora\u0000', 'Dune', '', 1, null, ['Aurora'], {},
  ]), E.room);
  acceptCases(ctx, 'room', same(['Aurora', 'Borealis', 'Cosmos']));
  it('room error beats title error', async () => {
    const res = await postJson(ctx.port, booking({ room: 'Dune', title: '' }));
    assertError(res, 400, E.room);
  });
});

describe('rule 5: title', () => {
  const ctx = setup();
  rejectCases(ctx, 'title', rej([
    undefined, null, 5, '', '   ', '\t\n', '  ', 'x'.repeat(81), ' ' + 'x'.repeat(81),
    '😀'.repeat(41),
  ]), E.title);
  const x80 = 'x'.repeat(80);
  const nfd = 'é'.normalize('NFD').repeat(40);
  acceptCases(ctx, 'title', [
    ['80 x', x80, x80],
    ['padded 80 x', '  ' + x80 + '\n ', x80],
    ['padded Plan', '  Plan  ', 'Plan'],
    ['html', '<b>x</b>', '<b>x</b>'],
    ['40 emoji', '😀'.repeat(40), '😀'.repeat(40)],
    ['40 NFD e-acute', nfd, nfd],
    ['inner whitespace', 'a  b', 'a  b'],
    ['trailing U+FEFF', ' Plan﻿', 'Plan'],
    ['trailing U+3000', ' x　', 'x'],
  ]);
});

describe('rule 6: date', () => {
  const ctx = setup();
  const good = ['2000-01-01', '2099-12-31', '2024-02-29', '2000-02-29', '2096-02-29', '2026-04-30', '2026-12-31'];
  for (const date of good) {
    it(`accepts ${date}`, async () => {
      assertCreated(await postJson(ctx.port, booking({ date })), booking({ date }));
    });
  }
  const bad = [
    '1999-12-31', '2100-01-01', '2023-02-29', '2026-02-29', '2026-04-31', '2026-06-31',
    '2026-13-01', '2026-00-10', '2026-01-00', '2026-01-32', ' 2026-11-03', '2026-11-03 ',
    '2026-11-3', '2026-1-03', '26-11-03', '2026/11/03', '20261103', '２０２６-11-03',
    '2026-11-03T00:00', 20261103, null, undefined,
  ];
  rejectCases(ctx, 'date', rej(bad), E.date);
});

function timeTests(field, message, other) {
  describe(`rules 7/8: ${field}`, () => {
    const ctx = setup();
    const bad = [
      '24:00', '9:00', '09:0', '12:60', '23:60', ' 09:00', '09:00 ', '09-00', '0900',
      '09:00:00', '０９:00', 900, null, undefined,
    ];
    rejectCases(ctx, field, rej(bad), message, () => ({ [other.key]: other.value }));
  });
}
timeTests('start', E.start, { key: 'end', value: '10:00' });
timeTests('end', E.end, { key: 'start', value: '09:00' });

describe('rules 7/8 acceptance and ordering', () => {
  const ctx = setup();
  it('accepts 00:00-00:01', async () => {
    const b = booking({ date: freshDate(), start: '00:00', end: '00:01' });
    assertCreated(await postJson(ctx.port, b), b);
  });
  it('accepts 23:58-23:59', async () => {
    const b = booking({ date: freshDate(), start: '23:58', end: '23:59' });
    assertCreated(await postJson(ctx.port, b), b);
  });
  it('start error beats end error', async () => {
    assertError(await postJson(ctx.port, booking({ start: 'x', end: 'y' })), 400, E.start);
  });
  it('date error beats start error', async () => {
    assertError(await postJson(ctx.port, booking({ date: 'x', start: 'y' })), 400, E.date);
  });
});

describe('rule 9: end after start', () => {
  const ctx = setup();
  for (const [start, end] of [['09:00', '09:00'], ['10:00', '09:00'], ['00:00', '00:00']]) {
    it(`400 for ${start}-${end}`, async () => {
      const res = await postJson(ctx.port, booking({ date: freshDate(), start, end }));
      assertError(res, 400, E.after);
    });
  }
});

describe('rule 10: overlap', () => {
  const ctx = setup();
  const date = '2031-05-05';
  const send = (over) => postJson(ctx.port, booking({ date, ...over }));
  const conflicts = [['09:30', '10:30'], ['08:00', '09:01'], ['08:00', '11:00'], ['09:15', '09:45'], ['09:00', '10:00']];
  before(async () => {
    assertCreated(await send({}), booking({ date }));
  });
  for (const [start, end] of conflicts) {
    it(`409 for ${start}-${end}`, async () => {
      assertError(await send({ start, end }), 409, 'room is already booked from 09:00 to 10:00');
    });
  }
  it('201 touching after', async () => {
    assertCreated(await send({ start: '10:00', end: '11:00' }), booking({ date, start: '10:00', end: '11:00' }));
  });
  it('201 touching before', async () => {
    assertCreated(await send({ start: '08:00', end: '09:00' }), booking({ date, start: '08:00', end: '09:00' }));
  });
  it('201 other room', async () => {
    assertCreated(await send({ room: 'Cosmos' }), booking({ date, room: 'Cosmos' }));
  });
  it('201 other date', async () => {
    const other = booking({ date: '2031-05-06' });
    assertCreated(await postJson(ctx.port, other), other);
  });
  it('names the earliest-starting overlapping booking', async () => {
    const d = '2031-06-06';
    for (const [start, end] of [['10:00', '11:00'], ['08:00', '09:00'], ['09:00', '10:00']]) {
      const b = booking({ date: d, start, end });
      assertCreated(await postJson(ctx.port, b), b);
    }
    const res = await postJson(ctx.port, booking({ date: d, start: '07:00', end: '12:00' }));
    assertError(res, 409, 'room is already booked from 08:00 to 09:00');
  });
  it('field errors beat 409', async () => {
    assertError(await send({ title: '' }), 400, E.title);
    assertError(await send({ end: '09:00', start: '09:30' }), 400, E.after);
  });
});

describe('no trimming except title', () => {
  const ctx = setup();
  it('stores room/date/start/end exactly as sent', async () => {
    const b = booking({ date: freshDate(), title: ' x ' });
    assertCreated(await postJson(ctx.port, b, JSON_H), { ...b, title: 'x' });
  });
});
