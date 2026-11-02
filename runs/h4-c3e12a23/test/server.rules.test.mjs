// Black-box tests for the booking rules and the list endpoint of server.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boot, post, request, rawRequest, valid, JSON_TYPE, assertError, chunkedPost,
} from './helpers/server-harness.mjs';

const MISSING = Symbol('missing');
const MSG = {
  ct: 'content type must be application/json',
  big: 'body too large',
  obj: 'body must be a JSON object',
  room: 'room must be one of Aurora, Borealis, Cosmos',
  title: 'title must be 1 to 80 characters',
  date: 'date must be a valid YYYY-MM-DD date',
  start: 'start must be HH:MM',
  end: 'end must be HH:MM',
  order: 'end must be after start',
};

/** valid() with `over` applied; MISSING removes the key. */
function body(over = {}) {
  const obj = valid(over);
  for (const [k, v] of Object.entries(over)) if (v === MISSING) delete obj[k];
  return obj;
}

const CT = (value) => ({ 'content-type': value });

/** Raw POST with a Buffer header line (or none) and an exact Content-Length. */
function rawPost(port, headerLine, payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const parts = [Buffer.from('POST /api/bookings HTTP/1.1\r\nHost: x\r\n')];
  if (headerLine) parts.push(Buffer.isBuffer(headerLine) ? headerLine : Buffer.from(headerLine), Buffer.from('\r\n'));
  parts.push(Buffer.from(`Content-Length: ${data.length}\r\nConnection: close\r\n\r\n`), data);
  return rawRequest(port, Buffer.concat(parts));
}

/** Splits a Buffer into three consecutive pieces. */
function inThirds(payload) {
  const third = Math.floor(payload.length / 3);
  return [payload.subarray(0, third), payload.subarray(third, 2 * third), payload.subarray(2 * third)];
}

/** A valid booking JSON text of exactly `bytes` bytes, optionally using 2-byte chars as padding. */
function sizedBody(bytes, multibyte) {
  const base = JSON.stringify({ ...valid(), pad: '' });
  const k = multibyte ? Math.floor((bytes - base.length) / 2) : 0;
  const text = JSON.stringify({ ...valid(), pad: 'é'.repeat(k) });
  return text + ' '.repeat(bytes - Buffer.byteLength(text));
}

const hourSlot = (i) => ({ start: `${String(i).padStart(2, '0')}:00`, end: `${String(i).padStart(2, '0')}:30` });

// ---------- rule 1 ----------

test('rule 1: accepted media type spellings', async (t) => {
  const { port } = await boot(t);
  const accepted = ['Application/JSON ; charset=x', 'application/json;', 'APPLICATION/JSON'];
  for (const [i, ct] of accepted.entries()) {
    const res = await post(port, body(hourSlot(i)), CT(ct));
    assert.equal(res.status, 201, `accept ${JSON.stringify(ct)}`);
  }
  const tabbed = ['Content-Type:\tapplication/json\t;x', 'Content-Type: application/json\t;x',
    'Content-Type: application/json \t \t; charset=x'];
  for (const [i, line] of tabbed.entries()) {
    const raw = await rawPost(port, line, JSON.stringify(body(hourSlot(5 + i))));
    assert.equal(raw.status, 201, `accept tab padded raw header ${JSON.stringify(line)}`);
  }
});

test('rule 1: rejected media types', async (t) => {
  const { port } = await boot(t);
  const rejected = ['application/json-patch', 'application/jsonx', 'text/json', 'application/json, text/plain',
    ';application/json', 'application/ json', 'application /json'];
  for (const ct of rejected) {
    assertError(await post(port, body(), CT(ct)), 415, MSG.ct, `reject ${JSON.stringify(ct)}`);
  }
  assertError(await post(port, body(), {}), 415, MSG.ct, 'missing header');
  const text = JSON.stringify(body());
  assertError(await rawPost(port, 'Content-Type: ', text), 415, MSG.ct, 'empty header value');
  const nbsp = Buffer.concat([Buffer.from('Content-Type:'), Buffer.from([0xa0]), Buffer.from('application/json')]);
  assertError(await rawPost(port, nbsp, text), 415, MSG.ct, 'latin1 nbsp padding');
});

// ---------- rule 2 and rule order ----------

