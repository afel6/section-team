// Persistence, save failures, no-write rules and concurrency of the booking server.
import assert from 'node:assert/strict';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  JSON_HEADERS,
  LISTEN_RE,
  MSG,
  booking,
  delay,
  exists,
  expectError,
  getBookings,
  postBooking,
  request,
  withServer,
  withTmpDir,
  writeStore,
} from './helpers/server.mjs';

const readStoreFile = async (path) => JSON.parse(await readFile(path, 'utf8'));
const del = (port, id) => request(port, { method: 'DELETE', path: `/api/bookings/${id}` });
const withId = (id, overrides = {}) => ({ id, ...booking(overrides) });

test('data file is saved before the reply to POST and DELETE', () =>
  withTmpDir(async (dir) => {
    const file = join(dir, 'data.json');
    await withServer({ cwd: dir, env: { DATA_FILE: file } }, async ({ port }) => {
      const created = await postBooking(port, booking());
      assert.strictEqual(created.status, 201);
      assert.deepStrictEqual(await readStoreFile(file), { nextId: 2, bookings: [withId(1)] });
      assert.strictEqual((await del(port, 1)).status, 204);
      assert.deepStrictEqual(await readStoreFile(file), { nextId: 2, bookings: [] });
    });
  }));

test('bookings and next id survive restarts, ids are never reused', () =>
  withTmpDir(async (dir) => {
    const file = join(dir, 'data.json');
    await withServer({ cwd: dir, env: { DATA_FILE: file } }, async ({ port }) => {
      for (const start of ['08:00', '09:00', '10:00']) {
        const end = `${String(Number(start.slice(0, 2)) + 1).padStart(2, '0')}:00`;
        await postBooking(port, booking({ start, end }));
      }
      assert.strictEqual((await del(port, 3)).status, 204);
      assert.strictEqual((await del(port, 1)).status, 204);
    });
    await withServer({ cwd: dir, env: { DATA_FILE: file } }, async ({ port }) => {
      assert.deepStrictEqual(await getBookings(port), [withId(2, { start: '09:00', end: '10:00' })]);
      const res = await postBooking(port, booking({ start: '11:00', end: '12:00' }));
      assert.strictEqual(res.json.id, 4);
      assert.strictEqual((await del(port, 4)).status, 204);
    });
    await withServer({ cwd: dir, env: { DATA_FILE: file } }, async ({ port }) => {
      const res = await postBooking(port, booking({ start: '13:00', end: '14:00' }));
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.json.id, 5);
    });
  }));

test('ids are not reused after a delete within one run', () =>
  withTmpDir(async (dir) => {
    await withServer({ cwd: dir, env: { DATA_FILE: join(dir, 'data.json') } }, async ({ port }) => {
      const a = await postBooking(port, booking({ start: '08:00', end: '09:00' }));
      const b = await postBooking(port, booking({ start: '09:00', end: '10:00' }));
      assert.deepStrictEqual([a.json.id, b.json.id], [1, 2]);
      assert.strictEqual((await del(port, 2)).status, 204);
      const c = await postBooking(port, booking({ start: '10:00', end: '11:00' }));
      assert.strictEqual(c.json.id, 3);
    });
  }));

test('outside changes to the data file are not noticed', () =>
  withTmpDir(async (dir) => {
    const file = join(dir, 'data.json');
    await writeStore(file, [withId(1)], 2);
    await withServer({ cwd: dir, env: { DATA_FILE: file } }, async ({ port }) => {
      await writeFile(file, 'garbage');
      assert.deepStrictEqual(await getBookings(port), [withId(1)]);
      const res = await postBooking(port, booking({ room: 'Cosmos' }));
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.json.id, 2);
      const saved = await readStoreFile(file);
      assert.strictEqual(saved.nextId, 3);
      assert.deepStrictEqual(saved.bookings, [withId(1), withId(2, { room: 'Cosmos' })]);
    });
  }));

test('a different valid store written from outside does not change the next id', () =>
  withTmpDir(async (dir) => {
    const file = join(dir, 'data.json');
    await writeStore(file, [withId(1)], 2);
    await withServer({ cwd: dir, env: { DATA_FILE: file } }, async ({ port }) => {
      await writeStore(file, [withId(7, { room: 'Borealis' })], 50);
      const res = await postBooking(port, booking({ room: 'Cosmos' }));
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.json.id, 2);
      assert.deepStrictEqual(await getBookings(port), [withId(1), withId(2, { room: 'Cosmos' })]);
    });
  }));

