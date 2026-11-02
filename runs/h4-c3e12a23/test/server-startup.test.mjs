// Startup behaviour of server.mjs: PORT, DATA_FILE, listening line, order of checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runUntilExit, startServer, request, postBooking, validBooking } from './helpers/server-harness.mjs';
import { withTempDir, withServer } from './helpers/api-assert.mjs';

const REPO_DIR = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const MAX_PORT_ATTEMPTS = 5;
const PORT_3000_SKIP_MESSAGE = 'port 3000 is in use on this machine; default-port test skipped';

function assertOneStderrLineExit1(result) {
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^[^\n]+\n$/);
  assert.equal(result.stderr.includes('    at '), false);
}

function listenOn(port) {
  return new Promise((resolve, reject) => {
    const blocker = net.createServer();
    blocker.once('error', reject);
    blocker.listen(port, '127.0.0.1', () => resolve(blocker));
  });
}

function closeServer(blocker) {
  return new Promise((resolve) => blocker.close(resolve));
}

async function freePort() {
  const blocker = await listenOn(0);
  const { port } = blocker.address();
  await closeServer(blocker);
  return port;
}

async function withBlockedPort(fn) {
  const blocker = await listenOn(0);
  try {
    return await fn(blocker.address().port);
  } finally {
    await closeServer(blocker);
  }
}

/**
 * Starts the server with PORT='0'+<free port>. A free port can be taken between
 * probing and binding; then the server exits before listening and we retry with
 * a new free port (up to MAX_PORT_ATTEMPTS). Any other failure is rethrown.
 */
async function startOnZeroPrefixedFreePort(dir) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_PORT_ATTEMPTS; attempt += 1) {
    const free = await freePort();
    try {
      const server = await startServer({ env: { PORT: `0${free}` }, cwd: dir });
      return { free, server };
    } catch (error) {
      if (!error.message.startsWith('server exited')) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

const INVALID_PORTS = ['abc', '-1', '+80', ' 80', '80 ', '65536', '99999', '1e3', '0x50', '8.0', '٣', '１'];

for (const port of INVALID_PORTS) {
  test(`invalid PORT ${JSON.stringify(port)} writes one stderr line and exits 1`, () => withTempDir(async (dir) => {
    assertOneStderrLineExit1(await runUntilExit({ env: { PORT: port }, cwd: dir }));
  }));
}

test('PORT is checked before the data file is read', () => withTempDir(async (dir) => {
  await mkdir(join(dir, 'dir'));
  const result = await runUntilExit({ env: { PORT: 'abc', DATA_FILE: 'dir' }, cwd: dir });
  assertOneStderrLineExit1(result);
  assert.notEqual(result.stderr, 'cannot read data file dir\n');
}));

test('a port that is in use writes one stderr line and exits 1', () => withTempDir((dir) => withBlockedPort(async (port) => {
  assertOneStderrLineExit1(await runUntilExit({ env: { PORT: String(port) }, cwd: dir }));
})));

test('the data file is read before listening: bad file wins over a port in use', () => withTempDir((dir) => withBlockedPort(async (port) => {
  await mkdir(join(dir, 'dir'));
  const result = await runUntilExit({ env: { PORT: String(port), DATA_FILE: 'dir' }, cwd: dir });
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'cannot read data file dir\n');
})));

test('PORT=0 prints exactly the listening line with the bound port and nothing else', () => withTempDir((dir) => (
  withServer({ env: { PORT: '0' }, cwd: dir }, async ({ port, output }) => {
    const line = `listening on http://127.0.0.1:${port}\n`;
    assert.equal(output.stdout, line);
    const rooms = await request(port, { path: '/api/rooms' });
    assert.equal(rooms.status, 200);
    await request(port, { path: '/api/bookings' });
    assert.equal((await postBooking(port, validBooking())).status, 201);
    assert.equal((await request(port, { path: '/nope' })).status, 404);
    assert.equal((await postBooking(port, {})).status, 400);
    assert.equal(output.stdout, line);
  })
)));

function probePort3000() {
  return listenOn(3000).then(closeServer, () => 'busy');
}

test('unset and empty PORT listen on 3000', (testContext) => withTempDir(async (dir) => {
  if (await probePort3000() === 'busy') return testContext.skip(PORT_3000_SKIP_MESSAGE);
  for (const port of [undefined, '']) {
    await withServer({ env: { PORT: port }, cwd: dir }, ({ output }) => {
      assert.equal(output.stdout, 'listening on http://127.0.0.1:3000\n');
    });
  }
  return undefined;
}));

test('PORT made only of digits with leading zeros is valid (00000 lets the OS pick)', () => withTempDir((dir) => (
  withServer({ env: { PORT: '00000' }, cwd: dir }, ({ port, output }) => {
    assert.notEqual(port, 0);
    assert.equal(output.stdout, `listening on http://127.0.0.1:${port}\n`);
  })
)));

test('PORT with a leading zero binds that port', () => withTempDir(async (dir) => {
  const { free, server } = await startOnZeroPrefixedFreePort(dir);
  try {
    assert.equal(server.port, free);
    assert.equal(server.output.stdout, `listening on http://127.0.0.1:${free}\n`);
  } finally {
    await server.stop();
  }
}));

async function parsedObject(path) {
  const value = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(typeof value, 'object');
  assert.notEqual(value, null);
  return value;
}

for (const dataFile of [undefined, '']) {
  test(`DATA_FILE ${dataFile === undefined ? 'unset' : 'empty'} saves to bookings.json in the cwd`, () => withTempDir(async (dir) => {
    await withServer({ env: { DATA_FILE: dataFile }, cwd: dir }, async ({ port }) => {
      assert.equal((await postBooking(port, validBooking())).status, 201);
    });
    await parsedObject(join(dir, 'bookings.json'));
  }));
}

test('a relative DATA_FILE resolves against the cwd, not the server folder', () => withTempDir(async (dir) => {
  const repoFile = join(REPO_DIR, 'bookings.json');
  const repoFileExistedBefore = existsSync(repoFile);
  await mkdir(join(dir, 'sub'));
  await withServer({ env: { DATA_FILE: 'sub/data.json' }, cwd: dir }, async ({ port }) => {
    assert.equal((await postBooking(port, validBooking())).status, 201);
  });
  await parsedObject(join(dir, 'sub', 'data.json'));
  assert.equal(existsSync(join(REPO_DIR, 'sub')), false);
  assert.equal(existsSync(repoFile), repoFileExistedBefore);
}));

test('a missing data file (ENOENT) means no bookings', () => withTempDir(async (dir) => {
  await withServer({ env: { DATA_FILE: 'missing.json' }, cwd: dir }, async ({ port }) => {
    const reply = await request(port, { path: '/api/bookings' });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.json(), { bookings: [] });
  });
  assert.equal(existsSync(join(dir, 'missing.json')), false);
}));

