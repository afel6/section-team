// Shared helpers for the server tests: spawn server.mjs, send raw HTTP requests.
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SERVER = path.join(ROOT, 'server.mjs');
const LISTEN_LINE = /^listening on http:\/\/127\.0\.0\.1:(\d+)\n$/;

/** A fresh empty temp folder; the caller removes it (use tmp(t) for automatic cleanup). */
export function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rooms-test-'));
}

/** process.env without PORT/DATA_FILE, then `env` applied (an undefined value removes the key). */
function buildEnv(env) {
  const base = { ...process.env };
  delete base.PORT;
  delete base.DATA_FILE;
  const merged = { ...base, ...env };
  return Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined));
}

function spawnServer({ env = {}, cwd = ROOT } = {}) {
  const child = spawn(process.execPath, [SERVER], { cwd, env: buildEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
  const out = { stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8').on('data', (d) => { out.stdout += d; });
  child.stderr.setEncoding('utf8').on('data', (d) => { out.stderr += d; });
  const exited = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
  return { child, out, exited };
}

/** Runs the server expecting it to exit by itself; resolves { code, stdout, stderr }. */
export async function runToExit({ env, cwd, timeoutMs = 5000 } = {}) {
  const { child, out, exited } = spawnServer({ env, cwd });
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  const { code, signal } = await exited;
  clearTimeout(timer);
  return { code, signal, stdout: out.stdout, stderr: out.stderr };
}

/**
 * Starts the server (PORT=0 unless given) and waits for its listening line.
 * Returns { port, child, stdout(), stderr(), stop() }; stop() kills it and resolves on exit.
 */
export async function startServer({ env = {}, cwd } = {}) {
  const { child, out, exited } = spawnServer({ env: { PORT: '0', ...env }, cwd });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`server did not start: ${out.stderr}`));
    }, 5000);
    const onData = () => {
      const match = LISTEN_LINE.exec(out.stdout);
      if (match) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        resolve(Number(match[1]));
      }
    };
    child.stdout.on('data', onData);
    exited.then(({ code }) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (code ${code}): ${out.stderr}`));
    });
  });
  return {
    port,
    child,
    stdout: () => out.stdout,
    stderr: () => out.stderr,
    exited,
    stop: async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      return exited;
    },
  };
}

/**
 * Sends one request with the request target written exactly as `target`.
 * `body` may be a string or Buffer. Resolves { status, headers, raw (Buffer), text, json }.
 * `json` is the parsed body, or undefined when the body is empty or not JSON.
 */
export function request(port, { method = 'GET', target = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: target, headers, agent: false });
    req.on('error', reject);
    req.on('response', (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const text = raw.toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch { json = undefined; }
        resolve({ status: res.statusCode, headers: res.headers, raw, text, json });
      });
    });
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export const JSON_CT = 'application/json; charset=utf-8';

/** POSTs a booking object as JSON with `Content-Type: application/json`. */
export function postBooking(port, booking, headers = { 'Content-Type': 'application/json' }) {
  return request(port, { method: 'POST', target: '/api/bookings', headers, body: JSON.stringify(booking) });
}

export const FIXTURE_BOOKING = { id: 2, room: 'Aurora', title: 'T', date: '2026-11-03', start: '09:00', end: '10:00' };
export const FIXTURE = JSON.stringify({ nextId: 5, bookings: [FIXTURE_BOOKING] });

/** A temp folder removed automatically after the test `t`. */
export function tmp(t) {
  const dir = makeTempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export const listeningLine = (port) => `listening on http://127.0.0.1:${port}\n`;

function parseRawReply(buf) {
  const split = buf.indexOf('\r\n\r\n');
  if (split < 0) throw new Error(`no header end in reply: ${JSON.stringify(buf.toString('latin1'))}`);
  const [statusLine, ...lines] = buf.subarray(0, split).toString('latin1').split('\r\n');
  const match = /^HTTP\/1\.[01] (\d{3}) /.exec(statusLine);
  if (!match) throw new Error(`bad status line: ${JSON.stringify(statusLine)}`);
  const headers = {};
  for (const line of lines) {
    const i = line.indexOf(':');
    headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
  }
  return { status: Number(match[1]), headers, body: buf.subarray(split + 4).toString('utf8') };
}

/**
 * Writes `bytes` to a raw TCP socket and reads the reply until the server closes it.
 * Resolves { status, headers (lower-cased names), body (string) }.
 */
export function rawRequest(port, bytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const socket = net.connect(port, '127.0.0.1', () => socket.write(bytes));
    socket.on('data', (c) => chunks.push(c));
    socket.on('error', reject);
    socket.on('close', () => {
      try { resolve(parseRawReply(Buffer.concat(chunks))); } catch (err) { reject(err); }
    });
  });
}

/** A valid booking body; override fields as needed. */
export function booking(overrides = {}) {
  return { room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00', ...overrides };
}
