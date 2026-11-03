import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLI = fileURLToPath(new URL('../../jsonpatch-cli.mjs', import.meta.url));
export const USAGE = 'Usage: node jsonpatch-cli.mjs <patch> [<doc>]';
export const LIMIT = 1048576;

export function runCli(args, { input, cwd, stdin } = {}) {
  const options = { cwd, maxBuffer: 64 * 1024 * 1024 };
  if (stdin === undefined) options.input = input === undefined ? '' : input;
  else options.stdio = [stdin, 'pipe', 'pipe'];
  const result = spawnSync(process.execPath, [CLI, ...args], options);
  if (result.error && result.error.code !== 'EPIPE') throw result.error;
  return {
    status: result.status,
    stdout: result.stdout ? result.stdout.toString('utf8') : '',
    stderr: result.stderr ? result.stderr.toString('utf8') : '',
  };
}

export function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jsonpatch-cli-'));
}

export function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

export function writeFile(dir, name, content) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

export function expectError(result, line, code) {
  assert.equal(result.status, code);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `${line}\n`);
}

export function expectOk(result, value) {
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, `${JSON.stringify(value, null, 2)}\n`);
}
