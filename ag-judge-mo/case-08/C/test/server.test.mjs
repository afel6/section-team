import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {
  JSON_TYPE, PUBLIC_DIR, cleanupAll, parseRaw, post, rawGet, request, runToExit, startServer, tmpDir,
} from './helpers.mjs';

afterEach(cleanupAll);

const VALID = Object.freeze({ room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00' });
const book = (over = {}) => ({ ...VALID, ...over });
const stored = (id, over = {}) => ({ id, ...book(over) });
const state = (nextId, bookings) => JSON.stringify({ nextId, bookings });

function expectError(res, status, message, label = '') {
  assert.equal(res.status, status, `${label} status (body ${res.text})`);
  assert.equal(res.headers['content-type'], JSON_TYPE, `${label} content-type`);
  assert.deepEqual(res.json, { error: message }, label);
}

/** Starts a server on a fresh temp dir; optional seed is written to the data file first. */
async function boot(seed, env = {}) {
  const dir = tmpDir();
  const file = path.join(dir, 'b.json');
  if (seed !== undefined) fs.writeFileSync(file, seed);
  const server = await startServer({ env: { DATA_FILE: file, ...env } });
  return { ...server, dir, file };
}

const listIds = async (port, query = '') => (await request(port, { path: `/api/bookings${query}` })).json.bookings.map((b) => b.id);

// ---------------------------------------------------------------- startup

describe('startup: PORT', () => {
  for (const value of ['abc', '65536', '-1', '1e3', ' 80', '+80', '80a', '99999999999', '1\n2', '80\r', '\n']) {
    test(`PORT=${JSON.stringify(value)} exits 1 with one stderr line`, async () => {
      const r = await runToExit({ env: { PORT: value } });
      assert.equal(r.code, 1);
      assert.match(r.stderr, /^[^\n]+\n$/);
      assert.equal(r.stdout, '');
    });
  }

  test('PORT=00 is digits only and binds an OS port', async () => {
    const s = await startServer({ env: { PORT: '00' } });
    assert.ok(s.port > 0);
    assert.equal((await request(s.port, { path: '/api/rooms' })).status, 200);
  });

  test('PORT is checked before the data file is read', async () => {
    const dir = tmpDir();
    const r = await runToExit({ env: { PORT: 'abc', DATA_FILE: dir } });
    assert.equal(r.code, 1);
    assert.doesNotMatch(r.stderr, /^cannot read data file/);
    assert.match(r.stderr, /^[^\n]+\n$/);
  });

  test('port in use exits 1 with empty stdout', async () => {
    const blocker = net.createServer();
    await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    try {
      const r = await runToExit({ env: { PORT: String(blocker.address().port) } });
      assert.equal(r.code, 1);
      assert.equal(r.stdout, '');
      assert.match(r.stderr, /^[^\n]+\n$/);
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  });

  test('stdout stays exactly the listening line after requests and errors', async () => {
    const s = await startServer();
    await request(s.port, { path: '/api/rooms' });
    await post(s.port, { nope: 1 });
    await request(s.port, { path: '/nope' });
    await post(s.port, book());
    assert.equal(s.stdout(), `listening on http://127.0.0.1:${s.port}\n`);
  });
});

describe('startup: data file', () => {
  test('DATA_FILE directory: exact message with the raw relative value, resolved against cwd', async () => {
    const cwd = tmpDir();
    fs.mkdirSync(path.join(cwd, 'sub'));
    const r = await runToExit({ env: { DATA_FILE: 'sub' }, cwd });
    assert.deepEqual(r, { code: 1, stdout: '', stderr: 'cannot read data file sub\n' });
  });

  test('relative DATA_FILE is read from cwd, not the server folder', async () => {
    const cwd = tmpDir();
    fs.writeFileSync(path.join(cwd, 'data.json'), state(2, [stored(1)]));
    const s = await startServer({ env: { DATA_FILE: 'data.json' }, cwd });
    assert.deepEqual(await listIds(s.port), [1]);
  });

  const bad = {
    'empty file': '',
    'invalid JSON': '{not json',
    null: 'null',
    'empty array': '[]',
    'missing bookings': '{"nextId":1}',
    'fractional nextId': '{"nextId":1.5,"bookings":[]}',
    'booking missing a key': state(2, [{ id: 1, room: 'Aurora', title: 'x', date: '2026-11-03', start: '09:00' }]),
    'booking with extra key': state(2, [{ ...stored(1), extra: true }]),
    'booking with invalid date': state(2, [stored(1, { date: '2026-02-30' })]),
    'duplicate ids': state(3, [stored(1), stored(1, { room: 'Cosmos' })]),
    'id equal to nextId': state(1, [stored(1)]),
    'id above nextId': state(2, [stored(5)]),
  };
  for (const [label, content] of Object.entries(bad)) {
    test(`bad content (${label}) exits 1`, async () => {
      const cwd = tmpDir();
      fs.writeFileSync(path.join(cwd, 'data.json'), content);
      const r = await runToExit({ env: { DATA_FILE: 'data.json' }, cwd });
      assert.deepEqual(r, { code: 1, stdout: '', stderr: 'cannot read data file data.json\n' });
    });
  }

  test('missing file starts with no bookings and is not created', async () => {
    const s = await boot();
    assert.deepEqual((await request(s.port, { path: '/api/bookings' })).json, { bookings: [] });
    await request(s.port, { path: '/api/rooms' });
    assert.equal(fs.existsSync(s.file), false);
  });

  test('missing parent folder starts fine', async () => {
    const dir = tmpDir();
    const s = await startServer({ env: { DATA_FILE: path.join(dir, 'nope', 'b.json') } });
    assert.deepEqual((await request(s.port, { path: '/api/bookings' })).json, { bookings: [] });
    assert.equal(fs.existsSync(path.join(dir, 'nope')), false);
  });

  for (const [label, value] of [['unset', undefined], ['empty', '']]) {
    test(`DATA_FILE ${label} defaults to bookings.json in cwd`, async () => {
      const cwd = tmpDir();
      const s = await startServer({ env: { DATA_FILE: value }, cwd });
      assert.equal((await post(s.port, book())).status, 201);
      assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, 'bookings.json'), 'utf8')).bookings.length, 1);
    });
  }

  test('DATA_FILE unset and bad bookings.json reports bookings.json', async () => {
    const cwd = tmpDir();
    fs.writeFileSync(path.join(cwd, 'bookings.json'), 'x');
    const r = await runToExit({ env: { DATA_FILE: undefined }, cwd });
    assert.deepEqual(r, { code: 1, stdout: '', stderr: 'cannot read data file bookings.json\n' });
  });
});

