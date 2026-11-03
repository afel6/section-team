import { test, before, after } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { run, expectError, expectOk, makeTmp, removeTmp, put, nestedArrays, mixedNesting, padded, MAX } from './cli-helpers.mjs';

let dir;
const r = (args, o = {}) => run(args, { cwd: dir, ...o });

before(() => {
  dir = makeTmp();
  put(dir, 'p.json', '[]');
  put(dir, 'd.json', '{"a":1}');
  fs.mkdirSync(path.join(dir, 'adir'));
});
after(() => removeTmp(dir));

// ---- invalid UTF-8 ----
const badUtf8 = {
  'raw 0xFF': Buffer.from([0x5b, 0x22, 0xff, 0x22, 0x5d]),
  'overlong C0 80': Buffer.from([0x5b, 0x22, 0xc0, 0x80, 0x22, 0x5d]),
  'encoded surrogate ED A0 80': Buffer.from([0x5b, 0x22, 0xed, 0xa0, 0x80, 0x22, 0x5d]),
  'truncated E2 82': Buffer.from([0x5b, 0x22, 0xe2, 0x82]),
};
for (const [label, bytes] of Object.entries(badUtf8)) {
  test(`invalid UTF-8 (${label}): patch file`, () => {
    put(dir, 'bad.json', bytes);
    expectError(r(['bad.json', 'd.json']), 'Error: bad.json: invalid UTF-8', 3);
  });
  test(`invalid UTF-8 (${label}): doc file`, () => {
    put(dir, 'bad.json', bytes);
    expectError(r(['p.json', 'bad.json']), 'Error: bad.json: invalid UTF-8', 3);
  });
  test(`invalid UTF-8 (${label}): stdin`, () =>
    expectError(r(['p.json'], { input: bytes }), 'Error: stdin: invalid UTF-8', 3));
}

// ---- invalid JSON ----
const badJson = {
  'empty': '',
  'whitespace only': ' \n\t ',
  'open brace': '{',
  'trailing comma': '[1,]',
  'undefined': 'undefined',
};
for (const [label, text] of Object.entries(badJson)) {
  test(`invalid JSON (${label}): patch`, () => {
    put(dir, 'bad.json', text);
    expectError(r(['bad.json', 'd.json']), 'Error: bad.json: invalid JSON', 3);
  });
  test(`invalid JSON (${label}): doc`, () => {
    put(dir, 'bad.json', text);
    expectError(r(['p.json', 'bad.json']), 'Error: bad.json: invalid JSON', 3);
  });
}
test('invalid JSON: empty stdin as doc', () =>
  expectError(r(['p.json'], { input: '' }), 'Error: stdin: invalid JSON', 3));
test('invalid JSON: empty stdin as patch', () =>
  expectError(r(['-', 'd.json'], { input: '' }), 'Error: stdin: invalid JSON', 3));

// ---- depth ----
test('too deep: patch of 1001 nested arrays', () => {
  put(dir, 'deep.json', nestedArrays(1001));
  expectError(r(['deep.json', 'd.json']), 'Error: deep.json: too deep', 3);
});
test('depth 1000 patch is not too deep (fails in apply)', () => {
  put(dir, 'deep.json', nestedArrays(1000));
  expectError(r(['deep.json', 'd.json']), 'Error: operation 0: not an object', 4);
});
test('doc of depth 1000 with [] patch succeeds', () => {
  const text = nestedArrays(1000);
  put(dir, 'deepdoc.json', text);
  expectOk(r(['p.json', 'deepdoc.json']), JSON.parse(text));
});
test('too deep: doc of depth 1001', () => {
  put(dir, 'deepdoc.json', nestedArrays(1001));
  expectError(r(['p.json', 'deepdoc.json']), 'Error: deepdoc.json: too deep', 3);
});
test('too deep: doc of depth 1001 via stdin', () =>
  expectError(r(['p.json'], { input: nestedArrays(1001) }), 'Error: stdin: too deep', 3));
