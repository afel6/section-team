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
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, input: input ?? '', maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: r.stdout.toString(), err: r.stderr.toString() };
}

function write(name, content) {
  fs.writeFileSync(path.join(dir, name), content);
  return name;
}

function expectError(r, code, message) {
  assert.equal(r.err, message + '\n');
  assert.equal(r.out, '');
  assert.equal(r.code, code);
}

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonpatch-'));
  write('patch.json', '[{"op":"add","path":"/1","value":5}]');
  write('doc.json', '{"b":0}');
  fs.mkdirSync(path.join(dir, 'adir'));
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('applies a patch from files', () => {
  const r = run(['patch.json', 'doc.json']);
  assert.equal(r.out, '{\n  "1": 5,\n  "b": 0\n}\n');
  assert.equal(r.err, '');
  assert.equal(r.code, 0);
});

test('document from stdin when omitted or -', () => {
  for (const args of [['patch.json'], ['patch.json', '-']]) {
    const r = run(args, '{"b":0}');
    assert.equal(r.out, '{\n  "1": 5,\n  "b": 0\n}\n');
    assert.equal(r.code, 0);
  }
});

test('patch from stdin', () => {
  const r = run(['-', 'doc.json'], '[]');
  assert.equal(r.out, '{\n  "b": 0\n}\n');
  assert.equal(r.code, 0);
});

test('byte order mark is ignored', () => {
  write('bom.json', '﻿[]');
  const r = run(['bom.json'], '﻿{"a":1}');
  assert.equal(r.out, '{\n  "a": 1\n}\n');
  write('bom2.json', '﻿﻿[]');
  expectError(run(['bom2.json', 'doc.json']), 3, 'Error: bom2.json: invalid JSON');
});

test('usage errors', () => {
  expectError(run([]), 2, USAGE.trimEnd());
  expectError(run(['a', 'b', 'c']), 2, USAGE.trimEnd());
  expectError(run(['-', '-']), 2, USAGE.trimEnd());
  expectError(run(['-']), 2, USAGE.trimEnd());
});

test('read errors', () => {
  expectError(run(['nope.json', 'doc.json']), 1, 'Error: nope.json: no such file');
  expectError(run(['patch.json/x', 'doc.json']), 1, 'Error: patch.json/x: no such file');
  expectError(run(['adir', 'doc.json']), 1, 'Error: adir: is a directory');
  expectError(run(['patch.json', 'nope.json']), 1, 'Error: nope.json: no such file');
  write('big.json', '[' + ' '.repeat(1048575) + ']');
  expectError(run(['big.json', 'doc.json']), 1, 'Error: big.json: too large');
  write('edge.json', '[' + ' '.repeat(1048574) + ']');
  assert.equal(run(['edge.json', 'doc.json']).code, 0);
  write('bigbom.json', '﻿[' + ' '.repeat(1048572) + ']');
  expectError(run(['bigbom.json', 'doc.json']), 1, 'Error: bigbom.json: too large');
});

test('unreadable file is cannot read', { skip: process.getuid?.() === 0 }, () => {
  write('locked.json', '[]');
  fs.chmodSync(path.join(dir, 'locked.json'), 0);
  expectError(run(['locked.json', 'doc.json']), 1, 'Error: locked.json: cannot read');
});

test('stdin too large', () => {
  expectError(run(['patch.json'], Buffer.alloc(1048577, 0x20)), 1, 'Error: stdin: too large');
});

test('decode, parse and depth errors', () => {
  write('bad.json', Buffer.from([0x5b, 0xff, 0x5d]));
  expectError(run(['bad.json', 'doc.json']), 3, 'Error: bad.json: invalid UTF-8');
  write('empty.json', '');
  expectError(run(['empty.json', 'doc.json']), 3, 'Error: empty.json: invalid JSON');
  expectError(run(['patch.json'], '{'), 3, 'Error: stdin: invalid JSON');
  expectError(run(['patch.json'], Buffer.from([0xc0, 0x80])), 3, 'Error: stdin: invalid UTF-8');
  write('deep.json', '['.repeat(1001) + ']'.repeat(1001));
  expectError(run(['deep.json', 'doc.json']), 3, 'Error: deep.json: too deep');
  write('ok.json', '{"a":' + '['.repeat(999) + ']'.repeat(999) + '}');
  assert.equal(run(['patch.json', 'ok.json']).code, 0);
  write('deepobj.json', '{"a":'.repeat(1001) + '1' + '}'.repeat(1001));
  expectError(run(['patch.json', 'deepobj.json']), 3, 'Error: deepobj.json: too deep');
});

test('patch input is fully checked before the document is read', () => {
  write('bad.json', Buffer.from([0x5b, 0xff, 0x5d]));
  expectError(run(['bad.json', 'nope.json']), 3, 'Error: bad.json: invalid UTF-8');
  expectError(run(['nope.json', 'bad.json']), 1, 'Error: nope.json: no such file');
});

test('patch errors exit 4', () => {
  write('badop.json', '[{"op":"nope"}]');
  expectError(run(['badop.json', 'doc.json']), 4, 'Error: operation 0: bad op');
  write('obj.json', '{}');
  expectError(run(['obj.json', 'doc.json']), 4, 'Error: patch must be an array');
  write('tf.json', '[{"op":"test","path":"","value":{"b":0}},{"op":"test","path":"/b","value":1}]');
  expectError(run(['tf.json', 'doc.json']), 4, 'Error: operation 1: test failed');
});
