import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, PatchError } from '../jsonpatch.mjs';

import { expectPatchError as expectExact } from './helpers/patch-assert.mjs';

function expectPatchError(doc, patch, reason, i = 0) {
  expectExact(doc, patch, `operation ${i}: ${reason}`, i);
}

const add = (path, value) => [{ op: 'add', path, value }];
const remove = (path) => [{ op: 'remove', path }];
const replace = (path, value) => [{ op: 'replace', path, value }];
const move = (from, path) => [{ op: 'move', from, path }];
const copy = (from, path) => [{ op: 'copy', from, path }];
const testOp = (path, value) => [{ op: 'test', path, value }];

describe('add', () => {
  test('empty path replaces the whole document', () => {
    assert.deepStrictEqual(applyPatch({ a: 1 }, add('', [1])), [1]);
    assert.equal(applyPatch({ a: 1 }, add('', 5)), 5);
    assert.equal(applyPatch([1, 2], add('', 5)), 5);
    assert.equal(applyPatch(null, add('', 5)), 5);
  });

  test('object: new member is appended, existing keeps its place', () => {
    const r = applyPatch({ a: 1, b: 2 }, add('/c', 3));
    assert.deepStrictEqual(Object.keys(r), ['a', 'b', 'c']);
    const r2 = applyPatch({ a: 1, b: 2 }, add('/a', 9));
    assert.deepStrictEqual(Object.keys(r2), ['a', 'b']);
    assert.equal(r2.a, 9);
  });

  test('array: "-" appends', () => {
    assert.deepStrictEqual(applyPatch([1, 2], add('/-', 3)), [1, 2, 3]);
  });

  test('array: index <= length inserts', () => {
    assert.deepStrictEqual(applyPatch([1, 2], add('/0', 0)), [0, 1, 2]);
    assert.deepStrictEqual(applyPatch([1, 2], add('/2', 3)), [1, 2, 3]);
  });

  test('array: index > length is path not found', () => {
    expectPatchError([1, 2], add('/3', 3), 'path not found');
  });

  for (const bad of ['/01', '/+1', '/1.0', '/x', '/']) {
    test(`array: ${JSON.stringify(bad)} is bad index`, () => {
      expectPatchError([1, 2], add(bad, 0), 'bad index');
    });
  }

  test('parent that is a scalar is path not found', () => {
    expectPatchError({ s: 'x' }, add('/s/0', 1), 'path not found');
    expectPatchError({ n: 1 }, add('/n/a', 1), 'path not found');
    expectPatchError({ b: true }, add('/b/a', 1), 'path not found');
    expectPatchError({ z: null }, add('/z/a', 1), 'path not found');
  });

  test('missing parent is path not found', () => {
    expectPatchError({ a: {} }, add('/b/c', 1), 'path not found');
  });

  test('parent path through array with bad index is bad index', () => {
    expectPatchError({ a: [1] }, add('/a/x/y', 1), 'bad index');
  });

  test('parent path through "-" is path not found', () => {
    expectPatchError({ a: [1] }, add('/a/-/y', 1), 'path not found');
  });

  test('"/" on an object adds the empty-named member', () => {
    const r = applyPatch({}, add('/', 'v'));
    assert.deepStrictEqual(Object.keys(r), ['']);
    assert.equal(r[''], 'v');
  });

  test('/__proto__ creates an own property', () => {
    const r = applyPatch({}, add('/__proto__', 1));
    assert.equal(Object.hasOwn(r, '__proto__'), true);
    assert.equal(Object.getPrototypeOf(r), Object.prototype);
    assert.deepStrictEqual(Object.keys(r), ['__proto__']);
  });

  test('null value works', () => {
    const r = applyPatch({}, add('/a', null));
    assert.deepStrictEqual(Object.keys(r), ['a']);
    assert.equal(r.a, null);
    assert.deepStrictEqual(applyPatch([], add('/-', null)), [null]);
  });
});

describe('remove', () => {
  test('removes object member', () => {
    assert.deepStrictEqual(applyPatch({ a: 1, b: 2 }, remove('/a')), { b: 2 });
  });

  test('removes array element', () => {
    assert.deepStrictEqual(applyPatch([1, 2, 3], remove('/1')), [1, 3]);
  });

  test('index past the end is path not found', () => {
    expectPatchError([1, 2, 3], remove('/3'), 'path not found');
  });

  test('"-" is path not found', () => {
    expectPatchError([1, 2, 3], remove('/-'), 'path not found');
  });

  test('leading-zero index is bad index', () => {
    expectPatchError([1, 2, 3], remove('/01'), 'bad index');
  });

  test('missing member is path not found', () => {
    expectPatchError({}, remove('/x'), 'path not found');
  });

  test('removes an own __proto__ member', () => {
    const r = applyPatch(JSON.parse('{"__proto__":1,"a":2}'), remove('/__proto__'));
    assert.deepStrictEqual(r, { a: 2 });
    assert.equal(Object.hasOwn(r, '__proto__'), false);
    assert.deepStrictEqual(Object.keys(r), ['a']);
  });
});