describe('persistence', () => {
  test('restart keeps bookings and the next id', async () => {
    const first = await boot();
    await post(first.port, book());
    await post(first.port, book({ room: 'Cosmos' }));
    assert.equal((await request(first.port, { method: 'DELETE', path: '/api/bookings/1' })).status, 204);
    await first.kill();
    const second = await startServer({ env: { DATA_FILE: first.file } });
    assert.deepEqual(await listIds(second.port), [2]);
    const next = await post(second.port, book({ room: 'Borealis' }));
    assert.equal(next.json.id, 3);
  });

  test('ids are not reused after deleting the last booking and restarting', async () => {
    const first = await boot();
    await post(first.port, book());
    await request(first.port, { method: 'DELETE', path: '/api/bookings/1' });
    await first.kill();
    const second = await startServer({ env: { DATA_FILE: first.file } });
    assert.equal((await post(second.port, book())).json.id, 2);
  });

  test('GET and failed requests never write the file', async () => {
    const seed = state(2, [stored(1)]);
    const s = await boot(seed);
    const past = new Date('2020-01-01T00:00:00Z');
    fs.utimesSync(s.file, past, past);
    const before = fs.statSync(s.file).mtimeMs;
    await request(s.port, { path: '/api/bookings' });
    await request(s.port, { path: '/api/rooms' });
    await request(s.port, { path: '/' });
    expectError(await post(s.port, book({ room: 'x' })), 400, 'room must be one of Aurora, Borealis, Cosmos');
    expectError(await post(s.port, book()), 409, 'room is already booked from 09:00 to 10:00');
    expectError(await request(s.port, { method: 'DELETE', path: '/api/bookings/9' }), 404, 'booking not found');
    assert.equal(fs.statSync(s.file).mtimeMs, before);
    assert.equal(fs.readFileSync(s.file, 'utf8'), seed);
  });

  test('external changes to the file are ignored after startup', async () => {
    const s = await boot(state(2, [stored(1)]));
    fs.writeFileSync(s.file, 'garbage');
    assert.deepEqual(await listIds(s.port), [1]);
  });
});

