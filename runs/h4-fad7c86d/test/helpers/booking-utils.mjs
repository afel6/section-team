// Helpers shared by the POST /api/bookings tests.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startServer, makeTempDir, request, postBooking, booking, JSON_CT } from './server.mjs';

export const CT_JSON = { 'Content-Type': 'application/json' };
export const BOOKING_KEYS = ['date', 'end', 'id', 'room', 'start', 'title'];

/** Starts a server with its own temp data file; returns { port, close }. */
export async function setup() {
  const dir = makeTempDir();
  const srv = await startServer({ env: { DATA_FILE: path.join(dir, 'data.json') } });
  return {
    port: srv.port,
    close: async () => {
      await srv.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

let dateCounter = 0;
/** A new valid date on every call, so bookings of different tests never overlap. */
export function nextDate() {
  dateCounter += 1;
  return new Date(Date.UTC(2030, 0, 1 + dateCounter)).toISOString().slice(0, 10);
}

/** A valid booking body on a date no other call has used. */
export function freshBooking(overrides = {}) {
  return booking({ date: nextDate(), ...overrides });
}

export function assertError(res, status, message) {
  assert.equal(res.status, status);
  assert.deepEqual(res.json, { error: message });
  assert.equal(res.headers['content-type'], JSON_CT);
}

/** Asserts a 201 reply whose body is the sent booking (minus nothing) plus an id. */
export function assertCreated(res, sent, expectedOverrides = {}) {
  assert.equal(res.status, 201);
  assert.equal(res.headers['content-type'], JSON_CT);
  assert.equal(typeof res.json.id, 'number');
  const { id, ...rest } = res.json;
  assert.deepEqual(Object.keys(res.json).sort(), BOOKING_KEYS);
  const { room, title, date, start, end } = { ...sent, ...expectedOverrides };
  assert.deepEqual(rest, { room, title, date, start, end });
  return id;
}

/** POSTs raw body (string or Buffer) with the given headers. */
export function postRaw(port, body, headers = CT_JSON) {
  return request(port, { method: 'POST', target: '/api/bookings', headers, body });
}

/** JSON of `obj` padded with trailing spaces to exactly `bytes` bytes. */
export function paddedBody(obj, bytes) {
  const json = JSON.stringify(obj);
  const pad = bytes - Buffer.byteLength(json);
  assert.ok(pad >= 0, 'object larger than requested size');
  return json + ' '.repeat(pad);
}

export { request, postBooking, booking, JSON_CT };
