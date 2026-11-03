// Shared helpers for server.test.mjs: spawn servers, make requests, manage temp dirs.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SERVER = path.join(ROOT, 'server.mjs');
export const JSON_TYPE = 'application/json; charset=utf-8';
const LISTEN_LINE = /^listening on http:\/\/127\.0\.0\.1:(\d+)\n$/;

const tempDirs = [];
const liveServers = new Set();

export function mkTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rooms-test-'));
  tempDirs.push(dir);
  return dir;
}

export async function cleanup() {
  await Promise.all([...liveServers].map((s) => s.stop()));
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

function buildEnv(env, defaultFile) {
  const merged = { ...process.env, PORT: '0', DATA_FILE: defaultFile, ...env };
  for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
  return merged;
}

function spawnServer({ env = {}, cwd, script = SERVER }) {
  const defaultFile = path.join(mkTmp(), 'bookings.json');
  const child = spawn(process.execPath, [script], {
    env: buildEnv(env, defaultFile),
    cwd: cwd ?? ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = { stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8').on('data', (d) => { out.stdout += d; });
  child.stderr.setEncoding('utf8').on('data', (d) => { out.stderr += d; });
  const exited = new Promise((resolve) => {
    child.once('exit', (code) => resolve(code));
  });
  return { child, out, exited, defaultFile };
}

export function start({ env = {}, cwd, script } = {}) {
  const { child, out, exited, defaultFile } = spawnServer({ env, cwd, script });
  const server = {
    child,
    file: env.DATA_FILE ?? defaultFile,
    stdout: () => out.stdout,
    stderr: () => out.stderr,
    stop: async () => {
      liveServers.delete(server);
      child.kill('SIGKILL');
      await exited;
    },
  };
  liveServers.add(server);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start in time')), 5000);
    const check = () => {
      const m = LISTEN_LINE.exec(out.stdout);
      if (m) {
        clearTimeout(timer);
        resolve({ ...server, port: Number(m[1]) });
      }
    };
    child.stdout.on('data', check);
    exited.then((code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (${code}): ${out.stderr}`));
    });
  });
}

export async function runToExit({ env = {}, cwd } = {}) {
  const { child, out, exited } = spawnServer({ env, cwd });
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  const code = await exited;
  clearTimeout(timer);
  return { code, stdout: out.stdout, stderr: out.stderr };
}

export function request(port, { method = 'GET', path: reqPath, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(body);
    const finalHeaders = { ...headers };
    if (payload) finalHeaders['content-length'] = payload.length;
    const req = http.request(
      { host: '127.0.0.1', port, method, path: reqPath, headers: finalHeaders, agent: false },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try { json = JSON.parse(text); } catch { json = undefined; }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

export function rawRequest(port, text) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const socket = net.connect(port, '127.0.0.1', () => socket.write(text));
    socket.on('data', (c) => chunks.push(c));
    socket.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    socket.on('error', reject);
  });
}

export function rawGet(port, target, method = 'GET') {
  return rawRequest(port, `${method} ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
}

export function parseRaw(text) {
  const [head, ...rest] = text.split('\r\n\r\n');
  return { status: Number(/^HTTP\/1\.1 (\d+)/.exec(head)[1]), head, body: rest.join('\r\n\r\n') };
}

export const get = (port, p) => request(port, { path: p });
export const del = (port, p) => request(port, { method: 'DELETE', path: p });

export function post(port, value, headers = {}) {
  const body = typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value);
  return request(port, {
    method: 'POST',
    path: '/api/bookings',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

export function booking(overrides = {}) {
  return {
    room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00', ...overrides,
  };
}

let dayCounter = 0;
export function uniqueDate() {
  const n = dayCounter++;
  const year = 2040 + Math.floor(n / 336);
  const month = String(1 + (Math.floor(n / 28) % 12)).padStart(2, '0');
  const day = String(1 + (n % 28)).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function writeData(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
}
