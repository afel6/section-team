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

function expectError({ code, out, err }, expectedCode, line) {
  assert.equal(err, line + '\n');
  assert.equal(out, '');
  assert.equal(code, expectedCode);
}

function nested(depth) {
  return '['.repeat(depth) + ']'.repeat(depth);
}

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonpatch-cli-'));
  write('patch.json', '[{"op":"add","path":"/1","value":5}]');
  write('doc.json', '{"b":0}');
  write('empty-patch.json', '[]');
  fs.mkdirSync(path.join(dir, 'adir'));
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('success: files', () => {
  const r = run(['patch.json', 'doc.json']);
  assert.equal(r.out, '{\n  "1": 5,\n  "b": 0\n}\n');
  assert.equal(r.err, '');
  assert.equal(r.code, 0);
});

test('success: doc from stdin, implicit and with -', () => {
  for (const args of [['patch.json'], ['patch.json', '-']]) {
    const r = run(args, '{"b":0}');
    assert.equal(r.out, '{\n  "1": 5,\n  "b": 0\n}\n');
    assert.equal(r.code, 0);
  }
});

test('success: patch from stdin', () => {
  const r = run(['-', 'doc.json'], '[{"op":"remove","path":"/b"}]');
  assert.equal(r.out, '{}\n');
  assert.equal(r.code, 0);
});

test('success: primitive result and BOM', () => {
  write('bom.json', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('"x"')]));
  const r = run(['empty-patch.json', 'bom.json']);
  assert.equal(r.out, '"x"\n');
  assert.equal(r.code, 0);
});

test('only one BOM is ignored', () => {
  write('bom2.json', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf]), Buffer.from('1')]));
  expectError(run(['empty-patch.json', 'bom2.json']), 3, 'Error: bom2.json: invalid JSON');
});

test('usage errors', () => {
  expectError(run([]), 2, USAGE.trimEnd());
  expectError(run(['a', 'b', 'c']), 2, USAGE.trimEnd());
  expectError(run(['-']), 2, USAGE.trimEnd());
  expectError(run(['-', '-']), 2, USAGE.trimEnd());
});

test('read errors', () => {
  expectError(run(['nope.json', 'doc.json']), 1, 'Error: nope.json: no such file');
  expectError(run(['patch.json/x', 'doc.json']), 1, 'Error: patch.json/x: no such file');
  expectError(run(['adir', 'doc.json']), 1, 'Error: adir: is a directory');
  expectError(run(['patch.json', 'adir']), 1, 'Error: adir: is a directory');
  expectError(run(['patch.json', 'missing/doc.json']), 1, 'Error: missing/doc.json: no such file');
});

test('too large counts bytes read, BOM included', () => {
  const limit = 1048576;
  write('exact.json', '"' + 'a'.repeat(limit - 2) + '"');
  assert.equal(run(['empty-patch.json', 'exact.json']).code, 0);
  write('big.json', '"' + 'a'.repeat(limit - 1) + '"');
  expectError(run(['empty-patch.json', 'big.json']), 1, 'Error: big.json: too large');
  write('bigbom.json', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('"' + 'a'.repeat(limit - 4) + '"')]));
  expectError(run(['empty-patch.json', 'bigbom.json']), 1, 'Error: bigbom.json: too large');
  expectError(run(['empty-patch.json'], '"' + 'a'.repeat(limit) + '"'), 1, 'Error: stdin: too large');
});

test('decode and parse errors', () => {
  write('bad-utf8.json', Buffer.from([0x22, 0xff, 0x22]));
  expectError(run(['bad-utf8.json', 'doc.json']), 3, 'Error: bad-utf8.json: invalid UTF-8');
  write('surrogate.json', Buffer.from([0x22, 0xed, 0xa0, 0x80, 0x22]));
  expectError(run(['empty-patch.json', 'surrogate.json']), 3, 'Error: surrogate.json: invalid UTF-8');
  write('empty.json', '');
  expectError(run(['empty.json', 'doc.json']), 3, 'Error: empty.json: invalid JSON');
  write('trailing.json', '[],');
  expectError(run(['trailing.json', 'doc.json']), 3, 'Error: trailing.json: invalid JSON');
  expectError(run(['patch.json'], '{'), 3, 'Error: stdin: invalid JSON');
  expectError(run(['patch.json'], Buffer.from([0xc0, 0x80])), 3, 'Error: stdin: invalid UTF-8');
});

test('depth limit', () => {
  write('d1000.json', nested(1000));
  assert.equal(run(['empty-patch.json', 'd1000.json']).code, 0);
  write('d1001.json', nested(1001));
  expectError(run(['empty-patch.json', 'd1001.json']), 3, 'Error: d1001.json: too deep');
  write('obj1001.json', '{"a":'.repeat(1001) + '1' + '}'.repeat(1001));
  expectError(run(['obj1001.json', 'doc.json']), 3, 'Error: obj1001.json: too deep');
});

test('step order: patch fully checked before doc is read', () => {
  write('notarray.json', '{}');
  expectError(run(['nope.json', 'adir']), 1, 'Error: nope.json: no such file');
  expectError(run(['d1001.json', 'nope.json']), 3, 'Error: d1001.json: too deep');
  expectError(run(['empty.json', 'nope.json']), 3, 'Error: empty.json: invalid JSON');
  expectError(run(['notarray.json', 'empty.json']), 3, 'Error: empty.json: invalid JSON');
});

test('step order: patch form rules are checked only when applying', () => {
  write('badop.json', '[{"op":"nope"}]');
  expectError(run(['badop.json', 'nope.json']), 1, 'Error: nope.json: no such file');
});

test('output is exactly JSON.stringify(result, null, 2)', () => {
  write('negzero.json', '{"a":-0,"s":"é","n":[1.5e3]}');
  const r = run(['empty-patch.json', 'negzero.json']);
  assert.equal(r.out, JSON.stringify({ a: -0, s: 'é', n: [1500] }, null, 2) + '\n');
  assert.equal(r.code, 0);
});

test('patch errors', () => {
  write('notarray.json', '{}');
  expectError(run(['notarray.json', 'doc.json']), 4, 'Error: patch must be an array');
  write('badop.json', '[{"op":"nope"}]');
  expectError(run(['badop.json', 'doc.json']), 4, 'Error: operation 0: bad op');
  write('testfail.json', '[{"op":"test","path":"/b","value":0},{"op":"test","path":"/b","value":1}]');
  expectError(run(['testfail.json', 'doc.json']), 4, 'Error: operation 1: test failed');
});
