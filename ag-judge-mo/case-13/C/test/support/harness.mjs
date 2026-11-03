// Shared helpers for the server tests: spawn `node server.mjs`, temp dirs, raw HTTP.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import net from 'node:net';

export const SERVER_PATH = fileURLToPath(new URL('../../server.mjs', import.meta.url));
const TIMEOUT_MS = 5000;
const LISTEN_RE = /^listening on http:\/\/127\.0\.0\.1:([0-9]+)\n$/;

export const makeTempDir = () => mkdtemp(join(tmpdir(), 'rooms-test-'));
export const removeDir = (dir) => rm(dir, { recursive: true, force: true });

// Builds the child env: inherits process.env without PORT/DATA_FILE, then applies `env`.
// A key whose value is undefined is left unset.
function childEnv(env) {
  const base = { ...process.env };
  delete base.PORT;
  delete base.DATA_FILE;
  const merged = { ...base, ...env };
  return Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined));
}

function spawnServer({ cwd, env }) {
  return spawn(process.execPath, [SERVER_PATH], { cwd, env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
}

// Runs the server expecting it to exit (startup failure). Resolves { code, stdout, stderr }.
export function runToExit({ cwd, env = {} }) {
  return new Promise((resolve, reject) => {
    const child = spawnServer({ cwd, env });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`server did not exit; stdout=${JSON.stringify(stdout)}`));
    }, TIMEOUT_MS);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// Starts the server (default PORT=0) and waits for the listening line.
// Resolves { port, child, stdout(), stderr(), stop() }; stop() kills and awaits exit.
export function startServer({ cwd, env = {} }) {
  return new Promise((resolve, reject) => {
    const child = spawnServer({ cwd, env: { PORT: '0', ...env } });
    let stdout = '';
    let stderr = '';
    let exited = false;
    const exitPromise = new Promise((done) => child.on('close', (code) => { exited = true; done(code); }));
    const stop = async () => {
      if (!exited) child.kill('SIGKILL');
      return exitPromise;
    };
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`server did not start; stderr=${JSON.stringify(stderr)}`));
    }, TIMEOUT_MS);
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
      const match = LISTEN_RE.exec(stdout);
      if (match) {
        clearTimeout(timer);
        resolve({ port: Number(match[1]), child, stdout: () => stdout, stderr: () => stderr, stop, exited: () => exited });
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited with ${code} before listening; stderr=${JSON.stringify(stderr)}`));
    });
  });
}

// One HTTP request via http.request (path sent as given, no normalisation).
// Resolves { status, headers, body: Buffer, text, json() }.
export function request(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body: buf, text, json: () => JSON.parse(text) });
      });
      res.on('error', reject);
    });
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(new Error(`request ${method} ${path} timed out after ${TIMEOUT_MS} ms`));
    });
    req.on('error', reject);
    req.end(body);
  });
}

export const getJson = (port, path) => request(port, { path });

export function postBooking(port, booking, headers = { 'Content-Type': 'application/json' }) {
  const body = typeof booking === 'string' || Buffer.isBuffer(booking) ? booking : JSON.stringify(booking);
  return request(port, { method: 'POST', path: '/api/bookings', headers, body });
}

// Writes raw bytes on a TCP socket and resolves with everything received until the server closes it.
// Send `Connection: close` so the server ends the socket after replying.
export function rawRequest(port, data) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    const chunks = [];
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('raw request timed out')); }, TIMEOUT_MS);
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('error', (err) => { clearTimeout(timer); reject(err); });
    socket.on('close', () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString('latin1')); });
    socket.end(data);
  });
}

// Parses a raw HTTP/1.1 response (single, non-chunked) into { status, headers, body }.
export function parseRaw(raw) {
  const split = raw.indexOf('\r\n\r\n');
  const head = raw.slice(0, split).split('\r\n');
  const status = Number(head[0].split(' ')[1]);
  const headers = Object.fromEntries(head.slice(1).map((line) => {
    const colon = line.indexOf(':');
    return [line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()];
  }));
  return { status, headers, body: Buffer.from(raw.slice(split + 4), 'latin1').toString('utf8') };
}

export const JSON_TYPE = 'application/json; charset=utf-8';
