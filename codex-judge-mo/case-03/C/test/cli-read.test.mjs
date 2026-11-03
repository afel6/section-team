import { after, before, describe, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  BOM,
  MAX_BYTES,
  expectError,
  expectOk,
  makeTmpDir,
  paddedJson,
  removeTmpDir,
  run,
  writeIn,
} from './helpers/cli-runner.mjs';

let dir;
let lockedDir;

before(() => {
  dir = makeTmpDir();
});

after(() => {
  if (lockedDir) fs.chmodSync(lockedDir, 0o755);
  removeTmpDir(dir);
});

describe('read errors', () => {
  test('ENOENT', () => {
    const p = path.join(dir, 'nope.json');
    expectError(run([p]), `Error: ${p}: no such file`, 1);
  });
  test('ENOENT for doc', () => {
    const p = writeIn(dir, 'r-p.json', '[]');
    const d = path.join(dir, 'nope-doc.json');
    expectError(run([p, d]), `Error: ${d}: no such file`, 1);
  });
  test('ENOTDIR', () => {
    const file = writeIn(dir, 'r-file.txt', '[]');
    const p = `${file}/x`;
    expectError(run([p]), `Error: ${p}: no such file`, 1);
  });
  test('directory as patch', () => {
    expectError(run([dir]), `Error: ${dir}: is a directory`, 1);
  });
  test('directory as doc', () => {
    const p = writeIn(dir, 'r-p2.json', '[]');
    expectError(run([p, dir]), `Error: ${dir}: is a directory`, 1);
  });
  test('directory with mode 000', () => {
    lockedDir = path.join(dir, 'locked');
    fs.mkdirSync(lockedDir);
    fs.chmodSync(lockedDir, 0o000);
    expectError(run([lockedDir]), `Error: ${lockedDir}: is a directory`, 1);
    fs.chmodSync(lockedDir, 0o755);
  });
  test('symlink loop is cannot read', () => {
    const loop = path.join(dir, 'loop');
    fs.symlinkSync('loop', loop);
    expectError(run([loop]), `Error: ${loop}: cannot read`, 1);
  });
  test('300-char file name is cannot read', () => {
    const p = path.join(dir, 'a'.repeat(300));
    expectError(run([p]), `Error: ${p}: cannot read`, 1);
  });
});

describe('size boundary', () => {
  test('exactly 1048576 bytes patch is OK', () => {
    const p = writeIn(dir, 's-p.json', paddedJson(MAX_BYTES));
    const d = writeIn(dir, 's-d.json', '[1]');
    expectOk(run([p, d]), '[\n  1\n]\n');
  });
  test('1048577 bytes patch is too large', () => {
    const p = writeIn(dir, 's-p2.json', paddedJson(MAX_BYTES + 1));
    expectError(run([p, path.join(dir, 'x')]), `Error: ${p}: too large`, 1);
  });
  test('exactly 1048576 bytes doc is OK', () => {
    const p = writeIn(dir, 's-p3.json', '[]');
    const d = writeIn(dir, 's-d3.json', paddedJson(MAX_BYTES));
    expectOk(run([p, d]), '[]\n');
  });
  test('1048577 bytes doc is too large', () => {
    const p = writeIn(dir, 's-p4.json', '[]');
    const d = writeIn(dir, 's-d4.json', paddedJson(MAX_BYTES + 1));
    expectError(run([p, d]), `Error: ${d}: too large`, 1);
  });
  test('BOM + 1048574 bytes (total 1048577) is too large', () => {
    const p = writeIn(dir, 's-p5.json', Buffer.concat([BOM, paddedJson(MAX_BYTES - 2)]));
    expectError(run([p, path.join(dir, 'x')]), `Error: ${p}: too large`, 1);
  });
  test('BOM + 1048573 bytes (total 1048576) is OK', () => {
    const p = writeIn(dir, 's-p6.json', Buffer.concat([BOM, paddedJson(MAX_BYTES - 3)]));
    const d = writeIn(dir, 's-d6.json', '[1]');
    expectOk(run([p, d]), '[\n  1\n]\n');
  });
  test('/dev/zero as patch is too large (bytes read, not stat size)', () => {
    expectError(run(['/dev/zero']), 'Error: /dev/zero: too large', 1);
  });
});

describe('stdin', () => {
  test('stdin over limit is too large', () => {
    const p = writeIn(dir, 'i-p.json', '[]');
    const input = Buffer.alloc(MAX_BYTES + 1, 0x20);
    expectError(run([p], { input }), 'Error: stdin: too large', 1);
  });
  test('stdin exactly at limit is OK', () => {
    const p = writeIn(dir, 'i-p2.json', '[]');
    expectOk(run([p], { input: paddedJson(MAX_BYTES) }), '[]\n');
  });
  test('stdin patch over limit is too large', () => {
    const d = writeIn(dir, 'i-d.json', '{}');
    const input = Buffer.alloc(MAX_BYTES + 1, 0x20);
    expectError(run(['-', d], { input }), 'Error: stdin: too large', 1);
  });
  test('stdin that is a directory is cannot read', () => {
    const p = writeIn(dir, 'i-p3.json', '[]');
    const fd = fs.openSync(dir, 'r');
    try {
      expectError(run([p], { stdio: [fd, 'pipe', 'pipe'] }), 'Error: stdin: cannot read', 1);
    } finally {
      fs.closeSync(fd);
    }
  });
});
