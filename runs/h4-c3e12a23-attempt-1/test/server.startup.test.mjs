// Startup behaviour: PORT checks, bind failures, the single stdout line.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {
  JSON_HEADERS, makeTmp, startServer, stopServer, runToExit, request, post, valid, assertError, portIsFree,
} from './helpers/server-harness.mjs';

function assertOneLine(stderr, label) {
  assert.ok(stderr.endsWith('\n'), `${label}: stderr must end with newline: ${JSON.stringify(stderr)}`);
  assert.equal(stderr.split('\n').length, 2, `${label}: stderr must hold exactly one line: ${JSON.stringify(stderr)}`);
  assert.ok(stderr.length > 1, `${label}: the line must be non-empty`);
  assert.ok(!stderr.includes('    at '), `${label}: no stack trace`);
}

const BAD_PORTS = [
  '+1', ' 80', '80 ', '\t80', '1e3', '0x10', '1.0', '-0', '-1', '65536', '70000',
  '99999999999999999999', '１２３', '٣٠٠٠', 'abc',
];

test('invalid PORT: one stderr line, exit 1, empty stdout, checked before the data file', async (t) => {
  await Promise.all(BAD_PORTS.map(async (port) => {
    const dir = makeTmp(t);
    const dataFile = path.join(dir, 'bad.json');
    fs.writeFileSync(dataFile, 'not json');
    const res = await runToExit(t, dir, { env: { PORT: port, DATA_FILE: dataFile } });
    const label = `PORT=${JSON.stringify(port)}`;
    assert.equal(res.code, 1, `${label}: exit code`);
    assert.equal(res.stdout, '', `${label}: stdout`);
    assertOneLine(res.stderr, label);
    assert.notEqual(res.stderr, `cannot read data file ${dataFile}\n`, `${label}: PORT must be checked first`);
  }));
});

async function getRooms(port) {
  const res = await request(port, 'GET', '/api/rooms');
  assert.equal(res.status, 200);
}

test('PORT 0 and 00 bind an OS-picked port', async (t) => {
  for (const port of ['0', '00']) {
    const dir = makeTmp(t);
    const srv = await startServer(t, dir, { env: { PORT: port } });
    assert.ok(srv.port > 0, `PORT=${port}: bound port`);
    assert.equal(srv.out(), `listening on http://127.0.0.1:${srv.port}\n`, `PORT=${port}: stdout`);
    await getRooms(srv.port);
  }
});

test('PORT 65535 when free', async (t) => {
  if (!(await portIsFree(65535))) return t.skip('port 65535 busy');
  const srv = await startServer(t, makeTmp(t), { env: { PORT: '65535' } });
  assert.equal(srv.out(), 'listening on http://127.0.0.1:65535\n');
  return undefined;
});

test('default port 3000 for empty and unset PORT', async (t) => {
  for (const port of ['', undefined]) {
    if (!(await portIsFree(3000))) return t.skip('port 3000 busy');
    const srv = await startServer(t, makeTmp(t), { env: { PORT: port } });
    assert.equal(srv.out(), 'listening on http://127.0.0.1:3000\n', `PORT=${JSON.stringify(port)}`);
    await stopServer(srv.child);
  }
  return undefined;
});

test('port in use: one stderr line, exit 1, empty stdout', async (t) => {
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  t.after(() => blocker.close());
  const { port } = blocker.address();
  const res = await runToExit(t, makeTmp(t), { env: { PORT: String(port) } });
  assert.equal(res.code, 1, 'port in use: exit code');
  assert.equal(res.stdout, '', 'port in use: stdout');
  assertOneLine(res.stderr, 'port in use');
});

test('stdout only ever holds the listening line', async (t) => {
  const dir = makeTmp(t);
  const dataFile = path.join(dir, 'missing', 'data.json');
  const srv = await startServer(t, dir, { env: { DATA_FILE: dataFile } });
  const { port } = srv;
  assert.equal((await request(port, 'GET', '/api/rooms')).status, 200);
  assert.equal((await post(port, valid({ room: 'x' }))).status, 400);
  assert.equal((await request(port, 'GET', '/nope')).status, 404);
  assert.equal((await request(port, 'PUT', '/api/rooms')).status, 405);
  assert.equal((await post(port, valid(), { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post(port, 'a'.repeat(10001), JSON_HEADERS)).status, 413);
  assertError(await post(port, valid()), 500, 'internal error', 'POST with save failing');
  assertError(await request(port, 'DELETE', '/api/bookings/7'), 404, 'booking not found', 'DELETE unknown id');
  await stopServer(srv.child);
  assert.equal(srv.out(), `listening on http://127.0.0.1:${port}\n`);
});
