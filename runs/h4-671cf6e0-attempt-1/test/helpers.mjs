// Shared helpers for the server tests: spawn server.mjs, send HTTP requests.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SERVER = path.join(ROOT, 'server.mjs');
export const JSON_CT = 'application/json; charset=utf-8';
const START_TIMEOUT_MS = 8000;

/** Creates a fresh temp folder; returns its absolute path. */
export function makeTempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'rooms-test-'));
}

export function removeDir(dir) {
  return rm(dir, { recursive: true, force: true });
}

/** process.env without PORT and DATA_FILE, plus `env` (a value of undefined removes the key). */
function buildEnv(env) {
  const base = { ...process.env };
  delete base.PORT;
  delete base.DATA_FILE;
  const merged = { ...base, ...env };
  return Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined));
}

function spawnServer({ env = {}, cwd = ROOT } = {}) {
  const proc = spawn(process.execPath, [SERVER], { cwd, env: buildEnv(env), stdio: 'pipe' });
  const out = { stdout: '', stderr: '' };
  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', (d) => { out.stdout += d; });
  proc.stderr.on('data', (d) => { out.stderr += d; });
  const exited = new Promise((resolve) => {
    proc.on('close', (code, signal) => resolve({ code, signal }));
  });
  return { proc, out, exited };
}

/**
 * Starts the server (PORT defaults to '0') and waits for its stdout line.
 * Resolves { port, proc, stdout(), stderr(), stop() }; stop() kills it and resolves when it is gone.
 * Rejects if the server exits before it prints a full line.
 */
export function startServer({ env = {}, cwd } = {}) {
  const { proc, out, exited } = spawnServer({ env: { PORT: '0', ...env }, cwd });
  const stop = async () => {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGTERM');
    return exited;
  };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stop(); reject(new Error(`no listen line; stderr=${out.stderr}`)); },
      START_TIMEOUT_MS);
    const onData = () => {
      if (!out.stdout.includes('\n')) return;
      clearTimeout(timer);
      proc.stdout.off('data', onData);
      const match = /:(\d+)\n/.exec(out.stdout);
      resolve({ port: match ? Number(match[1]) : NaN, proc,
        stdout: () => out.stdout, stderr: () => out.stderr, stop });
    };
    proc.stdout.on('data', onData);
    exited.then(({ code }) => {
      clearTimeout(timer);
      reject(new Error(`server exited with ${code}; stderr=${out.stderr}`));
    });
  });
}

/**
 * Runs the server expecting it to exit on its own (startup failure).
 * Resolves { code, stdout, stderr }. If it is still running after timeoutMs it is killed
 * and the result has code null and timedOut true.
 */
export async function runServerExpectExit({ env = {}, cwd, timeoutMs = START_TIMEOUT_MS } = {}) {
  const { proc, out, exited } = spawnServer({ env, cwd });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; proc.kill('SIGKILL'); }, timeoutMs);
  const { code } = await exited;
  clearTimeout(timer);
  return { code: timedOut ? null : code, timedOut, stdout: out.stdout, stderr: out.stderr };
}

/**
 * Sends one request with node:http (the path is sent as given, no normalisation).
 * `body` may be a string or Buffer. Resolves { status, headers, text, body (Buffer), json }.
 * `json` is the parsed body, or undefined when the body is not JSON.
 */
export function request(port, { method = 'GET', path: target = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: target, headers, agent: false },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const text = buf.toString('utf8');
          let json;
          try { json = JSON.parse(text); } catch { json = undefined; }
          resolve({ status: res.statusCode, headers: res.headers, text, body: buf, json });
        });
        res.on('error', reject);
      });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** POSTs `payload` as JSON to /api/bookings with Content-Type application/json. */
export function postBooking(port, payload, headers = { 'Content-Type': 'application/json' }) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return request(port, { method: 'POST', path: '/api/bookings', headers, body });
}

/** A valid booking body, with `overrides` applied. */
export function validBooking(overrides = {}) {
  return { room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00', ...overrides };
}

/**
 * Writes raw bytes on a fresh TCP connection and reads until the server closes it.
 * Include `Connection: close` in the request. Resolves { status, headers (lower-case keys), body (Buffer) }.
 */
export function rawRequest(port, bytes) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    const chunks = [];
    socket.on('data', (c) => chunks.push(c));
    socket.on('error', reject);
    socket.on('end', () => {
      socket.destroy();
      resolve(parseRawResponse(Buffer.concat(chunks)));
    });
    socket.write(bytes);
  });
}

function parseRawResponse(buf) {
  const split = buf.indexOf('\r\n\r\n');
  const head = buf.subarray(0, split).toString('latin1').split('\r\n');
  const status = Number(head[0].split(' ')[1]);
  const headers = {};
  for (const line of head.slice(1)) {
    const colon = line.indexOf(':');
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  const rest = buf.subarray(split + 4);
  const len = headers['content-length'];
  const body = len === undefined ? rest : rest.subarray(0, Number(len));
  return { status, headers, body };
}

/** Asserts that `stderr` is exactly one line ending in "\n" and holds no stack trace. */
export function isSingleLine(stderr) {
  return /^[^\n]+\n$/.test(stderr) && !/\n\s+at /.test(stderr) && !stderr.includes('Error:');
}
