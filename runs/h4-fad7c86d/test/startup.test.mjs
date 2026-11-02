// Startup behaviour of server.mjs: PORT checks, data file reading, order, no writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {
  startServer, runToExit, request, postBooking, booking, ROOT, FIXTURE, FIXTURE_BOOKING, tmp, listeningLine,
} from './helpers/server.mjs';

function listen(port = 0) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

const closeServer = (srv) => new Promise((resolve) => srv.close(resolve));

async function freePort() {
  const srv = await listen();
  const { port } = srv.address();
  await closeServer(srv);
  return port;
}

function assertOneLine(stderr) {
  assert.ok(stderr.endsWith('\n'), `stderr must end with newline: ${JSON.stringify(stderr)}`);
  const body = stderr.slice(0, -1);
  assert.ok(body.length > 0, 'stderr line must not be empty');
  assert.ok(!body.includes('\n'), `stderr must be one line: ${JSON.stringify(stderr)}`);
}

function assertFailed(res, stderr) {
  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  if (stderr === undefined) assertOneLine(res.stderr);
  else assert.equal(res.stderr, stderr);
}

async function withServer(t, opts) {
  const srv = await startServer(opts);
  t.after(() => srv.stop());
  return srv;
}

// ---- PORT ----

const BAD_PORTS = ['abc', '+1', ' 80', '80 ', '1e3', '0x10', '65536', '99999999999999999999', '８０', '-1', '80\n'];
for (const port of BAD_PORTS) {
  test(`invalid PORT ${JSON.stringify(port)} exits 1 with one stderr line`, async (t) => {
    const dir = tmp(t);
    assertFailed(await runToExit({ env: { PORT: port }, cwd: dir }));
  });
}

test('PORT in use exits 1 with one stderr line', async (t) => {
  const blocker = await listen();
  t.after(() => closeServer(blocker));
  const dir = tmp(t);
  const res = await runToExit({ env: { PORT: String(blocker.address().port) }, cwd: dir });
  assertFailed(res);
});

test('PORT is checked before the data file', async (t) => {
  const dir = tmp(t);
  fs.mkdirSync(path.join(dir, 'dir1'));
  const res = await runToExit({ env: { PORT: 'abc', DATA_FILE: 'dir1' }, cwd: dir });
  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.notEqual(res.stderr, 'cannot read data file dir1\n');
  assertOneLine(res.stderr);
});

test('data file is read before listening', async (t) => {
  const blocker = await listen();
  t.after(() => closeServer(blocker));
  const dir = tmp(t);
  fs.mkdirSync(path.join(dir, 'dir1'));
  const res = await runToExit({ env: { PORT: String(blocker.address().port), DATA_FILE: 'dir1' }, cwd: dir });
  assertFailed(res, 'cannot read data file dir1\n');
});

test('PORT=0 prints the bound port and serves requests', async (t) => {
  const dir = tmp(t);
  const srv = await withServer(t, { env: { PORT: '0' }, cwd: dir });
  assert.ok(srv.port > 0);
  assert.equal(srv.stdout(), listeningLine(srv.port));
  const res = await request(srv.port, { target: '/api/rooms' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
});

test('PORT=00 is accepted', async (t) => {
  const dir = tmp(t);
  const srv = await withServer(t, { env: { PORT: '00' }, cwd: dir });
  assert.ok(srv.port > 0);
  assert.equal(srv.stdout(), listeningLine(srv.port));
});

test('PORT with leading zeros is accepted', async (t) => {
  const dir = tmp(t);
  const free = await freePort();
  const srv = await withServer(t, { env: { PORT: `0${free}` }, cwd: dir });
  assert.equal(srv.port, free);
  assert.equal(srv.stdout(), listeningLine(free));
});

for (const [label, value] of [['unset', undefined], ['empty', '']]) {
  test(`PORT ${label} means 3000`, async (t) => {
    let probe;
    try {
      probe = await listen(3000);
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
      t.skip('127.0.0.1:3000 is busy');
      return;
    }
    await closeServer(probe);
    const dir = tmp(t);
    const srv = await withServer(t, { env: { PORT: value }, cwd: dir });
    assert.equal(srv.port, 3000);
    assert.equal(srv.stdout(), listeningLine(3000));
  });
}

// ---- DATA_FILE location ----

for (const [label, value] of [['unset', undefined], ['empty', '']]) {
  test(`DATA_FILE ${label} defaults to bookings.json in the cwd`, async (t) => {
    const rootFile = path.join(ROOT, 'bookings.json');
    const existedBefore = fs.existsSync(rootFile);
    const dir = tmp(t);
    const srv = await withServer(t, { env: { DATA_FILE: value }, cwd: dir });
    const res = await postBooking(srv.port, booking());
    assert.equal(res.status, 201);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'bookings.json'), 'utf8'));
    assert.equal(typeof saved, 'object');
    assert.deepEqual(fs.readdirSync(dir), ['bookings.json']);
    if (!existedBefore) assert.equal(fs.existsSync(rootFile), false);
  });
}

test('relative DATA_FILE is resolved against the cwd', async (t) => {
  const dir = tmp(t);
  fs.mkdirSync(path.join(dir, 'sub'));
  const srv = await withServer(t, { env: { DATA_FILE: 'sub/data.json' }, cwd: dir });
  assert.equal((await postBooking(srv.port, booking())).status, 201);
  JSON.parse(fs.readFileSync(path.join(dir, 'sub', 'data.json'), 'utf8'));
  assert.deepEqual(fs.readdirSync(dir), ['sub']);
});