test('rule 2: size limits by byte count', async (t) => {
  const { port } = await boot(t);
  const big = Buffer.alloc(20000, 0x61);
  assertError(await post(port, big, CT('text/plain')), 415, MSG.ct, 'bad type beats big body');
  assertError(await post(port, Buffer.alloc(10001, 0x7b)), 413, MSG.big, '10001 bytes invalid JSON');
  assertError(await post(port, sizedBody(10001, false)), 413, MSG.big, '10001 bytes valid booking');
  const ok = await post(port, sizedBody(10000, false));
  assert.equal(ok.status, 201, '10000 byte body accepted');
});

test('rule 2: multi-byte characters count as bytes', async (t) => {
  const { port } = await boot(t);
  const over = JSON.stringify({ ...valid(), pad: 'é'.repeat(9990 - JSON.stringify({ ...valid(), pad: '' }).length) });
  assert.equal(over.length, 9990, 'test setup: character count');
  assert.ok(Buffer.byteLength(over) > 10000, 'test setup: byte count above limit');
  assertError(await post(port, over), 413, MSG.big, 'few chars, many bytes');
  const exact = sizedBody(10000, true);
  assert.equal(Buffer.byteLength(exact), 10000, 'test setup: exact bytes');
  assert.ok(exact.length < 10000, 'test setup: multi-byte chars present');
  assert.equal((await post(port, exact)).status, 201, 'exactly 10000 multi-byte bytes');
});

test('rule 2: chunked uploads', async (t) => {
  const { port } = await boot(t);
  const tooBig = Buffer.from(sizedBody(10001, false));
  assert.equal(tooBig.length, 10001, 'test setup: chunked size');
  assertError(await chunkedPost(port, inThirds(tooBig)), 413, MSG.big, 'chunked 10001');
  const okRes = await chunkedPost(port, inThirds(Buffer.from(sizedBody(10000, false))));
  assert.equal(okRes.status, 201, 'chunked 10000 accepted');
});

test('rule order: the first failing rule decides', async (t) => {
  const { port } = await boot(t);
  const cases = [
    ['room before title', { room: 'x', title: '' }, MSG.room],
    ['title before date', { title: '', date: 'x' }, MSG.title],
    ['date before start', { date: 'x', start: 'x' }, MSG.date],
    ['start before end', { start: 'x', end: 'x' }, MSG.start],
    ['end before order', { start: '10:00', end: 'x' }, MSG.end],
  ];
  for (const [label, over, message] of cases) {
    assertError(await post(port, body(over)), 400, message, label);
  }
  assertError(await post(port, '{not json, "room": "x"}'), 400, MSG.obj, 'invalid JSON beats room');
});

test('rule order: end must be after start beats 409', async (t) => {
  const { port } = await boot(t);
  assert.equal((await post(port, body())).status, 201, 'seed');
  const equal = await post(port, body({ start: '10:30', end: '10:30' }));
  assertError(equal, 400, MSG.order, 'equal times inside an existing booking');
  const reversed = await post(port, body({ start: '10:30', end: '10:00' }));
  assertError(reversed, 400, MSG.order, 'reversed times inside an existing booking');
});

// ---------- rule 3 ----------

test('rule 3: bodies that are not JSON objects', async (t) => {
  const { port } = await boot(t);
  const bad = ['', ' ', 'null', '[]', '[{}]', '"x"', '0', 'false', '{', '{"room":"Aurora"} x'];
  for (const text of bad) {
    assertError(await post(port, text), 400, MSG.obj, `body ${JSON.stringify(text)}`);
  }
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(valid()))]);
  assertError(await post(port, bom), 400, MSG.obj, 'BOM prefix');
  assertError(await post(port, '{}'), 400, MSG.room, 'empty object');
});

