import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePointer, applyPatch, PatchError } from '../jsonpatch.mjs';

function fails(doc, patch, message, index) {
  assert.throws(
    () => applyPatch(doc, patch),
    (err) => {
      assert.ok(err instanceof PatchError);
      assert.ok(err instanceof Error);
      assert.equal(err.name, 'PatchError');
      assert.equal(err.message, message);
      assert.equal(err.index, index);
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
  assert.throws(() => parsePointer(1), TypeError);
  for (const p of ['a', '/~', '/~2', '/a~']) {
    assert.throws(() => parsePointer(p), { name: 'SyntaxError', message: 'invalid pointer' });
  }
  const a = parsePointer('/x');
  assert.notEqual(a, parsePointer('/x'));
});

test('empty patch deep-copies and keeps -0 and order', () => {
  const doc = { b: { c: [1] }, a: -0 };
  const out = applyPatch(doc, []);
  assert.deepEqual(out, doc);
  assert.notEqual(out, doc);
  assert.notEqual(out.b, doc.b);
  assert.ok(Object.is(out.a, -0));
  assert.deepEqual(Object.keys(out), ['b', 'a']);
});

test('add', () => {
  assert.deepEqual(Object.keys(applyPatch({ b: 0 }, [{ op: 'add', path: '/1', value: 5 }])), ['1', 'b']);
  assert.deepEqual(applyPatch([1, 2], [{ op: 'add', path: '/1', value: 9 }]), [1, 9, 2]);
  assert.deepEqual(applyPatch([1, 2], [{ op: 'add', path: '/2', value: 9 }]), [1, 2, 9]);
  assert.deepEqual(applyPatch([1, 2], [{ op: 'add', path: '/-', value: 9 }]), [1, 2, 9]);
  assert.deepEqual(applyPatch(1, [{ op: 'add', path: '', value: { a: 1 } }]), { a: 1 });
  const replaced = applyPatch({ a: 1, b: 2 }, [{ op: 'add', path: '/a', value: 3 }]);
  assert.deepEqual(Object.keys(replaced), ['a', 'b']);
  const proto = applyPatch({}, [{ op: 'add', path: '/__proto__', value: { x: 1 } }]);
  assert.ok(Object.hasOwn(proto, '__proto__'));
  assert.equal(Object.getPrototypeOf(proto), Object.prototype);
  fails([1], [{ op: 'add', path: '/3', value: 0 }], 'operation 0: path not found', 0);
  fails([1], [{ op: 'add', path: '/01', value: 0 }], 'operation 0: bad index', 0);
  fails({ a: 1 }, [{ op: 'add', path: '/a/b', value: 0 }], 'operation 0: path not found', 0);
  fails({}, [{ op: 'add', path: '/x/y', value: 0 }], 'operation 0: path not found', 0);
  fails([], [{ op: 'add', path: '/x/y', value: 0 }], 'operation 0: bad index', 0);
  fails({}, [{ op: 'add', path: '/toString/y', value: 0 }], 'operation 0: path not found', 0);
});

test('value is copied', () => {
  const value = { x: [1] };
  const patch = [{ op: 'add', path: '/a', value }];
  const out = applyPatch({}, patch);
  assert.notEqual(out.a, value);
  assert.notEqual(out.a.x, value.x);
});

test('remove and replace', () => {
  assert.deepEqual(applyPatch([1, 2, 3], [{ op: 'remove', path: '/1' }]), [1, 3]);
  assert.deepEqual(applyPatch({ a: 1, b: 2 }, [{ op: 'remove', path: '/a' }]), { b: 2 });
  fails([1], [{ op: 'remove', path: '/-' }], 'operation 0: path not found', 0);
  fails([1], [{ op: 'remove', path: '/1' }], 'operation 0: path not found', 0);
  fails([1], [{ op: 'remove', path: '/length' }], 'operation 0: bad index', 0);
  const r = applyPatch({ a: 1, b: 2 }, [{ op: 'replace', path: '/a', value: 9 }]);
  assert.deepEqual(Object.keys(r), ['a', 'b']);
  assert.equal(r.a, 9);
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'replace', path: '', value: [1] }]), [1]);
  fails({}, [{ op: 'replace', path: '/a', value: 1 }], 'operation 0: path not found', 0);
});

