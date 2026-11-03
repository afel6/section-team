import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { run, expectError, expectOk, makeTmp, removeTmp, put, nestedArrays, USAGE, BOM } from './cli-helpers.mjs';

let dir;
const r = (args, o = {}) => run(args, { cwd: dir, ...o });

before(() => {
  dir = makeTmp();
  put(dir, 'empty-patch.json', '[]');
  put(dir, 'doc.json', '{"a":1}');
  put(dir, 'add.json', '[{"op":"add","path":"/b","value":2}]');
  put(dir, 'bad-json.json', '{');
  put(dir, 'obj.json', '{}');
  put(dir, 'badop.json', '[{"op":"bad","path":""}]');
});
after(() => removeTmp(dir));

// ---- usage ----
test('usage: 0 args', () => expectError(r([]), USAGE, 2));
test('usage: 3 args with existing files', () =>
  expectError(r(['empty-patch.json', 'doc.json', 'doc.json']), USAGE, 2));
test('usage: "-" alone means both stdin', () => expectError(r(['-'], { input: '[]' }), USAGE, 2));
test('usage: "- -"', () => expectError(r(['-', '-'], { input: '[]' }), USAGE, 2));
test('usage: 3 args with missing first file is usage, not no such file', () =>
  expectError(r(['missing.json', 'doc.json', 'doc.json']), USAGE, 2));

// ---- success ----
test('success: patch file + doc file', () => expectOk(r(['add.json', 'doc.json']), { a: 1, b: 2 }));
test('success: patch file + doc from stdin (1 arg)', () =>
  expectOk(r(['add.json'], { input: '{"a":1}' }), { a: 1, b: 2 }));
test('success: patch file + explicit "-" doc', () =>
  expectOk(r(['add.json', '-'], { input: '{"a":1}' }), { a: 1, b: 2 }));
test('success: patch from stdin "-" + doc file', () =>
  expectOk(r(['-', 'doc.json'], { input: '[{"op":"add","path":"/b","value":2}]' }), { a: 1, b: 2 }));
test('success: empty patch prints doc pretty', () => {
  const res = r(['empty-patch.json', 'doc.json']);
  assert.equal(res.stdout, '{\n  "a": 1\n}\n');
  expectOk(res, { a: 1 });
});
test('success: member order {"1":5,"b":0}', () => {
  put(dir, 'order-patch.json', '[{"op":"add","path":"/1","value":5}]');
  put(dir, 'order-doc.json', '{"b":0}');
  const res = r(['order-patch.json', 'order-doc.json']);
  assert.equal(res.code, 0);
  assert.equal(res.stderr, '');
  assert.equal(res.stdout, '{\n  "1": 5,\n  "b": 0\n}\n');
});
for (const [text, out] of [['"x"', '"x"\n'], ['null', 'null\n'], ['5', '5\n']]) {
  test(`success: primitive doc ${text}`, () => {
    const res = r(['empty-patch.json'], { input: text });
    assert.equal(res.code, 0);
    assert.equal(res.stderr, '');
    assert.equal(res.stdout, out);
  });
}
test('success: replace "" gives new whole doc', () => {
  put(dir, 'rep.json', '[{"op":"replace","path":"","value":{"n":[1,2]}}]');
  expectOk(r(['rep.json', 'doc.json']), { n: [1, 2] });
});

// ---- BOM ----
test('BOM: patch with BOM ok', () => {
  put(dir, 'bom-patch.json', Buffer.concat([BOM, Buffer.from('[]')]));
  expectOk(r(['bom-patch.json', 'doc.json']), { a: 1 });
});
test('BOM: doc with BOM ok', () => {
  put(dir, 'bom-doc.json', Buffer.concat([BOM, Buffer.from('{"a":1}')]));
  expectOk(r(['empty-patch.json', 'bom-doc.json']), { a: 1 });
});
test('BOM: doc via stdin with BOM ok', () =>
  expectOk(r(['empty-patch.json'], { input: Buffer.concat([BOM, Buffer.from('{"a":1}')]) }), { a: 1 }));
test('BOM: two BOMs -> invalid JSON', () => {
  put(dir, 'two-bom.json', Buffer.concat([BOM, BOM, Buffer.from('{}')]));
  expectError(r(['empty-patch.json', 'two-bom.json']), 'Error: two-bom.json: invalid JSON', 3);
});
test('BOM: BOM only -> invalid JSON', () => {
  put(dir, 'only-bom.json', BOM);
  expectError(r(['only-bom.json', 'doc.json']), 'Error: only-bom.json: invalid JSON', 3);
});

// ---- apply errors ----
test('apply: non-array patch', () => expectError(r(['obj.json', 'doc.json']), 'Error: patch must be an array', 4));
test('apply: bad op', () =>
  expectError(r(['badop.json', 'doc.json']), 'Error: operation 0: bad op', 4));
test('apply: test failure at index 1', () => {
  put(dir, 'tf.json', '[{"op":"add","path":"/z","value":1},{"op":"test","path":"/a","value":2}]');
  expectError(r(['tf.json', 'doc.json']), 'Error: operation 1: test failed', 4);
});
test('apply: path not found', () => {
  put(dir, 'pnf.json', '[{"op":"remove","path":"/nope"}]');
  expectError(r(['pnf.json', 'doc.json']), 'Error: operation 0: path not found', 4);
});

// ---- name as given ----
test('name: ./nope.json echoed exactly', () =>
  expectError(r(['./nope.json', 'doc.json']), 'Error: ./nope.json: no such file', 1));
test('name: absolute path echoed verbatim', () => {
  const abs = path.join(dir, 'absent.json');
  expectError(r(['empty-patch.json', abs]), `Error: ${abs}: no such file`, 1);
});

// ---- order: doc is not read until patch passes every check ----
test('order: invalid JSON patch + missing doc -> patch invalid JSON', () =>
  expectError(r(['bad-json.json', 'missing.json']), 'Error: bad-json.json: invalid JSON', 3));
test('order: invalid UTF-8 patch + missing doc -> patch invalid UTF-8', () => {
  put(dir, 'bad-utf8.json', Buffer.from([0x5b, 0x22, 0xff, 0x22, 0x5d]));
  expectError(r(['bad-utf8.json', 'missing.json']), 'Error: bad-utf8.json: invalid UTF-8', 3);
});
test('order: too deep patch + directory doc -> patch too deep', () => {
  put(dir, 'deep-patch.json', nestedArrays(1001));
  expectError(r(['deep-patch.json', '.']), 'Error: deep-patch.json: too deep', 3);
});
test('order: missing patch + missing doc -> patch no such file', () =>
  expectError(r(['nope-a.json', 'nope-b.json']), 'Error: nope-a.json: no such file', 1));
test('order: invalid patch on stdin + missing doc -> stdin invalid JSON', () =>
  expectError(r(['-', 'missing.json'], { input: '{' }), 'Error: stdin: invalid JSON', 3));
test('order: valid non-array patch + invalid JSON doc -> doc invalid JSON', () =>
  expectError(r(['obj.json', 'bad-json.json']), 'Error: bad-json.json: invalid JSON', 3));
test('order: bad op patch + invalid stdin doc -> stdin invalid JSON', () =>
  expectError(r(['badop.json'], { input: '{' }), 'Error: stdin: invalid JSON', 3));
test('order: 1-arg invalid patch with empty stdin -> patch error first', () =>
  expectError(r(['bad-json.json'], { input: '' }), 'Error: bad-json.json: invalid JSON', 3));
