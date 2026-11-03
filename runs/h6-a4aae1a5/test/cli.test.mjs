import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../jsonpatch-cli.mjs', import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonpatch-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function file(name, content) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

function run(args, input) {
  const r = spawnSync(process.execPath, [CLI, ...args], { input: input ?? '', cwd: dir, maxBuffer: 1 << 30 });
  return { code: r.status, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

test('success with files and stdin', () => {
  const p = file('p.json', '[{"op":"add","path":"/1","value":5}]');
  const d = file('d.json', '﻿{"b":0}');
  const expected = '{\n  "1": 5,\n  "b": 0\n}\n';
  assert.deepEqual(run([p, d]), { code: 0, stdout: expected, stderr: '' });
  assert.deepEqual(run([p], '{"b":0}'), { code: 0, stdout: expected, stderr: '' });
  assert.deepEqual(run(['-', d], '[{"op":"add","path":"/1","value":5}]'), { code: 0, stdout: expected, stderr: '' });
  assert.equal(run([file('e.json', '[]'), file('z.json', '[-0,[],{}]')]).stdout, '[\n  0,\n  [],\n  {}\n]\n');
});

test('output matches JSON.stringify(result, null, 2)', () => {
  const text = '{"a":"\\u2028x\\"\\ud800","1":[1.5e300,-0,true,null,{}],"__proto__":{"b":[[]]},"":"\\u00e9"}';
  const r = run([file('p0.json', '[]'), file('d0.json', text)]);
  assert.equal(r.stdout, JSON.stringify(JSON.parse(text), null, 2) + '\n');
  assert.equal(r.code, 0);
  assert.deepEqual(run([file('p00.json', '[]')], ''), { code: 3, stdout: '', stderr: 'Error: stdin: invalid JSON\n' });
});

test('usage', () => {
  const usage = 'Usage: node jsonpatch-cli.mjs <patch> [<doc>]\n';
  assert.deepEqual(run([]), { code: 2, stdout: '', stderr: usage });
  assert.deepEqual(run(['a', 'b', 'c']), { code: 2, stdout: '', stderr: usage });
  assert.deepEqual(run(['-']), { code: 2, stdout: '', stderr: usage });
  assert.deepEqual(run(['-', '-']), { code: 2, stdout: '', stderr: usage });
});

test('read errors', () => {
  const p = file('ok.json', '[]');
  assert.deepEqual(run(['nope.json', p]), { code: 1, stdout: '', stderr: 'Error: nope.json: no such file\n' });
  assert.equal(run([p + '/x', p]).stderr, `Error: ${p}/x: no such file\n`);
  assert.deepEqual(run([dir, p]), { code: 1, stdout: '', stderr: `Error: ${dir}: is a directory\n` });
  const big = file('big.json', '"' + 'a'.repeat(1048575) + '"');
  assert.equal(run([big, p]).stderr, `Error: ${big}: too large\n`);
  const fits = file('fits.json', '"' + 'a'.repeat(1048574) + '"');
  assert.equal(run([p, fits]).code, 0);
  assert.deepEqual(run([p], ' '.repeat(1048577)), { code: 1, stdout: '', stderr: 'Error: stdin: too large\n' });
});

test('parse errors', () => {
  const p = file('ok2.json', '[]');
  assert.deepEqual(run([file('bad.json', Buffer.from([0x5b, 0xff, 0x5d])), p]), {
    code: 3, stdout: '', stderr: `Error: ${path.join(dir, 'bad.json')}: invalid UTF-8\n`,
  });
  assert.equal(run([p, file('empty.json', '')]).stderr, `Error: ${path.join(dir, 'empty.json')}: invalid JSON\n`);
  assert.equal(run([p], '{').stderr, 'Error: stdin: invalid JSON\n');
  assert.equal(run([p], '['.repeat(1000) + ']'.repeat(1000)).code, 0);
  assert.deepEqual(run([p], '['.repeat(1001) + ']'.repeat(1001)), { code: 3, stdout: '', stderr: 'Error: stdin: too deep\n' });
  // The doc is not read until the patch passes every check.
  assert.equal(run([file('deep.json', '['.repeat(1001) + ']'.repeat(1001)), 'nope.json']).stderr,
    `Error: ${path.join(dir, 'deep.json')}: too deep\n`);
});

test('patch errors', () => {
  const d = file('d2.json', '{}');
  assert.deepEqual(run([file('p1.json', '[{"op":"x"}]'), d]), { code: 4, stdout: '', stderr: 'Error: operation 0: bad op\n' });
  assert.equal(run([file('p2.json', '{}'), d]).stderr, 'Error: patch must be an array\n');
});

test('deep results are printed', () => {
  // Each copy appends a 999-deep value to the innermost array of /a.
  const chain = '['.repeat(999) + ']'.repeat(999);
  const ops = Array.from({ length: 10 }, (_, i) => ({ op: 'copy', from: '/v', path: '/a' + '/0'.repeat(998 + 999 * i) + '/-' }));
  const r = run([file('grow.json', JSON.stringify(ops))], `{"v":${chain},"a":${chain}}`);
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  let n = 0;
  for (let v = JSON.parse(r.stdout).a; Array.isArray(v); v = v[0]) n++;
  assert.equal(n, 10989);
});
