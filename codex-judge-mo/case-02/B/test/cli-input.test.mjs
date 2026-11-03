import { test, describe, before, after } from 'node:test';
import fs from 'node:fs';
import {
  runCli, makeTmp, cleanup, writeFile, expectError, expectOk, LIMIT,
} from './helpers/cli-runner.mjs';

let tmp;
before(() => { tmp = makeTmp(); });
after(() => cleanup(tmp));

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const EMPTY = '[]';
let counter = 0;
const file = (content) => writeFile(tmp, `f${counter++}.json`, content);

const nestedArrays = (n) => '['.repeat(n) + ']'.repeat(n);
const nestedObjects = (n) => '{"a":'.repeat(n - 1) + '{}' + '}'.repeat(n - 1);
const mixed = (n) => {
  let s = '[]';
  for (let i = 1; i < n; i++) s = i % 2 ? `{"a":${s}}` : `[${s}]`;
  return s;
};
const testPatch = (value) => `[{"op":"test","path":"","value":${value}}]`;
const padded = (size) => Buffer.from(`[${' '.repeat(size - 2)}]`);
const bigString = (size) => Buffer.from(`"${'a'.repeat(size - 2)}"`);

describe('too large', () => {
  test('exactly the limit succeeds (file)', () => {
    const d = file(bigString(LIMIT));
    expectOk(runCli([file(EMPTY), d]), 'a'.repeat(LIMIT - 2));
  });
  test('limit plus one fails (file)', () => {
    const d = file(bigString(LIMIT + 1));
    expectError(runCli([file(EMPTY), d]), `Error: ${d}: too large`, 1);
  });
  test('exactly the limit succeeds (stdin)', () => {
    expectOk(runCli([file(EMPTY)], { input: padded(LIMIT) }), []);
  });
  test('limit plus one fails (stdin)', () => {
    expectError(runCli([file(EMPTY)], { input: padded(LIMIT + 1) }), 'Error: stdin: too large', 1);
  });
  test('patch over limit on stdin', () => {
    expectError(runCli(['-', file(EMPTY)], { input: padded(LIMIT + 1) }), 'Error: stdin: too large', 1);
  });
  test('BOM counts toward the limit', () => {
    const ok = file(Buffer.concat([BOM, padded(LIMIT - 3)]));
    expectOk(runCli([file(EMPTY), ok]), []);
    const bad = file(Buffer.concat([BOM, padded(LIMIT - 2)]));
    expectError(runCli([file(EMPTY), bad]), `Error: ${bad}: too large`, 1);
  });
  test('too large wins over invalid UTF-8', () => {
    const d = file(Buffer.alloc(LIMIT + 1, 0xff));
    expectError(runCli([file(EMPTY), d]), `Error: ${d}: too large`, 1);
  });
  test('/dev/zero counts bytes read', { skip: !fs.existsSync('/dev/zero') && 'no /dev/zero' }, () => {
    expectError(runCli([file(EMPTY), '/dev/zero']), 'Error: /dev/zero: too large', 1);
  });
});

describe('invalid UTF-8', () => {
  const samples = {
    'lone 0xff': [0xff],
    'truncated multibyte': [0x22, 0xc3, 0x22],
    'overlong': [0x22, 0xc0, 0xaf, 0x22],
    'surrogate': [0x22, 0xed, 0xa0, 0x80, 0x22],
    'UTF-16LE BOM': [0xff, 0xfe, 0x5b, 0x00, 0x5d, 0x00],
  };
  for (const [name, bytes] of Object.entries(samples)) {
    const buf = Buffer.from(bytes);
    test(`${name} in patch file`, () => {
      const p = file(buf);
      expectError(runCli([p], { input: '{}' }), `Error: ${p}: invalid UTF-8`, 3);
    });
    test(`${name} in doc file`, () => {
      const d = file(buf);
      expectError(runCli([file(EMPTY), d]), `Error: ${d}: invalid UTF-8`, 3);
    });
    test(`${name} on stdin`, () => {
      expectError(runCli([file(EMPTY)], { input: buf }), 'Error: stdin: invalid UTF-8', 3);
    });
  }
});