describe('save failures', () => {
  test('POST save failure replies 500, changes nothing, next id unchanged', async () => {
    const dir = tmpDir();
    const folder = path.join(dir, 'missingdir');
    const s = await startServer({ env: { DATA_FILE: path.join(folder, 'b.json') } });
    expectError(await post(s.port, book()), 500, 'internal error');
    assert.equal(fs.existsSync(folder), false);
    assert.deepEqual(await listIds(s.port), []);
    fs.mkdirSync(folder);
    const ok = await post(s.port, book());
    assert.equal(ok.status, 201);
    assert.equal(ok.json.id, 1);
  });

  test('DELETE save failure replies 500 and the booking stays', async () => {
    const dir = tmpDir();
    const sub = path.join(dir, 'd');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'b.json'), state(2, [stored(1)]));
    const s = await startServer({ env: { DATA_FILE: path.join(sub, 'b.json') } });
    fs.rmSync(sub, { recursive: true });
    expectError(await request(s.port, { method: 'DELETE', path: '/api/bookings/1' }), 500, 'internal error');
    assert.deepEqual(await listIds(s.port), [1]);
    assert.equal((await request(s.port, { path: '/api/rooms' })).status, 200);
    fs.mkdirSync(sub);
    assert.equal((await request(s.port, { method: 'DELETE', path: '/api/bookings/1' })).status, 204);
  });
});

