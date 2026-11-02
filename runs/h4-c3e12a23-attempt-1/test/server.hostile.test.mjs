// Hostile input: aborted uploads, malformed request targets and prototype-pollution bodies must
// neither crash nor hang the server, and stdout must stay the single listening line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import {
  boot, startServer, stopServer, makeTmp, request, post, rawRequest, valid, assertError,
} from './helpers/server-harness.mjs';

const ROOMS_BODY = { rooms: ['Aurora', 'Borealis', 'Cosmos'] };

/** Opens a POST, sends part of the declared body, then destroys the socket. */
function abortMidBody(port, declared, sent) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`POST /api/bookings HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n`
        + `Content-Length: ${declared}\r\n\r\n${'{'.repeat(sent)}`, () => {
        socket.destroy();
        resolve();
      });
    });
    socket.on('error', () => resolve()); // the abort itself is the point of this helper
  });
}

async function assertAlive(srv, label) {
  const res = await request(srv.port, 'GET', '/api/rooms');
  assert.equal(res.status, 200, `${label}: still answering`);
  assert.deepEqual(res.json, ROOMS_BODY, `${label}: rooms body`);
  assert.equal(srv.out(), `listening on http://127.0.0.1:${srv.port}\n`, `${label}: stdout`);
}

test('aborted uploads neither crash nor block later requests', async (t) => {
  const srv = await boot(t);
  await Promise.all(Array.from({ length: 20 }, (_, i) => abortMidBody(srv.port, 5000 + i, 100 + i)));
  await Promise.all(Array.from({ length: 5 }, () => abortMidBody(srv.port, 20000, 15000)));
  await assertAlive(srv, 'after aborts');
  const created = await post(srv.port, valid());
  assert.equal(created.status, 201, 'POST after aborts');
  assert.equal(created.json.id, 1, 'aborted uploads consume no id');
});

test('a stalled upload does not block other requests', async (t) => {
  const srv = await boot(t);
  const stalled = net.connect(srv.port, '127.0.0.1');
  t.after(() => stalled.destroy());
  stalled.on('error', () => undefined); // destroyed by the test itself
  stalled.write('POST /api/bookings HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n'
    + 'Content-Length: 9000\r\n\r\n{"room":');
  const created = await post(srv.port, valid());
  assert.equal(created.status, 201, 'POST while another upload stalls');
  const removed = await request(srv.port, 'DELETE', '/api/bookings/1');
  assert.equal(removed.status, 204, 'DELETE while another upload stalls');
  await assertAlive(srv, 'with a stalled upload');
});

test('malformed request targets get exact replies', async (t) => {
  const srv = await boot(t);
  const cases = [
    ['absolute-form target', 'GET http://127.0.0.1/api/rooms', 404, 'not found'],
    ['asterisk target', 'OPTIONS *', 404, 'not found'],
    ['bad percent in ignored query', 'GET /api/rooms?%zz', 200, null],
    ['bad percent in date', 'GET /api/bookings?date=%zz', 400, 'date must be a valid YYYY-MM-DD date'],
    ['truncated UTF-8 in date', 'GET /api/bookings?date=%E0%A4%A', 400, 'date must be a valid YYYY-MM-DD date'],
    ['lone percent id', 'DELETE /api/bookings/%', 404, 'booking not found'],
    ['NUL-encoded id', 'DELETE /api/bookings/%00', 404, 'booking not found'],
  ];
  for (const [label, line, status, msg] of cases) {
    const res = await rawRequest(srv.port, `${line} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    if (msg === null) assert.equal(res.status, status, label);
    else assertError(res, status, msg, label);
  }
  // Not valid HTTP/1.1, so node:http answers 400 itself before the app runs (decisions.md).
  for (const garbage of ['GET api/rooms HTTP/1.1\r\nHost: x\r\n\r\n', 'HELLO\r\n\r\n', 'GET /api/rooms HTTP/9.9\r\n\r\n', 'G\0T / HTTP/1.1\r\n\r\n']) {
    await rawRequest(srv.port, garbage).catch(() => undefined); // node:http may reset; only survival matters
  }
  await assertAlive(srv, 'after malformed targets');
});

test('prototype keys in bodies are plain data', async (t) => {
  const dir = makeTmp(t);
  const file = path.join(dir, 'data.json');
  const srv = await startServer(t, dir, { env: { DATA_FILE: file } });
  const fields = '"title":"T","date":"2026-11-03","start":"10:00","end":"11:00"';
  const inherited = await post(srv.port, `{"__proto__":{"room":"Aurora"},${fields}}`);
  assertError(inherited, 400, 'room must be one of Aurora, Borealis, Cosmos', 'room only via __proto__');
  const cases = [
    `{"room":"Aurora",${fields},"__proto__":null}`,
    `{"room":"Borealis",${fields},"__proto__":{"isAdmin":true},"constructor":{"prototype":{"x":1}}}`,
  ];
  const created = [];
  for (const [i, body] of cases.entries()) {
    const res = await post(srv.port, body);
    assert.equal(res.status, 201, `case ${i}`);
    assert.deepEqual(Object.keys(res.json).sort(), ['date', 'end', 'id', 'room', 'start', 'title'], `case ${i} keys`);
    created.push(res.json);
  }
  assert.deepEqual((await request(srv.port, 'GET', '/api/bookings')).json, { bookings: created }, 'stored');
  await assertAlive(srv, 'after prototype bodies');
  await stopServer(srv.child);
  const again = await startServer(t, dir, { env: { DATA_FILE: file } });
  assert.deepEqual((await request(again.port, 'GET', '/api/bookings')).json, { bookings: created }, 'reloaded');
  assert.equal(fs.readFileSync(file, 'utf8').includes('isAdmin'), false, 'unused keys are not saved');
});

test('deeply nested JSON within the size limit is a 400, not a crash', async (t) => {
  const srv = await boot(t);
  const nested = `${'['.repeat(5000)}${']'.repeat(5000)}`;
  assertError(await post(srv.port, nested), 400, 'body must be a JSON object', 'nested arrays');
  const objects = `${'{"a":'.repeat(1600)}1${'}'.repeat(1600)}`; // 9601 bytes
  assert.equal(objects.length < 10000, true, 'nested objects fit the limit');
  assertError(await post(srv.port, objects), 400, 'room must be one of Aurora, Borealis, Cosmos', 'nested objects');
  await assertAlive(srv, 'after nesting');
});
