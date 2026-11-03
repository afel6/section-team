import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CLI_PATH = path.resolve(import.meta.dirname, '..', '..', 'jsonpatch-cli.mjs');
export const USAGE_LINE = 'Usage: node jsonpatch-cli.mjs <patch> [<doc>]';
export const MAX_BYTES = 1048576;
export const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export function run(args, { input, stdio, cwd } = {}) {
  const options = { cwd, maxBuffer: 256 * 1024 * 1024 };
  if (stdio !== undefined) options.stdio = stdio;
  else if (input !== undefined) options.input = input;
  const res = spawnSync(process.execPath, [CLI_PATH, ...args], options);
  assert.equal(res.error, undefined, 'spawn failed');
  return {
    status: res.status,
    stdout: res.stdout.toString('utf8'),
    stderr: res.stderr.toString('utf8'),
  };
}

// Exact string equality; skips assert's diff for big strings, which can take
// minutes on ~1 MB outputs and makes a failing run look hung.
const DIFF_LIMIT = 4096;
function assertSameText(actual, expected, label) {
  if (actual.length <= DIFF_LIMIT && expected.length <= DIFF_LIMIT) {
    assert.strictEqual(actual, expected, label);
    return;
  }
  let at = 0;
  while (at < actual.length && actual[at] === expected[at]) at += 1;
  assert.ok(actual === expected,
    `${label}: lengths ${actual.length} vs ${expected.length}, first difference at ${at}`);
}

export function expectError(result, line, code) {
  assertSameText(result.stderr, `${line}\n`, 'stderr');
  assertSameText(result.stdout, '', 'stdout');
  assert.strictEqual(result.status, code);
}

export function expectOk(result, expectedStdout) {
  assertSameText(result.stderr, '', 'stderr');
  assertSameText(result.stdout, expectedStdout, 'stdout');
  assert.strictEqual(result.status, 0);
}

export function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jp-cli-'));
}

export function removeTmpDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

export function writeIn(dir, name, content) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

// Valid JSON "[]" followed by spaces, exactly `size` bytes.
export function paddedJson(size) {
  return Buffer.concat([Buffer.from('[]'), Buffer.alloc(size - 2, 0x20)]);
}
