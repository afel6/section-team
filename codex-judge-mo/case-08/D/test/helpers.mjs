import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SERVER = path.join(ROOT, 'server.mjs');

export function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bookings-test-'));
}

// Runs the server until it exits; resolves with { code, stdout, stderr }.
export function runToExit(env, cwd = ROOT) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SERVER], { cwd, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 5000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// Starts the server and resolves once it is listening.
export function startServer(env = {}, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], {
      cwd,
      env: { ...process.env, PORT: '0', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.stdout.on('data', (d) => {
      stdout += d;
      const m = /^listening on http:\/\/127\.0\.0\.1:(\d+)\n$/.exec(stdout);
      if (m) {
        const port = Number(m[1]);
        const base = `http://127.0.0.1:${port}`;
        resolve({
          child,
          port,
          base,
          get stdout() { return stdout; },
          stop: () => new Promise((r) => {
            if (child.exitCode !== null) return r();
            child.once('exit', r);
            child.kill();
          }),
        });
      }
    });
    child.on('exit', (code) => reject(new Error(`server exited ${code}: ${stderr}`)));
  });
}

export async function api(base, method, urlPath, { body, headers } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    if (!('Content-Type' in init.headers)) init.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(base + urlPath, init);
  const text = await res.text();
  let json;
  try {
    json = text === '' ? undefined : JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, text, json };
}

// Sends a raw request target (no normalisation) and returns status and body.
export function rawRequest(port, method, target, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let data = '';
    const lines = [`${method} ${target} HTTP/1.1`, 'Host: localhost', 'Connection: close'];
    for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
    if (body !== undefined) lines.push(`Content-Length: ${Buffer.byteLength(body)}`);
    socket.on('connect', () => {
      socket.write(lines.join('\r\n') + '\r\n\r\n');
      if (body !== undefined) socket.write(body);
    });
    socket.on('data', (d) => (data += d));
    socket.on('end', () => {
      const [head, ...rest] = data.split('\r\n\r\n');
      const status = Number(head.split(' ')[1]);
      resolve({ status, head, body: rest.join('\r\n\r\n') });
    });
    socket.on('error', reject);
  });
}

export const sample = (over = {}) => ({
  room: 'Aurora',
  title: 'Standup',
  date: '2026-11-03',
  start: '09:00',
  end: '10:00',
  ...over,
});
