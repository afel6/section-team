import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePointer, applyPatch, PatchError } from '../jsonpatch.mjs';

function fails(doc, patch, message, index) {
  assert.throws(
    () => applyPatch(doc, patch),
    (e) => {
      assert.ok(e instanceof PatchError);
      assert.ok(e instanceof Error);
      assert.equal(e.name, 'PatchError');
      assert.equal(e.message, message);
      assert.equal(e.index, index);
      return true;
    },
  );
}

test('parsePointer', () => {
  assert.deepEqual(parsePointer(''), []);
  assert.deepEqual(parsePointer('/'), ['']);
  assert.deepEqual(parsePointer('/a//b/'), ['a', '', 'b', '']);
  assert.deepEqual(parsePointer('/~01'), ['~1']);
  assert.deepEqual(parsePointer('/~10'), ['/0']);
  assert.throws(() => parsePointer(new String('/a')), { name: 'TypeError', message: 'pointer must be a string' });
  assert.throws(() => parsePointer(5), TypeError);
  for (const p of ['a', '/~', '/~2', '/a~/b']) {
    assert.throws(() => parsePointer(p), { name: 'SyntaxError', message: 'invalid pointer' });
  }
});

test('add', () => {
  assert.deepEqual(applyPatch({ b: 0 }, [{ op: 'add', path: '/1', value: 5 }]), { 1: 5, b: 0 });
  assert.deepEqual(Object.keys(applyPatch({ b: 0 }, [{ op: 'add', path: '/1', value: 5 }])), ['1', 'b']);
  assert.deepEqual(Object.keys(applyPatch({ a: 1, b: 2 }, [{ op: 'add', path: '/a', value: 3 }])), ['a', 'b']);
  assert.deepEqual(applyPatch([1, 2], [{ op: 'add', path: '/1', value: 9 }]), [1, 9, 2]);
  assert.deepEqual(applyPatch([1, 2], [{ op: 'add', path: '/2', value: 9 }]), [1, 2, 9]);
  assert.deepEqual(applyPatch([1, 2], [{ op: 'add', path: '/-', value: 9 }]), [1, 2, 9]);
  assert.deepEqual(applyPatch(1, [{ op: 'add', path: '', value: { x: 1 } }]), { x: 1 });
  fails([1], [{ op: 'add', path: '/3', value: 0 }], 'operation 0: path not found', 0);
  fails([1], [{ op: 'add', path: '/01', value: 0 }], 'operation 0: bad index', 0);
  fails('s', [{ op: 'add', path: '/a', value: 0 }], 'operation 0: path not found', 0);
  fails({}, [{ op: 'add', path: '/a/b', value: 0 }], 'operation 0: path not found', 0);
});

test('__proto__ and inherited names are ordinary members', () => {
  const r = applyPatch({}, [{ op: 'add', path: '/__proto__', value: { x: 1 } }]);
  assert.ok(Object.hasOwn(r, '__proto__'));
  assert.equal(Object.getPrototypeOf(r), Object.prototype);
  fails({}, [{ op: 'remove', path: '/toString' }], 'operation 0: path not found', 0);
  fails({}, [{ op: 'test', path: '/constructor', value: 1 }], 'operation 0: path not found', 0);
  const doc = JSON.parse('{"__proto__":{"a":1}}');
  const copy = applyPatch(doc, []);
  assert.ok(Object.hasOwn(copy, '__proto__'));
  assert.deepEqual(applyPatch(doc, [{ op: 'remove', path: '/__proto__/a' }]), JSON.parse('{"__proto__":{}}'));
});

test('remove, replace', () => {
  assert.deepEqual(applyPatch({ a: 1, b: 2 }, [{ op: 'remove', path: '/a' }]), { b: 2 });
  assert.deepEqual(applyPatch([1, 2, 3], [{ op: 'remove', path: '/0' }]), [2, 3]);
  assert.deepEqual(Object.keys(applyPatch({ a: 1, b: 2 }, [{ op: 'replace', path: '/a', value: 3 }])), ['a', 'b']);
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'replace', path: '', value: [1] }]), [1]);
  fails([1], [{ op: 'remove', path: '/1' }], 'operation 0: path not found', 0);
  fails([1], [{ op: 'remove', path: '/-' }], 'operation 0: path not found', 0);
  fails([1], [{ op: 'replace', path: '/length', value: 1 }], 'operation 0: bad index', 0);
  fails({}, [{ op: 'replace', path: '/a', value: 1 }], 'operation 0: path not found', 0);
});

