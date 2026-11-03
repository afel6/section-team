// Server tests: startup, PORT/DATA_FILE handling, persistence, save failures, concurrency, body draining.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  JSON_TYPE, SERVER_PATH, makeTempDir, removeDir, parseRaw, postBooking, rawRequest, request, runToExit, startServer,
} from './support/harness.mjs';
import {
  BASE_BOOKING as BOOKING, JSON_HEADERS as JSON_HDR, ROOM_NAMES, listAll, postOk,
} from './support/fixtures.mjs';

const INTERNAL = { error: 'internal error' };

// ---------- helpers ----------

async function tmp(t) {
  const dir = await makeTempDir();
  t.after(() => removeDir(dir));
  return dir;
}

async function boot(t, opts) {
  const server = await startServer(opts);
  t.after(() => server.stop());
  return server;
}

async function holdPort(t, port = 0) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

function assertOneLine(result, expectedCode = 1) {
  assert.equal(result.code, expectedCode);
  assert.equal(result.stdout, '');
  assert.ok(result.stderr.length > 1);
  assert.ok(result.stderr.endsWith('\n'));
  assert.equal(result.stderr.split('\n').length, 2);
}

function stored(id, over = {}) {
  return { id, ...BOOKING, ...over };
}

const layout = (nextId, bookings) => JSON.stringify({ nextId, bookings });

