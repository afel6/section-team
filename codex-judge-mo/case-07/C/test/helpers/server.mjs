// Test helpers: spawn server.mjs as a child process, talk HTTP to it, clean up after.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

export const SERVER_PATH = fileURLToPath(new URL('../../server.mjs', import.meta.url));
export const JSON_TYPE = 'application/json; charset=utf-8';
const START_TIMEOUT_MS = 5000;
const STRIPPED_ENV = ['PORT', 'DATA_FILE', 'NODE_TEST_CONTEXT', 'NODE_OPTIONS'];

function baseEnv(extra) {
  const env = { ...process.env };
  for (const key of STRIPPED_ENV) delete env[key];
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

/** Creates a fresh temp folder; returns its path. Remove it with removeDir. */
export function makeTempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'booking-test-'));
}

export function removeDir(dir) {
  return rm(dir, { recursive: true, force: true });
}

/** Runs fn(dir) in a fresh temp folder and removes the folder afterwards. */
export async function withTemp(fn) {
  const dir = await makeTempDir();
  try {
    return await fn(dir);
  } finally {
    await removeDir(dir);
  }
}

let dateCounter = 0;
/**
 * A valid date (days 1-28) not handed out before in this process, so tests never overlap.
 * Starts in `baseYear`; the counter is shared by every caller in the process.
 */
export function uniqueDate(baseYear = 2060) {
  const n = dateCounter++;
  const year = baseYear + Math.floor(n / 336);
  const month = Math.floor((n % 336) / 28) + 1;
  const day = (n % 28) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Asserts an error reply: exact status, exact `{ error }` body and the JSON content type. */
export function expectError(res, status, message) {
  assert.equal(res.status, status);
  assert.deepEqual(res.json(), { error: message });
  assert.equal(res.headers['content-type'], JSON_TYPE);
}

function spawnServer({ env = {}, cwd, serverPath = SERVER_PATH }) {
  const child = spawn(process.execPath, [serverPath], {
    cwd, env: baseEnv(env), stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = { stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8').on('data', (s) => { output.stdout += s; });
  child.stderr.setEncoding('utf8').on('data', (s) => { output.stderr += s; });
  const exited = new Promise((resolve) => {
    child.on('close', (code, signal) => resolve({ code, signal }));
  });
  return { child, output, exited };
}

/** Runs the server expecting it to exit by itself; resolves { code, stdout, stderr }. */
export async function runToExit({ env = {}, cwd, serverPath, timeoutMs = START_TIMEOUT_MS }) {
  const { child, output, exited } = spawnServer({ env, cwd, serverPath });
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  const { code, signal } = await exited;
  clearTimeout(timer);
  return { code, signal, stdout: output.stdout, stderr: output.stderr };
}

/**
 * Starts the server and waits for its "listening" line.
 * Resolves { port, output, stop() }; stop() kills it and resolves { code, signal }.
 * Rejects (after killing the child) when the server exits or stays silent.
 */
export async function startServer({ env = {}, cwd, serverPath } = {}) {
  const proc = spawnServer({ env: { PORT: '0', ...env }, cwd, serverPath });
  const stop = async () => {
    if (proc.child.exitCode === null && proc.child.signalCode === null) proc.child.kill('SIGKILL');
    return proc.exited;
  };
  try {
    const port = await waitForListening(proc);
    return { port, output: proc.output, stop, exited: proc.exited };
  } catch (err) {
    await stop();
    throw err;
  }
}

function waitForListening({ child, output, exited }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${output.stderr}`)), START_TIMEOUT_MS);
    const onData = () => {
      const match = /^listening on http:\/\/127\.0\.0\.1:(\d+)\n/.exec(output.stdout);
      if (!match) return;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      resolve(Number(match[1]));
    };
    child.stdout.on('data', onData);
    exited.then(({ code }) => {
      clearTimeout(timer);
      reject(new Error(`server exited with ${code}: ${output.stderr}`));
    });
  });
}

/**
 * Sends one HTTP request with the path exactly as given (no normalisation).
 * Resolves { status, headers, body: Buffer, text, json() }.
 */
export function request(port, { method = 'GET', path: target = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: target, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body: buffer, text, json: () => JSON.parse(text) });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** Sends a POST /api/bookings with a JSON content type; `body` may be an object, string or Buffer. */
export function postBooking(port, body, headers = { 'Content-Type': 'application/json' }) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  return request(port, { method: 'POST', path: '/api/bookings', headers, body: payload });
}

/**
 * Writes raw bytes to the server and resolves with everything it sends until it closes.
 * The socket is not half-closed (Node drops replies to half-closed requests that answer
 * asynchronously), so the data must end with a request carrying `Connection: close`.
 */
export function rawRequest(port, data, timeoutMs = START_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    const chunks = [];
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(Buffer.concat(chunks).toString('latin1'));
    }, timeoutMs);
    socket.on('data', (c) => chunks.push(c));
    socket.on('error', (err) => { clearTimeout(timer); reject(err); });
    socket.on('close', () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString('latin1')); });
    socket.write(data);
  });
}

/**
 * Starts one server in a fresh temp folder for a suite.
 * Returns an object whose fields (`port`, `dir`, `dataFile`, `server`) are filled by `before`.
 * Usage: const ctx = useServer({ before, after });
 */
export function useServer({ before, after }, { dataFileName = 'data.json', env = {} } = {}) {
  const ctx = { port: 0, dir: '', dataFile: '', server: null };
  before(async () => {
    ctx.dir = await makeTempDir();
    ctx.dataFile = path.join(ctx.dir, dataFileName);
    ctx.server = await startServer({ env: { DATA_FILE: ctx.dataFile, ...env }, cwd: ctx.dir });
    ctx.port = ctx.server.port;
  });
  after(async () => {
    if (ctx.server) await ctx.server.stop();
    if (ctx.dir) await removeDir(ctx.dir);
  });
  return ctx;
}

export const VALID_BOOKING = Object.freeze({
  room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00',
});
