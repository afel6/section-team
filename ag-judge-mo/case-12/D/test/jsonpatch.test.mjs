import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePointer, applyPatch, PatchError } from '../jsonpatch.mjs';

function throwsPatch(fn, message, index) {
  assert.throws(fn, (e) => {
    assert.ok(e instanceof PatchError);
    assert.ok(e instanceof Error);
    assert.equal(e.name, 'PatchError');
    assert.equal(e.message, message);
    assert.equal(e.index, index);
    return true;
  });
}

test('parsePointer', () => {
  assert.deepEqual(parsePointer(''), []);
  assert.deepEqual(parsePointer('/'), ['']);
  assert.deepEqual(parsePointer('/a//b/'), ['a', '', 'b', '']);
  assert.deepEqual(parsePointer('/~01'), ['~1']);
  assert.deepEqual(parsePointer('/~10'), ['/0']);
  assert.throws(() => parsePointer(new String('/a')), { name: 'TypeError', message: 'pointer must be a string' });
  assert.throws(() => parsePointer(1), TypeError);
  assert.throws(() => parsePointer('a'), { name: 'SyntaxError', message: 'invalid pointer' });
  assert.throws(() => parsePointer('/~2'), SyntaxError);
  assert.throws(() => parsePointer('/a~'), SyntaxError);
});

test('empty patch deep-copies and keeps -0', () => {
  const doc = { a: -0, b: [1, { c: 2 }] };
  const out = applyPatch(doc, []);
  assert.deepEqual(out, doc);
  assert.notEqual(out, doc);
  assert.notEqual(out.b, doc.b);
  assert.ok(Object.is(out.a, -0));
});

test('add', () => {
  assert.deepEqual(Object.keys(applyPatch({ b: 0 }, [{ op: 'add', path: '/1', value: 5 }])), ['1', 'b']);
  assert.deepEqual(applyPatch([1, 2], [{ op: 'add', path: '/1', value: 9 }]), [1, 9, 2]);
  assert.deepEqual(applyPatch([1, 2], [{ op: 'add', path: '/2', value: 9 }]), [1, 2, 9]);
  assert.deepEqual(applyPatch([1], [{ op: 'add', path: '/-', value: 9 }]), [1, 9]);
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'add', path: '', value: [1] }]), [1]);
  const keys = Object.keys(applyPatch({ a: 1, b: 2 }, [{ op: 'add', path: '/a', value: 3 }]));
  assert.deepEqual(keys, ['a', 'b']);
  const proto = applyPatch({}, [{ op: 'add', path: '/__proto__', value: { x: 1 } }]);
  assert.ok(Object.hasOwn(proto, '__proto__'));
  assert.equal(Object.getPrototypeOf(proto), Object.prototype);
  throwsPatch(() => applyPatch([1], [{ op: 'add', path: '/3', value: 1 }]), 'operation 0: path not found', 0);
  throwsPatch(() => applyPatch([1], [{ op: 'add', path: '/01', value: 1 }]), 'operation 0: bad index', 0);
  throwsPatch(() => applyPatch({ a: 1 }, [{ op: 'add', path: '/a/b', value: 1 }]), 'operation 0: path not found', 0);
  throwsPatch(() => applyPatch({}, [{ op: 'add', path: '/x/y', value: 1 }]), 'operation 0: path not found', 0);
});

test('inherited names are not members', () => {
  throwsPatch(() => applyPatch({}, [{ op: 'remove', path: '/toString' }]), 'operation 0: path not found', 0);
  throwsPatch(() => applyPatch({}, [{ op: 'test', path: '/constructor', value: 1 }]), 'operation 0: path not found', 0);
});

test('remove and replace', () => {
  assert.deepEqual(applyPatch([1, 2, 3], [{ op: 'remove', path: '/1' }]), [1, 3]);
  assert.deepEqual(applyPatch({ a: 1, b: 2 }, [{ op: 'remove', path: '/a' }]), { b: 2 });
  assert.deepEqual(Object.keys(applyPatch({ a: 1, b: 2 }, [{ op: 'replace', path: '/a', value: 0 }])), ['a', 'b']);
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'replace', path: '', value: null }]), null);
  throwsPatch(() => applyPatch([1], [{ op: 'remove', path: '/-' }]), 'operation 0: path not found', 0);
  throwsPatch(() => applyPatch([1], [{ op: 'replace', path: '/length', value: 1 }]), 'operation 0: bad index', 0);
  throwsPatch(() => applyPatch('s', [{ op: 'remove', path: '/0' }]), 'operation 0: path not found', 0);
});

test('move and copy', () => {
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'move', from: '/a', path: '/b' }]), { b: 1 });
  assert.deepEqual(applyPatch([1, 2, 3], [{ op: 'move', from: '/0', path: '/2' }]), [2, 3, 1]);
  assert.deepEqual(applyPatch({ a: 1, b: 2 }, [{ op: 'move', from: '/a', path: '/a' }]), { a: 1, b: 2 });
  assert.deepEqual(applyPatch({ a: { b: 1 } }, [{ op: 'move', from: '/a', path: '' }]), { b: 1 });
  const c = applyPatch({ a: { b: 1 } }, [{ op: 'copy', from: '/a', path: '/a/c' }]);
  assert.deepEqual(c, { a: { b: 1, c: { b: 1 } } });
  assert.notEqual(c.a, c.a.c);
  throwsPatch(() => applyPatch({}, [{ op: 'move', from: '/x', path: '/y/z' }]), 'operation 0: from not found', 0);
  throwsPatch(() => applyPatch([], [{ op: 'copy', from: '/a', path: '/0' }]), 'operation 0: bad index', 0);
  throwsPatch(() => applyPatch({}, [{ op: 'move', from: '/x', path: '/x' }]), 'operation 0: from not found', 0);
});

