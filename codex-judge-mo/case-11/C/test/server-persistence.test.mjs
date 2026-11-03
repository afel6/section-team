import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { readFile, writeFile, stat, utimes, mkdir, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { startServer, request, postBooking, validBooking } from './helpers/server-harness.mjs';
import { assertJsonError, listBookings, withTempDir, MSG } from './helpers/api-assert.mjs';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const ABORT_ERROR_CODES = ['ECONNRESET', 'EPIPE', 'ABORT_ERR'];

/** Runs fn(dir, track) with a fresh temp dir; every server passed to track is stopped afterwards. */
function withDir(fn) {
  return withTempDir(async (dir) => {
    const servers = [];
    const track = (server) => { servers.push(server); return server; };
    try {
      await fn(dir, track);
    } finally {
      await Promise.all(servers.map((server) => server.stop()));
    }
  });
}

async function start(dir, track, dataFile) {
  return track(await startServer({ cwd: dir, env: { DATA_FILE: dataFile } }));
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

test('no write at startup or on non-changing requests', async () => {
  await withDir(async (dir, track) => {
    const file = join(dir, 'data.json');
    const booking = { id: 3, room: 'Borealis', title: 'Plan', date: '2026-11-04', start: '13:00', end: '14:00' };
    await writeFile(file, '{"nextId":5,"bookings":[{"id":3,"room":"Borealis","title":"Plan","date":"2026-11-04","start":"13:00","end":"14:00"}]}');
    const past = new Date('2020-01-02T03:04:05Z');
    await utimes(file, past, past);
    const contentBefore = await readFile(file);
    const mtimeBefore = (await stat(file)).mtimeMs;

    const { port } = await start(dir, track, 'data.json');
    const requests = [
      { path: '/api/rooms' },
      { path: '/api/bookings' },
      { path: '/api/bookings?date=2026-11-04' },
      { path: '/' },
      { path: '/app.js' },
      { path: '/nope' },
      { method: 'PUT', path: '/api/rooms' },
      { method: 'POST', path: '/api/bookings', headers: JSON_HEADERS, body: 'nope' },
      { method: 'POST', path: '/api/bookings', headers: JSON_HEADERS,
        body: JSON.stringify(validBooking({ room: 'Borealis', date: '2026-11-04', start: '13:30', end: '14:30' })) },
      { method: 'POST', path: '/api/bookings', headers: { 'Content-Type': 'text/plain' }, body: '{}' },
      { method: 'DELETE', path: '/api/bookings/999' },
    ];
    const statuses = [];
    for (const options of requests) statuses.push((await request(port, options)).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 404, 405, 400, 409, 415, 404]);

    assert.deepEqual(await readFile(file), contentBefore);
    assert.equal((await stat(file)).mtimeMs, mtimeBefore);
    assert.deepEqual(await listBookings(port), [booking]);
    const created = await postBooking(port, validBooking());
    assert.equal(created.status, 201);
    assert.deepEqual(created.json(), validBooking({ id: 5 }));
  });
});

test('ENOENT start writes nothing', async () => {
  await withDir(async (dir, track) => {
    const file = join(dir, 'data.json');
    const { port } = await start(dir, track, 'data.json');
    assert.equal((await request(port, { path: '/api/rooms' })).status, 200);
    assert.deepEqual(await listBookings(port), []);
    assert.equal((await request(port, { path: '/' })).status, 200);
    assert.equal(await exists(file), false);
    assert.equal((await postBooking(port, validBooking())).status, 201);
    assert.equal(await exists(file), true);
  });
});

test('persistence across restarts keeps bookings and never reuses ids', async () => {
  await withDir(async (dir, track) => {
    const first = await start(dir, track, 'data.json');
    for (const hour of ['09', '10', '11']) {
      const reply = await postBooking(first.port, validBooking({ start: `${hour}:00`, end: `${hour}:30` }));
      assert.equal(reply.status, 201);
    }
    assert.equal((await request(first.port, { method: 'DELETE', path: '/api/bookings/3' })).status, 204);
    assert.equal((await request(first.port, { method: 'DELETE', path: '/api/bookings/1' })).status, 204);
    const expected = [validBooking({ id: 2, start: '10:00', end: '10:30' })];
    assert.deepEqual(await listBookings(first.port), expected);
    await first.stop();

    const second = await start(dir, track, 'data.json');
    assert.deepEqual(await listBookings(second.port), expected);
    const next = await postBooking(second.port, validBooking({ start: '12:00', end: '12:30' }));
    assert.equal(next.status, 201);
    assert.equal(next.json().id, 4);
    const afterSecond = await listBookings(second.port);
    assert.equal(afterSecond.length, 2);
    await second.stop();

    const third = await start(dir, track, 'data.json');
    assert.deepEqual(await listBookings(third.port), afterSecond);
    const last = await postBooking(third.port, validBooking({ start: '13:00', end: '13:30' }));
    assert.equal(last.status, 201);
    assert.equal(last.json().id, 5);
  });
});

test('every change is saved before the reply is sent', async () => {
  await withDir(async (dir, track) => {
    const file = join(dir, 'data.json');
    const { port } = await start(dir, track, 'data.json');
    const created = await postBooking(port, validBooking());
    assert.equal(created.status, 201);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(saved.bookings, [validBooking({ id: 1 })]);
    assert.equal(saved.nextId, 2);

    const removed = await request(port, { method: 'DELETE', path: '/api/bookings/1' });
    assert.equal(removed.status, 204);
    const savedAfterDelete = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(savedAfterDelete.bookings, []);
    assert.equal(savedAfterDelete.nextId, 2);
  });
});

test('a failed save replies 500, changes nothing and keeps the server running', async () => {
  await withDir(async (dir, track) => {
    const sub = join(dir, 'sub');
    await mkdir(sub);
    const server = await start(dir, track, 'sub/data.json');
    const { port } = server;
    const firstBooking = validBooking();
    const created = await postBooking(port, firstBooking);
    assert.equal(created.status, 201);
    assert.deepEqual(created.json(), { ...firstBooking, id: 1 });

    await rm(sub, { recursive: true, force: true });
    const secondBooking = validBooking({ start: '11:00', end: '12:00' });
    assertJsonError(await postBooking(port, secondBooking), 500, MSG.internal);
    assertJsonError(await request(port, { method: 'DELETE', path: '/api/bookings/1' }), 500, MSG.internal);
    assert.deepEqual(await listBookings(port), [{ ...firstBooking, id: 1 }]);
    assert.equal(server.isRunning(), true);
    assert.equal(await exists(sub), false);

    await mkdir(sub);
    const retry = await postBooking(port, secondBooking);
    assert.equal(retry.status, 201);
    assert.deepEqual(retry.json(), { ...secondBooking, id: 2 });
    assert.equal((await request(port, { method: 'DELETE', path: '/api/bookings/1' })).status, 204);
  });
});

test('concurrent requests behave as if handled one at a time', async () => {
  await withDir(async (dir, track) => {
    const first = await start(dir, track, 'data.json');
    const minutes = ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11'];
    const overlapping = await Promise.all(minutes.map((minute) =>
      postBooking(first.port, validBooking({ start: `09:${minute}`, end: '10:00' }))));
    const statuses = overlapping.map((reply) => reply.status).sort();
    assert.deepEqual(statuses, [201, 409, 409, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
    assert.equal((await listBookings(first.port)).length, 1);

    const hours = Array.from({ length: 15 }, (_, index) => String(index).padStart(2, '0'));
    const others = await Promise.all(hours.map((hour) =>
      postBooking(first.port, validBooking({ date: '2026-11-05', start: `${hour}:00`, end: `${hour}:30` }))));
    assert.deepEqual(others.map((reply) => reply.status), hours.map(() => 201));
    const ids = others.map((reply) => reply.json().id).sort((left, right) => left - right);
    assert.deepEqual(ids, Array.from({ length: 15 }, (_, index) => index + 2));

    const bookingsBeforeRestart = await listBookings(first.port);
    assert.equal(bookingsBeforeRestart.length, 16);
    await first.stop();
    const second = await start(dir, track, 'data.json');
    assert.deepEqual(await listBookings(second.port), bookingsBeforeRestart);
    const next = await postBooking(second.port, validBooking({ date: '2026-11-06' }));
    assert.equal(next.status, 201);
    assert.equal(next.json().id, 17);
  });
});

test('large bodies still get their replies', async () => {
  await withDir(async (dir, track) => {
    const { port } = await start(dir, track, 'data.json');
    const big = Buffer.alloc(2 * 1024 * 1024, 'a');
    assertJsonError(await request(port, {
      method: 'POST', path: '/api/bookings', headers: { 'Content-Type': 'text/plain' }, body: big,
    }), 415, MSG.type);
    assertJsonError(await request(port, {
      method: 'POST', path: '/api/bookings', headers: JSON_HEADERS, body: big,
    }), 413, MSG.size);
    assertJsonError(await request(port, { method: 'POST', path: '/nope', body: big }), 404, MSG.notFound);
    assertJsonError(await request(port, { method: 'PUT', path: '/api/rooms', body: big }), 405, MSG.method);
    assertJsonError(await request(port, { method: 'DELETE', path: '/api/bookings/1', body: big }), 404, MSG.bookingNotFound);

    const chunk = Buffer.alloc(64 * 1024, 'b');
    const chunks = Array.from({ length: 16 }, () => chunk);
    assertJsonError(await request(port, {
      method: 'POST', path: '/api/bookings', headers: JSON_HEADERS, body: chunks,
    }), 413, MSG.size);
  });
});

test('the server survives a client that aborts mid-body', async () => {
  await withDir(async (dir, track) => {
    const server = await start(dir, track, 'data.json');
    const clientError = await new Promise((resolve) => {
      let caught;
      const abortedRequest = httpRequest({
        host: '127.0.0.1', port: server.port, method: 'POST', path: '/api/bookings',
        headers: { 'Content-Type': 'application/json', 'Content-Length': 100000 }, agent: false,
      });
      // Aborting the request is the point of this test, so a client-side error is expected here.
      abortedRequest.on('error', (error) => { caught = error; });
      abortedRequest.on('close', () => resolve(caught));
      abortedRequest.write('0123456789', () => abortedRequest.destroy());
    });
    if (clientError !== undefined) assert.ok(ABORT_ERROR_CODES.includes(clientError.code), `unexpected client error: ${clientError.code}`);
    const reply = await request(server.port, { path: '/api/rooms' });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.json(), { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
    assert.equal(server.isRunning(), true);
  });
});
