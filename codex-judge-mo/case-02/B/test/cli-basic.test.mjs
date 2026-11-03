import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  runCli, makeTmp, cleanup, writeFile, expectError, expectOk, USAGE,
} from './helpers/cli-runner.mjs';

const isRoot = process.getuid?.() === 0;
let tmp;
before(() => { tmp = makeTmp(); });
after(() => cleanup(tmp));

const ADD = '[{"op":"add","path":"/a","value":1}]';

describe('success', () => {
  test('patch file and doc file', () => {
    const p = writeFile(tmp, 's1p.json', ADD);
    const d = writeFile(tmp, 's1d.json', '{"b":2}');
    expectOk(runCli([p, d]), { b: 2, a: 1 });
  });
  test('doc on stdin with one arg', () => {
    const p = writeFile(tmp, 's2p.json', ADD);
    expectOk(runCli([p], { input: '{"b":2}' }), { b: 2, a: 1 });
  });
  test('dash doc reads stdin', () => {
    const p = writeFile(tmp, 's3p.json', ADD);
    expectOk(runCli([p, '-'], { input: '{"b":2}' }), { b: 2, a: 1 });
  });
  test('dash patch reads stdin', () => {
    const d = writeFile(tmp, 's4d.json', '{"b":2}');
    expectOk(runCli(['-', d], { input: ADD }), { b: 2, a: 1 });
  });
  test('member order puts index names first', () => {
    const p = writeFile(tmp, 'ord.json', '[{"op":"add","path":"/1","value":5}]');
    const r = runCli([p], { input: '{"b":0}' });
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assert.equal(r.stdout, '{\n  "1": 5,\n  "b": 0\n}\n');
  });
  test('scalar results', () => {
    const p = writeFile(tmp, 'sc.json', '[{"op":"replace","path":"","value":"x"}]');
    assert.deepEqual(runCli([p], { input: '{}' }), { status: 0, stdout: '"x"\n', stderr: '' });
    const e = writeFile(tmp, 'empty.json', '[]');
    assert.deepEqual(runCli([e], { input: 'null' }), { status: 0, stdout: 'null\n', stderr: '' });
  });
  test('negative zero prints as 0', () => {
    const e = writeFile(tmp, 'e0.json', '[]');
    const r = runCli([e], { input: '{"a":-0}' });
    assert.equal(r.stdout, '{\n  "a": 0\n}\n');
    assert.equal(r.status, 0);
  });
  test('non-ASCII preserved', () => {
    const e = writeFile(tmp, 'e1.json', '[]');
    const d = writeFile(tmp, 'u.json', Buffer.from('["é日本"]', 'utf8'));
    const r = runCli([e, d]);
    assert.equal(r.stdout, '[\n  "é日本"\n]\n');
    assert.equal(r.status, 0);
  });
});

describe('usage', () => {
  const cases = [
    ['no args', []],
    ['three args', ['a', 'b', 'c']],
    ['dash alone', ['-']],
    ['two dashes', ['-', '-']],
    ['missing files with three args', ['missing.json', 'missing2.json', 'x']],
  ];
  for (const [name, args] of cases) {
    test(name, () => expectError(runCli(args, { input: '[]' }), USAGE, 2));
  }
  test('three existing files', () => {
    const f = writeFile(tmp, 'u3.json', '[]');
    expectError(runCli([f, f, f]), USAGE, 2);
  });
});

describe('patch errors', () => {
  const run = (patch, doc = '{}') => {
    const p = writeFile(tmp, 'pe.json', patch);
    return runCli([p], { input: doc });
  };
  test('bad op', () => expectError(run('[{"op":"x"}]'), 'Error: operation 0: bad op', 4));
  test('not an array', () => expectError(run('{}'), 'Error: patch must be an array', 4));
  test('test failed', () => {
    const patch = '[{"op":"add","path":"/a","value":1},{"op":"test","path":"/a","value":2}]';
    expectError(run(patch), 'Error: operation 1: test failed', 4);
  });
  test('path not found', () => {
    expectError(run('[{"op":"remove","path":"/q"}]'), 'Error: operation 0: path not found', 4);
  });
});