test('test op', () => {
  const doc = { n: 1, z: -0, s: 'é', o: { a: [1, { b: null }] } };
  assert.deepEqual(applyPatch(doc, [
    { op: 'test', path: '/n', value: 1.0 },
    { op: 'test', path: '/z', value: 0 },
    { op: 'test', path: '/o', value: { a: [1, { b: null }] } },
    { op: 'test', path: '', value: { o: { a: [1, { b: null }] }, s: 'é', z: 0, n: 1 } },
  ]), doc);
  throwsPatch(() => applyPatch(doc, [{ op: 'test', path: '/s', value: 'é' }]), 'operation 0: test failed', 0);
  throwsPatch(() => applyPatch(doc, [{ op: 'test', path: '/n', value: '1' }]), 'operation 0: test failed', 0);
  throwsPatch(() => applyPatch(doc, [{ op: 'test', path: '/o', value: { a: [1, {}] } }]), 'operation 0: test failed', 0);
  throwsPatch(() => applyPatch({ a: [] }, [{ op: 'test', path: '/a', value: {} }]), 'operation 0: test failed', 0);
});

test('form rules', () => {
  throwsPatch(() => applyPatch({}, {}), 'patch must be an array', null);
  throwsPatch(() => applyPatch({}, [null]), 'operation 0: not an object', 0);
  throwsPatch(() => applyPatch({}, [[]]), 'operation 0: not an object', 0);
  throwsPatch(() => applyPatch({}, [() => {}]), 'operation 0: not an object', 0);
  // eslint-disable-next-line no-sparse-arrays
  throwsPatch(() => applyPatch({}, [{ op: 'test', path: '', value: {} }, ,]), 'operation 1: not an object', 1);
  throwsPatch(() => applyPatch({}, [new String('x')]), 'operation 0: bad op', 0);
  throwsPatch(() => applyPatch({}, [{ op: new String('add'), path: '', value: 1 }]), 'operation 0: bad op', 0);
  throwsPatch(() => applyPatch({}, [Object.create({ op: 'add', path: '', value: 1 })]), 'operation 0: bad op', 0);
  throwsPatch(() => applyPatch({}, [{ op: 'add', path: 'a', value: 1 }]), 'operation 0: bad path', 0);
  throwsPatch(() => applyPatch({}, [{ op: 'copy', path: '/a' }]), 'operation 0: bad from', 0);
  throwsPatch(() => applyPatch({}, [{ op: 'replace', path: '/a' }]), 'operation 0: missing value', 0);
  throwsPatch(() => applyPatch({}, [{ op: 'remove', path: '' }]), 'operation 0: cannot remove root', 0);
  throwsPatch(() => applyPatch({}, [{ op: 'move', from: '/a', path: '/a/b' }]), 'operation 0: cannot move into own child', 0);
  throwsPatch(() => applyPatch({}, [{ op: 'move', from: '', path: '/a' }]), 'operation 0: cannot move into own child', 0);
  throwsPatch(() => applyPatch({ ab: 1 }, [{ op: 'move', from: '/a', path: '/ab' }]), 'operation 0: from not found', 0);
  const op = { op: 'add', path: '/x' };
  Object.defineProperty(op, 'value', { value: 1, enumerable: false });
  assert.deepEqual(applyPatch({}, [op]), { x: 1 });
  // A form error in a later operation stops everything before applying.
  throwsPatch(() => applyPatch({}, [{ op: 'test', path: '/nope', value: 1 }, { op: 'bad' }]), 'operation 1: bad op', 1);
});

test('inputs are never changed', () => {
  const doc = { a: [1, 2], b: { c: 1 } };
  const value = { v: [1] };
  const patch = [
    { op: 'add', path: '/a/-', value },
    { op: 'remove', path: '/b/c' },
    { op: 'test', path: '/nope', value: 1 },
  ];
  const docSnap = JSON.stringify(doc);
  const patchSnap = JSON.stringify(patch);
  throwsPatch(() => applyPatch(doc, patch), 'operation 2: path not found', 2);
  assert.equal(JSON.stringify(doc), docSnap);
  assert.equal(JSON.stringify(patch), patchSnap);
  const out = applyPatch(doc, patch.slice(0, 2));
  assert.notEqual(out.a[2], value);
  assert.notEqual(out.a[2].v, value.v);
});

test('deep documents', () => {
  let doc = 0;
  for (let i = 0; i < 1000; i++) doc = [doc];
  const deepest = '/0'.repeat(1000);
  let out = applyPatch(doc, [{ op: 'replace', path: deepest, value: doc }]);
  for (let i = 0; i < 10; i++) {
    out = applyPatch(out, [{ op: 'copy', from: '', path: '/0'.repeat(1000 * (i + 2)) }]);
  }
  assert.ok(Array.isArray(out));
  applyPatch(doc, [{ op: 'test', path: '', value: doc }]);
});