describe('replace', () => {
  test('empty path replaces the whole document', () => {
    assert.deepStrictEqual(applyPatch({ a: 1 }, replace('', [2])), [2]);
    assert.equal(applyPatch({ a: 1 }, replace('', 'x')), 'x');
  });

  test('member keeps its place', () => {
    const r = applyPatch({ a: 1, b: 2, c: 3 }, replace('/b', 9));
    assert.deepStrictEqual(Object.keys(r), ['a', 'b', 'c']);
    assert.equal(r.b, 9);
  });

  test('array element is replaced', () => {
    assert.deepStrictEqual(applyPatch([1, 2], replace('/1', 9)), [1, 9]);
  });

  test('index past the end is path not found', () => {
    expectPatchError([1, 2], replace('/2', 9), 'path not found');
  });

  test('"-" is path not found', () => {
    expectPatchError([1, 2], replace('/-', 9), 'path not found');
  });

  test('missing member is path not found (never creates)', () => {
    expectPatchError({}, replace('/x', 1), 'path not found');
  });

  test('bad index on array', () => {
    expectPatchError([1, 2], replace('/0x', 9), 'bad index');
  });
});

describe('move', () => {
  test('missing from is from not found', () => {
    expectPatchError({ a: 1 }, move('/zzz', '/b'), 'from not found');
  });

  test('bad index in from is bad index', () => {
    expectPatchError([1, 2], move('/01', '/0'), 'bad index');
  });

  test('array index counts after removal', () => {
    assert.deepStrictEqual(applyPatch([1, 2, 3], move('/0', '/2')), [2, 3, 1]);
    expectPatchError([1, 2, 3], move('/0', '/3'), 'path not found');
  });

  test('object member order: removed then appended', () => {
    const r = applyPatch({ a: 1, b: 2 }, move('/a', '/c'));
    assert.deepStrictEqual(Object.keys(r), ['b', 'c']);
    assert.deepStrictEqual(r, { b: 2, c: 1 });
  });

  test('from equal to path is a no-op', () => {
    const r = applyPatch({ a: 1, b: 2 }, move('/a', '/a'));
    assert.deepStrictEqual(r, { a: 1, b: 2 });
    assert.deepStrictEqual(Object.keys(r), ['a', 'b']);
  });

  test('from equal to path still requires from to exist', () => {
    expectPatchError({}, move('/missing', '/missing'), 'from not found');
  });

  test('from is followed before path', () => {
    expectPatchError({}, move('/x', '/y/z'), 'from not found');
  });

  test('missing parent of path is path not found', () => {
    expectPatchError({ a: 1 }, move('/a', '/b/c'), 'path not found');
  });

  test('move up to an ancestor', () => {
    assert.deepStrictEqual(applyPatch({ a: { b: 1 } }, move('/a/b', '/a')), { a: 1 });
  });
});

describe('copy', () => {
  test('path may lie inside from', () => {
    const r = applyPatch({ a: { b: 1 } }, copy('/a', '/a/c'));
    assert.deepStrictEqual(r, { a: { b: 1, c: { b: 1 } } });
    assert.notEqual(r.a.c, r.a);
  });

  test('missing from is from not found', () => {
    expectPatchError({}, copy('/x', '/y'), 'from not found');
  });

  test('from is followed before path', () => {
    expectPatchError({}, copy('/x', '/y/z'), 'from not found');
  });

  test('copy into array with "-"', () => {
    assert.deepStrictEqual(applyPatch([1, 2], copy('/0', '/-')), [1, 2, 1]);
  });
});

describe('test', () => {
  test('empty path tests the whole document', () => {
    assert.deepStrictEqual(applyPatch({ a: 1 }, testOp('', { a: 1 })), { a: 1 });
    expectPatchError({ a: 1 }, testOp('', { a: 2 }), 'test failed');
  });

  test('mismatch is test failed', () => {
    expectPatchError({ a: 1 }, testOp('/a', 2), 'test failed');
  });

  test('missing path is path not found, not test failed', () => {
    expectPatchError({ a: 1 }, testOp('/b', 1), 'path not found');
  });

  test('"-" on array is path not found', () => {
    expectPatchError([1], testOp('/-', 1), 'path not found');
  });
});

describe('ordering and error type', () => {
  test('later operations see earlier results', () => {
    const patch = [
      { op: 'add', path: '/a', value: 1 },
      { op: 'test', path: '/a', value: 1 },
      { op: 'replace', path: '/a', value: 2 },
      { op: 'test', path: '/a', value: 2 },
    ];
    assert.deepStrictEqual(applyPatch({}, patch), { a: 2 });
  });

  test('failure at operation 2 reports index 2', () => {
    const patch = [
      { op: 'add', path: '/a', value: 1 },
      { op: 'test', path: '/a', value: 1 },
      { op: 'remove', path: '/zzz' },
      { op: 'add', path: '/b', value: 1 },
    ];
    expectPatchError({}, patch, 'path not found', 2);
  });

  test('failures are always PatchError', () => {
    const cases = [
      [{}, remove('/x')],
      [[1], add('/9', 1)],
      [[1], add('/x', 1)],
      [{}, move('/x', '/y')],
      [{}, copy('/x', '/y')],
      [{ a: 1 }, testOp('/a', 2)],
    ];
    for (const [doc, patch] of cases) {
      assert.throws(() => applyPatch(doc, patch), PatchError);
    }
  });
});
