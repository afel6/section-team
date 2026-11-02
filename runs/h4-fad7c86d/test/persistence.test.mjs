// Persistence, save failures, concurrency and body draining of server.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  startServer, request, postBooking, booking, FIXTURE, FIXTURE_BOOKING, tmp, listeningLine,
} from './helpers/server.mjs';
import { assertError } from './helpers/booking-utils.mjs';

async function launch(t, dataFile) {
  const srv = await startServer({ env: { DATA_FILE: dataFile } });
  t.after(() => srv.stop());
  return srv;
}

const readSaved = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const getBookings = async (port) => (await request(port, { target: '/api/bookings' })).json.bookings;
const del = (port, id) => request(port, { method: 'DELETE', target: `/api/bookings/${id}` });
const at = (i) => booking({ start: `${String(8 + i).padStart(2, '0')}:00`, end: `${String(9 + i).padStart(2, '0')}:00` });

// ---- save before reply, restart ----

test('a change is on disk when the reply arrives', async (t) => {
  const file = path.join(tmp(t), 'd.json');
  const srv = await launch(t, file);
  const post = await postBooking(srv.port, booking());
  assert.equal(post.status, 201);
  assert.ok(readSaved(file).bookings.some((b) => b.id === post.json.id));
  const res = await del(srv.port, post.json.id);
  assert.equal(res.status, 204);
  assert.equal(readSaved(file).bookings.some((b) => b.id === post.json.id), false);
});

test('restart keeps bookings and does not reuse the last deleted id', async (t) => {
  const file = path.join(tmp(t), 'd.json');
  const first = await startServer({ env: { DATA_FILE: file } });
  t.after(() => first.stop());
  for (let i = 0; i < 3; i += 1) assert.equal((await postBooking(first.port, at(i))).status, 201);
  assert.equal((await del(first.port, 3)).status, 204);
  const before = await getBookings(first.port);
  await first.stop();
  const second = await launch(t, file);
  const after = await getBookings(second.port);
  assert.deepEqual(after, before);
  assert.deepEqual(after.map((b) => b.id), [1, 2]);
  const post = await postBooking(second.port, at(5));
  assert.equal(post.json.id, 4);
});

test('deleting everything then restarting continues the ids', async (t) => {
  const file = path.join(tmp(t), 'd.json');
  const first = await startServer({ env: { DATA_FILE: file } });
  t.after(() => first.stop());
  await postBooking(first.port, at(0));
  await postBooking(first.port, at(1));
  await del(first.port, 1);
  await del(first.port, 2);
  await first.stop();
  const second = await launch(t, file);
  assert.deepEqual(await getBookings(second.port), []);
  assert.equal((await postBooking(second.port, at(0))).json.id, 3);
});

test('external edits are not noticed', async (t) => {
  const file = path.join(tmp(t), 'd.json');
  fs.writeFileSync(file, FIXTURE);
  const srv = await launch(t, file);
  fs.writeFileSync(file, 'garbage');
  assert.deepEqual(await getBookings(srv.port), [FIXTURE_BOOKING]);
  fs.writeFileSync(file, JSON.stringify({ nextId: 9, bookings: [] }));
  assert.deepEqual(await getBookings(srv.port), [FIXTURE_BOOKING]);
});

// ---- save failures ----

test('POST save failure replies 500, changes nothing and keeps running', async (t) => {
  const dir = tmp(t);
  const folder = path.join(dir, 'missing');
  const srv = await launch(t, path.join(folder, 'data.json'));
  const res = await postBooking(srv.port, booking());
  assertError(res, 500, 'internal error');
  assert.deepEqual(await getBookings(srv.port), []);
  assert.equal(fs.existsSync(folder), false);
  assert.equal(srv.child.exitCode, null);
  fs.mkdirSync(folder);
  const ok = await postBooking(srv.port, booking());
  assert.equal(ok.status, 201);
  assert.equal(ok.json.id, 1);
  assert.equal(srv.stdout(), listeningLine(srv.port));
});

