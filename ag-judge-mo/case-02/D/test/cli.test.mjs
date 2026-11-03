import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../jsonpatch-cli.mjs', import.meta.url));
const USAGE = 'Usage: node jsonpatch-cli.mjs <patch> [<doc>]\n';
let dir;

function run(args, input) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, input: input ?? '' });
  return { code: r.status, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

function write(name, content) {
  fs.writeFileSync(path.join(dir, name), content);
  return name;
}

function expectError(r, message, code) {
  assert.equal(r.stderr, `${message}\n`);
  assert.equal(r.stdout, '');
  assert.equal(r.code, code);
}

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonpatch-cli-'));
  write('patch.json', '[{"op":"add","path":"/1","value":5}]');
  write('doc.json', '{"b":0}');
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('applies a patch from files', () => {
  const r = run(['patch.json', 'doc.json']);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout, '{\n  "1": 5,\n  "b": 0\n}\n');
});

test('reads the document from stdin when missing or -', () => {
  assert.equal(run(['patch.json'], '{"b":0}').stdout, '{\n  "1": 5,\n  "b": 0\n}\n');
  assert.equal(run(['patch.json', '-'], '{"b":0}').stdout, '{\n  "1": 5,\n  "b": 0\n}\n');
  assert.equal(run(['-', 'doc.json'], '[]').stdout, '{\n  "b": 0\n}\n');
});

test('ignores a leading byte order mark', () => {
  write('bom.json', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('[]')]));
  assert.equal(run(['bom.json'], '﻿{"a":1}').stdout, '{\n  "a": 1\n}\n');
  write('bom2.json', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf]), Buffer.from('[]')]));
  expectError(run(['bom2.json'], '{}'), 'Error: bom2.json: invalid JSON', 3);
});

test('usage errors', () => {
  expectError(run([]), USAGE.trimEnd(), 2);
  expectError(run(['a', 'b', 'c']), USAGE.trimEnd(), 2);
  expectError(run(['-']), USAGE.trimEnd(), 2);
  expectError(run(['-', '-']), USAGE.trimEnd(), 2);
});

test('read errors', () => {
  expectError(run(['nope.json', 'doc.json']), 'Error: nope.json: no such file', 1);
  expectError(run(['patch.json/x', 'doc.json']), 'Error: patch.json/x: no such file', 1);
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  expectError(run(['sub', 'doc.json']), 'Error: sub: is a directory', 1);
  expectError(run(['patch.json', 'nope.json']), 'Error: nope.json: no such file', 1);
});

test('too large inputs', () => {
  write('big.json', `[${' '.repeat(1048576 - 2)}]`);
  assert.equal(run(['big.json'], '1').code, 0);
  write('big2.json', `[${' '.repeat(1048576 - 1)}]`);
  expectError(run(['big2.json'], '1'), 'Error: big2.json: too large', 1);
  write('big3.json', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`[${' '.repeat(1048576 - 4)}]`)]));
  expectError(run(['big3.json'], '1'), 'Error: big3.json: too large', 1);
  expectError(run(['patch.json'], `"${'x'.repeat(1048576)}"`), 'Error: stdin: too large', 1);
});

test('decode, parse and depth errors', () => {
  write('bad-utf8.json', Buffer.from([0x5b, 0xff, 0x5d]));
  expectError(run(['bad-utf8.json', 'doc.json']), 'Error: bad-utf8.json: invalid UTF-8', 3);
  write('empty.json', '');
  expectError(run(['empty.json', 'doc.json']), 'Error: empty.json: invalid JSON', 3);
  expectError(run(['patch.json'], '{'), 'Error: stdin: invalid JSON', 3);
  write('deep1000.json', `${'['.repeat(1000)}${']'.repeat(1000)}`);
  assert.equal(run(['deep1000.json'], '1').code, 4);
  write('deep1001.json', `${'['.repeat(1001)}${']'.repeat(1001)}`);
  expectError(run(['deep1001.json', 'nope.json']), 'Error: deep1001.json: too deep', 3);
  expectError(run(['patch.json'], `${'{"a":'.repeat(1001)}1${'}'.repeat(1001)}`), 'Error: stdin: too deep', 3);
  expectError(run(['patch.json'], Buffer.from([0x22, 0xc3, 0x22])), 'Error: stdin: invalid UTF-8', 3);
});

test('the patch is fully checked before the document is read', () => {
  write('bad-patch.json', '{');
  expectError(run(['bad-patch.json', 'nope.json']), 'Error: bad-patch.json: invalid JSON', 3);
  expectError(run(['nope.json', 'bad-patch.json']), 'Error: nope.json: no such file', 1);
});

test('patch errors exit 4', () => {
  write('bad-op.json', '[{"op":"nope"}]');
  expectError(run(['bad-op.json', 'doc.json']), 'Error: operation 0: bad op', 4);
  write('not-array.json', '{}');
  expectError(run(['not-array.json', 'doc.json']), 'Error: patch must be an array', 4);
  write('test-fail.json', '[{"op":"test","path":"/b","value":1}]');
  expectError(run(['test-fail.json', 'doc.json']), 'Error: operation 0: test failed', 4);
});