async function sendNonWritingRequests(port) {
  const big = JSON.stringify({ ...booking(), title: 'x'.repeat(10001 - 80) }).padEnd(10001, ' ');
  assert.strictEqual(Buffer.byteLength(big), 10001);
  const json = JSON_HEADERS;
  const sent = [
    { path: '/' },
    { path: '/app.js' },
    { path: '/api/rooms' },
    { path: '/api/bookings' },
    { path: '/api/bookings?date=2026-11-03' },
    { path: '/api/bookings?date=bad' },
    { path: '/nope' },
    { method: 'PUT', path: '/api/bookings' },
    { method: 'DELETE', path: '/api/bookings/99' },
    { method: 'DELETE', path: '/api/bookings/abc' },
    { method: 'DELETE', path: '/api/bookings/1/' },
    { method: 'POST', path: '/api/bookings', headers: json, body: '{not json' },
    { method: 'POST', path: '/api/bookings', headers: { 'Content-Type': 'text/plain' }, body: '{}' },
    { method: 'POST', path: '/api/bookings', headers: json, body: big },
    { method: 'POST', path: '/api/bookings', headers: json, body: JSON.stringify(booking()) },
  ];
  const statuses = [];
  for (const req of sent) statuses.push((await request(port, req)).status);
  return statuses;
}

test('requests that change nothing never write the data file', () =>
  withTmpDir(async (dir) => {
    const file = join(dir, 'data.json');
    await writeFile(file, JSON.stringify({ nextId: 2, bookings: [withId(1)] }, null, 2));
    const bytes = await readFile(file);
    const { mtimeMs } = await stat(file);
    await delay(20);
    await withServer({ cwd: dir, env: { DATA_FILE: file } }, async ({ port }) => {
      const statuses = await sendNonWritingRequests(port);
      assert.deepStrictEqual(statuses, [200, 200, 200, 200, 200, 400, 404, 405, 404, 404, 404, 400, 415, 413, 409]);
      await delay(100);
      assert.deepStrictEqual(await readFile(file), bytes);
      assert.strictEqual((await stat(file)).mtimeMs, mtimeMs);
      const res = await postBooking(port, booking({ room: 'Cosmos' }));
      assert.strictEqual(res.status, 201);
      assert.notDeepStrictEqual(await readFile(file), bytes);
    });
  }));

test('starting the server does not create the data file', () =>
  withTmpDir(async (dir) => {
    const file = join(dir, 'data.json');
    await withServer({ cwd: dir, env: { DATA_FILE: file } }, async ({ port }) => {
      await request(port, { path: '/api/bookings' });
      await delay(50);
      assert.strictEqual(await exists(file), false);
    });
  }));

test('failed save on POST gives 500, changes nothing and creates no folder', () =>
  withTmpDir(async (dir) => {
    const folder = join(dir, 'd');
    const file = join(folder, 'b.json');
    await withServer({ cwd: dir, env: { DATA_FILE: file } }, async (handle) => {
      const res = await postBooking(handle.port, booking());
      expectError(res, 500, MSG.internal);
      assert.deepStrictEqual(await getBookings(handle.port), []);
      assert.strictEqual(await exists(folder), false);
      assert.match(handle.stdout(), LISTEN_RE);
      await mkdir(folder);
      const ok = await postBooking(handle.port, booking());
      assert.strictEqual(ok.status, 201);
      assert.strictEqual(ok.json.id, 1);
      assert.deepStrictEqual(await readStoreFile(file), { nextId: 2, bookings: [withId(1)] });
    });
  }));

test('failed save on DELETE gives 500 and keeps the booking', () =>
  withTmpDir(async (dir) => {
    const folder = join(dir, 'd');
    const moved = join(dir, 'd2');
    const file = join(folder, 'b.json');
    await mkdir(folder);
    await writeStore(file, [withId(1)], 2);
    await withServer({ cwd: dir, env: { DATA_FILE: file } }, async ({ port }) => {
      await rename(folder, moved);
      expectError(await del(port, 1), 500, MSG.internal);
      assert.deepStrictEqual(await getBookings(port), [withId(1)]);
      expectError(await postBooking(port, booking({ room: 'Cosmos' })), 500, MSG.internal);
      await rename(moved, folder);
      const ok = await postBooking(port, booking({ room: 'Cosmos' }));
      assert.strictEqual(ok.status, 201);
      assert.strictEqual(ok.json.id, 2);
      assert.strictEqual((await del(port, 1)).status, 204);
      assert.deepStrictEqual(await readStoreFile(file), {
        nextId: 3,
        bookings: [withId(2, { room: 'Cosmos' })],
      });
    });
  }));

