import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, PatchError } from '../jsonpatch.mjs';
import { expectPatchError } from './helpers/patch-assert.mjs';

function deepFreeze(v) {
  const stack = [v];
  while (stack.length > 0) {
    const x = stack.pop();
    if (x === null || typeof x !== 'object' || Object.isFrozen(x)) continue;
    Object.freeze(x);
    for (const k of Reflect.ownKeys(x)) stack.push(x[k]);
  }
  return v;
}

function collectObjects(root) {
  const seen = new Set();
  const stack = [root];
  while (stack.length > 0) {
    const x = stack.pop();
    if (x === null || typeof x !== 'object' || seen.has(x)) continue;
    seen.add(x);
    for (const k of Object.keys(x)) stack.push(x[k]);
  }
  return seen;
}

function expectTestFailed(doc, value) {
  expectPatchError(doc, [{ op: 'test', path: '', value }], 'operation 0: test failed', 0);
}

function expectTestPasses(doc, value) {
  const result = applyPatch(doc, [{ op: 'test', path: '', value }]);
  assert.deepStrictEqual(result, doc);
}

const mixedDoc = () => ({ a: { b: [1, { c: 2 }] }, d: [[1], [2]], e: 'x' });
const mixedPatch = () => [
  { op: 'add', path: '/x', value: { y: [1, { z: 1 }] } },
  { op: 'replace', path: '/e', value: { k: [3] } },
  { op: 'copy', from: '/a', path: '/a2' },
  { op: 'move', from: '/d', path: '/d2' },
  { op: 'add', path: '/a/b/-', value: [5] },
];

describe('input immutability', () => {
  test('doc and patch unchanged on success', () => {
    const doc = mixedDoc();
    const patch = mixedPatch();
    const docSnap = structuredClone(doc);
    const patchSnap = structuredClone(patch);
    applyPatch(doc, patch);
    assert.deepStrictEqual(doc, docSnap);
    assert.deepStrictEqual(patch, patchSnap);
  });

  test('doc and patch unchanged when the last op fails', () => {
    const doc = mixedDoc();
    const patch = [
      ...mixedPatch(),
      { op: 'remove', path: '/a/b/0' },
      { op: 'remove', path: '/nope' },
    ];
    const docSnap = structuredClone(doc);
    const patchSnap = structuredClone(patch);
    assert.throws(() => applyPatch(doc, patch), PatchError);
    assert.deepStrictEqual(doc, docSnap);
    assert.deepStrictEqual(patch, patchSnap);
  });

  test('deeply frozen inputs do not cause TypeError', () => {
    const doc = deepFreeze(mixedDoc());
    const patch = deepFreeze([
      { op: 'add', path: '/n', value: { q: [1] } },
      { op: 'remove', path: '/e' },
      { op: 'replace', path: '/d/0', value: [9] },
      { op: 'move', from: '/a', path: '/m' },
      { op: 'copy', from: '/m', path: '/m2' },
    ]);
    const r = applyPatch(doc, patch);
    assert.deepStrictEqual(Object.keys(r), ['d', 'n', 'm', 'm2']);
  });
});

describe('no sharing', () => {
  test('empty patch returns a deep copy', () => {
    const doc = { a: { b: [[1], [2, [3]]] }, c: [1] };
    const r = applyPatch(doc, []);
    assert.notEqual(r, doc);
    assert.notEqual(r.a, doc.a);
    assert.notEqual(r.a.b, doc.a.b);
    assert.notEqual(r.a.b[0], doc.a.b[0]);
    assert.notEqual(r.a.b[1][1], doc.a.b[1][1]);
    assert.notEqual(r.c, doc.c);
    assert.deepStrictEqual(r, doc);
  });

  test('add value is copied', () => {
    const patch = [{ op: 'add', path: '/x', value: { k: [1] } }];
    const r = applyPatch({}, patch);
    assert.notEqual(r.x, patch[0].value);
    assert.notEqual(r.x.k, patch[0].value.k);
    r.x.k.push(2);
    r.x.z = 1;
    assert.deepStrictEqual(patch[0].value, { k: [1] });
  });

  test('replace value is copied', () => {
    const patch = [{ op: 'replace', path: '/x', value: { k: [1] } }];
    const r = applyPatch({ x: 0 }, patch);
    assert.notEqual(r.x, patch[0].value);
    r.x.k.push(2);
    assert.deepStrictEqual(patch[0].value, { k: [1] });
  });

  test('whole-document add and replace are copied', () => {
    for (const op of ['add', 'replace']) {
      const patch = [{ op, path: '', value: { k: [1] } }];
      const r = applyPatch({}, patch);
      assert.notEqual(r, patch[0].value);
      assert.notEqual(r.k, patch[0].value.k);
    }
  });

  test('result shares no object with doc or patch', () => {
    const doc = mixedDoc();
    const patch = mixedPatch();
    const r = applyPatch(doc, patch);
    const inputs = new Set([...collectObjects(doc), ...collectObjects(patch)]);
    const shared = [...collectObjects(r)].filter((o) => inputs.has(o));
    assert.equal(shared.length, 0);
  });
});

