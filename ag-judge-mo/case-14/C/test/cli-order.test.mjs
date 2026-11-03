import { test, describe, before, after } from 'node:test';
import path from 'node:path';
import {
  runCli, makeTmp, cleanup, writeFile, expectError, USAGE, LIMIT,
} from './helpers/cli-runner.mjs';

let tmp;
before(() => { tmp = makeTmp(); });
after(() => cleanup(tmp));

describe('patch input is checked before the document is touched', () => {
  test('invalid JSON patch, missing doc', () => {
    const p = writeFile(tmp, 'p1.json', '{');
    expectError(runCli([p, 'nope.json'], { cwd: tmp }), `Error: ${p}: invalid JSON`, 3);
  });
  test('too deep patch, missing doc', () => {
    const p = writeFile(tmp, 'p2.json', `${'['.repeat(1001)}${']'.repeat(1001)}`);
    expectError(runCli([p, 'nope.json'], { cwd: tmp }), `Error: ${p}: too deep`, 3);
  });
  test('invalid UTF-8 patch, doc is dir', () => {
    const p = writeFile(tmp, 'p3.json', Buffer.from([0xff]));
    expectError(runCli([p, tmp]), `Error: ${p}: invalid UTF-8`, 3);
  });
  test('too large patch, missing doc', () => {
    const p = writeFile(tmp, 'p4.json', Buffer.alloc(LIMIT + 1, 0x20));
    expectError(runCli([p, 'nope.json'], { cwd: tmp }), `Error: ${p}: too large`, 1);
  });
  test('invalid stdin patch, missing doc file', () => {
    expectError(runCli(['-', 'nope.json'], { input: '{', cwd: tmp }), 'Error: stdin: invalid JSON', 3);
  });
  test('missing patch file ignores valid stdin doc', () => {
    const p = path.join(tmp, 'absent.json');
    expectError(runCli([p], { input: '{}' }), `Error: ${p}: no such file`, 1);
  });
  test('missing patch file is reported before an invalid stdin doc', () => {
    const p = path.join(tmp, 'absent.json');
    expectError(runCli([p], { input: Buffer.from([0xff]) }), `Error: ${p}: no such file`, 1);
  });
});

describe('document input is checked before applying', () => {
  test('bad op patch with invalid JSON doc', () => {
    const p = writeFile(tmp, 'q1.json', '[{"op":"x"}]');
    const d = writeFile(tmp, 'd1.json', '{');
    expectError(runCli([p, d]), `Error: ${d}: invalid JSON`, 3);
  });
  test('form error is reported after doc read fails', () => {
    const p = writeFile(tmp, 'q2.json', '[{"op":"bogus"}]');
    const d = path.join(tmp, 'missing-doc.json');
    expectError(runCli([p, d]), `Error: ${d}: no such file`, 1);
  });
  test('form error is reported after doc is too deep', () => {
    const p = writeFile(tmp, 'q4.json', '[{"op":"bogus"}]');
    const d = writeFile(tmp, 'd4.json', '['.repeat(1001) + ']'.repeat(1001));
    expectError(runCli([p, d]), `Error: ${d}: too deep`, 3);
  });
});

describe('usage comes first', () => {
  test('three args, first invalid JSON', () => {
    const p = writeFile(tmp, 'q3.json', '{');
    expectError(runCli([p, 'a', 'b']), USAGE, 2);
  });
});
