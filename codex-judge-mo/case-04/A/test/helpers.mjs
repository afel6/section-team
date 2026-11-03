// Shared helpers for the jsonpatch test suites (not a test file itself).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PatchError } from '../jsonpatch.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CLI = join(ROOT, 'jsonpatch-cli.mjs');

// Runs the CLI with the given arguments; `stdin` (string or Buffer) is piped in when given.
// `nodeArgs` are V8/Node flags placed before the script (for example `--stack-size=200`).
export function runCli(args, { stdin = '', cwd, nodeArgs = [] } = {}) {
  const res = spawnSync(process.execPath, [...nodeArgs, CLI, ...args], {
    cwd,
    input: stdin,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error && res.error.code !== 'EPIPE') throw res.error;
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

// Asserts a failed CLI run: exactly one stderr line, nothing on stdout, the given exit code.
export function assertCliError(res, code, line) {
  assert.equal(res.stderr, `${line}\n`);
  assert.equal(res.stdout, '');
  assert.equal(res.code, code);
}

// Asserts a successful CLI run: stdout is exactly `expectedText`, stderr empty, exit 0.
export function assertCliOk(res, expectedText) {
  assert.equal(res.stderr, '');
  assert.equal(res.stdout, expectedText);
  assert.equal(res.code, 0);
}

// Creates a fresh temp directory; returns { dir, file(name, content), cleanup }.
export function makeTmp() {
  const dir = mkdtempSync(join(tmpdir(), 'jsonpatch-test-'));
  const file = (name, content) => {
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
  };
  return { dir, file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// Asserts that fn throws a PatchError with exactly this message and index.
export function assertPatchError(fn, message, index) {
  let caught;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught !== undefined, `expected PatchError "${message}", nothing was thrown`);
  assert.ok(caught instanceof PatchError, `expected PatchError, got ${caught?.name}: ${caught?.message}`);
  assert.ok(caught instanceof Error);
  assert.equal(caught.name, 'PatchError');
  assert.equal(caught.message, message);
  assert.equal(caught.index, index);
}

// Nested arrays: depth 1 is [], depth n is n levels of brackets.
export function nestedArrayText(depth) {
  return '['.repeat(depth) + ']'.repeat(depth);
}

// Returns true when x is -0.
export const isNegZero = (x) => Object.is(x, -0);
