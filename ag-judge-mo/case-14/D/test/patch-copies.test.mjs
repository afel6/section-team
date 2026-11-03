import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch } from '../jsonpatch.mjs';
import { deepClone, collectObjects, expectPatchError } from './helpers.mjs';

// --- immutability ---

function assertUntouched(doc, patch, message, index) {
  const docSnap = deepClone(doc);
  const patchSnap = deepClone(patch);
  if (message === null) {
    assert.doesNotThrow(() => applyPatch(doc, patch));
  } else {
    expectPatchError(doc, patch, message, index);
  }
  assert.deepStrictEqual(doc, docSnap);
  assert.deepStrictEqual(patch, patchSnap);
}

test('doc and patch unchanged after a successful patch', () => {
  const doc = { a: [1, { b: -0 }], c: { d: 1 } };
  const patch = [
    { op: 'add', path: '/a/-', value: { x: [-0] } },
    { op: 'replace', path: '/c/d', value: [1, 2] },
    { op: 'move', from: '/a/0', path: '/e' },
    { op: 'copy', from: '/c', path: '/f' },
    { op: 'remove', path: '/a/0' },
    { op: 'test', path: '/e', value: 1 },
  ];
  assertUntouched(doc, patch, null);
});

test('doc and patch unchanged when a later op fails (add then test fails)', () => {
  const doc = { a: [1, 2], b: { c: 1 } };
  const patch = [
    { op: 'add', path: '/a/0', value: { z: 1 } },
    { op: 'test', path: '/b/c', value: 2 },
  ];
  assertUntouched(doc, patch, 'operation 1: test failed', 1);
});

test('doc and patch unchanged when a later op fails (remove then move fails)', () => {
  const doc = { a: [1, 2], b: { c: 1 } };
  const patch = [
    { op: 'remove', path: '/a/0' },
    { op: 'move', from: '/nope', path: '/q' },
  ];
  assertUntouched(doc, patch, 'operation 1: from not found', 1);
});

test('doc and patch unchanged on form error', () => {
  const doc = { a: 1 };
  const patch = [{ op: 'remove', path: '/a' }, { op: 'bogus' }];
  assertUntouched(doc, patch, 'operation 1: bad op', 1);
});

// --- no shared objects ---

function assertDisjoint(doc, patch) {
  const result = applyPatch(doc, patch);
  const inputs = collectObjects(patch, collectObjects(doc));
  for (const obj of collectObjects(result)) {
    assert.strictEqual(inputs.has(obj), false, 'result shares an object with the inputs');
  }
  return result;
}

const nested = () => ({ a: { b: [1, { c: 2 }] }, d: [[1], [2]] });

test('disjoint: patch [] on nested doc', () => {
  const doc = nested();
  const r = assertDisjoint(doc, []);
  assert.deepStrictEqual(r, nested());
  assert.notStrictEqual(r, doc);
});

test('disjoint: add with object value', () => {
  const op = { op: 'add', path: '/n', value: { x: [1] } };
  const r = assertDisjoint(nested(), [op]);
  assert.notStrictEqual(r.n, op.value);
  assert.notStrictEqual(r.n.x, op.value.x);
});

test('disjoint: replace with array value', () => {
  const op = { op: 'replace', path: '/a', value: [{ y: 1 }] };
  const r = assertDisjoint(nested(), [op]);
  assert.notStrictEqual(r.a, op.value);
  assert.notStrictEqual(r.a[0], op.value[0]);
});

test('disjoint: copy', () => {
  assertDisjoint(nested(), [{ op: 'copy', from: '/a', path: '/z' }]);
});

test('disjoint: move', () => {
  assertDisjoint(nested(), [{ op: 'move', from: '/a', path: '/z' }]);
});

test('disjoint: test with object value', () => {
  assertDisjoint(nested(), [{ op: 'test', path: '/a', value: { b: [1, { c: 2 }] } }]);
});

test('disjoint: add "" with object value', () => {
  const op = { op: 'add', path: '', value: { k: [1] } };
  const r = assertDisjoint(nested(), [op]);
  assert.notStrictEqual(r, op.value);
});

test('disjoint: replace "" with object value', () => {
  const op = { op: 'replace', path: '', value: { k: [1] } };
  const r = assertDisjoint(nested(), [op]);
  assert.notStrictEqual(r, op.value);
});

test('same patch applied twice gives independent results', () => {
  const patch = [{ op: 'add', path: '/n', value: { x: 1 } }];
  const r1 = applyPatch({}, patch);
  const r2 = applyPatch({}, patch);
  assert.notStrictEqual(r1.n, r2.n);
  r1.n.x = 99;
  assert.deepStrictEqual(r2, { n: { x: 1 } });
  assert.deepStrictEqual(patch[0].value, { x: 1 });
});

test('mutating the result does not affect doc or patch', () => {
  const doc = { a: [1] };
  const patch = [{ op: 'add', path: '/b', value: [2] }];
  const r = applyPatch(doc, patch);
  r.a.push(5);
  r.b.push(5);
  assert.deepStrictEqual(doc, { a: [1] });
  assert.deepStrictEqual(patch[0].value, [2]);
});

// --- copy op identity ---

test('copy result does not share identity with the source', () => {
  const r = applyPatch({ a: { x: [1] } }, [{ op: 'copy', from: '/a', path: '/b' }]);
  assert.notStrictEqual(r.a, r.b);
  assert.notStrictEqual(r.a.x, r.b.x);
  r.b.x.push(2);
  assert.deepStrictEqual(r.a, { x: [1] });
  r.a.x.push(3);
  assert.deepStrictEqual(r.b, { x: [1, 2] });
});

