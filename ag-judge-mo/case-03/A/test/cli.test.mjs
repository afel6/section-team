import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../jsonpatch-cli.mjs', import.meta.url));
let dir;

function run(args, input) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, input: input ?? '', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

function write(name, content) {
  fs.writeFileSync(path.join(dir, name), content);
}

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonpatch-cli-'));
  write('patch.json', '[{"op":"add","path":"/1","value":5}]');
  write('doc.json', '{"b":0}');
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('success with files and stdin', () => {
  const expected = '{\n  "1": 5,\n  "b": 0\n}\n';
  assert.deepEqual(run(['patch.json', 'doc.json']), { code: 0, stdout: expected, stderr: '' });
  assert.deepEqual(run(['patch.json'], '{"b":0}'), { code: 0, stdout: expected, stderr: '' });
  assert.deepEqual(run(['-', 'doc.json'], '[{"op":"add","path":"/1","value":5}]'), { code: 0, stdout: expected, stderr: '' });
});

test('BOM is ignored and -0 kept', () => {
  write('bom.json', '﻿{"a":-0}');
  assert.deepEqual(run(['-', 'bom.json'], '[]'), { code: 0, stdout: '{\n  "a": 0\n}\n', stderr: '' });
});

test('usage errors', () => {
  const usage = 'Usage: node jsonpatch-cli.mjs <patch> [<doc>]\n';
  assert.deepEqual(run([]), { code: 2, stdout: '', stderr: usage });
  assert.deepEqual(run(['a', 'b', 'c']), { code: 2, stdout: '', stderr: usage });
  assert.deepEqual(run(['-']), { code: 2, stdout: '', stderr: usage });
  assert.deepEqual(run(['-', '-']), { code: 2, stdout: '', stderr: usage });
});

test('read errors', () => {
  assert.deepEqual(run(['nope.json', 'doc.json']), { code: 1, stdout: '', stderr: 'Error: nope.json: no such file\n' });
  assert.deepEqual(run(['patch.json/x', 'doc.json']), { code: 1, stdout: '', stderr: 'Error: patch.json/x: no such file\n' });
  assert.deepEqual(run(['.', 'doc.json']), { code: 1, stdout: '', stderr: 'Error: .: is a directory\n' });
  write('big.json', ' '.repeat(1048575) + '[]');
  assert.deepEqual(run(['big.json', 'doc.json']), { code: 1, stdout: '', stderr: 'Error: big.json: too large\n' });
  assert.deepEqual(run(['patch.json'], ' '.repeat(1048577)), { code: 1, stdout: '', stderr: 'Error: stdin: too large\n' });
  if (fs.existsSync('/dev/zero')) {
    assert.deepEqual(run(['-', '/dev/zero'], '[]'), { code: 1, stdout: '', stderr: 'Error: /dev/zero: too large\n' });
  }
  fs.mkdirSync(path.join(dir, 'locked'));
  fs.chmodSync(path.join(dir, 'locked'), 0);
  assert.deepEqual(run(['locked', 'doc.json']), { code: 1, stdout: '', stderr: 'Error: locked: is a directory\n' });
  write('ok-size.json', ' '.repeat(1048574) + '[]');
  assert.equal(run(['ok-size.json', 'doc.json']).code, 0);
});

test('decode, parse and depth errors', () => {
  write('bad-utf8.json', Buffer.from([0x5b, 0xff, 0x5d]));
  assert.deepEqual(run(['bad-utf8.json', 'doc.json']), { code: 3, stdout: '', stderr: 'Error: bad-utf8.json: invalid UTF-8\n' });
  assert.deepEqual(run(['patch.json'], ''), { code: 3, stdout: '', stderr: 'Error: stdin: invalid JSON\n' });
  write('deep.json', '['.repeat(1001) + ']'.repeat(1001));
  assert.deepEqual(run(['patch.json', 'deep.json']), { code: 3, stdout: '', stderr: 'Error: deep.json: too deep\n' });
  write('deep-ok.json', '['.repeat(1000) + ']'.repeat(1000));
  assert.equal(run(['-', 'deep-ok.json'], '[]').code, 0);
});

test('patch input is checked before the document is read', () => {
  assert.deepEqual(run(['-', 'nope.json'], '{'), { code: 3, stdout: '', stderr: 'Error: stdin: invalid JSON\n' });
});

test('patch errors', () => {
  assert.deepEqual(run(['-', 'doc.json'], '[{"op":"nope"}]'), { code: 4, stdout: '', stderr: 'Error: operation 0: bad op\n' });
  assert.deepEqual(run(['-', 'doc.json'], '{}'), { code: 4, stdout: '', stderr: 'Error: patch must be an array\n' });
});