test('rule 3: whitespace and invalid UTF-8', async (t) => {
  const { port } = await boot(t);
  const ws = await post(port, `\n ${JSON.stringify(valid())} \n`);
  assert.equal(ws.status, 201, 'whitespace around object');
  const head = '{"room":"Aurora","title":"x';
  const tail = '","date":"2026-11-03","start":"12:00","end":"13:00"}';
  const titled = await post(port, Buffer.concat([Buffer.from(head), Buffer.from([0xff]), Buffer.from(tail)]));
  assert.equal(titled.status, 201, 'invalid byte in title status');
  assert.equal(titled.json.title, 'x\uFFFD', 'invalid byte in title becomes U+FFFD');
  const roomHead = Buffer.from('{"room":"Aurora');
  const roomTail = Buffer.from('","title":"x","date":"2026-11-03","start":"14:00","end":"15:00"}');
  const badRoom = await post(port, Buffer.concat([roomHead, Buffer.from([0xff]), roomTail]));
  assertError(badRoom, 400, MSG.room, 'invalid byte in room');
});

// ---------- rule 4 ----------

test('rule 4: room names', async (t) => {
  const { port } = await boot(t);
  const bad = ['aurora', 'AURORA', ' Aurora', 'Aurora ', 'Aurora\u0000', null, 1, ['Aurora'], MISSING, 'Nebula'];
  for (const room of bad) {
    const label = `room ${room === MISSING ? 'missing' : JSON.stringify(room)}`;
    assertError(await post(port, body({ room })), 400, MSG.room, label);
  }
  for (const room of ['Borealis', 'Cosmos']) {
    assert.equal((await post(port, body({ room }))).status, 201, `room ${room}`);
  }
  const proto = '{"__proto__":{"room":"Aurora"},"title":"t","date":"2026-11-03","start":"10:00","end":"11:00"}';
  assertError(await post(port, proto), 400, MSG.room, '__proto__ room');
});

// ---------- rule 5 ----------

test('rule 5: rejected titles', async (t) => {
  const { port } = await boot(t);
  const bad = ['', '   ', '\t\n', '\u3000\u00a0', null, 5, ['x'], MISSING, 'x'.repeat(81), ` ${'x'.repeat(81)} `,
    '😀'.repeat(41), `${'a'.repeat(79)}😀`];
  for (const [i, title] of bad.entries()) {
    const label = `title #${i} ${title === MISSING ? 'missing' : JSON.stringify(title)}`;
    assertError(await post(port, body({ title })), 400, MSG.title, label);
  }
});

test('rule 5: accepted titles are stored trimmed', async (t) => {
  const { port } = await boot(t);
  const x80 = 'x'.repeat(80);
  const cases = [
    ['😀'.repeat(40), '😀'.repeat(40)], [` \t${x80}\t `, x80], ['\u3000hi\u00A0', 'hi'], ['\uFEFFhi\u2003', 'hi'],
    [' a  b ', 'a  b'], ['  hi', 'hi'], ['hi  ', 'hi'], ['\u200B', '\u200B'], ['<b>x</b>', '<b>x</b>'],
  ];
  const expected = [];
  for (const [i, [sent, stored]] of cases.entries()) {
    const over = { title: sent, ...hourSlot(i) };
    const res = await post(port, body(over));
    assert.equal(res.status, 201, `title #${i} status`);
    assert.deepEqual(res.json, { id: i + 1, ...valid(over), title: stored }, `title #${i} body`);
    expected.push(res.json);
  }
  const list = await request(port, 'GET', '/api/bookings');
  assert.deepEqual(list.json.bookings, expected, 'GET returns trimmed titles');
});

// ---------- rule 6 ----------

test('rule 6: accepted dates', async (t) => {
  const { port } = await boot(t);
  const dates = ['2000-01-01', '2099-12-31', '2024-02-29', '2000-02-29', '2096-02-29', '2026-01-31',
    '2026-04-30', '2026-12-31', '2026-11-30'];
  for (const date of dates) {
    assert.equal((await post(port, body({ date }))).status, 201, `date ${date}`);
  }
});

test('rule 6: rejected dates', async (t) => {
  const { port } = await boot(t);
  const dates = ['1999-12-31', '2100-01-01', '2100-02-29', '2023-02-29', '2026-02-29', '2026-02-30', '2026-04-31',
    '2026-06-31', '2026-09-31', '2026-11-31', '2026-00-10', '2026-11-00', '2026-13-01', '2026-11-3', '26-11-03',
    '2026/11/03', '20261103', ' 2026-11-03', '2026-11-03 ', '2026-11-03\n', '２０２６-11-03', '٢٠٢٦-11-03',
    '+2026-11-03', '2026-11-03T00:00', 20261103, null, MISSING];
  for (const date of dates) {
    const label = `date ${date === MISSING ? 'missing' : JSON.stringify(date)}`;
    assertError(await post(port, body({ date })), 400, MSG.date, label);
  }
});

