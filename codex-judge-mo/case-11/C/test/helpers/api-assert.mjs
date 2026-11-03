// Shared assertions, messages and fixtures for the server/API test files.
import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTempDir, removeDir, startServer, request, validBooking, JSON_TYPE } from './server-harness.mjs';

/** The booking reply's keys, sorted. */
export const SIX_KEYS = Object.freeze(['date', 'end', 'id', 'room', 'start', 'title']);
export const ROOMS = Object.freeze(['Aurora', 'Borealis', 'Cosmos']);

/** Every error message the spec names, verbatim. */
export const MSG = Object.freeze({
  type: 'content type must be application/json',
  size: 'body too large',
  object: 'body must be a JSON object',
  room: 'room must be one of Aurora, Borealis, Cosmos',
  title: 'title must be 1 to 80 characters',
  date: 'date must be a valid YYYY-MM-DD date',
  start: 'start must be HH:MM',
  end: 'end must be HH:MM',
  order: 'end must be after start',
  bookingNotFound: 'booking not found',
  notFound: 'not found',
  method: 'method not allowed',
  internal: 'internal error',
});

/** Exact JSON error reply: status, Content-Type and a body with only the `error` key. */
export function assertJsonError(res, status, message) {
  assert.equal(res.status, status);
  assert.equal(res.headers['content-type'], JSON_TYPE);
  assert.deepEqual(res.json(), { error: message });
}

/** Exact 201 reply: Content-Type, exactly the six keys, numeric id, and `expected` fields. Returns the booking. */
export function assertCreated(res, expected) {
  assert.equal(res.status, 201);
  assert.equal(res.headers['content-type'], JSON_TYPE);
  const body = res.json();
  assert.deepEqual(Object.keys(body).sort(), SIX_KEYS);
  assert.equal(typeof body.id, 'number');
  assert.deepEqual(body, { id: body.id, ...expected });
  return body;
}

/** GET /api/bookings (optional query string) and return the bookings array, asserting a 200 JSON reply. */
export async function listBookings(port, query = '') {
  const res = await request(port, { path: `/api/bookings${query}` });
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], JSON_TYPE);
  return res.json().bookings;
}

let dayCounter = 0;
/** A date (2030 onwards) no other test in this process has used. */
export function freshDate() {
  dayCounter += 1;
  return new Date(Date.UTC(2030, 0, 1 + dayCounter)).toISOString().slice(0, 10);
}

/** A valid booking body on a fresh date. */
export function freshBooking(overrides = {}) {
  return validBooking({ date: freshDate(), ...overrides });
}

/** A readable, unique-ish test label for a value: invisible characters are shown as \uXXXX escapes. */
export function label(value) {
  if (value === undefined) return '<missing>';
  return JSON.stringify(value).replace(/[^\x20-\x7e]/gu, (ch) => `\\u{${ch.codePointAt(0).toString(16)}}`);
}

/**
 * Registers before/after hooks in the current describe that start one server
 * (cwd = temp dir, DATA_FILE='data.json') and stop it. Returns a context whose
 * `port`, `server` and `dir` are set once the before hook ran.
 */
export function useServer() {
  const ctx = {};
  before(async () => {
    ctx.dir = await makeTempDir();
    ctx.server = await startServer({ cwd: ctx.dir, env: { DATA_FILE: 'data.json' } });
    ctx.port = ctx.server.port;
  });
  after(async () => {
    if (ctx.server) await ctx.server.stop();
    if (ctx.dir) await removeDir(ctx.dir);
  });
  return ctx;
}

/** Runs fn(dir) in a fresh temp dir and always removes it. */
export async function withTempDir(fn) {
  const dir = await makeTempDir();
  try {
    return await fn(dir);
  } finally {
    await removeDir(dir);
  }
}

/** Starts a server with `options`, runs fn(server) and always stops it. */
export async function withServer(options, fn) {
  const server = await startServer(options);
  try {
    return await fn(server);
  } finally {
    await server.stop();
  }
}