test('server keeps running after save failures', () =>
  withTmpDir(async (dir) => {
    const file = join(dir, 'missing', 'b.json');
    await withServer({ cwd: dir, env: { DATA_FILE: file } }, async (handle) => {
      for (let i = 0; i < 3; i += 1) {
        expectError(await postBooking(handle.port, booking()), 500, MSG.internal);
      }
      const rooms = await request(handle.port, { path: '/api/rooms' });
      assert.strictEqual(rooms.status, 200);
      assert.strictEqual(handle.child.exitCode, null);
      assert.strictEqual(handle.child.signalCode, null);
    });
  }));

const OVERLAPPING = [
  ['09:00', '10:00'], ['09:30', '10:30'], ['08:30', '09:45'], ['09:15', '09:45'],
  ['08:00', '12:00'], ['09:35', '09:50'], ['09:20', '10:15'], ['09:00', '09:45'],
  ['09:10', '11:00'], ['09:35', '09:45'], ['07:00', '10:00'], ['09:25', '13:00'],
];

test('concurrent overlapping POSTs create exactly one booking', () =>
  withTmpDir(async (dir) => {
    const file = join(dir, 'data.json');
    await withServer({ cwd: dir, env: { DATA_FILE: file } }, async ({ port }) => {
      const sent = OVERLAPPING.map(([start, end]) => booking({ start, end }));
      const results = await Promise.all(sent.map((b) => postBooking(port, b)));
      const winners = results.filter((r) => r.status === 201);
      assert.strictEqual(winners.length, 1);
      const win = winners[0].json;
      assert.strictEqual(win.id, 1);
      for (const r of results.filter((x) => x.status !== 201)) {
        assert.strictEqual(r.status, 409);
        assert.deepStrictEqual(r.json, {
          error: `room is already booked from ${win.start} to ${win.end}`,
        });
      }
      assert.deepStrictEqual(await getBookings(port), [win]);
      assert.deepStrictEqual(await readStoreFile(file), { nextId: 2, bookings: [win] });
    });
  }));

function distinctBookings() {
  const rooms = ['Aurora', 'Borealis', 'Cosmos'];
  const dates = ['2026-11-03', '2026-11-04'];
  const times = [['08:00', '09:00'], ['09:00', '10:00'], ['10:00', '11:00']];
  const all = [];
  for (const room of rooms) {
    for (const date of dates) {
      for (const [start, end] of times) all.push(booking({ room, date, start, end }));
    }
  }
  return all.slice(0, 15);
}

test('concurrent non-overlapping POSTs all succeed with distinct ids', () =>
  withTmpDir(async (dir) => {
    const file = join(dir, 'data.json');
    await withServer({ cwd: dir, env: { DATA_FILE: file } }, async ({ port }) => {
      const results = await Promise.all(distinctBookings().map((b) => postBooking(port, b)));
      assert.deepStrictEqual(results.map((r) => r.status), Array(15).fill(201));
      const ids = results.map((r) => r.json.id).sort((a, b) => a - b);
      assert.deepStrictEqual(ids, Array.from({ length: 15 }, (_, i) => i + 1));
      const saved = await readStoreFile(file);
      assert.strictEqual(saved.bookings.length, 15);
      assert.strictEqual(saved.nextId, 16);
    });
  }));

test('concurrent DELETE of the same id succeeds once', () =>
  withTmpDir(async (dir) => {
    const file = join(dir, 'data.json');
    await writeStore(file, [withId(1)], 2);
    await withServer({ cwd: dir, env: { DATA_FILE: file } }, async ({ port }) => {
      const results = await Promise.all([del(port, 1), del(port, 1)]);
      assert.deepStrictEqual(results.map((r) => r.status).sort(), [204, 404]);
      const missing = results.find((r) => r.status === 404);
      expectError(missing, 404, MSG.bookingNotFound);
    });
  }));

test('concurrent POSTs while saving fails all get 500, then ids start at 1', () =>
  withTmpDir(async (dir) => {
    const folder = join(dir, 'd');
    await withServer({ cwd: dir, env: { DATA_FILE: join(folder, 'b.json') } }, async ({ port }) => {
      const sent = distinctBookings().slice(0, 6);
      const results = await Promise.all(sent.map((b) => postBooking(port, b)));
      for (const r of results) expectError(r, 500, MSG.internal);
      assert.deepStrictEqual(await getBookings(port), []);
      await mkdir(folder);
      const ok = await postBooking(port, booking());
      assert.strictEqual(ok.status, 201);
      assert.strictEqual(ok.json.id, 1);
    });
  }));