test('copy of "" does not share identity', () => {
  const r = applyPatch({ a: [1] }, [{ op: 'copy', from: '', path: '/b' }]);
  assert.notStrictEqual(r.b, r);
  assert.notStrictEqual(r.b.a, r.a);
});

test('same value added twice by two ops is not shared', () => {
  const value = { x: 1 };
  const r = applyPatch({}, [
    { op: 'add', path: '/a', value },
    { op: 'add', path: '/b', value },
  ]);
  assert.notStrictEqual(r.a, r.b);
});

// --- -0 ---

test('[] keeps -0', () => {
  const r = applyPatch({ a: -0 }, []);
  assert.strictEqual(Object.is(r.a, -0), true);
});

test('[] keeps -0 nested in arrays', () => {
  const r = applyPatch([[-0]], []);
  assert.strictEqual(Object.is(r[0][0], -0), true);
});

test('add value -0', () => {
  const r = applyPatch({}, [{ op: 'add', path: '/a', value: -0 }]);
  assert.strictEqual(Object.is(r.a, -0), true);
});

test('add value {"x":[-0]}', () => {
  const r = applyPatch({}, [{ op: 'add', path: '/a', value: { x: [-0] } }]);
  assert.strictEqual(Object.is(r.a.x[0], -0), true);
});

test('add "" with -0', () => {
  assert.strictEqual(Object.is(applyPatch(1, [{ op: 'add', path: '', value: -0 }]), -0), true);
});

test('copy of -0', () => {
  const r = applyPatch({ a: -0 }, [{ op: 'copy', from: '/a', path: '/b' }]);
  assert.strictEqual(Object.is(r.a, -0), true);
  assert.strictEqual(Object.is(r.b, -0), true);
});

test('copy of nested -0', () => {
  const r = applyPatch({ a: [-0] }, [{ op: 'copy', from: '/a', path: '/b' }]);
  assert.strictEqual(Object.is(r.b[0], -0), true);
});

test('replace with -0', () => {
  const r = applyPatch({ a: 1 }, [{ op: 'replace', path: '/a', value: -0 }]);
  assert.strictEqual(Object.is(r.a, -0), true);
});

test('replace "" with -0', () => {
  assert.strictEqual(Object.is(applyPatch(1, [{ op: 'replace', path: '', value: -0 }]), -0), true);
});

test('move keeps -0', () => {
  const r = applyPatch({ a: -0 }, [{ op: 'move', from: '/a', path: '/b' }]);
  assert.strictEqual(Object.is(r.b, -0), true);
});

test('other numbers kept exactly', () => {
  const doc = { a: 0.1, b: 1e300, c: -5e-324, d: 9007199254740993 };
  assert.deepStrictEqual(applyPatch(doc, []), doc);
});

// --- member order ---

test('add /1 to {"b":0} puts index name first', () => {
  const r = applyPatch({ b: 0 }, [{ op: 'add', path: '/1', value: 5 }]);
  assert.deepStrictEqual(Object.keys(r), ['1', 'b']);
  assert.strictEqual(JSON.stringify(r), '{"1":5,"b":0}');
});

test('[] keeps member order', () => {
  const r = applyPatch({ b: 1, a: 2 }, []);
  assert.deepStrictEqual(Object.keys(r), ['b', 'a']);
  assert.strictEqual(JSON.stringify(r), '{"b":1,"a":2}');
});

test('nested member order kept by copy', () => {
  const r = applyPatch({ s: { z: 1, y: 2, x: 3 } }, [{ op: 'copy', from: '/s', path: '/t' }]);
  assert.deepStrictEqual(Object.keys(r.t), ['z', 'y', 'x']);
  assert.strictEqual(JSON.stringify(r.t), '{"z":1,"y":2,"x":3}');
});

test('add value keeps its member order', () => {
  const r = applyPatch({}, [{ op: 'add', path: '/v', value: { q: 1, p: 2, 3: 3 } }]);
  assert.deepStrictEqual(Object.keys(r.v), ['3', 'q', 'p']);
  assert.strictEqual(JSON.stringify(r.v), '{"3":3,"q":1,"p":2}');
});

test('new member is added last among names', () => {
  const r = applyPatch({ b: 1, a: 2 }, [{ op: 'add', path: '/c', value: 3 }]);
  assert.deepStrictEqual(Object.keys(r), ['b', 'a', 'c']);
  assert.strictEqual(JSON.stringify(r), '{"b":1,"a":2,"c":3}');
});

test('JSON.parse doc with "__proto__" key round-trips through []', () => {
  const doc = JSON.parse('{"__proto__": 1, "a": 2}');
  const r = applyPatch(doc, []);
  assert.strictEqual(Object.hasOwn(r, '__proto__'), true);
  assert.strictEqual(Object.getPrototypeOf(r), Object.prototype);
  assert.deepStrictEqual(Object.keys(r), ['__proto__', 'a']);
  assert.strictEqual(JSON.stringify(r), '{"__proto__":1,"a":2}');
});

test('"__proto__" with object value does not pollute prototype', () => {
  const doc = JSON.parse('{"__proto__": {"polluted": true}}');
  const r = applyPatch(doc, []);
  assert.strictEqual(Object.getPrototypeOf(r), Object.prototype);
  assert.strictEqual(r.polluted, undefined);
  assert.strictEqual(Object.hasOwn(r.__proto__, 'polluted'), true);
});
