// Shared black-box harness: spawn `node server.mjs` and talk to it over HTTP or raw TCP.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SERVER = path.join(ROOT, 'server.mjs');
export const JSON_TYPE = 'application/json; charset=utf-8';
export const JSON_HEADERS = Object.freeze({ 'content-type': 'application/json' });
export const LISTEN_RE = /^listening on http:\/\/127\.0\.0\.1:(\d+)\n$/;
const EXIT_TIMEOUT_MS = 10000;

/** Fresh temp folder, removed after the test. */
export function makeTmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booking-h-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Spawns the server. `env` entries override the defaults (PORT=0, DATA_FILE=<dir>/data.json);
 * an entry whose value is `undefined` removes that variable entirely.
 */
export function spawnServer(dir, { env = {}, cwd } = {}) {
  const merged = { ...process.env, PORT: '0', DATA_FILE: path.join(dir, 'data.json'), ...env };
  const fullEnv = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined));
  return spawn(process.execPath, [SERVER], { env: fullEnv, cwd: cwd ?? dir });
}

/**
 * Starts the server and resolves once it prints the listening line.
 * `out()` / `err()` return everything written to stdout / stderr so far.
 */
export function startServer(t, dir, opts = {}) {
  const child = spawnServer(dir, opts);
  t.after(() => child.kill('SIGKILL'));
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      child.kill('SIGKILL');
      reject(new Error(`no listening line within ${EXIT_TIMEOUT_MS} ms: ${stderr}`));
    }, EXIT_TIMEOUT_MS);
    const onData = () => {
      const m = LISTEN_RE.exec(stdout);
      if (!m) return;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
      resolve({ port: Number(m[1]), child, out: () => stdout, err: () => stderr });
    };
    const onExit = (code) => {
      clearTimeout(timer);
      reject(new Error(`exited ${code} before listening: ${stderr}`));
    };
    child.stdout.on('data', onData);
    child.on('exit', onExit);
  });
}

/** Kills a started server and resolves once its process is gone and its stdio is drained. */
export function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('close', () => resolve());
    child.kill('SIGKILL');
  });
}

/** Spawns the server in a fresh temp dir; returns { dir, port, child, out, err }. */
export async function boot(t, opts = {}) {
  const dir = makeTmp(t);
  const srv = await startServer(t, dir, opts);
  return { dir, ...srv };
}

/**
 * Runs the server until it exits; resolves { code, stdout, stderr }.
 * When it is still running after the timeout it is killed and `code` is 'still running',
 * so the caller's own assertion (with its case label) reports the failure.
 */
export function runToExit(t, dir, opts = {}) {
  const child = spawnServer(dir, opts);
  t.after(() => child.kill('SIGKILL'));
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.removeAllListeners('close');
      child.kill('SIGKILL');
      resolve({ code: 'still running', stdout, stderr });
    }, EXIT_TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    // 'close' (not 'exit') fires only after stdout and stderr are fully read.
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** HTTP request; resolves { status, headers, text, json } (json undefined when not JSON). */
export function request(port, method, reqPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const opts = { host: '127.0.0.1', port, method, path: reqPath, headers, agent: false };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch { json = undefined; }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** POST /api/bookings; objects are JSON-encoded, strings and Buffers are sent as is. */
export function post(port, obj, headers = JSON_HEADERS) {
  const body = typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj);
  return request(port, 'POST', '/api/bookings', { headers, body });
}

/**
 * Sends raw bytes over TCP and resolves the parsed status line, lower-cased headers and body text.
 * Use for request lines or headers that node:http would refuse to send. Send `Connection: close`:
 * the socket is not half-closed (node:http aborts a request whose client sent FIN), so the reply
 * ends when the server closes the connection.
 */
export function rawRequest(port, raw) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(raw));
    const chunks = [];
    socket.on('data', (c) => chunks.push(c));
    socket.on('error', reject);
    socket.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const split = text.indexOf('\r\n\r\n');
      const head = split === -1 ? text : text.slice(0, split);
      const bodyText = split === -1 ? '' : text.slice(split + 4);
      const [statusLine, ...headerLines] = head.split('\r\n');
      const headers = Object.fromEntries(headerLines.map((l) => {
        const i = l.indexOf(':');
        return [l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()];
      }));
      let json;
      try { json = JSON.parse(bodyText); } catch { json = undefined; }
      resolve({ status: Number(statusLine.split(' ')[1]), headers, text: bodyText, json });
    });
  });
}

/** A valid booking body; `over` replaces fields. */
export const valid = (over = {}) => ({
  room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '10:00', end: '11:00', ...over,
});

/** Asserts status, exact `{error}` body and the JSON content type; `label` names the case. */
export function assertError(res, status, message, label = '') {
  const at = label ? `${label}: ` : '';
  assert.equal(res.status, status, `${at}status`);
  assert.deepEqual(res.json, { error: message }, `${at}body`);
  assert.equal(res.headers['content-type'], JSON_TYPE, `${at}content-type`);
}

/**
 * POST /api/bookings with `transfer-encoding: chunked` (no Content-Length), writing each Buffer of
 * `pieces` in turn and honouring back-pressure. Resolves { status, headers, text, json }.
 */
export function chunkedPost(port, pieces, headers = JSON_HEADERS) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, method: 'POST', path: '/api/bookings', agent: false,
      headers: { ...headers, 'transfer-encoding': 'chunked' },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = JSON.parse(text); } catch { json = undefined; }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    let next = 0;
    const pump = () => {
      while (next < pieces.length) {
        const piece = pieces[next];
        next += 1;
        if (!req.write(piece)) { req.once('drain', pump); return; }
      }
      req.end();
    };
    pump();
  });
}

/** Resolves true when 127.0.0.1:<port> can be bound right now. */
export function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}