test('object nesting: depth 1001 too deep', () => {
  put(dir, 'deepdoc.json', '{"a":'.repeat(1001) + '1' + '}'.repeat(1001));
  expectError(r(['p.json', 'deepdoc.json']), 'Error: deepdoc.json: too deep', 3);
});
test('object nesting: depth 1000 ok', () => {
  const text = '{"a":'.repeat(1000) + '1' + '}'.repeat(1000);
  put(dir, 'deepdoc.json', text);
  expectOk(r(['p.json', 'deepdoc.json']), JSON.parse(text));
});
test('mixed array/object nesting: depth 1001 too deep', () => {
  put(dir, 'deepdoc.json', mixedNesting(1001));
  expectError(r(['p.json', 'deepdoc.json']), 'Error: deepdoc.json: too deep', 3);
});
test('mixed array/object nesting: depth 1000 ok', () => {
  const text = mixedNesting(1000);
  put(dir, 'deepdoc.json', text);
  expectOk(r(['p.json', 'deepdoc.json']), JSON.parse(text));
});

// ---- size ----
test('size: doc of exactly 1048576 bytes ok', () => {
  put(dir, 'big.json', padded(MAX));
  expectOk(r(['p.json', 'big.json']), []);
});
test('size: doc of 1048577 bytes too large', () => {
  put(dir, 'big.json', padded(MAX + 1));
  expectError(r(['p.json', 'big.json']), 'Error: big.json: too large', 1);
});
test('size: patch of 1048577 bytes too large', () => {
  put(dir, 'big.json', padded(MAX + 1));
  expectError(r(['big.json', 'd.json']), 'Error: big.json: too large', 1);
});
test('size: BOM + content totalling 1048576 ok', () => {
  put(dir, 'big.json', padded(MAX, true));
  expectOk(r(['p.json', 'big.json']), []);
});
test('size: BOM + content totalling 1048577 too large (BOM counted)', () => {
  put(dir, 'big.json', padded(MAX + 1, true));
  expectError(r(['p.json', 'big.json']), 'Error: big.json: too large', 1);
});
test('size: stdin of exactly 1048576 bytes ok', () =>
  expectOk(r(['p.json'], { input: padded(MAX) }), []));
test('size: stdin of 1048577 bytes too large', () =>
  expectError(r(['p.json'], { input: padded(MAX + 1) }), 'Error: stdin: too large', 1));
test('size: stdin BOM + content totalling 1048576 ok', () =>
  expectOk(r(['p.json'], { input: padded(MAX, true) }), []));
test('size: stdin BOM + content totalling 1048577 too large (BOM counted)', () =>
  expectError(r(['p.json'], { input: padded(MAX + 1, true) }), 'Error: stdin: too large', 1));
test('size: too large wins over invalid UTF-8', () => {
  put(dir, 'big.json', Buffer.alloc(MAX + 1, 0xff));
  expectError(r(['p.json', 'big.json']), 'Error: big.json: too large', 1);
});
test('size: too large wins over invalid UTF-8 on stdin', () =>
  expectError(r(['p.json'], { input: Buffer.alloc(MAX + 1, 0xff) }), 'Error: stdin: too large', 1));

// ---- no such file / directory ----
test('missing patch file', () =>
  expectError(r(['nope.json', 'd.json']), 'Error: nope.json: no such file', 1));
test('missing doc file', () =>
  expectError(r(['p.json', 'nope.json']), 'Error: nope.json: no such file', 1));
test('ENOTDIR: patch.json/x where patch.json is a regular file', () =>
  expectError(r(['p.json/x', 'd.json']), 'Error: p.json/x: no such file', 1));
test('ENOTDIR on doc', () =>
  expectError(r(['p.json', 'd.json/x']), 'Error: d.json/x: no such file', 1));
test('missing directory component', () =>
  expectError(r(['nodir/x.json', 'd.json']), 'Error: nodir/x.json: no such file', 1));
test('patch arg is a directory', () =>
  expectError(r(['adir', 'd.json']), 'Error: adir: is a directory', 1));
test('doc arg is a directory', () =>
  expectError(r(['p.json', 'adir']), 'Error: adir: is a directory', 1));
test('"." as doc is a directory', () =>
  expectError(r(['p.json', '.']), 'Error: .: is a directory', 1));

// ---- cannot read ----
test('stdin that is a directory -> cannot read', () => {
  const fd = fs.openSync(dir, 'r');
  try {
    expectError(r(['p.json'], { stdio: [fd, 'pipe', 'pipe'] }), 'Error: stdin: cannot read', 1);
  } finally {
    fs.closeSync(fd);
  }
});
test('file that opens but fails on read (/proc/self/mem)', { skip: !fs.existsSync('/proc/self/mem') }, () =>
  expectError(r(['p.json', '/proc/self/mem']), 'Error: /proc/self/mem: cannot read', 1));