test('missing folders on the data path mean no bookings and are never created', () => withTempDir(async (dir) => {
  await withServer({ env: { DATA_FILE: 'nofolder/deeper/x.json' }, cwd: dir }, async ({ port }) => {
    for (let round = 0; round < 2; round += 1) {
      const reply = await request(port, { path: '/api/bookings' });
      assert.equal(reply.status, 200);
      assert.deepEqual(reply.json(), { bookings: [] });
    }
  });
  assert.equal(existsSync(join(dir, 'nofolder')), false);
}));

const BAD_CONTENTS = [
  ['empty file', ''],
  ['not json', 'not json'],
  ['truncated object', '{'],
  ['null', 'null'],
  ['array', '[]'],
  ['empty object', '{}'],
  ['string', '"x"'],
  ['only nextId', '{"nextId":1}'],
  ['only bookings', '{"bookings":[]}'],
  ['extra key', '{"nextId":1,"bookings":[],"extra":1}'],
  ['nextId as string', '{"nextId":"1","bookings":[]}'],
  ['unknown room', '{"nextId":2,"bookings":[{"id":1,"room":"Nope","title":"t","date":"2026-11-03","start":"09:00","end":"10:00"}]}'],
];

const NAME_FORMS = [
  ['plain', () => 'data.json'],
  ['dot-slash', () => './data.json'],
  ['dot-dot segment', () => 'sub/../data.json'],
  ['absolute', (dir) => join(dir, 'data.json')],
];

function assertCannotRead(result, name) {
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `cannot read data file ${name}\n`);
}

for (const [formLabel, nameOf] of NAME_FORMS) {
  test(`unreadable data file given as ${formLabel} path (a directory) reports the name as given`, () => withTempDir(async (dir) => {
    await mkdir(join(dir, 'sub'));
    await mkdir(join(dir, 'data.json'));
    const name = nameOf(dir);
    assertCannotRead(await runUntilExit({ env: { DATA_FILE: name }, cwd: dir }), name);
  }));

  for (const [label, content] of BAD_CONTENTS) {
    test(`data file ${label} given as ${formLabel} path reports the name as given`, () => withTempDir(async (dir) => {
      await mkdir(join(dir, 'sub'));
      await writeFile(join(dir, 'data.json'), content);
      const name = nameOf(dir);
      assertCannotRead(await runUntilExit({ env: { DATA_FILE: name }, cwd: dir }), name);
    }));
  }
}

for (const dataFile of [undefined, '']) {
  test(`invalid bookings.json with DATA_FILE ${dataFile === undefined ? 'unset' : 'empty'} reports bookings.json`, () => withTempDir(async (dir) => {
    await writeFile(join(dir, 'bookings.json'), 'not json');
    assertCannotRead(await runUntilExit({ env: { DATA_FILE: dataFile }, cwd: dir }), 'bookings.json');
  }));
}

test('a data file in the server layout starts fine', () => withTempDir(async (dir) => {
  await writeFile(join(dir, 'data.json'), '{"nextId":1,"bookings":[]}');
  await withServer({ env: { DATA_FILE: 'data.json' }, cwd: dir }, async ({ port, isRunning }) => {
    assert.equal(isRunning(), true);
    const reply = await request(port, { path: '/api/bookings' });
    assert.deepEqual(reply.json(), { bookings: [] });
  });
}));
