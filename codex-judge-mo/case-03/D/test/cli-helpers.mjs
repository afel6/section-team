import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after } from 'node:test';

export const CLI = fileURLToPath(new URL('../jsonpatch-cli.mjs', import.meta.url));
export const USAGE = 'Usage: node jsonpatch-cli.mjs <patch> [<doc>]';
export const LIMIT = 1048576;
export const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export function run(args, { input, stdinFd, cwd, timeout = 60000 } = {}) {
  const opts = {
    cwd,
    timeout,
    maxBuffer: 64 * 1024 * 1024,
    encoding: 'utf8',
  };
  if (stdinFd !== undefined) {
    opts.stdio = [stdinFd, 'pipe', 'pipe'];
  } else {
    opts.input = input === undefined ? '' : input;
  }
  const r = spawnSync(process.execPath, [CLI, ...args], opts);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// Async run. With stdinOpen the stdin pipe is never written or ended, so a CLI that
// reads stdin too early hangs until timeoutMs, then is killed and timedOut is true.
export function runAsync(args, { stdinOpen = false, timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (c) => { stdout += c; });
    child.stderr.setEncoding('utf8').on('data', (c) => { stderr += c; });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, timedOut });
    });
    if (!stdinOpen) child.stdin.end();
    // Nothing is written; an EPIPE after the child exits is expected and harmless.
    else child.stdin.on('error', (err) => { if (err.code !== 'EPIPE') reject(err); });
  });
}

// Creates a temp dir and registers cleanup for the calling suite.
export function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonpatch-cli-'));
  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

export function writeFile(dir, name, content) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

export function assertFailure(r, exitCode, line) {
  assert.equal(r.status, exitCode);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, line + '\n');
}

export function assertSuccess(r, value) {
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, JSON.stringify(value, null, 2) + '\n');
}

// Valid JSON '[]' padded with trailing spaces so that prefix + content is `total` bytes.
export function padded(total, prefix = Buffer.alloc(0)) {
  const body = Buffer.from('[]');
  const fill = Buffer.alloc(total - prefix.length - body.length, 0x20);
  return Buffer.concat([prefix, body, fill]);
}
