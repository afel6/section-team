// Shared helpers for the CLI tests. Contains no tests itself.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLI_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'jsonpatch-cli.mjs');
export const USAGE = 'Usage: node jsonpatch-cli.mjs <patch> [<doc>]';
export const MAX = 1048576;
export const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export function run(args, { input, cwd, stdio } = {}) {
  // No `encoding` option: spawnSync returns Buffers, and string input is encoded as UTF-8 here.
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  const opts = { input: bytes, cwd, maxBuffer: 64 * 1024 * 1024 };
  if (stdio) {
    delete opts.input;
    opts.stdio = stdio;
  }
  const r = spawnSync(process.execPath, [CLI_PATH, ...args], opts);
  return {
    code: r.status,
    stdout: r.stdout ? r.stdout.toString('utf8') : '',
    stderr: r.stderr ? r.stderr.toString('utf8') : '',
  };
}

export function expectError(res, line, code) {
  assert.equal(res.code, code);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, line + '\n');
}

export function expectOk(res, value) {
  assert.equal(res.code, 0);
  assert.equal(res.stderr, '');
  assert.equal(res.stdout, JSON.stringify(value, null, 2) + '\n');
}

export function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jsonpatch-cli-'));
}

export function removeTmp(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Write a fixture (string or Buffer) into dir; returns the relative name.
export function put(dir, name, content) {
  fs.writeFileSync(path.join(dir, name), content);
  return name;
}

// Valid JSON '[]' padded with spaces so the result is exactly `total` bytes
// (BOM included when withBom is true).
export function padded(total, withBom = false) {
  const head = withBom ? Buffer.concat([BOM, Buffer.from('[]')]) : Buffer.from('[]');
  return Buffer.concat([head, Buffer.alloc(total - head.length, 0x20)]);
}

// JSON text nesting objects and arrays alternately, `depth` levels deep.
export function mixedNesting(depth) {
  let text = '1';
  for (let i = 0; i < depth; i++) text = i % 2 ? `[${text}]` : `{"a":${text}}`;
  return text;
}

export function nestedArrays(depth) {
  return '['.repeat(depth) + ']'.repeat(depth);
}