test('DELETE and POST save failures change nothing, ids unchanged', async (t) => {
  const dir = tmp(t);
  const folder = path.join(dir, 'd');
  const moved = path.join(dir, 'e');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'data.json'), FIXTURE);
  const srv = await launch(t, path.join(folder, 'data.json'));
  fs.renameSync(folder, moved);
  const res = await del(srv.port, 2);
  assertError(res, 500, 'internal error');
  assert.deepEqual(await getBookings(srv.port), [FIXTURE_BOOKING]);
  const post = await postBooking(srv.port, at(3));
  assertError(post, 500, 'internal error');
  fs.renameSync(moved, folder);
  const ok = await postBooking(srv.port, at(3));
  assert.equal(ok.status, 201);
  assert.equal(ok.json.id, 5);
  assert.equal(srv.child.exitCode, null);
  assert.equal(srv.stdout(), listeningLine(srv.port));
});

// ---- concurrency ----

const spread = (i) => booking({ date: `2026-12-${String(i + 1).padStart(2, '0')}` });

test('concurrent requests behave as if handled one at a time', async (t) => {
  const file = path.join(tmp(t), 'd.json');
  const srv = await launch(t, file);
  const same = await Promise.all(Array.from({ length: 10 }, () => postBooking(srv.port, booking())));
  assert.equal(same.filter((r) => r.status === 201).length, 1);
  const conflicts = same.filter((r) => r.status === 409);
  assert.equal(conflicts.length, 9);
  for (const r of conflicts) assert.deepEqual(r.json, { error: 'room is already booked from 09:00 to 10:00' });

  const many = await Promise.all(Array.from({ length: 10 }, (_, i) => postBooking(srv.port, spread(i))));
  assert.ok(many.every((r) => r.status === 201));
  const ids = many.map((r) => r.json.id).sort((a, b) => a - b);
  assert.deepEqual(ids, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const all = await getBookings(srv.port);
  assert.equal(all.length, 11);
  assert.equal(new Set(all.map((b) => b.id)).size, 11);

  const dels = await Promise.all(Array.from({ length: 5 }, () => del(srv.port, 5)));
  assert.equal(dels.filter((r) => r.status === 204).length, 1);
  const missing = dels.filter((r) => r.status === 404);
  assert.equal(missing.length, 4);
  for (const r of missing) assert.deepEqual(r.json, { error: 'booking not found' });
  assert.equal(srv.stdout(), listeningLine(srv.port));
});

// ---- big bodies ----

function sendChunked(port, headers, chunkCount, chunkSize) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/bookings', headers, agent: false });
    req.on('error', reject);
    req.on('response', (res) => {
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('error', reject);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(parts).toString('utf8')) });
        } catch (err) {
          reject(err);
        }
      });
    });
    const chunks = Array.from({ length: chunkCount }, () => Buffer.alloc(chunkSize, 0x61));
    Readable.from(chunks).pipe(req);
  });
}

test('413 and 415 replies reach the client after big bodies', async (t) => {
  const srv = await launch(t, path.join(tmp(t), 'd.json'));
  const big = Buffer.alloc(2_000_000, 0x61);
  const tooLarge = await request(srv.port, { method: 'POST', target: '/api/bookings', headers: { 'Content-Type': 'application/json' }, body: big });
  assert.equal(tooLarge.status, 413);
  assert.deepEqual(tooLarge.json, { error: 'body too large' });
  const wrongType = await request(srv.port, { method: 'POST', target: '/api/bookings', headers: { 'Content-Type': 'text/plain' }, body: big });
  assert.equal(wrongType.status, 415);
  assert.deepEqual(wrongType.json, { error: 'content type must be application/json' });

  const chunkedLarge = await sendChunked(srv.port, { 'Content-Type': 'application/json' }, 200, 10000);
  assert.equal(chunkedLarge.status, 413);
  assert.deepEqual(chunkedLarge.json, { error: 'body too large' });
  const chunkedType = await sendChunked(srv.port, { 'Content-Type': 'text/plain' }, 200, 10000);
  assert.equal(chunkedType.status, 415);
  assert.deepEqual(chunkedType.json, { error: 'content type must be application/json' });

  const body = Buffer.alloc(1_000_000, 0x61);
  const rooms = await request(srv.port, { target: '/api/rooms', headers: { 'Content-Length': String(body.length) }, body });
  assert.equal(rooms.status, 200);
  assert.deepEqual(rooms.json, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
  assert.equal(srv.child.exitCode, null);
  assert.equal((await postBooking(srv.port, booking())).status, 201);
  assert.equal(srv.stdout(), listeningLine(srv.port));
});