describe('names', () => {
  test('relative path as given', () => {
    fs.mkdirSync(path.join(tmp, 'sub'), { recursive: true });
    expectError(runCli(['sub/../nope.json'], { cwd: tmp }), 'Error: sub/../nope.json: no such file', 1);
  });
  test('absolute path as given', () => {
    const p = path.join(tmp, 'absent.json');
    expectError(runCli([p]), `Error: ${p}: no such file`, 1);
  });
  test('stdin named stdin', () => {
    const p = writeFile(tmp, 'nm.json', '[]');
    expectError(runCli([p], { input: '{' }), 'Error: stdin: invalid JSON', 3);
    expectError(runCli(['-', p], { input: '{' }), 'Error: stdin: invalid JSON', 3);
  });
});

describe('no such file', () => {
  test('missing patch', () => {
    const p = path.join(tmp, 'nopatch.json');
    expectError(runCli([p], { input: '{}' }), `Error: ${p}: no such file`, 1);
  });
  test('missing doc', () => {
    const p = writeFile(tmp, 'okp.json', '[]');
    const d = path.join(tmp, 'nodoc.json');
    expectError(runCli([p, d]), `Error: ${d}: no such file`, 1);
  });
  test('ENOTDIR', () => {
    const f = writeFile(tmp, 'reg.json', '[]');
    const arg = `${f}/x`;
    expectError(runCli([arg], { input: '{}' }), `Error: ${arg}: no such file`, 1);
  });
  test('missing dir component', () => {
    const arg = path.join(tmp, 'nodir', 'x.json');
    expectError(runCli([arg], { input: '{}' }), `Error: ${arg}: no such file`, 1);
  });
});

describe('is a directory', () => {
  test('patch arg is dir', () => {
    expectError(runCli([tmp], { input: '{}' }), `Error: ${tmp}: is a directory`, 1);
  });
  test('doc arg is dir', () => {
    const p = writeFile(tmp, 'dp.json', '[]');
    expectError(runCli([p, tmp]), `Error: ${tmp}: is a directory`, 1);
  });
  test('dir with mode 000', () => {
    const d = path.join(tmp, 'locked');
    fs.mkdirSync(d);
    fs.chmodSync(d, 0o000);
    try {
      expectError(runCli([d], { input: '{}' }), `Error: ${d}: is a directory`, 1);
    } finally {
      fs.chmodSync(d, 0o755);
    }
  });
});

describe('cannot read', () => {
  test('stdin that cannot be read', () => {
    const p = writeFile(tmp, 'sd1.json', '[]');
    const fd = fs.openSync(tmp, 'r');
    try {
      expectError(runCli([p], { stdin: fd }), 'Error: stdin: cannot read', 1);
    } finally {
      fs.closeSync(fd);
    }
  });
  test('patch on stdin that cannot be read', () => {
    const d = writeFile(tmp, 'sd2.json', '{}');
    const fd = fs.openSync(tmp, 'r');
    try {
      expectError(runCli(['-', d], { stdin: fd }), 'Error: stdin: cannot read', 1);
    } finally {
      fs.closeSync(fd);
    }
  });
  test('symlink loop', () => {
    const loop = path.join(tmp, 'loop');
    fs.symlinkSync('loop', loop);
    expectError(runCli([loop], { input: '{}' }), `Error: ${loop}: cannot read`, 1);
  });
  test('mode 000 file', { skip: isRoot && 'running as root' }, () => {
    const f = writeFile(tmp, 'secret.json', '[]');
    fs.chmodSync(f, 0o000);
    expectError(runCli([f], { input: '{}' }), `Error: ${f}: cannot read`, 1);
  });
  test('mode 000 large file is cannot read', { skip: isRoot && 'running as root' }, () => {
    const f = writeFile(tmp, 'secretbig.json', Buffer.alloc(1048577, 0x20));
    fs.chmodSync(f, 0o000);
    expectError(runCli([f], { input: '{}' }), `Error: ${f}: cannot read`, 1);
  });
});