// ---------- rules 7, 8, 9 ----------

const BAD_TIMES = ['24:00', '00:60', '9:00', '09:0', '009:00', '0900', '09-00', ' 09:00', '09:00 ', '２３:００',
  '-1:00', 900, null, MISSING];
const timeLabel = (v) => (v === MISSING ? 'missing' : JSON.stringify(v));

test('rule 7: rejected start times', async (t) => {
  const { port } = await boot(t);
  for (const start of BAD_TIMES) {
    assertError(await post(port, body({ start, end: '23:59' })), 400, MSG.start, `start ${timeLabel(start)}`);
  }
});

test('rule 8: rejected end times', async (t) => {
  const { port } = await boot(t);
  for (const end of BAD_TIMES) {
    assertError(await post(port, body({ start: '00:00', end })), 400, MSG.end, `end ${timeLabel(end)}`);
  }
});

test('rules 7/8: accepted boundary times', async (t) => {
  const { port } = await boot(t);
  const cases = [
    { room: 'Aurora', date: '2026-11-03', start: '00:00', end: '00:01' },
    { room: 'Borealis', date: '2026-11-03', start: '23:58', end: '23:59' },
    { room: 'Cosmos', date: '2026-11-03', start: '00:00', end: '23:59' },
  ];
  for (const over of cases) {
    assert.equal((await post(port, body(over))).status, 201, `times ${over.start}-${over.end}`);
  }
});

test('rule 9: end must be later than start', async (t) => {
  const { port } = await boot(t);
  for (const [start, end] of [['10:00', '10:00'], ['10:00', '09:59']]) {
    assertError(await post(port, body({ start, end })), 400, MSG.order, `${start}-${end}`);
  }
});

// ---------- rule 10 ----------

const SEED = { start: '10:00', end: '11:00' };

test('rule 10: touching bookings are allowed', async (t) => {
  const { port } = await boot(t);
  assert.equal((await post(port, body(SEED))).status, 201, 'seed');
  for (const [start, end] of [['09:00', '10:00'], ['11:00', '12:00']]) {
    assert.equal((await post(port, body({ start, end }))).status, 201, `touching ${start}-${end}`);
  }
});

test('rule 10: overlaps give 409 with the existing times', async (t) => {
  const { port } = await boot(t);
  assert.equal((await post(port, body(SEED))).status, 201, 'seed');
  const clashing = [['10:59', '11:30'], ['09:00', '10:01'], ['10:15', '10:45'], ['09:00', '12:00'], ['10:00', '11:00']];
  for (const [start, end] of clashing) {
    const res = await post(port, body({ start, end }));
    assertError(res, 409, 'room is already booked from 10:00 to 11:00', `clash ${start}-${end}`);
  }
  assert.equal((await post(port, body({ ...SEED, room: 'Borealis' }))).status, 201, 'other room');
  assert.equal((await post(port, body({ ...SEED, date: '2026-11-04' }))).status, 201, 'other date');
});

test('rule 10: the earliest-starting overlap is reported', async (t) => {
  const { port } = await boot(t);
  for (const [start, end] of [['11:00', '12:00'], ['10:00', '11:00'], ['09:00', '10:00']]) {
    assert.equal((await post(port, body({ start, end }))).status, 201, `seed ${start}-${end}`);
  }
  const first = await post(port, body({ start: '09:30', end: '11:30' }));
  assertError(first, 409, 'room is already booked from 09:00 to 10:00', 'spans three, earliest is 09:00');
  const second = await post(port, body({ start: '10:30', end: '11:30' }));
  assertError(second, 409, 'room is already booked from 10:00 to 11:00', 'spans two, earliest is 10:00');
});