async function seed(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

const diskState = (path) => JSON.parse(readFileSync(path, 'utf8'));

// Tries to hold a fixed port; resolves false when something else already holds it.
// Any other listen failure is rethrown.
async function tryHoldPort(t, port) {
  try {
    await holdPort(t, port);
    return true;
  } catch (err) {
    if (err.code === 'EADDRINUSE') return false;
    throw err;
  }
}

// ---------- startup / PORT ----------

test('stdout holds only the listening line, even after errors and a 500', async (t) => {
  const dir = await tmp(t);
  const server = await boot(t, { cwd: dir, env: { DATA_FILE: 'missing/data.json' } });
  await request(server.port, { path: '/api/rooms' });
  await request(server.port, { path: '/nope' });
  await request(server.port, { method: 'PUT', path: '/api/rooms' });
  assert.equal((await postBooking(server.port, 'x')).status, 400);
  assert.equal((await postBooking(server.port, BOOKING)).status, 500);
  assert.equal(server.stdout(), `listening on http://127.0.0.1:${server.port}\n`);
  assert.equal(server.exited(), false);
});

const BAD_PORTS = ['abc', '-1', '+80', ' 80', '80 ', '8.0', '1e3', '٣٠٠٠', '０', '65536', '99999999999999999999', '0x10'];
for (const bad of BAD_PORTS) {
  test(`invalid PORT ${JSON.stringify(bad)} exits 1 with one stderr line`, async (t) => {
    const dir = await tmp(t);
    assertOneLine(await runToExit({ cwd: dir, env: { PORT: bad } }));
  });
}

for (const good of ['0', '00000']) {
  test(`PORT ${JSON.stringify(good)} starts and serves`, async (t) => {
    const dir = await tmp(t);
    const server = await boot(t, { cwd: dir, env: { PORT: good } });
    assert.ok(server.port > 0);
    assert.equal((await request(server.port, { path: '/api/rooms' })).status, 200);
  });
}

for (const [label, value] of [['unset', undefined], ['empty', '']]) {
  test(`PORT ${label} passes the PORT check (data file error is reported)`, async (t) => {
    const dir = await tmp(t);
    await seed(join(dir, 'x.json'), 'not json');
    const result = await runToExit({ cwd: dir, env: { PORT: value, DATA_FILE: 'x.json' } });
    assert.deepEqual(result, { code: 1, stdout: '', stderr: 'cannot read data file x.json\n' });
  });

  test(`PORT ${label} means 3000 (exits 1 with one line while 3000 is taken)`, async (t) => {
    const dir = await tmp(t);
    // If someone else already holds 3000 the server must fail the same way.
    await tryHoldPort(t, 3000);
    const result = await runToExit({ cwd: dir, env: { PORT: value, DATA_FILE: 'data.json' } });
    assertOneLine(result);
  });
}

test('PORT 65535 passes validation: the server fails at binding, not at the PORT check', async (t) => {
  const dir = await tmp(t);
  await seed(join(dir, 'empty.json'), layout(1, []));
  const env = { DATA_FILE: 'empty.json' };
  // Hold 65535 so the bind fails; if it is already taken elsewhere the bind fails just the same.
  await tryHoldPort(t, 65535);
  const validation = await runToExit({ cwd: dir, env: { ...env, PORT: '65536' } });
  assertOneLine(validation);
  const binding = await runToExit({ cwd: dir, env: { ...env, PORT: '65535' } });
  assertOneLine(binding);
  assert.notEqual(binding.stderr, validation.stderr);
  assert.notEqual(binding.stderr, 'cannot read data file empty.json\n');
});

test('port in use exits 1 with one stderr line', async (t) => {
  const dir = await tmp(t);
  const port = await holdPort(t);
  assertOneLine(await runToExit({ cwd: dir, env: { PORT: String(port) } }));
});

test('startup order: PORT is checked before the data file', async (t) => {
  const dir = await tmp(t);
  await seed(join(dir, 'x.json'), 'not json');
  const result = await runToExit({ cwd: dir, env: { PORT: 'abc', DATA_FILE: 'x.json' } });
  assertOneLine(result);
  assert.notEqual(result.stderr, 'cannot read data file x.json\n');
});

test('startup order: data file is read before listening', async (t) => {
  const dir = await tmp(t);
  await seed(join(dir, 'x.json'), 'not json');
  const port = await holdPort(t);
  const result = await runToExit({ cwd: dir, env: { PORT: String(port), DATA_FILE: 'x.json' } });
  assert.deepEqual(result, { code: 1, stdout: '', stderr: 'cannot read data file x.json\n' });
});

// ---------- data file: rejected ----------

const GOOD = layout(3, [stored(1), stored(2, { start: '11:00', end: '12:00' })]);
const BAD_FILES = [
  { label: 'directory', given: 'adir', check: 'adir', content: null },
  { label: 'ENOTDIR', given: 'afile/data.json', check: 'afile', content: 'plain' },
  { label: 'empty file', given: 'b.json', check: 'b.json', content: '' },
  { label: 'whitespace only', given: 'b.json', check: 'b.json', content: ' \n\t ' },
  { label: 'not json', given: 'b.json', check: 'b.json', content: 'not json' },
  { label: 'null', given: 'b.json', check: 'b.json', content: 'null' },
  { label: 'array', given: 'b.json', check: 'b.json', content: '[]' },
  { label: 'empty object', given: 'b.json', check: 'b.json', content: '{}' },
  { label: 'missing bookings', given: 'b.json', check: 'b.json', content: '{"nextId":1}' },
  { label: 'BOM + valid layout', given: 'b.json', check: 'b.json', content: `﻿${GOOD}` },
  { label: 'extra booking key', given: 'b.json', check: 'b.json', content: layout(2, [stored(1, { extra: 1 })]) },
  { label: 'nextId not above an id', given: 'b.json', check: 'b.json', content: layout(1, [stored(1)]) },
  { label: 'duplicate ids', given: 'b.json', check: 'b.json', content: layout(5, [stored(1), stored(1, { start: '11:00', end: '12:00' })]) },
  { label: 'invalid date', given: 'b.json', check: 'b.json', content: layout(2, [stored(1, { date: '2026-02-30' })]) },
  { label: 'relative nested name', given: 'data/b.json', check: 'data/b.json', content: 'not json' },
  { label: 'dot-slash name', given: './x.json', check: 'x.json', content: 'not json' },
];

async function prepareBad(dir, entry) {
  if (entry.content === null) await mkdir(join(dir, entry.check));
  else await seed(join(dir, entry.check), entry.content);
}

for (const entry of BAD_FILES) {
  test(`unusable data file (${entry.label}) exits 1 and leaves it untouched`, async (t) => {
    const dir = await tmp(t);
    await prepareBad(dir, entry);
    const before = entry.content === null ? null : await readFile(join(dir, entry.check));
    const result = await runToExit({ cwd: dir, env: { DATA_FILE: entry.given } });
    assert.deepEqual(result, { code: 1, stdout: '', stderr: `cannot read data file ${entry.given}\n` });
    if (before === null) assert.ok((await stat(join(dir, entry.check))).isDirectory());
    else assert.deepEqual(await readFile(join(dir, entry.check)), before);
  });
}

test('unusable data file given as an absolute path reports the path as given', async (t) => {
  const dir = await tmp(t);
  const abs = join(dir, 'abs.json');
  await seed(abs, 'not json');
  const result = await runToExit({ cwd: dirname(dir), env: { DATA_FILE: abs } });
  assert.deepEqual(result, { code: 1, stdout: '', stderr: `cannot read data file ${abs}\n` });
  assert.equal(await readFile(abs, 'utf8'), 'not json');
});

// ---------- data file: defaults, ENOENT, resolution, seeding ----------

for (const [label, value] of [['unset', undefined], ['empty', '']]) {
  test(`DATA_FILE ${label} uses bookings.json in the cwd`, async (t) => {
    const dir = await tmp(t);
    await seed(join(dir, 'bookings.json'), 'not json');
    const result = await runToExit({ cwd: dir, env: { DATA_FILE: value } });
    assert.deepEqual(result, { code: 1, stdout: '', stderr: 'cannot read data file bookings.json\n' });
    await seed(join(dir, 'bookings.json'), layout(2, [stored(1)]));
    const server = await boot(t, { cwd: dir, env: { DATA_FILE: value } });
    assert.deepEqual(await listAll(server.port), [stored(1)]);
  });
}

test('missing data file: starts empty and is never created by non-writing requests', async (t) => {
  const dir = await tmp(t);
  const server = await boot(t, { cwd: dir, env: { DATA_FILE: 'data.json' } });
  assert.equal(existsSync(join(dir, 'data.json')), false);
  assert.deepEqual(await listAll(server.port), []);
  const expected = [
    [{ path: '/nope' }, 404],
    [{ method: 'PUT', path: '/api/bookings' }, 405],
    [{ method: 'DELETE', path: '/api/bookings/999' }, 404],
    [{ method: 'POST', path: '/api/bookings', body: 'x', headers: JSON_HDR }, 400],
    [{ method: 'POST', path: '/api/bookings', body: '{}', headers: { 'Content-Type': 'text/plain' } }, 415],
    [{ method: 'POST', path: '/api/bookings', body: 'x'.repeat(10001), headers: JSON_HDR }, 413],
  ];
  for (const [req, status] of expected) assert.equal((await request(server.port, req)).status, status);
  await sleep(50);
  assert.equal(existsSync(join(dir, 'data.json')), false);
});

test('missing parent folder: starts empty and the folder is not created', async (t) => {
  const dir = await tmp(t);
  const server = await boot(t, { cwd: dir, env: { DATA_FILE: 'nodir/data.json' } });
  assert.deepEqual(await listAll(server.port), []);
  await sleep(50);
  assert.equal(existsSync(join(dir, 'nodir')), false);
});

test('relative DATA_FILE is resolved against the cwd, not the server folder', async (t) => {
  const dir = await tmp(t);
  await mkdir(join(dir, 'sub'));
  const server = await boot(t, { cwd: dir, env: { DATA_FILE: 'sub/data.json' } });
  await postOk(server.port);
  assert.deepEqual(diskState(join(dir, 'sub', 'data.json')), { nextId: 2, bookings: [stored(1)] });
  assert.equal(existsSync(join(dirname(SERVER_PATH), 'sub', 'data.json')), false);
});

test('a seeded valid file loads and the next POST gets its nextId', async (t) => {
  const dir = await tmp(t);
  const seeded = [stored(3), stored(5, { room: 'Cosmos', start: '11:00', end: '12:00' })];
  await seed(join(dir, 'd.json'), layout(7, seeded));
  const server = await boot(t, { cwd: dir, env: { DATA_FILE: 'd.json' } });
  assert.deepEqual(await listAll(server.port), seeded);
  assert.deepEqual(await postOk(server.port, { date: '2026-11-04' }), stored(7, { date: '2026-11-04' }));
});

// ---------- persistence ----------

test('bookings and next id survive a restart; ids are never reused', async (t) => {
  const dir = await tmp(t);
  const env = { DATA_FILE: 'd.json' };
  const first = await startServer({ cwd: dir, env });
  try {
    await postOk(first.port);
    await postOk(first.port, { start: '11:00', end: '12:00' });
    assert.equal((await request(first.port, { method: 'DELETE', path: '/api/bookings/2' })).status, 204);
  } finally {
    await first.stop();
  }
  const second = await boot(t, { cwd: dir, env });
  assert.deepEqual(await listAll(second.port), [stored(1)]);
  assert.equal((await request(second.port, { method: 'DELETE', path: '/api/bookings/1' })).status, 204);
  await second.stop();
  const third = await boot(t, { cwd: dir, env });
  assert.deepEqual(await listAll(third.port), []);
  assert.equal((await postOk(third.port)).id, 3);
});

test('the file is written before the reply is sent', async (t) => {
  const dir = await tmp(t);
  const server = await boot(t, { cwd: dir, env: { DATA_FILE: 'd.json' } });
  const res = await postBooking(server.port, BOOKING);
  assert.equal(res.status, 201);
  assert.deepEqual(diskState(join(dir, 'd.json')), { nextId: 2, bookings: [res.json()] });
  const del = await request(server.port, { method: 'DELETE', path: '/api/bookings/1' });
  assert.equal(del.status, 204);
  assert.deepEqual(diskState(join(dir, 'd.json')), { nextId: 2, bookings: [] });
});

test('outside changes to the file are not noticed; a later POST rewrites from memory', async (t) => {
  const dir = await tmp(t);
  const path = join(dir, 'd.json');
  await seed(path, layout(2, [stored(1)]));
  const server = await boot(t, { cwd: dir, env: { DATA_FILE: 'd.json' } });
  await writeFile(path, 'other content');
  assert.deepEqual(await listAll(server.port), [stored(1)]);
  const created = await postOk(server.port, { start: '11:00', end: '12:00' });
  assert.deepEqual(diskState(path), { nextId: 3, bookings: [stored(1), created] });
});

// ---------- no write on other requests ----------

const OTHER_REQUESTS = [
  [{ path: '/api/rooms' }, 200],
  [{ path: '/api/bookings' }, 200],
  [{ path: '/api/bookings?date=2026-11-03' }, 200],
  [{ path: '/api/bookings?date=bad' }, 400],
  [{ path: '/' }, 200],
  [{ path: '/app.js' }, 200],
  [{ path: '/nope' }, 404],
  [{ method: 'POST', path: '/api/bookings', body: 'x', headers: JSON_HDR }, 400],
  [{ method: 'POST', path: '/api/bookings', body: JSON.stringify(BOOKING), headers: JSON_HDR }, 409],
  [{ method: 'POST', path: '/api/bookings', body: 'x'.repeat(10001), headers: JSON_HDR }, 413],
  [{ method: 'POST', path: '/api/bookings', body: '{}', headers: { 'Content-Type': 'text/plain' } }, 415],
  [{ method: 'DELETE', path: '/api/bookings/999' }, 404],
  [{ method: 'DELETE', path: '/api/bookings/abc' }, 404],
  [{ method: 'GET', path: '/api/bookings/1' }, 405],
  [{ method: 'PUT', path: '/api/bookings' }, 405],
  [{ method: 'POST', path: '/api/rooms' }, 405],
];

test('only a successful POST or DELETE writes the file', async (t) => {
  const dir = await tmp(t);
  const path = join(dir, 'd.json');
  const server = await boot(t, { cwd: dir, env: { DATA_FILE: 'd.json' } });
  await postOk(server.port);
  const before = { text: await readFile(path, 'utf8') };
  await utimes(path, new Date(1_000_000_000_000), new Date(1_000_000_000_000));
  const fixed = (await stat(path)).mtimeMs;
  for (const [req, status] of OTHER_REQUESTS) {
    assert.equal((await request(server.port, req)).status, status, JSON.stringify(req));
  }
  await sleep(50);
  assert.equal(await readFile(path, 'utf8'), before.text);
  assert.equal((await stat(path)).mtimeMs, fixed);
});

test('startup with an existing file does not rewrite it', async (t) => {
  const dir = await tmp(t);
  const path = join(dir, 'd.json');
  await seed(path, layout(2, [stored(1)]));
  await utimes(path, new Date(1_000_000_000_000), new Date(1_000_000_000_000));
  const before = await stat(path);
  const server = await boot(t, { cwd: dir, env: { DATA_FILE: 'd.json' } });
  await listAll(server.port);
  await request(server.port, { path: '/api/rooms' });
  await sleep(50);
  assert.equal((await stat(path)).mtimeMs, before.mtimeMs);
  assert.equal(await readFile(path, 'utf8'), layout(2, [stored(1)]));
});

// ---------- save failure ----------

async function assertInternalError(res) {
  assert.equal(res.status, 500);
  assert.equal(res.headers['content-type'], JSON_TYPE);
  assert.deepEqual(res.json(), INTERNAL);
}

test('save failure on POST: 500, nothing changes, server keeps running', async (t) => {
  const dir = await tmp(t);
  const server = await boot(t, { cwd: dir, env: { DATA_FILE: 'missing/data.json' } });
  await assertInternalError(await postBooking(server.port, BOOKING));
  assert.equal(server.exited(), false);
  assert.equal((await request(server.port, { path: '/api/rooms' })).status, 200);
  assert.deepEqual(await listAll(server.port), []);
  assert.equal(existsSync(join(dir, 'missing')), false);
  await mkdir(join(dir, 'missing'));
  const created = await postBooking(server.port, BOOKING);
  assert.equal(created.status, 201);
  assert.deepEqual(created.json(), stored(1));
});

test('save failure on DELETE: 500, booking stays, later DELETE works', async (t) => {
  const dir = await tmp(t);
  await seed(join(dir, 'sub', 'data.json'), layout(2, [stored(1)]));
  const server = await boot(t, { cwd: dir, env: { DATA_FILE: 'sub/data.json' } });
  await rm(join(dir, 'sub'), { recursive: true });
  await assertInternalError(await request(server.port, { method: 'DELETE', path: '/api/bookings/1' }));
  assert.deepEqual(await listAll(server.port), [stored(1)]);
  await mkdir(join(dir, 'sub'));
  assert.equal((await request(server.port, { method: 'DELETE', path: '/api/bookings/1' })).status, 204);
  assert.deepEqual(await listAll(server.port), []);
});

// ---------- concurrency ----------

test('10 overlapping POSTs at once: one 201, nine 409', async (t) => {
  const dir = await tmp(t);
  const server = await boot(t, { cwd: dir, env: { DATA_FILE: 'd.json' } });
  const bodies = Array.from({ length: 10 }, (_, index) => {
    const start = `09:${String(index * 5).padStart(2, '0')}`;
    return { ...BOOKING, start, end: `10:${String(index * 5).padStart(2, '0')}` };
  });
  const replies = await Promise.all(bodies.map((body) => postBooking(server.port, body)));
  const created = replies.filter((res) => res.status === 201);
  const rejected = replies.filter((res) => res.status === 409);
  assert.equal(created.length, 1);
  assert.equal(rejected.length, 9);
  const winner = created[0].json();
  for (const res of rejected) {
    assert.deepEqual(res.json(), { error: `room is already booked from ${winner.start} to ${winner.end}` });
  }
  assert.deepEqual(await listAll(server.port), [winner]);
});

test('10 non-overlapping POSTs at once: distinct ids 2..11 and the file matches memory', async (t) => {
  const dir = await tmp(t);
  const env = { DATA_FILE: 'd.json' };
  const server = await startServer({ cwd: dir, env });
  let memory;
  try {
    await postOk(server.port);
    const hours = Array.from({ length: 10 }, (_, index) => String(8 + index).padStart(2, '0'));
    const replies = await Promise.all(hours.map((hour) => (
      postBooking(server.port, { ...BOOKING, date: '2026-11-04', start: `${hour}:00`, end: `${hour}:30` })
    )));
    assert.deepEqual(replies.map((res) => res.status), Array(10).fill(201));
    const ids = replies.map((res) => res.json().id).sort((first, second) => first - second);
    assert.deepEqual(ids, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    memory = await listAll(server.port);
    assert.equal(memory.length, 11);
  } finally {
    await server.stop();
  }
  const again = await boot(t, { cwd: dir, env });
  assert.deepEqual(await listAll(again.port), memory);
  assert.equal((await postOk(again.port, { date: '2026-11-05' })).id, 12);
});

// ---------- body draining ----------

test('5 MB body with the wrong content type still gets 415', async (t) => {
  const dir = await tmp(t);
  const server = await boot(t, { cwd: dir, env: { DATA_FILE: 'd.json' } });
  const res = await postBooking(server.port, Buffer.alloc(5_000_000, 0x61), { 'Content-Type': 'text/plain' });
  assert.equal(res.status, 415);
  assert.deepEqual(res.json(), { error: 'content type must be application/json' });
});

test('5 MB JSON body gets 413', async (t) => {
  const dir = await tmp(t);
  const server = await boot(t, { cwd: dir, env: { DATA_FILE: 'd.json' } });
  const res = await postBooking(server.port, Buffer.alloc(5_000_000, 0x61), JSON_HDR);
  assert.equal(res.status, 413);
  assert.deepEqual(res.json(), { error: 'body too large' });
});

const BIG_BODY = 'x'.repeat(2_000_000);
const DRAIN_CASES = [
  {
    label: '415 POST', status: 415, error: 'content type must be application/json',
    method: 'POST', path: '/api/bookings', type: 'text/plain',
  },
  {
    label: '413 POST', status: 413, error: 'body too large',
    method: 'POST', path: '/api/bookings', type: 'application/json',
  },
  {
    label: '404 POST /nope', status: 404, error: 'not found',
    method: 'POST', path: '/nope', type: 'application/json',
  },
  {
    label: '405 PUT /api/rooms', status: 405, error: 'method not allowed',
    method: 'PUT', path: '/api/rooms', type: 'application/json',
  },
  {
    label: '404 DELETE /api/bookings/999', status: 404, error: 'booking not found',
    method: 'DELETE', path: '/api/bookings/999', type: 'application/json',
  },
];

for (const drain of DRAIN_CASES) {
  test(`pipelined 2 MB body (${drain.label}) then GET on one socket: both replies arrive`, async (t) => {
    const dir = await tmp(t);
    const server = await boot(t, { cwd: dir, env: { DATA_FILE: 'd.json' } });
    const first = `${drain.method} ${drain.path} HTTP/1.1\r\nHost: x\r\nContent-Type: ${drain.type}\r\n`
      + `Content-Length: ${BIG_BODY.length}\r\n\r\n${BIG_BODY}`;
    const second = 'GET /api/rooms HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n';
    const raw = await rawRequest(server.port, first + second);
    const parts = raw.split('HTTP/1.1 ');
    assert.equal(parts.length, 3);
    const [failed, rooms] = [parts[1], parts[2]].map((part) => parseRaw(`HTTP/1.1 ${part}`));
    assert.equal(failed.status, drain.status);
    assert.deepEqual(JSON.parse(failed.body), { error: drain.error });
    assert.equal(rooms.status, 200);
    assert.deepEqual(JSON.parse(rooms.body), { rooms: [...ROOM_NAMES] });
  });
}