describe('concurrency', () => {
  test('10 overlapping POSTs: one 201, nine 409', async () => {
    const s = await boot();
    const results = await Promise.all(Array.from({ length: 10 }, () => post(s.port, book())));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 9);
    assert.deepEqual(await listIds(s.port), [1]);
  });

  test('10 non-overlapping concurrent POSTs get ids 1..10', async () => {
    const s = await boot();
    const pad = (i) => String(i).padStart(2, '0');
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => post(s.port, book({ start: `${pad(i)}:00`, end: `${pad(i)}:30` }))),
    );
    assert.ok(results.every((r) => r.status === 201));
    assert.deepEqual(results.map((r) => r.json.id).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

// ---------------------------------------------------------------- API

describe('API: rooms and listing', () => {
  test('GET /api/rooms exact body and content type', async () => {
    const s = await boot();
    const res = await request(s.port, { path: '/api/rooms' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], JSON_TYPE);
    assert.deepEqual(res.json, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
  });

  async function seedUnsorted(port) {
    const rows = [
      book({ room: 'Borealis', date: '2026-11-04', start: '08:00', end: '09:00' }), // 1
      book({ room: 'Cosmos' }), // 2
      book({ room: 'Aurora' }), // 3
      book({ room: 'Cosmos', start: '08:00', end: '08:30' }), // 4
      book({ room: 'Aurora', start: '10:00', end: '11:00' }), // 5
      book({ room: 'Aurora', date: '2027-01-01', start: '07:00', end: '08:00' }), // 6
      book({ room: 'Aurora', date: '2026-10-30', start: '23:00', end: '23:30' }), // 7
    ];
    for (const row of rows) assert.equal((await post(port, row)).status, 201);
  }

  test('sorted by date, then start, then room order', async () => {
    const s = await boot();
    await seedUnsorted(s.port);
    assert.deepEqual(await listIds(s.port), [7, 4, 3, 2, 5, 1, 6]);
  });

  test('date filter', async () => {
    const s = await boot();
    await seedUnsorted(s.port);
    const cases = [
      ['?date=2026-11-03', [4, 3, 2, 5]],
      ['?date=2026-11-04', [1]],
      ['?date=2026-11-05', []],
      ['?date=2026-11-03&date=bad', [4, 3, 2, 5]],
      ['?x=1', [7, 4, 3, 2, 5, 1, 6]],
      ['?date=2026%2D11%2D03', [4, 3, 2, 5]],
    ];
    for (const [query, ids] of cases) assert.deepEqual(await listIds(s.port, query), ids, query);
  });

  test('invalid date filter values reply 400', async () => {
    const s = await boot();
    await seedUnsorted(s.port);
    const queries = ['?date', '?date=', '?date=bad&date=2026-11-03', '?date=2026-02-30', '?date=+2026-11-03',
      '?date=1999-12-31', '?date=2026-11-3', '?x=1&date='];
    for (const query of queries) {
      const res = await request(s.port, { path: `/api/bookings${query}` });
      expectError(res, 400, 'date must be a valid YYYY-MM-DD date', query);
    }
  });
});

describe('API: routing', () => {
  test('trailing-slash bookings paths are 404 for GET and DELETE', async () => {
    const s = await boot();
    await post(s.port, book());
    for (const method of ['GET', 'DELETE']) {
      for (const p of ['/api/bookings/', '/api/bookings/1/', '/api/rooms/', '/api/bookings/1/x']) {
        expectError(await request(s.port, { method, path: p }), 404, 'not found', `${method} ${p}`);
      }
    }
  });

  test('non-normalised paths are 404 over a raw socket', async () => {
    const s = await boot();
    for (const p of ['/api/./rooms', '/api/%62ookings', '/API/rooms', '//api/rooms', '/nope', '/api/rooms%2F', '/app.js/']) {
      const res = parseRaw(await rawGet(s.port, p));
      assert.equal(res.status, 404, p);
      assert.deepEqual(res.json, { error: 'not found' }, p);
    }
  });

  test('a query without value is ignored', async () => {
    const s = await boot();
    assert.equal((await request(s.port, { path: '/api/rooms?x' })).status, 200);
    assert.equal((await request(s.port, { path: '/api/rooms?' })).status, 200);
  });

  test('405 for methods not listed', async () => {
    const s = await boot();
    const cases = [
      ['POST', '/api/rooms'], ['PUT', '/api/bookings'], ['GET', '/api/bookings/abc'], ['OPTIONS', '/api/bookings'],
      ['POST', '/'], ['DELETE', '/app.js'], ['DELETE', '/api/rooms'], ['DELETE', '/api/bookings'],
      ['POST', '/api/bookings/1'], ['PUT', '/api/bookings/1'],
    ];
    for (const [method, p] of cases) {
      expectError(await request(s.port, { method, path: p }), 405, 'method not allowed', `${method} ${p}`);
    }
    const head = await request(s.port, { method: 'HEAD', path: '/api/rooms' });
    assert.equal(head.status, 405);
    assert.equal(head.text, '');
  });

  test('unknown paths are 404 whatever the method', async () => {
    const s = await boot();
    for (const method of ['GET', 'POST', 'DELETE', 'PUT', 'HEAD']) {
      const res = await request(s.port, { method, path: '/nope' });
      assert.equal(res.status, 404, method);
      if (method !== 'HEAD') assert.deepEqual(res.json, { error: 'not found' }, method);
    }
  });
});

describe('API: DELETE', () => {
  test('204 with empty body, then 404', async () => {
    const s = await boot();
    await post(s.port, book());
    const del = await request(s.port, { method: 'DELETE', path: '/api/bookings/1' });
    assert.equal(del.status, 204);
    assert.equal(del.text, '');
    expectError(await request(s.port, { method: 'DELETE', path: '/api/bookings/1' }), 404, 'booking not found');
    assert.deepEqual(await listIds(s.port), []);
  });

  test('non-canonical ids are 404 booking not found and delete nothing', async () => {
    const s = await boot();
    await post(s.port, book());
    for (const id of ['01', '0', '-1', '1.0', 'abc', '%31', '+1', '1e0', '99999999999999999999', '%201', '1%20']) {
      const res = await request(s.port, { method: 'DELETE', path: `/api/bookings/${id}` });
      expectError(res, 404, 'booking not found', id);
    }
    assert.deepEqual(await listIds(s.port), [1]);
  });

  test('ids are never reused after delete', async () => {
    const s = await boot();
    assert.equal((await post(s.port, book())).json.id, 1);
    await request(s.port, { method: 'DELETE', path: '/api/bookings/1' });
    assert.equal((await post(s.port, book())).json.id, 2);
  });
});

describe('API: page', () => {
  const files = [['/', 'index.html', 'text/html; charset=utf-8'], ['/app.js', 'app.js', 'text/javascript; charset=utf-8']];
  for (const [url, name, type] of files) {
    test(`GET ${url} serves public/${name}`, async (t) => {
      const file = path.join(PUBLIC_DIR, name);
      if (!fs.existsSync(file)) return t.skip('frontend files not present');
      const s = await boot();
      const res = await request(s.port, { path: url });
      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], type);
      assert.equal(res.text, fs.readFileSync(file, 'utf8'));
    });
  }
});

// ---------------------------------------------------------------- booking rules

const jsonHeaders = { 'Content-Type': 'application/json' };
const postRaw = (port, body, headers = jsonHeaders) => request(port, { method: 'POST', path: '/api/bookings', headers, body });
const ROOM_MSG = 'room must be one of Aurora, Borealis, Cosmos';
const TITLE_MSG = 'title must be 1 to 80 characters';
const DATE_MSG = 'date must be a valid YYYY-MM-DD date';

function padded(obj, size) {
  const text = JSON.stringify(obj);
  return text + ' '.repeat(size - Buffer.byteLength(text));
}

describe('rules: content type (415) and size (413)', () => {
  test('wrong or missing content types are 415', async () => {
    const s = await boot();
    const types = [undefined, 'text/plain', 'application/jsonx', 'application/json-patch', 'application/', ''];
    for (const type of types) {
      const headers = type === undefined ? {} : { 'Content-Type': type };
      const res = await postRaw(s.port, JSON.stringify(book()), headers);
      expectError(res, 415, 'content type must be application/json', String(type));
    }
  });

  test('accepted content type spellings', async () => {
    const s = await boot();
    const types = ['Application/JSON', 'application/json; charset=utf-8', '\tapplication/json\t;x=1', ' application/json ', 'APPLICATION/JSON;'];
    for (const [i, type] of types.entries()) {
      const res = await postRaw(s.port, JSON.stringify(book({ date: `2026-11-0${i + 1}` })), { 'Content-Type': type });
      assert.equal(res.status, 201, JSON.stringify(type));
    }
  });

  test('415 wins over 413 and the reply is received', async () => {
    const s = await boot();
    const res = await postRaw(s.port, Buffer.alloc(20000, 0x61), { 'Content-Type': 'text/plain' });
    expectError(res, 415, 'content type must be application/json');
  });

  test('exactly 10001 bytes is 413, exactly 10000 is not', async () => {
    const s = await boot();
    expectError(await postRaw(s.port, padded(book(), 10001)), 413, 'body too large');
    const ok = await postRaw(s.port, padded(book(), 10000));
    assert.equal(ok.status, 201);
  });

  test('413 wins over invalid JSON and a huge body still gets its reply', async () => {
    const s = await boot();
    expectError(await postRaw(s.port, Buffer.alloc(10001, 0x78)), 413, 'body too large');
    expectError(await postRaw(s.port, Buffer.alloc(1_000_000, 0x78)), 413, 'body too large');
  });

  test('chunked body without Content-Length is counted by bytes received', async () => {
    const s = await boot();
    const headers = { ...jsonHeaders, 'Transfer-Encoding': 'chunked' };
    const big = await postRaw(s.port, [Buffer.alloc(5000, 0x20), Buffer.alloc(5001, 0x20)], headers);
    expectError(big, 413, 'body too large');
    const small = await postRaw(s.port, [padded(book(), 6000), Buffer.alloc(4000, 0x20)], headers);
    assert.equal(small.status, 201);
  });

  test('415 comes before body syntax checks', async () => {
    const s = await boot();
    expectError(await postRaw(s.port, 'not json', {}), 415, 'content type must be application/json');
  });
});

describe('rules: body shape (400) and decoding', () => {
  test('non-object bodies are 400', async () => {
    const s = await boot();
    const bodies = ['', '{', 'null', '[]', '"x"', '1', 'true', '[{}]', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(book()))])];
    for (const body of bodies) {
      expectError(await postRaw(s.port, body), 400, 'body must be a JSON object', JSON.stringify(String(body)));
    }
  });

  test('invalid UTF-8 in the title becomes U+FFFD', async () => {
    const s = await boot();
    const body = Buffer.concat([
      Buffer.from('{"room":"Aurora","title":"a'), Buffer.from([0xff]),
      Buffer.from('b","date":"2026-11-03","start":"09:00","end":"10:00"}'),
    ]);
    const res = await postRaw(s.port, body);
    assert.equal(res.status, 201);
    assert.equal(res.json.title, 'a�b');
  });

  test('rule order: each fix reveals the next error', async () => {
    const s = await boot();
    const steps = [
      [{ room: 'x', title: '', date: 'bad', start: 'bad', end: 'bad' }, ROOM_MSG],
      [{ room: 'Aurora', title: '', date: 'bad', start: 'bad', end: 'bad' }, TITLE_MSG],
      [{ room: 'Aurora', title: 'T', date: 'bad', start: 'bad', end: 'bad' }, DATE_MSG],
      [{ room: 'Aurora', title: 'T', date: '2026-11-03', start: 'bad', end: 'bad' }, 'start must be HH:MM'],
      [{ room: 'Aurora', title: 'T', date: '2026-11-03', start: '09:00', end: 'bad' }, 'end must be HH:MM'],
      [{ room: 'Aurora', title: 'T', date: '2026-11-03', start: '09:00', end: '09:00' }, 'end must be after start'],
    ];
    for (const [body, message] of steps) expectError(await post(s.port, body), 400, message, message);
  });

  test('validation (400) comes before the overlap check (409)', async () => {
    const s = await boot();
    await post(s.port, book());
    expectError(await post(s.port, book({ start: '09:30', end: '09:30' })), 400, 'end must be after start');
  });

  test('extra keys are ignored and the reply has exactly the booking keys', async () => {
    const s = await boot();
    const res = await post(s.port, book({ id: 99, extra: 1 }));
    assert.equal(res.status, 201);
    assert.equal(res.headers['content-type'], JSON_TYPE);
    assert.deepEqual(res.json, { id: 1, ...VALID });
    assert.deepEqual(Object.keys(res.json).sort(), ['date', 'end', 'id', 'room', 'start', 'title']);
  });
});

