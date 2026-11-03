// Test harness: spawn server.mjs, raw HTTP requests, temp dirs.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SERVER = path.join(ROOT, 'server.mjs');
const LISTEN_RE = /^listening on http:\/\/127\.0\.0\.1:(\d+)\n$/;
const TIMEOUT_MS = 8000;

export function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rooms-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function buildEnv(overrides, dataFile) {
  const env = { ...process.env, PORT: '0', DATA_FILE: dataFile, ...overrides };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key];
  }
  return env;
}

function launch(t, { env = {}, cwd, dataFile }) {
  const child = spawn(process.execPath, [SERVER], {
    env: buildEnv(env, dataFile),
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = { stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (d) => { out.stdout += d; });
  child.stderr.on('data', (d) => { out.stderr += d; });
  const closed = new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  t.after(() => { child.kill('SIGKILL'); });
  return { child, out, closed };
}

function waitForListening({ child, out, closed }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start in time')), TIMEOUT_MS);
    child.stdout.on('data', () => {
      const match = LISTEN_RE.exec(out.stdout);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    closed.then((r) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (code ${r.code}): ${out.stderr}`));
    });
  });
}

export async function startServer(t, opts = {}) {
  const dir = opts.dir ?? tmpDir(t);
  const dataFile = opts.dataFile ?? path.join(dir, 'data.json');
  const proc = launch(t, { env: opts.env, cwd: opts.cwd ?? dir, dataFile });
  const port = await waitForListening(proc);
  return {
    port,
    dir,
    dataFile,
    child: proc.child,
    stdout: () => proc.out.stdout,
    stderr: () => proc.out.stderr,
    async stop() {
      proc.child.kill('SIGTERM');
      await proc.closed;
      return proc.out.stdout;
    },
    req: (o) => request(port, o),
  };
}

export async function runToExit(t, opts = {}) {
  const dir = opts.dir ?? tmpDir(t);
  const dataFile = opts.dataFile ?? path.join(dir, 'data.json');
  const proc = launch(t, { env: opts.env, cwd: opts.cwd ?? dir, dataFile });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('server did not exit in time')), TIMEOUT_MS);
  });
  try {
    const { code } = await Promise.race([proc.closed, timeout]);
    return { code, stdout: proc.out.stdout, stderr: proc.out.stderr };
  } finally {
    clearTimeout(timer);
  }
}

function toReply(res, raw) {
  const body = raw.toString('utf8');
  let json;
  try { json = JSON.parse(body); } catch { json = undefined; }
  return { status: res.statusCode, headers: res.headers, raw, body, json };
}

// Raw request: `path` is sent exactly as given (http.request does not normalise it).
export function request(port, { method = 'GET', path: target = '/', headers = {}, body, chunks } = {}) {
  return new Promise((resolve, reject) => {
    const sent = chunks ? { ...headers, 'Transfer-Encoding': 'chunked' } : headers;
    const req = http.request(
      { host: '127.0.0.1', port, method, path: target, headers: sent, agent: false },
      (res) => {
        const parts = [];
        res.on('data', (c) => parts.push(c));
        res.on('end', () => resolve(toReply(res, Buffer.concat(parts))));
        res.on('error', reject);
      },
    );
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    if (chunks) {
      for (const chunk of chunks) req.write(chunk);
      req.end();
    } else {
      req.end(body);
    }
  });
}