describe('byte order mark', () => {
  test('BOM in patch and doc', () => {
    const p = file(Buffer.concat([BOM, Buffer.from('[{"op":"add","path":"/a","value":1}]')]));
    const d = file(Buffer.concat([BOM, Buffer.from('{}')]));
    expectOk(runCli([p, d]), { a: 1 });
  });
  test('BOM-only input', () => {
    const d = file(BOM);
    expectError(runCli([file(EMPTY), d]), `Error: ${d}: invalid JSON`, 3);
  });
  test('two BOMs', () => {
    const d = file(Buffer.concat([BOM, BOM, Buffer.from('[]')]));
    expectError(runCli([file(EMPTY), d]), `Error: ${d}: invalid JSON`, 3);
  });
  test('BOM on stdin doc', () => {
    const stdin = Buffer.concat([BOM, Buffer.from('{"a":1}')]);
    expectOk(runCli([file(EMPTY)], { input: stdin }), { a: 1 });
  });
  test('BOM on stdin patch', () => {
    const stdin = Buffer.concat([BOM, Buffer.from('[{"op":"add","path":"/b","value":2}]')]);
    expectOk(runCli(['-', file('{"a":1}')], { input: stdin }), { a: 1, b: 2 });
  });
  test('two BOMs on stdin', () => {
    const stdin = Buffer.concat([BOM, BOM, Buffer.from('[]')]);
    expectError(runCli([file(EMPTY)], { input: stdin }), 'Error: stdin: invalid JSON', 3);
  });
  test('BOM after a space', () => {
    const d = file(Buffer.concat([Buffer.from(' '), BOM, Buffer.from('[]')]));
    expectError(runCli([file(EMPTY), d]), `Error: ${d}: invalid JSON`, 3);
  });
});

describe('invalid JSON', () => {
  const samples = {
    'empty': '', 'whitespace': ' \n\t ', 'open brace': '{',
    'single quotes': "{'a':1}", 'trailing comma': '[1,]', 'NaN': 'NaN',
  };
  for (const [name, text] of Object.entries(samples)) {
    test(`${name} as patch`, () => {
      const p = file(text);
      expectError(runCli([p], { input: '{}' }), `Error: ${p}: invalid JSON`, 3);
    });
    test(`${name} as doc`, () => {
      const d = file(text);
      expectError(runCli([file(EMPTY), d]), `Error: ${d}: invalid JSON`, 3);
    });
    test(`${name} on stdin`, () => {
      expectError(runCli([file(EMPTY)], { input: text }), 'Error: stdin: invalid JSON', 3);
    });
  }
});

describe('too deep', () => {
  test('patch depth 1000 ok, 1001 too deep', () => {
    const doc = nestedArrays(998);
    expectOk(runCli([file(testPatch(doc))], { input: doc }), JSON.parse(doc));
    const p = file(testPatch(nestedArrays(999)));
    expectError(runCli([p], { input: '{}' }), `Error: ${p}: too deep`, 3);
  });
  for (const [name, make] of [['arrays', nestedArrays], ['objects', nestedObjects], ['mixed', mixed]]) {
    test(`doc ${name} depth 1000 ok, 1001 too deep`, () => {
      expectOk(runCli([file(EMPTY), file(make(1000))]), JSON.parse(make(1000)));
      const d = file(make(1001));
      expectError(runCli([file(EMPTY), d]), `Error: ${d}: too deep`, 3);
    });
  }
  test('brackets and quotes inside strings do not count', () => {
    const s = `${'['.repeat(2000)}${'{'.repeat(2000)}\\"[[[[`;
    const text = `["${s}"]`;
    expectOk(runCli([file(EMPTY), file(text)]), JSON.parse(text));
  });
  test('escaped backslash before closing quote', () => {
    const make = (n) => `["\\\\", ${nestedArrays(n - 1)}]`;
    const bad = file(make(1001));
    expectError(runCli([file(EMPTY), bad]), `Error: ${bad}: too deep`, 3);
    expectOk(runCli([file(EMPTY), file(make(1000))]), JSON.parse(make(1000)));
  });
  test('huge depth within size limit', () => {
    const d = file(nestedArrays(LIMIT / 2));
    expectError(runCli([file(EMPTY), d]), `Error: ${d}: too deep`, 3);
  });
  test('invalid JSON reported before depth', () => {
    const d = file('['.repeat(1001));
    expectError(runCli([file(EMPTY), d]), `Error: ${d}: invalid JSON`, 3);
  });
});