test('rule 10: deleting frees the slot, and a 409 keeps the id', async (t) => {
  const { port } = await boot(t);
  const first = await post(port, body(SEED));
  assert.equal(first.json.id, 1, 'first id');
  assertError(await post(port, body(SEED)), 409, 'room is already booked from 10:00 to 11:00', 'clash');
  const del = await request(port, 'DELETE', `/api/bookings/${first.json.id}`);
  assert.equal(del.status, 204, 'delete status');
  const again = await post(port, body(SEED));
  assert.equal(again.status, 201, 'slot free again');
  assert.equal(again.json.id, 2, 'rejected 409 consumed no id, delete frees none');
  assertError(await post(port, body(SEED)), 409, 'room is already booked from 10:00 to 11:00', 'clash again');
  const next = await post(port, body({ room: 'Cosmos' }));
  assert.equal(next.json.id, 3, 'id after a second 409');
});

test('201 reply has exactly the booking fields', async (t) => {
  const { port } = await boot(t);
  const one = await post(port, body());
  assert.equal(one.status, 201, 'status');
  assert.equal(one.headers['content-type'], JSON_TYPE, 'content type');
  assert.deepEqual(one.json, { id: 1, ...valid() }, 'exact body');
  assert.equal(typeof one.json.id, 'number', 'id is a number');
  const two = await post(port, body({ room: 'Borealis' }));
  assert.equal(two.json.id, 2, 'second id');
});

// ---------- listing ----------

async function seedList(port) {
  const inputs = [
    { room: 'Aurora', date: '2026-11-04', start: '09:00', end: '10:00' },
    { room: 'Borealis', date: '2026-11-03', start: '10:00', end: '11:00' },
    { room: 'Aurora', date: '2026-11-03', start: '09:00', end: '10:00' },
  ];
  const made = [];
  for (const over of inputs) made.push((await post(port, body(over))).json);
  return { b1: made[0], b2: made[1], b3: made[2] };
}

test('GET /api/bookings date query parsing', async (t) => {
  const { port } = await boot(t);
  const { b1, b2, b3 } = await seedList(port);
  const day3 = [b3, b2];
  const all = [b3, b2, b1];
  const ok = [
    ['?date=2026%2D11%2D03', day3], ['?%64ate=2026-11-03', day3], ['?x=1&date=2026-11-04', [b1]],
    ['?Date=2026-11-03', all], ['?a=1?date=bad', all], ['?date=2026-11-03&date=bad', day3],
    ['?date=2024-02-29', []], ['?date=2099-12-31', []], ['', all],
  ];
  for (const [query, expected] of ok) {
    const res = await request(port, 'GET', `/api/bookings${query}`);
    assert.equal(res.status, 200, `${query} status`);
    assert.equal(res.headers['content-type'], JSON_TYPE, `${query} content-type`);
    assert.deepEqual(res.json, { bookings: expected }, `${query} bookings`);
  }
  const bad = ['?date=bad&date=2026-11-03', '?date', '?date=', '?date&date=2026-11-03', '?date=2026-11-03+',
    '?date=+2026-11-03', '?date=2026-11-03%20', '?date=2026-02-29', '?date=2100-01-01'];
  for (const query of bad) {
    assertError(await request(port, 'GET', `/api/bookings${query}`), 400, MSG.date, query);
  }
});

test('GET /api/bookings sorts by date, start, then room', async (t) => {
  const { port } = await boot(t);
  const inputs = [
    ['2026-11-05', '09:00', '09:30', 'Aurora'], ['2026-11-03', '10:00', '10:30', 'Cosmos'],
    ['2026-11-03', '10:00', '10:30', 'Borealis'], ['2026-11-03', '10:00', '10:30', 'Aurora'],
    ['2026-11-03', '09:00', '09:30', 'Cosmos'], ['2026-11-04', '08:00', '08:30', 'Borealis'],
    ['2026-11-03', '09:30', '09:45', 'Cosmos'],
  ];
  const made = [];
  for (const [date, start, end, room] of inputs) {
    const res = await post(port, body({ date, start, end, room }));
    assert.equal(res.status, 201, `insert ${date} ${start} ${room}`);
    made.push(res.json);
  }
  const pick = (ids) => ids.map((id) => made[id - 1]);
  const all = await request(port, 'GET', '/api/bookings');
  assert.deepEqual(all.json.bookings, pick([5, 7, 4, 3, 2, 6, 1]), 'full order');
  const day = await request(port, 'GET', '/api/bookings?date=2026-11-03');
  assert.deepEqual(day.json.bookings, pick([5, 7, 4, 3, 2]), 'filtered order');
});
