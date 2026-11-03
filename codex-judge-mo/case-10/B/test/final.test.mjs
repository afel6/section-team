// Final verification tests (testing section): spec edge cases the builder suites do not cover.
import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {
  JSON_TYPE, cleanupAll, parseRaw, post, rawGet, rawRequest, request, runToExit, startServer, tmpDir,
} from './helpers.mjs';

afterEach(cleanupAll);

const VALID = Object.freeze({ room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00' });
const book = (over = {}) => ({ ...VALID, ...over });
const DATE_MSG = 'date must be a valid YYYY-MM-DD date';
const NOT_FOUND = { error: 'not found' };
const METHOD = { error: 'method not allowed' };
const BIG = 2_000_000;

function expectError(res, status, message, label = '') {
  assert.equal(res.status, status, `${label} status (body ${res.text})`);
  assert.equal(res.headers['content-type'], JSON_TYPE, `${label} content-type`);
  assert.deepEqual(res.json, { error: message }, label);
}

async function boot(seed) {
  const dir = tmpDir();
  const file = path.join(dir, 'b.json');
  if (seed !== undefined) fs.writeFileSync(file, seed);
  return { ...(await startServer({ env: { DATA_FILE: file } })), file };
}

const ids = async (port, query = '') => (await request(port, { path: `/api/bookings${query}` })).json.bookings.map((b) => b.id);

/** Raw HTTP/1.1 request with an optional body; returns the parsed reply. */
async function raw(port, method, target, { body, headers = '' } = {}) {
  const buf = body === undefined ? Buffer.alloc(0) : Buffer.from(body);
  const length = body === undefined ? '' : `Content-Length: ${buf.length}\r\n`;
  const head = `${method} ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n${headers}${length}\r\n`;
  return parseRaw(await rawRequest(port, Buffer.concat([Buffer.from(head), buf])));
}

describe('final: startup', () => {
  for (const value of ['1\n2', '\n', '80\r', 'a\r\nb', '\u0663']) {
    test(`PORT=${JSON.stringify(value)} exits 1 with exactly one stderr line`, async () => {
      const r = await runToExit({ env: { PORT: value } });
      assert.equal(r.code, 1);
      assert.equal(r.stdout, '');
      assert.match(r.stderr, /^[^\r\n]+\n$/);
    });
  }

  test('a folder on the path that is a file (ENOTDIR) is a read failure, not "no bookings"', async () => {
    const dir = tmpDir();
    const file = path.join(dir, 'plain');
    fs.writeFileSync(file, 'x');
    const name = path.join(file, 'b.json');
    const r = await runToExit({ env: { DATA_FILE: name } });
    assert.deepEqual(r, { code: 1, stdout: '', stderr: `cannot read data file ${name}\n` });
  });

  test('an absolute DATA_FILE is reported exactly as given', async () => {
    const dir = tmpDir();
    const name = path.join(dir, 'd.json');
    fs.writeFileSync(name, '{}');
    const r = await runToExit({ env: { DATA_FILE: name } });
    assert.deepEqual(r, { code: 1, stdout: '', stderr: `cannot read data file ${name}\n` });
  });

  test('startup reads but never rewrites a valid file it did not write itself', async () => {
    const text = `{\n  "nextId": 3,\n  "bookings": [${JSON.stringify({ id: 2, ...VALID })}]\n}\n`;
    const s = await boot(text);
    const before = fs.statSync(s.file).mtimeMs;
    assert.deepEqual(await ids(s.port), [2]);
    await request(s.port, { path: '/api/rooms' });
    assert.equal(fs.readFileSync(s.file, 'utf8'), text);
    assert.equal(fs.statSync(s.file).mtimeMs, before);
    assert.equal((await post(s.port, book({ date: '2026-11-04' }))).json.id, 3);
  });

  test('PORT=0 prints the bound port and nothing else', async () => {
    const s = await startServer();
    assert.equal(s.stdout(), `listening on http://127.0.0.1:${s.port}\n`);
    const probe = net.connect(s.port, '127.0.0.1');
    await new Promise((resolve, reject) => { probe.once('connect', resolve); probe.once('error', reject); });
    probe.destroy();
  });
});

describe('final: concurrency over raw sockets', () => {
  test('30 overlapping bookings written at once: exactly one 201, 29 × 409, one id', async () => {
    const s = await boot();
    const pad = (n) => String(n).padStart(2, '0');
    const bodies = Array.from({ length: 30 }, (_, i) => JSON.stringify(book({ start: `09:${pad(i)}`, end: `10:${pad(i)}` })));
    const replies = await Promise.all(bodies.map((body) => raw(s.port, 'POST', '/api/bookings', {
      body, headers: 'Content-Type: application/json\r\n',
    })));
    const created = replies.filter((r) => r.status === 201);
    assert.equal(created.length, 1);
    assert.equal(replies.filter((r) => r.status === 409).length, 29);
    assert.equal(created[0].json.id, 1);
    assert.deepEqual(await ids(s.port), [1]);
    assert.equal(JSON.parse(fs.readFileSync(s.file, 'utf8')).bookings.length, 1);
  });
});

describe('final: body draining', () => {
  const big = 'x'.repeat(BIG);
  test('large bodies on every kind of reply are drained and the reply arrives', async () => {
    const s = await boot();
    const rooms = await request(s.port, { path: '/api/rooms', headers: { 'Content-Type': 'text/plain' }, body: big });
    assert.equal(rooms.status, 200);
    expectError(await request(s.port, { method: 'POST', path: '/nope', body: big }), 404, 'not found');
    expectError(await request(s.port, { method: 'PUT', path: '/api/rooms', body: big }), 405, 'method not allowed');
    expectError(await request(s.port, { method: 'DELETE', path: '/api/bookings/1', body: big }), 404, 'booking not found');
    expectError(await request(s.port, { method: 'POST', path: '/api/bookings', body: big }), 415,
      'content type must be application/json');
    expectError(await request(s.port, {
      method: 'POST', path: '/api/bookings', headers: { 'Content-Type': 'application/json' }, body: big,
    }), 413, 'body too large');
  });
});

describe('final: routing', () => {
  test('HEAD and OPTIONS on listed paths are 405; asterisk and absolute targets are 404', async () => {
    const s = await boot();
    for (const target of ['/', '/app.js', '/api/rooms', '/api/bookings', '/api/bookings/1']) {
      assert.equal(parseRaw(await rawGet(s.port, target, 'HEAD')).status, 405, `HEAD ${target}`);
      const opt = parseRaw(await rawGet(s.port, target, 'OPTIONS'));
      assert.equal(opt.status, 405, `OPTIONS ${target}`);
      assert.deepEqual(opt.json, METHOD, `OPTIONS ${target}`);
    }
    for (const [method, target] of [['OPTIONS', '*'], ['GET', 'http://x/api/rooms'], ['GET', '/api/rooms#x']]) {
      const res = parseRaw(await rawGet(s.port, target, method));
      assert.equal(res.status, 404, `${method} ${target}`);
      assert.deepEqual(res.json, NOT_FOUND, `${method} ${target}`);
    }
  });

  test('the id route takes any non-empty id without a slash, and the query is cut off', async () => {
    const s = await boot();
    await post(s.port, book());
    // Node's HTTP parser itself rejects raw non-ASCII bytes in the target, so Arabic-Indic 1 is sent encoded.
    for (const id of ['%2F', '%D9%A1', '1;x', '1%3F', '1.']) {
      const target = `/api/bookings/${id}`;
      const del = await raw(s.port, 'DELETE', target);
      assert.equal(del.status, 404, `DELETE ${target}`);
      assert.deepEqual(del.json, { error: 'booking not found' }, `DELETE ${target}`);
      assert.deepEqual((await raw(s.port, 'GET', target)).json, METHOD, `GET ${target}`);
    }
    for (const target of ['/api/bookings//', '/api/bookings/%2F/', '/api/bookings/1/?x']) {
      assert.deepEqual((await raw(s.port, 'DELETE', target)).json, NOT_FOUND, target);
    }
    assert.deepEqual((await raw(s.port, 'DELETE', '/api/bookings?x=1')).json, METHOD);
    assert.deepEqual((await raw(s.port, 'GET', '/api/bookings/1?date=x')).json, METHOD);
    assert.equal((await raw(s.port, 'DELETE', '/api/bookings/1?x=/')).status, 204);
    assert.deepEqual(await ids(s.port), []);
  });
});

describe('final: listing', () => {
  async function seeded() {
    const s = await boot();
    const order = [
      ['Cosmos', '2026-11-03', '09:00', '09:30'], ['Aurora', '2026-11-03', '09:00', '09:30'],
      ['Borealis', '2026-11-03', '09:00', '09:30'], ['Aurora', '2026-11-02', '23:00', '23:59'],
      ['Aurora', '2026-11-03', '08:59', '09:00'], ['Borealis', '2026-11-04', '00:00', '00:30'],
    ];
    for (const [room, date, start, end] of order) {
      assert.equal((await post(s.port, book({ room, date, start, end }))).status, 201, `${room} ${date} ${start}`);
    }
    return s;
  }

  test('sorted by date, then start, then room order (not by id or name)', async () => {
    const s = await seeded();
    assert.deepEqual(await ids(s.port), [4, 5, 2, 3, 1, 6]);
  });

  test('date filter: first of repeated values, other params ignored, + decodes to space', async () => {
    const s = await seeded();
    assert.deepEqual(await ids(s.port, '?date=2026-11-03&date=bad'), [5, 2, 3, 1]);
    assert.deepEqual(await ids(s.port, '?Date=bad&x'), [4, 5, 2, 3, 1, 6]);
    assert.deepEqual(await ids(s.port, '?x=1&date=2026-11-04&date='), [6]);
    assert.deepEqual(await ids(s.port, '?date=2026-12-31'), []);
    for (const q of ['?date=2026-11-03+', '?date=2026-11-03%20', '?date&date=2026-11-03', '?date=%EF%BC%92026-11-03']) {
      expectError(await request(s.port, { path: `/api/bookings${q}` }), 400, DATE_MSG, q);
    }
  });
});

describe('final: booking rules', () => {
  test('leap years: every year divisible by 4 in range, including 2000 and 2096', async () => {
    const s = await boot();
    for (const [i, date] of ['2000-02-29', '2004-02-29', '2096-02-29', '2099-12-31', '2026-12-31'].entries()) {
      assert.equal((await post(s.port, book({ date, start: `0${i}:00`, end: `0${i}:30` }))).status, 201, date);
    }
    for (const date of ['2001-02-29', '2099-02-29', '2000-02-30', '2026-06-31', '1999-02-29', '2100-02-29', '2026-1-01']) {
      expectError(await post(s.port, book({ date })), 400, DATE_MSG, date);
    }
  });

  test('inherited keys are not fields, and Unicode whitespace is trimmed from titles', async () => {
    const s = await boot();
    const proto = '{"__proto__":{"room":"Aurora","title":"T","date":"2026-11-03","start":"09:00","end":"10:00"}}';
    const res = await raw(s.port, 'POST', '/api/bookings', { body: proto, headers: 'Content-Type: application/json\r\n' });
    assert.equal(res.status, 400);
    assert.deepEqual(res.json, { error: 'room must be one of Aurora, Borealis, Cosmos' });
    expectError(await post(s.port, book({ title: '\u3000\u2028\uFEFF' })), 400, 'title must be 1 to 80 characters');
    expectError(await post(s.port, book({ start: '\uFF10\uFF19:00' })), 400, 'start must be HH:MM');
  });

  test('409 names the overlapping booking that starts earliest', async () => {
    const s = await boot();
    for (const [start, end] of [['11:00', '12:00'], ['09:00', '10:00'], ['10:00', '11:00']]) {
      assert.equal((await post(s.port, book({ start, end }))).status, 201);
    }
    expectError(await post(s.port, book({ start: '09:59', end: '11:01' })), 409, 'room is already booked from 09:00 to 10:00');
    expectError(await post(s.port, book({ start: '10:30', end: '23:00' })), 409, 'room is already booked from 10:00 to 11:00');
    assert.equal((await post(s.port, book({ start: '12:00', end: '12:01' }))).status, 201);
  });
});
