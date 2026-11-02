// Tests for jsonpatch-cli.mjs: run the CLI on temp files and stdin, check stdout, stderr and the exit code.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./jsonpatch-cli.mjs', import.meta.url));
const USAGE = 'Usage: node jsonpatch-cli.mjs <patch> [<doc>]\n';
const LIMIT = 1048576;
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const dir = mkdtempSync(join(tmpdir(), 'jsonpatch-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));

function run(args, input) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

let fileCount = 0;
function file(content) {
  fileCount += 1;
  const path = join(dir, `case-${fileCount}.json`);
  writeFileSync(path, content);
  return path;
}

const ok = result => ({ stdout: `${JSON.stringify(result, null, 2)}\n`, stderr: '', status: 0 });
const failed = (stderr, status) => ({ stdout: '', stderr, status });
const PATCH = JSON.stringify([{ op: 'add', path: '/b', value: [1, 2] }]);
const nested = depth => `${'['.repeat(depth)}${']'.repeat(depth)}`;
// A JSON string document of exactly `size` bytes.
const stringDoc = size => `"${'a'.repeat(size - 2)}"`;

test('applies a patch file to a document file', () => {
  assert.deepEqual(run([file(PATCH), file('{"a":0}')]), ok({ a: 0, b: [1, 2] }));
});

test('prints members in JavaScript property order', () => {
  const r = run([file('[{"op":"add","path":"/1","value":5}]'), file('{"b":0}')]);
  assert.deepEqual(r, { stdout: '{\n  "1": 5,\n  "b": 0\n}\n', stderr: '', status: 0 });
});

test('reads the document from stdin when it is missing or "-"', () => {
  const patch = file(PATCH);
  assert.deepEqual(run([patch], '{"a":0}'), ok({ a: 0, b: [1, 2] }));
  assert.deepEqual(run([patch, '-'], '{"a":0}'), ok({ a: 0, b: [1, 2] }));
});

test('reads the patch from stdin when it is "-"', () => {
  assert.deepEqual(run(['-', file('{}')], PATCH), ok({ b: [1, 2] }));
});

test('usage errors exit 2', () => {
  for (const args of [[], ['a', 'b', 'c'], ['-'], ['-', '-']]) {
    assert.deepEqual(run(args, '[]'), failed(USAGE, 2));
  }
});

test('read errors exit 1', () => {
  const missing = join(dir, 'nope.json');
  assert.deepEqual(run([missing, file('{}')]), failed(`Error: ${missing}: no such file\n`, 1));
  const throughFile = join(file('[]'), 'x');
  assert.deepEqual(run([throughFile, file('{}')]), failed(`Error: ${throughFile}: no such file\n`, 1));
  assert.deepEqual(run([file('[]'), dir]), failed(`Error: ${dir}: is a directory\n`, 1));
});

test('an unreadable directory is still a directory', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const locked = join(dir, 'locked');
  mkdirSync(locked);
  chmodSync(locked, 0o000);
  try {
    assert.deepEqual(run([locked]), failed(`Error: ${locked}: is a directory\n`, 1));
  } finally {
    chmodSync(locked, 0o700);
  }
});

test('an input of exactly 1048576 bytes is read; one more byte is too large', () => {
  const patch = file('[]');
  assert.deepEqual(run([patch, file(stringDoc(LIMIT))]).status, 0);
  const big = file(stringDoc(LIMIT + 1));
  assert.deepEqual(run([patch, big]), failed(`Error: ${big}: too large\n`, 1));
  const withBom = file(Buffer.concat([BOM, Buffer.from(stringDoc(LIMIT - 2))]));
  assert.deepEqual(run([patch, withBom]), failed(`Error: ${withBom}: too large\n`, 1));
  assert.deepEqual(run([patch], stringDoc(LIMIT + 1)), failed('Error: stdin: too large\n', 1));
  assert.equal(run([patch], stringDoc(LIMIT)).status, 0);
});

test('a leading byte order mark is ignored, a second one is not', () => {
  const patch = file(Buffer.concat([BOM, Buffer.from('[]')]));
  assert.deepEqual(run([patch, file(Buffer.concat([BOM, Buffer.from('{"a":1}')]))]), ok({ a: 1 }));
  const twice = file(Buffer.concat([BOM, BOM, Buffer.from('{}')]));
  assert.deepEqual(run([patch, twice]), failed(`Error: ${twice}: invalid JSON\n`, 3));
});

test('decode, parse and depth errors exit 3', () => {
  const patch = file('[]');
  const badUtf8 = file(Buffer.from([0x22, 0xc3, 0x28, 0x22]));
  assert.deepEqual(run([patch, badUtf8]), failed(`Error: ${badUtf8}: invalid UTF-8\n`, 3));
  const surrogate = file(Buffer.from([0x22, 0xed, 0xa0, 0x80, 0x22]));
  assert.deepEqual(run([patch, surrogate]), failed(`Error: ${surrogate}: invalid UTF-8\n`, 3));
  const empty = file('');
  assert.deepEqual(run([patch, empty]), failed(`Error: ${empty}: invalid JSON\n`, 3));
  assert.deepEqual(run([patch], '{"a":}'), failed('Error: stdin: invalid JSON\n', 3));
  assert.equal(run([patch, file(nested(1000))]).status, 0);
  const deep = file(nested(1001));
  assert.deepEqual(run([patch, deep]), failed(`Error: ${deep}: too deep\n`, 3));
  const deepObject = file(`${'{"a":'.repeat(1001)}1${'}'.repeat(1001)}`);
  assert.deepEqual(run([patch, deepObject]), failed(`Error: ${deepObject}: too deep\n`, 3));
  const veryDeep = file(nested(400000));
  assert.deepEqual(run([patch, veryDeep]), failed(`Error: ${veryDeep}: too deep\n`, 3));
});

test('the patch input passes every check before the document is read', () => {
  const missing = join(dir, 'missing.json');
  const badPatch = file('[');
  assert.deepEqual(run([badPatch, missing]), failed(`Error: ${badPatch}: invalid JSON\n`, 3));
  const deepPatch = file(nested(1001));
  assert.deepEqual(run([deepPatch, file('{')]), failed(`Error: ${deepPatch}: too deep\n`, 3));
  assert.deepEqual(run([missing, file('{')]), failed(`Error: ${missing}: no such file\n`, 1));
  const badDoc = file('{');
  assert.deepEqual(run([file('{"op":1}'), badDoc]), failed(`Error: ${badDoc}: invalid JSON\n`, 3)); // apply runs last
});

test('patch errors exit 4', () => {
  const doc = file('{"a":1}');
  assert.deepEqual(run([file('[{"op":"nope"}]'), doc]), failed('Error: operation 0: bad op\n', 4));
  assert.deepEqual(run([file('{"op":"add"}'), doc]), failed('Error: patch must be an array\n', 4));
  const testPatch = file('[{"op":"test","path":"/a","value":1},{"op":"test","path":"/a","value":2}]');
  assert.deepEqual(run([testPatch, doc]), failed('Error: operation 1: test failed\n', 4));
});