describe('numbers kept exactly', () => {
  test('-0 in doc survives an empty patch', () => {
    assert.ok(Object.is(applyPatch({ a: -0 }, []).a, -0));
    assert.ok(Object.is(applyPatch([-0], [])[0], -0));
  });

  test('-0 via add and replace', () => {
    assert.ok(Object.is(applyPatch({}, [{ op: 'add', path: '/a', value: -0 }]).a, -0));
    assert.ok(Object.is(applyPatch({ a: 1 }, [{ op: 'replace', path: '/a', value: -0 }]).a, -0));
    assert.ok(Object.is(applyPatch({}, [{ op: 'add', path: '/a', value: [-0] }]).a[0], -0));
  });

  test('-0 via copy and move', () => {
    const c = applyPatch({ a: -0 }, [{ op: 'copy', from: '/a', path: '/b' }]);
    assert.ok(Object.is(c.a, -0));
    assert.ok(Object.is(c.b, -0));
    const m = applyPatch({ a: -0 }, [{ op: 'move', from: '/a', path: '/b' }]);
    assert.ok(Object.is(m.b, -0));
  });

  test('extreme numbers are exact', () => {
    const nums = [1e308, 5e-324, 0.1, Number.MAX_SAFE_INTEGER + 2];
    const r = applyPatch({ nums }, [{ op: 'add', path: '/more', value: nums }]);
    for (let i = 0; i < nums.length; i++) {
      assert.ok(Object.is(r.nums[i], nums[i]));
      assert.ok(Object.is(r.more[i], nums[i]));
    }
  });
});

describe('member order', () => {
  test('integer-like names sort first', () => {
    const r = applyPatch({ b: 0 }, [{ op: 'add', path: '/1', value: 5 }]);
    assert.deepStrictEqual(Object.keys(r), ['1', 'b']);
    assert.deepStrictEqual(r, { 1: 5, b: 0 });
  });

  test('new names are appended', () => {
    const r = applyPatch({ b: 0, a: 1 }, [{ op: 'add', path: '/c', value: 2 }]);
    assert.deepStrictEqual(Object.keys(r), ['b', 'a', 'c']);
  });

  test('add /__proto__ appends an own member', () => {
    const r = applyPatch({ b: 0 }, [{ op: 'add', path: '/__proto__', value: 1 }]);
    assert.deepStrictEqual(Object.keys(r), ['b', '__proto__']);
    assert.equal(Object.getPrototypeOf(r), Object.prototype);
  });

  test('doc with own __proto__ keeps order and prototype', () => {
    const doc = JSON.parse('{"z":1,"__proto__":{"x":1},"a":2}');
    const r = applyPatch(doc, []);
    assert.deepStrictEqual(Object.keys(r), ['z', '__proto__', 'a']);
    assert.deepStrictEqual(Object.getOwnPropertyDescriptor(r, '__proto__').value, { x: 1 });
    assert.equal(Object.getPrototypeOf(r), Object.prototype);
    assert.notEqual(Object.getOwnPropertyDescriptor(r, '__proto__').value,
      Object.getOwnPropertyDescriptor(doc, '__proto__').value);
  });

  test('replace /__proto__ keeps its place', () => {
    const doc = JSON.parse('{"z":1,"__proto__":{"x":1},"a":2}');
    const r = applyPatch(doc, [{ op: 'replace', path: '/__proto__', value: 7 }]);
    assert.deepStrictEqual(Object.keys(r), ['z', '__proto__', 'a']);
    assert.equal(Object.getOwnPropertyDescriptor(r, '__proto__').value, 7);
    assert.equal(Object.getPrototypeOf(r), Object.prototype);
  });

  test('copy into "__proto__" works', () => {
    const r = applyPatch({ a: { k: 1 } }, [{ op: 'copy', from: '/a', path: '/__proto__' }]);
    assert.deepStrictEqual(Object.keys(r), ['a', '__proto__']);
    const copied = Object.getOwnPropertyDescriptor(r, '__proto__').value;
    assert.deepStrictEqual(copied, { k: 1 });
    assert.notEqual(copied, r.a);
    assert.equal(Object.getPrototypeOf(r), Object.prototype);
  });

  test('remove then add re-appends at the end', () => {
    const r = applyPatch({ a: 1, b: 2 }, [
      { op: 'remove', path: '/a' },
      { op: 'add', path: '/a', value: 1 },
    ]);
    assert.deepStrictEqual(Object.keys(r), ['b', 'a']);
  });
});

