// Fixtures shared by the server test files: base booking, headers, server lifecycle, assertions.
import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { makeTempDir, removeDir, startServer, request, postBooking, JSON_TYPE } from './harness.mjs';

export const BASE_BOOKING = Object.freeze({
  room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00',
});
export const JSON_HEADERS = Object.freeze({ 'Content-Type': 'application/json' });
export const ROOM_NAMES = Object.freeze(['Aurora', 'Borealis', 'Cosmos']);

// Registers before/after hooks that start one server per describe block and clean up after it.
// Fills ctx.dir, ctx.srv and ctx.port.
export function useServer(ctx) {
  before(async () => {
    ctx.dir = await makeTempDir();
    ctx.srv = await startServer({ cwd: ctx.dir, env: { DATA_FILE: join(ctx.dir, 'data.json') } });
    ctx.port = ctx.srv.port;
  });
  after(async () => {
    if (ctx.srv) await ctx.srv.stop();
    if (ctx.dir) await removeDir(ctx.dir);
  });
}

export function expectError(res, status, message) {
  assert.equal(res.status, status);
  assert.equal(res.headers['content-type'], JSON_TYPE);
  assert.deepEqual(res.json(), { error: message });
}

// GET /api/bookings (with an optional query such as '?date=2026-11-03'); asserts a 200.
export async function listAll(port, query = '') {
  const res = await request(port, { path: `/api/bookings${query}` });
  assert.equal(res.status, 200);
  return res.json().bookings;
}

// POSTs one booking (BASE_BOOKING plus overrides) and asserts a 201; resolves the new booking.
export async function postOk(port, over = {}) {
  const res = await postBooking(port, { ...BASE_BOOKING, ...over });
  assert.equal(res.status, 201);
  return res.json();
}

// POSTs several bookings in order; resolves the created bookings.
export async function seedBookings(port, items) {
  const made = [];
  for (const item of items) made.push(await postOk(port, item));
  return made;
}
