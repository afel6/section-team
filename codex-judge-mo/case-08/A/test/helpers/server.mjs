// Test helpers: start server.mjs as a child process and talk HTTP to it.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { connect, createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SERVER = join(ROOT, 'server.mjs');
export const LISTEN_RE = /^listening on http:\/\/127\.0\.0\.1:(\d+)\n$/;
export const JSON_TYPE = 'application/json; charset=utf-8';
export const JSON_HEADERS = Object.freeze({ 'Content-Type': 'application/json' });
const EXIT_TIMEOUT_MS = 5000;
const LISTEN_TIMEOUT_MS = 10000;
const REQUEST_TIMEOUT_MS = 15000;

/** Every error message the spec names, exactly. */
export const MSG = Object.freeze({
  internal: 'internal error',
  notFound: 'not found',
  method: 'method not allowed',
  bookingNotFound: 'booking not found',
  contentType: 'content type must be application/json',
  tooLarge: 'body too large',
  notObject: 'body must be a JSON object',
  room: 'room must be one of Aurora, Borealis, Cosmos',
  title: 'title must be 1 to 80 characters',
  date: 'date must be a valid YYYY-MM-DD date',
  start: 'start must be HH:MM',
  end: 'end must be HH:MM',
  order: 'end must be after start',
});

/** Asserts an error reply: exact status, body exactly {error}, exact JSON content type. */
export function expectError(res, status, error) {
  assert.strictEqual(res.status, status, res.text);
  assert.deepStrictEqual(res.json, { error });
  assert.strictEqual(res.headers['content-type'], JSON_TYPE);
}

let dateCounter = 0;
/** A date no earlier call returned (2040-01-02 onwards), so accepted bookings never overlap. */
export function uniqueDate() {
  dateCounter += 1;
  const month = String(1 + Math.floor(dateCounter / 28)).padStart(2, '0');
  const day = String(1 + (dateCounter % 28)).padStart(2, '0');
  return `2040-${month}-${day}`;
}

/** Resolves true/false for an existing/missing path; rethrows any error other than ENOENT. */
export async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

/** Runs fn(dir) with a fresh tmp dir that is always removed. */
export async function withTmpDir(fn) {
  const dir = await makeTmpDir();
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Starts a server (see startServer), runs fn(server), always stops it. */
export async function withServer(opts, fn) {
  const server = await startServer(opts);
  try {
    return await fn(server);
  } finally {
    await server.stop();
  }
}

/** A valid booking body; override any field. */
export const booking = (overrides = {}) => ({
  room: 'Aurora',
  title: 'Standup',
  date: '2026-11-03',
  start: '09:00',
  end: '10:00',
  ...overrides,
});

export const makeTmpDir = () => mkdtemp(join(tmpdir(), 'rooms-test-'));

/** Writes a data file in the server's layout. */
export const writeStore = (path, bookings = [], nextId = bookings.length + 1) =>
  writeFile(path, JSON.stringify({ nextId, bookings }));

/** Environment without the caller's PORT / DATA_FILE; `undefined` values mean unset. */
function buildEnv(env) {
  const base = { ...process.env };
  delete base.PORT;
  delete base.DATA_FILE;
  const merged = { ...base, ...env };
  return Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined));
}

/** Spawns the server. Returns a handle with live stdout/stderr text and an exit promise. */
export function spawnServer({ cwd, env = {}, script = SERVER }) {
  const child = spawn(process.execPath, [script], { cwd, env: buildEnv(env) });
  const out = { stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8').on('data', (d) => (out.stdout += d));
  child.stderr.setEncoding('utf8').on('data', (d) => (out.stderr += d));
  const exited = new Promise((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  return {
    child,
    exited,
    stdout: () => out.stdout,
    stderr: () => out.stderr,
  };
}

/** Runs the server until it exits by itself; fails if it is still running after the timeout. */
export async function runToExit(opts, timeoutMs = EXIT_TIMEOUT_MS) {
  const handle = spawnServer(opts);
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  const result = await Promise.race([handle.exited, timeout]);
  clearTimeout(timer);
  if (result === 'timeout') {
    handle.child.kill('SIGKILL');
    await handle.exited;
    throw new Error(`server did not exit; stdout=${JSON.stringify(handle.stdout())}`);
  }
  return { code: result.code, signal: result.signal, stdout: handle.stdout(), stderr: handle.stderr() };
}

/**
 * Starts the server (PORT=0 unless given) and waits for the listening line.
 * Returns { port, stop(), stdout(), stderr(), child }.
 */
export async function startServer({ cwd, env = {}, script }) {
  const handle = spawnServer({ cwd, env: { PORT: '0', ...env }, script });
  const stop = async () => {
    if (handle.child.exitCode === null && handle.child.signalCode === null) {
      handle.child.kill();
    }
    await handle.exited;
  };
  let timer;
  try {
    const port = await new Promise((resolve, reject) => {
      handle.child.stdout.on('data', () => {
        const match = LISTEN_RE.exec(handle.stdout());
        if (match) resolve(Number(match[1]));
      });
      handle.exited.then(({ code }) =>
        reject(new Error(`server exited (${code}) before listening: ${handle.stderr()}`)),
      );
      timer = setTimeout(() => reject(new Error('server did not print its listening line')), LISTEN_TIMEOUT_MS);
    });
    return { ...handle, port, stop };
  } catch (err) {
    await stop();
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One HTTP request with a raw path (sent as given, nothing normalised).
 * `chunks` (an array of strings/Buffers) sends the body in several writes instead of `body`.
 * Resolves to { status, headers, text, json } (json is undefined when the body is not JSON).
 */
export function request(port, { method = 'GET', path = '/', headers = {}, body, chunks } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, method, path, headers, agent: false, timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`no reply to ${method} ${path}`)));
    for (const chunk of chunks ?? []) req.write(chunk);
    req.end(body);
  });
}

/** POST /api/bookings with a JSON body (object, or a raw string/Buffer). */
export function postBooking(port, value, headers = JSON_HEADERS) {
  const body = typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value);
  return request(port, { method: 'POST', path: '/api/bookings', headers, body });
}

export const getBookings = async (port, query = '') =>
  (await request(port, { path: `/api/bookings${query}` })).json.bookings;

/**
 * Writes raw bytes to a socket and resolves to everything the server sent back
 * once it closes the connection (send `Connection: close`).
 */
export function rawRequest(port, data) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    socket.setTimeout(REQUEST_TIMEOUT_MS, () => socket.destroy(new Error('raw request got no full reply')));
    const chunks = [];
    socket.on('data', (c) => chunks.push(c));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    socket.on('error', reject);
    socket.write(data);
  });
}

/** Opens a socket and returns it plus a getter for the bytes received so far. */
export function openSocket(port) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => resolve({ socket, received: () => text }));
    let text = '';
    socket.setTimeout(REQUEST_TIMEOUT_MS, () => socket.destroy(new Error('socket got no reply in time')));
    socket.setEncoding('utf8');
    socket.on('data', (d) => (text += d));
    socket.on('error', reject);
  });
}

/** Resolves true when 127.0.0.1:<port> can be bound right now. */
export function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = createNetServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

/** Binds a port (0 = any) on 127.0.0.1 and returns { port, close() }. */
export function occupyPort(port = 0) {
  return new Promise((resolve, reject) => {
    const blocker = createNetServer();
    blocker.once('error', reject);
    blocker.listen(port, '127.0.0.1', () =>
      resolve({
        port: blocker.address().port,
        close: () => new Promise((done) => blocker.close(() => done())),
      }),
    );
  });
}

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