describe('test equality', () => {
  test('numbers compare by value, 0 equals -0', () => {
    expectTestPasses(1, 1.0);
    expectTestPasses(0, -0);
    expectTestPasses(-0, 0);
    expectTestFailed(1, 2);
    expectTestFailed(1, '1');
    expectTestFailed('1', 1);
  });

  test('strings compare exactly', () => {
    expectTestPasses('abc', 'abc');
    expectTestPasses('é', 'é');
    expectTestFailed('é', 'é');
    expectTestFailed('a', 'a ');
    expectTestFailed('A', 'a');
  });

  test('arrays need same length and order', () => {
    expectTestPasses([1, 2], [1, 2]);
    expectTestPasses([], []);
    expectTestFailed([1, 2], [2, 1]);
    expectTestFailed([1], [1, 1]);
    expectTestFailed([1, 1], [1]);
    expectTestFailed([], {});
    expectTestFailed({}, []);
  });

  test('objects need same names in any order', () => {
    expectTestPasses({ a: 1, b: 2 }, { b: 2, a: 1 });
    expectTestPasses({}, {});
    expectTestFailed({ a: 1 }, { a: 1, b: 2 });
    expectTestFailed({ a: 1, b: 2 }, { a: 1 });
    expectTestFailed({ a: 1 }, { b: 1 });
    expectTestFailed({ a: 1 }, { a: 2 });
  });

  test('true, false and null equal only themselves', () => {
    expectTestPasses(null, null);
    expectTestPasses(true, true);
    expectTestPasses(false, false);
    expectTestFailed(null, false);
    expectTestFailed(null, 0);
    expectTestFailed(null, {});
    expectTestFailed(null, []);
    expectTestFailed(false, 0);
    expectTestFailed(true, 1);
    expectTestFailed('', false);
    expectTestFailed(0, '');
    expectTestFailed(true, false);
  });

  test('nested values compare deeply', () => {
    const a = { x: [1, { y: [true, null, { z: 'deep' }] }] };
    expectTestPasses(a, { x: [1, { y: [true, null, { z: 'deep' }] }] });
    expectTestFailed(a, { x: [1, { y: [true, null, { z: 'deeP' }] }] });
    expectTestFailed(a, { x: [1, { y: [true, null, { z: 'deep', w: 1 }] }] });
  });

  test('test at a nested path', () => {
    const doc = { a: { b: [1, 2] } };
    const result = applyPatch(doc, [{ op: 'test', path: '/a/b', value: [1, 2] }]);
    assert.deepStrictEqual(result, doc);
  });

  test('own __proto__ member counts as a member', () => {
    const withProto = () => JSON.parse('{"__proto__":1}');
    expectTestPasses(withProto(), withProto());
    expectTestFailed(withProto(), {});
    expectTestFailed({}, withProto());
  });
});
