// Shared test helpers: spawn server.mjs as a child process and talk HTTP to it.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SERVER = path.join(ROOT, 'server.mjs');
export const LISTEN_RE = /^listening on http:\/\/127\.0\.0\.1:(\d+)\n$/;
const START_TIMEOUT_MS = 5000;

export async function makeTempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'bookings-test-'));
}

export async function removeDir(dir) {
  await rm(dir, { recursive: true, force: true });
}

// Builds the child env: inherited env without PORT/DATA_FILE, then `env`
// (a value of undefined leaves the variable unset).
function childEnv(env) {
  const merged = { ...process.env };
  delete merged.PORT;
  delete merged.DATA_FILE;
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

function spawnServer({ env = {}, cwd = ROOT } = {}) {
  const child = spawn(process.execPath, [SERVER], {
    cwd,
    env: childEnv(env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = { stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d) => { out.stdout += d; });
  child.stderr.on('data', (d) => { out.stderr += d; });
  const exited = new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });
  return { child, out, exited };
}

// Runs the server and expects it to exit by itself; returns { code, stdout, stderr }.
export async function runUntilExit(options) {
  const { child, out, exited } = spawnServer(options);
  const timer = setTimeout(() => child.kill('SIGKILL'), START_TIMEOUT_MS);
  const { code, signal } = await exited;
  clearTimeout(timer);
  return { code, signal, stdout: out.stdout, stderr: out.stderr };
}

// Starts the server (PORT=0 unless given) and waits for the listening line.
// Returns { port, child, out, stop }; stop() kills it and waits for exit.
export async function startServer({ env = {}, cwd } = {}) {
  const fullEnv = { PORT: '0', ...env };
  const { child, out, exited } = spawnServer({ env: fullEnv, cwd });
  const port = await waitForPort(child, out, exited).catch(async (error) => {
    child.kill('SIGKILL'); // never leave a half-started server behind
    await exited;
    throw error;
  });
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await exited;
  };
  return { port, child, out, exited, stop };
}

function waitForPort(child, out, exited) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no listening line; stderr: ${out.stderr}`)), START_TIMEOUT_MS);
    const onData = () => {
      if (!out.stdout.includes('\n')) return;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      const match = LISTEN_RE.exec(out.stdout);
      if (match) resolve(Number(match[1]));
      else reject(new Error(`unexpected stdout: ${JSON.stringify(out.stdout)}`));
    };
    child.stdout.on('data', onData);
    exited.then(({ code }) => {
      clearTimeout(timer);
      reject(new Error(`server exited with ${code}; stderr: ${out.stderr}`));
    });
  });
}

// Sends one raw HTTP request; the path is sent byte for byte as given.
// Returns { status, headers, raw (Buffer), text, json (or undefined) }.
// A body gets an explicit Content-Length unless the caller framed it itself
// (Node sends GET/DELETE bodies unframed otherwise).
function framedHeaders(headers, body) {
  if (body === undefined) return headers;
  const names = Object.keys(headers).map((name) => name.toLowerCase());
  if (names.includes('content-length') || names.includes('transfer-encoding')) return headers;
  return { ...headers, 'Content-Length': Buffer.byteLength(body) };
}

export function request(port, { method = 'GET', path: target = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, method, path: target, headers: framedHeaders(headers, body), agent: false,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const text = raw.toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch { json = undefined; }
        resolve({ status: res.statusCode, headers: res.headers, raw, text, json });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export const JSON_CT = 'application/json; charset=utf-8';

export function postJson(port, value, headers = { 'Content-Type': 'application/json' }) {
  const body = typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value);
  return request(port, { method: 'POST', path: '/api/bookings', headers, body });
}

export function booking(overrides = {}) {
  return {
    room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00', ...overrides,
  };
}