test('move and copy', () => {
  assert.deepEqual(applyPatch({ a: 1, b: 2 }, [{ op: 'move', from: '/a', path: '/c' }]), { b: 2, c: 1 });
  assert.deepEqual(applyPatch([1, 2, 3], [{ op: 'move', from: '/0', path: '/2' }]), [2, 3, 1]);
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'move', from: '/a', path: '/a' }]), { a: 1 });
  fails({}, [{ op: 'move', from: '/a', path: '/a' }], 'operation 0: from not found', 0);
  fails({}, [{ op: 'move', from: '/a', path: '/a/b' }], 'operation 0: cannot move into own child', 0);
  fails({}, [{ op: 'move', from: '', path: '/a' }], 'operation 0: cannot move into own child', 0);
  assert.deepEqual(applyPatch({ a: 1, ab: 2 }, [{ op: 'move', from: '/a', path: '/ab' }]), { ab: 1 });
  assert.deepEqual(applyPatch({ a: { b: 1 } }, [{ op: 'copy', from: '/a', path: '/a/c' }]), {
    a: { b: 1, c: { b: 1 } },
  });
  const out = applyPatch({ a: [1] }, [{ op: 'copy', from: '/a', path: '/b' }]);
  assert.notEqual(out.a, out.b);
  fails({}, [{ op: 'copy', from: '/x', path: '/y' }], 'operation 0: from not found', 0);
  fails([], [{ op: 'copy', from: '/x', path: '/y' }], 'operation 0: bad index', 0);
});

test('test op', () => {
  assert.deepEqual(applyPatch({ a: [1, { b: 0 }] }, [{ op: 'test', path: '/a', value: [1.0, { b: -0 }] }]), {
    a: [1, { b: 0 }],
  });
  applyPatch({ a: 1, b: 2 }, [{ op: 'test', path: '', value: { b: 2, a: 1 } }]);
  fails({ a: '1' }, [{ op: 'test', path: '/a', value: 1 }], 'operation 0: test failed', 0);
  fails({ a: null }, [{ op: 'test', path: '/a', value: {} }], 'operation 0: test failed', 0);
  fails({ a: [] }, [{ op: 'test', path: '/a', value: {} }], 'operation 0: test failed', 0);
  fails({ a: {} }, [{ op: 'test', path: '/a', value: { x: 1 } }], 'operation 0: test failed', 0);
  fails({ a: 'é' }, [{ op: 'test', path: '/a', value: 'é' }], 'operation 0: test failed', 0);
});

test('form rules', () => {
  fails({}, {}, 'patch must be an array', null);
  fails({}, [null], 'operation 0: not an object', 0);
  fails({}, [[]], 'operation 0: not an object', 0);
  fails({}, [() => {}], 'operation 0: not an object', 0);
  // eslint-disable-next-line no-sparse-arrays
  fails({}, [, {}], 'operation 0: not an object', 0);
  fails({}, [new String('x')], 'operation 0: bad op', 0);
  fails({}, [{ op: new String('add') }], 'operation 0: bad op', 0);
  fails({}, [Object.create({ op: 'add', path: '', value: 1 })], 'operation 0: bad op', 0);
  fails({}, [{ op: 'add', path: 1 }], 'operation 0: bad path', 0);
  fails({}, [{ op: 'add', path: 'a' }], 'operation 0: bad path', 0);
  fails({}, [{ op: 'copy', path: '/a', from: '/~' }], 'operation 0: bad from', 0);
  fails({}, [{ op: 'add', path: '/a' }], 'operation 0: missing value', 0);
  fails({}, [{ op: 'remove', path: '' }], 'operation 0: cannot remove root', 0);
  const op = { op: 'add', path: '/a' };
  Object.defineProperty(op, 'value', { value: 1, enumerable: false });
  assert.deepEqual(applyPatch({}, [op]), { a: 1 });
  // Checks run before anything is applied.
  fails({}, [{ op: 'test', path: '/x', value: 1 }, { op: 'bogus' }], 'operation 1: bad op', 1);
  fails({}, [{ op: 'add', path: '/a', value: 1 }, { op: 'test', path: '/a', value: 2 }], 'operation 1: test failed', 1);
});

test('does not mutate inputs on failure', () => {
  const doc = { a: [1, 2] };
  const patch = [{ op: 'remove', path: '/a/0' }, { op: 'test', path: '/a', value: [] }];
  const docCopy = JSON.parse(JSON.stringify(doc));
  const patchCopy = JSON.parse(JSON.stringify(patch));
  assert.throws(() => applyPatch(doc, patch), PatchError);
  assert.deepEqual(doc, docCopy);
  assert.deepEqual(patch, patchCopy);
});

test('deep documents', () => {
  let doc = 0;
  for (let k = 0; k < 1000; k++) doc = [doc];
  const out = applyPatch(doc, [{ op: 'copy', from: '', path: '/-' }, { op: 'test', path: '/1', value: doc }]);
  assert.equal(out.length, 2);
});
