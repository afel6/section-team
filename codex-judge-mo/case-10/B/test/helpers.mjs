// Shared helpers for server.test.mjs: process spawning, HTTP clients, cleanup.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_PATH = fileURLToPath(new URL('../server.mjs', import.meta.url));
export const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
export const JSON_TYPE = 'application/json; charset=utf-8';
const LISTEN_RE = /^listening on http:\/\/127\.0\.0\.1:(\d+)\n$/;

const procs = new Set();
const dirs = [];

/** Creates a temp dir that cleanupAll() removes. */
export function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rooms-test-'));
  dirs.push(dir);
  return dir;
}

const exited = (proc) => proc.exitCode !== null || proc.signalCode !== null;

function waitExit(proc) {
  if (exited(proc)) return Promise.resolve();
  return new Promise((resolve) => proc.once('exit', resolve));
}

/** Kills every spawned server and removes every temp dir. */
export async function cleanupAll() {
  const all = [...procs];
  procs.clear();
  for (const proc of all) if (!exited(proc)) proc.kill('SIGKILL');
  await Promise.all(all.map(waitExit));
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

function buildEnv(env) {
  const merged = { ...process.env, PORT: '0', DATA_FILE: path.join(tmpDir(), 'bookings.json'), ...env };
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  return merged;
}

function spawnServer({ env = {}, cwd } = {}) {
  const options = { env: buildEnv(env), stdio: ['ignore', 'pipe', 'pipe'] };
  if (cwd) options.cwd = cwd;
  const proc = spawn(process.execPath, [SERVER_PATH], options);
  procs.add(proc);
  let out = '';
  let err = '';
  proc.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
  proc.stderr.setEncoding('utf8').on('data', (d) => { err += d; });
  return { proc, stdout: () => out, stderr: () => err, env: options.env };
}

/** Spawns the server and resolves once it prints its listening line. */
export function startServer(opts = {}) {
  const s = spawnServer(opts);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${s.stderr()}`)), 5000);
    s.proc.stdout.on('data', () => {
      const m = LISTEN_RE.exec(s.stdout());
      if (!m) return;
      clearTimeout(timer);
      resolve({
        proc: s.proc,
        port: Number(m[1]),
        dataFile: s.env.DATA_FILE,
        stdout: s.stdout,
        stderr: s.stderr,
        kill: async () => { s.proc.kill('SIGKILL'); await waitExit(s.proc); },
      });
    });
    s.proc.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (${code}): ${s.stderr()}`));
    });
  });
}

/** Spawns the server and resolves with its exit code and output. */
export function runToExit(opts = {}) {
  const s = spawnServer(opts);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      s.proc.kill('SIGKILL');
      reject(new Error(`server did not exit: ${s.stdout()}`));
    }, 5000);
    s.proc.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: s.stdout(), stderr: s.stderr() });
    });
  });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined; // not JSON: callers see json === undefined
  }
}

/** HTTP request with full control of the path and headers. body may be an array of chunks. */
export function request(port, { method = 'GET', path: target = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const h = { Connection: 'close', ...headers };
    const parts = body === undefined ? [] : Array.isArray(body) ? body : [body];
    const chunked = Object.keys(h).some((k) => k.toLowerCase() === 'transfer-encoding');
    if (body !== undefined && !chunked) {
      h['Content-Length'] = parts.reduce((n, p) => n + Buffer.byteLength(p), 0);
    }
    const req = http.request({ host: '127.0.0.1', port, method, path: target, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, text, json: parseJson(text) });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('request timeout')));
    for (const p of parts) req.write(p);
    req.end();
  });
}

/** Writes raw bytes to a socket and returns everything the server sends back. */
export function rawRequest(port, data) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const sock = net.connect(port, '127.0.0.1', () => sock.write(data));
    sock.setTimeout(5000, () => sock.destroy(new Error('raw request timeout')));
    sock.on('data', (c) => chunks.push(c));
    sock.on('error', reject);
    sock.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

export function rawGet(port, target, method = 'GET') {
  return rawRequest(port, `${method} ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
}

export function parseRaw(text) {
  const split = text.indexOf('\r\n\r\n');
  const head = split === -1 ? text : text.slice(0, split);
  const body = split === -1 ? '' : text.slice(split + 4);
  return { status: Number(head.split(' ')[1]), head, body, json: parseJson(body) };
}

export function post(port, obj) {
  return request(port, {
    method: 'POST',
    path: '/api/bookings',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  });
}