test('move, copy', () => {
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'move', from: '/a', path: '/b' }]), { b: 1 });
  assert.deepEqual(applyPatch([1, 2, 3], [{ op: 'move', from: '/0', path: '/2' }]), [2, 3, 1]);
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'move', from: '/a', path: '/a' }]), { a: 1 });
  fails({}, [{ op: 'move', from: '/a', path: '/a' }], 'operation 0: from not found', 0);
  const r = applyPatch({ a: { b: 1 } }, [{ op: 'copy', from: '/a', path: '/a/c' }]);
  assert.deepEqual(r, { a: { b: 1, c: { b: 1 } } });
  assert.notEqual(r.a, r.a.c);
  fails({}, [{ op: 'copy', from: '/x', path: '/y/z' }], 'operation 0: from not found', 0);
  fails([], [{ op: 'copy', from: '/x', path: '/0' }], 'operation 0: bad index', 0);
});

test('test op', () => {
  assert.deepEqual(applyPatch({ a: [1, { b: 0 }] }, [{ op: 'test', path: '/a', value: [1.0, { b: -0 }] }]), { a: [1, { b: 0 }] });
  applyPatch({ a: 1, b: 2 }, [{ op: 'test', path: '', value: { b: 2, a: 1 } }]);
  fails({ a: 1 }, [{ op: 'test', path: '/a', value: '1' }], 'operation 0: test failed', 0);
  fails([1], [{ op: 'test', path: '', value: [1, 2] }], 'operation 0: test failed', 0);
  fails({}, [{ op: 'test', path: '', value: [] }], 'operation 0: test failed', 0);
  fails('é', [{ op: 'test', path: '', value: 'é' }], 'operation 0: test failed', 0);
  fails(null, [{ op: 'test', path: '', value: false }], 'operation 0: test failed', 0);
});

test('form rules', () => {
  fails({}, {}, 'patch must be an array', null);
  // eslint-disable-next-line no-sparse-arrays
  fails({}, [{ op: 'add', path: '', value: 1 }, , null], 'operation 1: not an object', 1);
  fails({}, [() => 1], 'operation 0: not an object', 0);
  fails({}, [[]], 'operation 0: not an object', 0);
  fails({}, [new String('x')], 'operation 0: bad op', 0);
  fails({}, [Object.create({ op: 'add', path: '', value: 1 })], 'operation 0: bad op', 0);
  fails({}, [{ op: new String('add'), path: '' }], 'operation 0: bad op', 0);
  fails({}, [{ op: 'add', path: 'a', value: 1 }], 'operation 0: bad path', 0);
  fails({}, [{ op: 'add', path: new String(''), value: 1 }], 'operation 0: bad path', 0);
  fails({}, [{ op: 'copy', path: '/a' }], 'operation 0: bad from', 0);
  fails({}, [{ op: 'replace', path: '/a' }], 'operation 0: missing value', 0);
  fails({}, [{ op: 'remove', path: '' }], 'operation 0: cannot remove root', 0);
  fails({}, [{ op: 'move', from: '/a', path: '/a/b' }], 'operation 0: cannot move into own child', 0);
  fails({}, [{ op: 'move', from: '', path: '/a' }], 'operation 0: cannot move into own child', 0);
  fails({ a: 1 }, [{ op: 'move', from: '/a', path: '/ab' }, { op: 'remove', path: '/x' }], 'operation 1: path not found', 1);
  // Form errors come before any application failure.
  fails({}, [{ op: 'remove', path: '/x' }, { op: 'bogus' }], 'operation 1: bad op', 1);
  const op = { path: '/a', value: 1 };
  Object.defineProperty(op, 'op', { value: 'add', enumerable: false });
  assert.deepEqual(applyPatch({}, [op]), { a: 1 });
  assert.deepEqual(applyPatch({}, [{ op: 'add', path: '/a', value: null, from: 5 }]), { a: null });
});

test('no sharing or mutation, -0 kept', () => {
  const doc = { a: [1, { b: 2 }], z: -0 };
  const value = { c: [3] };
  const patch = [{ op: 'add', path: '/a/1/v', value }, { op: 'test', path: '/q', value: 1 }];
  const before = JSON.stringify([doc, patch]);
  fails(doc, patch, 'operation 1: path not found', 1);
  assert.equal(JSON.stringify([doc, patch]), before);
  const r = applyPatch(doc, [patch[0]]);
  assert.notEqual(r.a, doc.a);
  assert.notEqual(r.a[1].v, value);
  assert.notEqual(r.a[1].v.c, value.c);
  assert.ok(Object.is(r.z, -0));
  assert.equal(doc.a[1].v, undefined);
  assert.ok(Object.is(applyPatch({ a: -0 }, []).a, -0));
});

test('deep values', () => {
  let deep = 0;
  for (let i = 0; i < 1000; i++) deep = [deep];
  // Each replace puts a 1000-deep value at the bottom, giving a 6000-deep result.
  const patch = [];
  for (let i = 0; i < 5; i++) patch.push({ op: 'replace', path: '/0'.repeat(1000 * (i + 1)), value: deep });
  const r = applyPatch(deep, patch);
  applyPatch(r, [{ op: 'test', path: '', value: r }]);
  let n = 0;
  for (let v = r; Array.isArray(v); v = v[0]) n++;
  assert.equal(n, 6000);
});