// ---- ENOENT ----

test('missing data file starts with no bookings and is not created', async (t) => {
  const dir = tmp(t);
  const srv = await withServer(t, { env: { DATA_FILE: 'data.json' }, cwd: dir });
  const res = await request(srv.port, { target: '/api/bookings' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { bookings: [] });
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('missing data folder starts with no bookings and is not created', async (t) => {
  const dir = tmp(t);
  const srv = await withServer(t, { env: { DATA_FILE: 'nope/x.json' }, cwd: dir });
  assert.deepEqual(fs.readdirSync(dir), []);
  const res = await request(srv.port, { target: '/api/bookings' });
  assert.deepEqual(res.json, { bookings: [] });
  await request(srv.port, { target: '/api/bookings?date=2026-11-03' });
  assert.deepEqual(fs.readdirSync(dir), []);
});

// ---- bad data files ----

const bad = (obj) => JSON.stringify(obj);
const okBooking = { id: 1, room: 'Aurora', title: 'T', date: '2026-11-03', start: '09:00', end: '10:00' };
const BAD_CONTENTS = {
  empty: '',
  whitespace: '  \n\t ',
  'not json': 'not json',
  null: 'null',
  'empty array': '[]',
  'empty object': '{}',
  'only bookings': bad({ bookings: [] }),
  'nextId as string': bad({ nextId: '5', bookings: [] }),
  'booking extra key': bad({ nextId: 2, bookings: [{ ...okBooking, extra: 1 }] }),
  'booking missing key': bad({ nextId: 2, bookings: [{ id: 1, room: 'Aurora', title: 'T', date: '2026-11-03', start: '09:00' }] }),
  'BOM before valid JSON': '\u{FEFF}' + bad({ nextId: 1, bookings: [] }),
};

function nameVariants(dir) {
  return [
    ['relative', 'bad.json'],
    ['unnormalised', './x/../bad.json'],
    ['absolute', path.join(dir, 'bad.json')],
  ];
}

for (const [label, content] of Object.entries(BAD_CONTENTS)) {
  test(`bad data file (${label}) exits 1 with the name as given`, async (t) => {
    const dir = tmp(t);
    fs.mkdirSync(path.join(dir, 'x'));
    fs.writeFileSync(path.join(dir, 'bad.json'), content);
    for (const [, name] of nameVariants(dir)) {
      const res = await runToExit({ env: { PORT: '0', DATA_FILE: name }, cwd: dir });
      assertFailed(res, `cannot read data file ${name}\n`);
    }
  });
}

test('data file that is a directory exits 1 with the name as given', async (t) => {
  const dir = tmp(t);
  fs.mkdirSync(path.join(dir, 'dir1'));
  const names = ['dir1', './dir1/../dir1', path.join(dir, 'dir1')];
  for (const name of names) {
    const res = await runToExit({ env: { PORT: '0', DATA_FILE: name }, cwd: dir });
    assertFailed(res, `cannot read data file ${name}\n`);
  }
});

for (const [label, value] of [['unset', undefined], ['empty', '']]) {
  test(`DATA_FILE ${label} with an empty bookings.json reports bookings.json`, async (t) => {
    const dir = tmp(t);
    fs.writeFileSync(path.join(dir, 'bookings.json'), '');
    const res = await runToExit({ env: { PORT: '0', DATA_FILE: value }, cwd: dir });
    assertFailed(res, 'cannot read data file bookings.json\n');
  });
}

// ---- valid data ----

test('valid fixture is loaded and the next id is kept', async (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'd.json'), FIXTURE);
  const srv = await withServer(t, { env: { DATA_FILE: 'd.json' }, cwd: dir });
  const res = await request(srv.port, { target: '/api/bookings' });
  assert.deepEqual(res.json, { bookings: [FIXTURE_BOOKING] });
  const post = await postBooking(srv.port, booking({ start: '11:00', end: '12:00' }));
  assert.equal(post.status, 201);
  assert.equal(post.json.id, 5);
});

// ---- no write at startup ----

async function exerciseServer(port) {
  await request(port, { target: '/' });
  await request(port, { target: '/app.js' });
  await request(port, { target: '/api/rooms' });
  await request(port, { target: '/api/bookings' });
  assert.equal((await postBooking(port, { room: 'Aurora' })).status, 400);
  assert.equal((await postBooking(port, booking())).status, 409);
  assert.equal((await request(port, { method: 'DELETE', target: '/api/bookings/99' })).status, 404);
  assert.equal((await request(port, { method: 'PUT', target: '/api/rooms' })).status, 405);
}

test('startup and non-changing requests never write the data file', async (t) => {
  const dir = tmp(t);
  const file = path.join(dir, 'd.json');
  fs.writeFileSync(file, FIXTURE);
  const stat = fs.statSync(file);
  const before = { content: fs.readFileSync(file), files: fs.readdirSync(dir) };
  const srv = await withServer(t, { env: { DATA_FILE: 'd.json' }, cwd: dir });
  await exerciseServer(srv.port);
  assert.ok(fs.readFileSync(file).equals(before.content));
  assert.deepEqual(fs.readdirSync(dir), before.files);
  const after = fs.statSync(file);
  assert.equal(after.mtimeMs, stat.mtimeMs);
  assert.equal(after.ino, stat.ino);
});
