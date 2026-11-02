// Test harness: spawns `node server.mjs` as a child process and talks to it over raw HTTP.
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_PATH = fileURLToPath(new URL('../../server.mjs', import.meta.url));
export const JSON_TYPE = 'application/json; charset=utf-8';
const START_TIMEOUT_MS = 5000;
const EXIT_TIMEOUT_MS = 5000;

/** Creates a fresh temp directory; remove it with removeDir. */
export function makeTempDir() {
  return mkdtemp(join(tmpdir(), 'room-bookings-test-'));
}

export function removeDir(dir) {
  return rm(dir, { recursive: true, force: true });
}

/**
 * Builds the child env from the parent env without PORT, DATA_FILE and node:test variables,
 * then applies `env`. A value of `undefined` in `env` leaves the variable unset.
 */
function buildEnv(env) {
  const base = { ...process.env };
  for (const key of ['PORT', 'DATA_FILE', 'NODE_TEST_CONTEXT', 'NODE_OPTIONS']) delete base[key];
  const merged = { ...base, ...env };
  return Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined));
}

function spawnServer({ env = {}, cwd }) {
  if (!cwd) throw new Error('spawnServer needs a cwd (use a temp dir)');
  const child = spawn(process.execPath, [SERVER_PATH], { cwd, env: buildEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
  const output = { stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output.stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { output.stderr += chunk; });
  const closed = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
  return { child, output, closed };
}

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout: ${what}`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Runs the server and waits for it to exit (for startup-failure tests).
 * Resolves { code, signal, stdout, stderr }. Fails if it does not exit in time.
 */
export async function runUntilExit({ env = {}, cwd, timeoutMs = EXIT_TIMEOUT_MS } = {}) {
  const { child, output, closed } = spawnServer({ env, cwd });
  try {
    const { code, signal } = await withTimeout(closed, timeoutMs, 'server did not exit');
    return { code, signal, stdout: output.stdout, stderr: output.stderr };
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

/**
 * Starts the server and waits for its listening line.
 * Resolves { port, child, output, closed, isRunning(), stop() }. stop() kills it and waits.
 */
export async function startServer({ env = {}, cwd } = {}) {
  const { child, output, closed } = spawnServer({ env: { PORT: '0', ...env }, cwd });
  const listening = new Promise((resolve, reject) => {
    const check = () => {
      const match = /^listening on http:\/\/127\.0\.0\.1:(\d+)\n/.exec(output.stdout);
      if (match) resolve(Number(match[1]));
    };
    child.stdout.on('data', check);
    closed.then(({ code }) => reject(new Error(`server exited (${code}) before listening: ${output.stderr}`)));
  });
  let port;
  try {
    port = await withTimeout(listening, START_TIMEOUT_MS, 'server did not start');
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
  const isRunning = () => child.exitCode === null && child.signalCode === null;
  const stop = async () => {
    if (isRunning()) child.kill('SIGKILL');
    await closed;
  };
  return { port, child, output, closed, isRunning, stop };
}

/**
 * Sends one HTTP request (no agent, no keep-alive). `path` is sent as-is (no normalisation).
 * `body` may be a string, a Buffer, an array of chunks (sent chunked, no Content-Length) or undefined.
 * Resolves { status, headers, body: Buffer, text, json() }.
 */
export function request(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    // Node's client does not frame bodies of GET/DELETE/OPTIONS by itself; always send a Content-Length.
    const framed = body === undefined || Array.isArray(body) || hasHeader(headers, 'content-length')
      ? headers
      : { ...headers, 'Content-Length': String(Buffer.byteLength(body)) };
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: framed, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body: buffer, text, json: () => JSON.parse(text) });
      });
    });
    req.on('error', reject);
    if (Array.isArray(body)) {
      body.forEach((chunk) => req.write(chunk));
      req.end();
    } else {
      req.end(body);
    }
  });
}

function hasHeader(headers, name) {
  return Object.keys(headers).some((key) => key.toLowerCase() === name);
}

/**
 * Shorthand: POST a JSON value (or a raw string/Buffer) to /api/bookings.
 * Content-Type is application/json unless `contentType` is given; an explicit `contentType: undefined` sends none.
 */
export function postBooking(port, value, options = {}) {
  const { raw = false } = options;
  const contentType = Object.hasOwn(options, 'contentType') ? options.contentType : 'application/json';
  const body = raw ? value : JSON.stringify(value);
  const headers = contentType === undefined ? {} : { 'Content-Type': contentType };
  return request(port, { method: 'POST', path: '/api/bookings', headers, body });
}

/** Writes raw bytes on a TCP socket and resolves the full raw reply text (for non-ASCII targets). */
export function rawRequest(port, bytes) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.end(bytes));
    const chunks = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('error', reject);
    socket.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

/** A valid booking body; override fields as needed. */
export function validBooking(overrides = {}) {
  return { room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00', ...overrides };
}