describe('rules: fields', () => {
  /** Posts each body on one server; cases are [overrides, expected status, message or undefined]. */
  async function check(cases) {
    const s = await boot();
    for (const [over, status, message] of cases) {
      const res = await post(s.port, book(over));
      const label = JSON.stringify(over);
      if (status === 201) assert.equal(res.status, 201, `${label} ${res.text}`);
      else expectError(res, status, message, label);
    }
  }

  test('room is matched exactly', async () => {
    const bad = ['aurora', 'AURORA', 'Aurora ', 'Zeta', '', null, 5, ['Aurora'], {}];
    await check(bad.map((room) => [{ room }, 400, ROOM_MSG]));
    const s = await boot();
    const { room: _omit, ...noRoom } = VALID;
    expectError(await post(s.port, noRoom), 400, ROOM_MSG);
  });

  test('title trimming and length in UTF-16 units', async () => {
    const a80 = 'a'.repeat(80);
    await check([
      [{ title: '   ' }, 400, TITLE_MSG],
      [{ title: '' }, 400, TITLE_MSG],
      [{ title: 123 }, 400, TITLE_MSG],
      [{ title: null }, 400, TITLE_MSG],
      [{ title: 'a'.repeat(81) }, 400, TITLE_MSG],
      [{ title: '\u{1F600}'.repeat(41) }, 400, TITLE_MSG],
      [{ title: `  ${'a'.repeat(81)}` }, 400, TITLE_MSG],
    ]);
    const s = await boot();
    const trimmed = await post(s.port, book({ title: ` \t${a80}\n `, date: '2026-11-04' }));
    assert.equal(trimmed.status, 201);
    assert.equal(trimmed.json.title, a80);
    assert.equal((await post(s.port, book({ title: '\u{1F600}'.repeat(40), date: '2026-11-05' }))).status, 201);
    const nbsp = await post(s.port, book({ title: ' x ', date: '2026-11-06' }));
    assert.equal(nbsp.json.title, 'x');
    const zw = await post(s.port, book({ title: '​', date: '2026-11-07' }));
    assert.equal(zw.json.title, '​');
    const listed = (await request(s.port, { path: '/api/bookings?date=2026-11-04' })).json.bookings[0];
    assert.equal(listed.title, a80);
  });

  test('date validity', async () => {
    const badDates = ['2026-11-3', ' 2026-11-03', '2026-11-03 ', '1999-12-31', '2100-01-01', '2026-02-29', '2026-13-01',
      '2026-00-10', '2026-11-00', '2026-04-31', '2100-02-29', '２０２６-11-03', '20261103', '2026/11/03', 20261103, null, ''];
    await check(badDates.map((date) => [{ date }, 400, DATE_MSG]));
    const s = await boot();
    for (const date of ['2028-02-29', '2000-01-01', '2099-12-31', '2000-02-29', '2026-02-28']) {
      assert.equal((await post(s.port, book({ date }))).status, 201, date);
    }
  });

  test('start and end formats', async () => {
    const badTimes = ['9:00', '24:00', '12:60', '09:0', '09:00:00', ' 09:00', '0900', 900, null, ''];
    await check(badTimes.map((start) => [{ start, end: '23:59' }, 400, 'start must be HH:MM']));
    await check(badTimes.map((end) => [{ start: '00:00', end }, 400, 'end must be HH:MM']));
    await check([
      [{ start: '10:00', end: '10:00' }, 400, 'end must be after start'],
      [{ start: '10:00', end: '09:59' }, 400, 'end must be after start'],
      [{ start: '00:00', end: '23:59' }, 201],
    ]);
    const s = await boot();
    assert.equal((await post(s.port, book({ start: '23:58', end: '23:59' }))).status, 201);
  });
});

describe('rules: overlap (409)', () => {
  test('reports the earliest overlapping booking, touching and other rooms/dates are fine', async () => {
    const s = await boot();
    assert.equal((await post(s.port, book({ start: '10:30', end: '11:30' }))).json.id, 1);
    assert.equal((await post(s.port, book({ start: '09:00', end: '10:00' }))).json.id, 2);
    const msg = 'room is already booked from 09:00 to 10:00';
    const clashes = [
      { start: '09:30', end: '11:00' }, { start: '08:00', end: '12:00' }, { start: '09:15', end: '09:45' },
      { start: '09:00', end: '10:00' }, { start: '09:59', end: '10:31' },
    ];
    for (const over of clashes) expectError(await post(s.port, book(over)), 409, msg, JSON.stringify(over));
    expectError(await post(s.port, book({ start: '10:30', end: '10:45' })), 409, 'room is already booked from 10:30 to 11:30');
    const touching = await post(s.port, book({ start: '10:00', end: '10:30' }));
    assert.equal(touching.status, 201);
    assert.equal(touching.json.id, 3);
    assert.equal((await post(s.port, book({ start: '11:30', end: '12:00' }))).status, 201);
    assert.equal((await post(s.port, book({ room: 'Borealis' }))).status, 201);
    assert.equal((await post(s.port, book({ date: '2026-11-04' }))).status, 201);
  });
});
