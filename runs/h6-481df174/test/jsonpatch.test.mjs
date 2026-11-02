import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePointer, applyPatch, PatchError } from '../jsonpatch.mjs';

function patchError(doc, patch) {
  try {
    applyPatch(doc, patch);
  } catch (err) {
    assert.ok(err instanceof PatchError);
    assert.ok(err instanceof Error);
    assert.equal(err.name, 'PatchError');
    return err;
  }
  assert.fail('expected a PatchError');
}

function failsWith(doc, patch, message, index) {
  const err = patchError(doc, patch);
  assert.equal(err.message, message);
  assert.equal(err.index, index);
}

test('parsePointer decodes tokens', () => {
  assert.deepEqual(parsePointer(''), []);
  assert.deepEqual(parsePointer('/'), ['']);
  assert.deepEqual(parsePointer('/a//b/'), ['a', '', 'b', '']);
  assert.deepEqual(parsePointer('/~01'), ['~1']);
  assert.deepEqual(parsePointer('/~10'), ['/0']);
  assert.deepEqual(parsePointer('/a~1b/c~0d'), ['a/b', 'c~d']);
});

test('parsePointer returns a new array each time', () => {
  const a = parsePointer('');
  a.push('x');
  assert.deepEqual(parsePointer(''), []);
});

test('parsePointer rejects non-strings with TypeError', () => {
  for (const p of [new String('/a'), null, undefined, 1, ['/a'], {}]) {
    assert.throws(() => parsePointer(p), (e) => e instanceof TypeError && e.message === 'pointer must be a string');
  }
});

test('parsePointer rejects invalid pointers with SyntaxError', () => {
  for (const p of ['a', ' /a', '/~', '/~2', '/a~', '/~~0', '#/a']) {
    assert.throws(() => parsePointer(p), (e) => e instanceof SyntaxError && e.message === 'invalid pointer', p);
  }
});

test('patch must be an array', () => {
  for (const p of [null, {}, 'x', { length: 0 }, undefined]) {
    const err = patchError({}, p);
    assert.equal(err.message, 'patch must be an array');
    assert.equal(err.index, null);
  }
});

test('empty patch returns a deep copy keeping -0 and order', () => {
  const doc = { b: { c: [1, { d: -0 }] }, a: -0 };
  const out = applyPatch(doc, []);
  assert.deepEqual(out, doc);
  assert.notEqual(out, doc);
  assert.notEqual(out.b, doc.b);
  assert.notEqual(out.b.c, doc.b.c);
  assert.ok(Object.is(out.a, -0));
  assert.ok(Object.is(out.b.c[1].d, -0));
  assert.deepEqual(Object.keys(out), ['b', 'a']);
});

test('form rule: not an object', () => {
  for (const op of [null, [], 1, 'x', true, undefined, () => {}]) {
    failsWith({}, [op], 'operation 0: not an object', 0);
  }
  failsWith({}, [, { op: 'add' }], 'operation 0: not an object', 0); // eslint-disable-line no-sparse-arrays
  failsWith({}, [new String('x')], 'operation 0: bad op', 0);
  failsWith({}, [new Date()], 'operation 0: bad op', 0);
});

test('form rule: bad op', () => {
  for (const op of [{}, { op: 'ADD', path: '' }, { op: new String('add'), path: '', value: 1 }, { op: 'add ', path: '' }]) {
    failsWith({}, [op], 'operation 0: bad op', 0);
  }
  const inherited = Object.create({ op: 'test', path: '', value: {} });
  failsWith({}, [inherited], 'operation 0: bad op', 0);
});

test('non-enumerable own members count', () => {
  const op = {};
  Object.defineProperty(op, 'op', { value: 'add', enumerable: false });
  Object.defineProperty(op, 'path', { value: '/a', enumerable: false });
  Object.defineProperty(op, 'value', { value: 1, enumerable: false });
  assert.deepEqual(applyPatch({}, [op]), { a: 1 });
});

test('form rule: bad path and bad from', () => {
  failsWith({}, [{ op: 'remove' }], 'operation 0: bad path', 0);
  failsWith({}, [{ op: 'remove', path: new String('/a') }], 'operation 0: bad path', 0);
  failsWith({}, [{ op: 'remove', path: 'a' }], 'operation 0: bad path', 0);
  failsWith({}, [{ op: 'remove', path: '/~2' }], 'operation 0: bad path', 0);
  failsWith({}, [{ op: 'move', path: '/a' }], 'operation 0: bad from', 0);
  failsWith({}, [{ op: 'copy', path: '/a', from: 'x' }], 'operation 0: bad from', 0);
  failsWith({}, [{ op: 'move', path: 'x', from: 'x' }], 'operation 0: bad path', 0);
  // from is ignored on add
  assert.deepEqual(applyPatch({}, [{ op: 'add', path: '/a', value: 1, from: 5 }]), { a: 1 });
});

test('form rule: missing value', () => {
  for (const name of ['add', 'replace', 'test']) {
    failsWith({}, [{ op: name, path: '' }], 'operation 0: missing value', 0);
  }
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'replace', path: '/a', value: null }]), { a: null });
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'remove', path: '/a', value: undefined }]), {});
});

test('form rule: cannot remove root and cannot move into own child', () => {
  failsWith({}, [{ op: 'remove', path: '' }], 'operation 0: cannot remove root', 0);
  failsWith({ a: {} }, [{ op: 'move', from: '/a', path: '/a/b' }], 'operation 0: cannot move into own child', 0);
  failsWith({ a: {} }, [{ op: 'move', from: '', path: '/a' }], 'operation 0: cannot move into own child', 0);
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'move', from: '/a', path: '/ab' }]), { ab: 1 });
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'move', from: '', path: '' }]), { a: 1 });
});

test('form checks run on every operation before applying any', () => {
  failsWith({}, [{ op: 'test', path: '/x', value: 1 }, { op: 'nope' }], 'operation 1: bad op', 1);
});

test('form reasons are checked in order', () => {
  failsWith({}, [{ op: 'move', path: 'x' }], 'operation 0: bad path', 0);
  failsWith({}, [{ op: 'remove', path: '' , value: 1 }], 'operation 0: cannot remove root', 0);
});

test('add: object members and order', () => {
  const out = applyPatch({ b: 0 }, [{ op: 'add', path: '/1', value: 5 }]);
  assert.deepEqual(Object.keys(out), ['1', 'b']);
  const out2 = applyPatch({ a: 1, b: 2 }, [{ op: 'add', path: '/a', value: 3 }, { op: 'add', path: '/c', value: 4 }]);
  assert.deepEqual(Object.keys(out2), ['a', 'b', 'c']);
  assert.deepEqual(out2, { a: 3, b: 2, c: 4 });
});

test('add: special member names are ordinary', () => {
  const out = applyPatch({}, [{ op: 'add', path: '/__proto__', value: { x: 1 } }]);
  assert.ok(Object.hasOwn(out, '__proto__'));
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.deepEqual(Object.keys(out), ['__proto__']);
  failsWith({}, [{ op: 'remove', path: '/toString' }], 'operation 0: path not found', 0);
  failsWith({}, [{ op: 'test', path: '/constructor', value: {} }], 'operation 0: path not found', 0);
  failsWith({}, [{ op: 'add', path: '/__proto__/x', value: 1 }], 'operation 0: path not found', 0);
});

test('add: whole document', () => {
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'add', path: '', value: [1] }]), [1]);
});

test('add: arrays', () => {
  assert.deepEqual(applyPatch([1, 2], [{ op: 'add', path: '/-', value: 3 }]), [1, 2, 3]);
  assert.deepEqual(applyPatch([1, 2], [{ op: 'add', path: '/1', value: 9 }]), [1, 9, 2]);
  assert.deepEqual(applyPatch([1, 2], [{ op: 'add', path: '/2', value: 9 }]), [1, 2, 9]);
  failsWith([1, 2], [{ op: 'add', path: '/3', value: 9 }], 'operation 0: path not found', 0);
  for (const t of ['01', '+1', '1.0', '1e0', ' 1', 'length', '', '-1']) {
    failsWith([1, 2], [{ op: 'add', path: `/${t}`, value: 9 }], 'operation 0: bad index', 0);
  }
});

test('add: parent missing or not a container', () => {
  failsWith({}, [{ op: 'add', path: '/a/b', value: 1 }], 'operation 0: path not found', 0);
  failsWith({ a: 1 }, [{ op: 'add', path: '/a/b', value: 1 }], 'operation 0: path not found', 0);
  failsWith('s', [{ op: 'add', path: '/0', value: 1 }], 'operation 0: path not found', 0);
  failsWith(null, [{ op: 'add', path: '/a', value: 1 }], 'operation 0: path not found', 0);
  failsWith([[]], [{ op: 'add', path: '/x/0', value: 1 }], 'operation 0: bad index', 0);
  failsWith([[]], [{ op: 'add', path: '/-/0', value: 1 }], 'operation 0: path not found', 0);
  failsWith([[]], [{ op: 'add', path: '/1/0', value: 1 }], 'operation 0: path not found', 0);
});

test('remove', () => {
  assert.deepEqual(applyPatch({ a: 1, b: 2 }, [{ op: 'remove', path: '/a' }]), { b: 2 });
  assert.deepEqual(applyPatch([1, 2, 3], [{ op: 'remove', path: '/0' }]), [2, 3]);
  failsWith([1], [{ op: 'remove', path: '/1' }], 'operation 0: path not found', 0);
  failsWith([1], [{ op: 'remove', path: '/-' }], 'operation 0: path not found', 0);
  failsWith([1], [{ op: 'remove', path: '/00' }], 'operation 0: bad index', 0);
  failsWith({ a: 1 }, [{ op: 'remove', path: '/b' }], 'operation 0: path not found', 0);
  failsWith({ a: 'str' }, [{ op: 'remove', path: '/a/0' }], 'operation 0: path not found', 0);
});

test('replace', () => {
  const out = applyPatch({ a: 1, b: 2 }, [{ op: 'replace', path: '/a', value: 9 }]);
  assert.deepEqual(Object.keys(out), ['a', 'b']);
  assert.deepEqual(out, { a: 9, b: 2 });
  assert.deepEqual(applyPatch([1, 2], [{ op: 'replace', path: '/1', value: 9 }]), [1, 9]);
  assert.equal(applyPatch({ a: 1 }, [{ op: 'replace', path: '', value: 5 }]), 5);
  failsWith({}, [{ op: 'replace', path: '/a', value: 1 }], 'operation 0: path not found', 0);
  failsWith([1], [{ op: 'replace', path: '/1', value: 1 }], 'operation 0: path not found', 0);
  failsWith([1], [{ op: 'replace', path: '/-', value: 1 }], 'operation 0: path not found', 0);
});

test('move', () => {
  assert.deepEqual(applyPatch({ a: 1, b: 2 }, [{ op: 'move', from: '/a', path: '/c' }]), { b: 2, c: 1 });
  assert.deepEqual(applyPatch([1, 2, 3], [{ op: 'move', from: '/0', path: '/2' }]), [2, 3, 1]);
  assert.deepEqual(applyPatch([1, 2, 3], [{ op: 'move', from: '/2', path: '/0' }]), [3, 1, 2]);
  // the index counts after removal: length is 2 after removing, so /3 is out of range
  failsWith([1, 2, 3], [{ op: 'move', from: '/0', path: '/3' }], 'operation 0: path not found', 0);
  const same = applyPatch({ a: 1, b: 2 }, [{ op: 'move', from: '/a', path: '/a' }]);
  assert.deepEqual(Object.keys(same), ['a', 'b']);
  failsWith({}, [{ op: 'move', from: '/x', path: '/x' }], 'operation 0: from not found', 0);
  failsWith({}, [{ op: 'move', from: '/x', path: '/y/z' }], 'operation 0: from not found', 0);
  failsWith([1], [{ op: 'move', from: '/a', path: '/0' }], 'operation 0: bad index', 0);
  failsWith({ a: 1 }, [{ op: 'move', from: '/a', path: '/y/z' }], 'operation 0: path not found', 0);
  assert.deepEqual(applyPatch({ a: { b: 1 } }, [{ op: 'move', from: '/a/b', path: '/a' }]), { a: 1 });
});

test('copy', () => {
  const out = applyPatch({ a: { b: [1] } }, [{ op: 'copy', from: '/a', path: '/a/c' }]);
  assert.deepEqual(out, { a: { b: [1], c: { b: [1] } } });
  assert.notEqual(out.a.b, out.a.c.b);
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'copy', from: '', path: '/b' }]), { a: 1, b: { a: 1 } });
  failsWith({}, [{ op: 'copy', from: '/x', path: '/y' }], 'operation 0: from not found', 0);
  failsWith({ x: 1 }, [{ op: 'copy', from: '/x', path: '/y/z' }], 'operation 0: path not found', 0);
});

test('test: equality rules', () => {
  const ok = (doc, path, value) => assert.deepEqual(applyPatch(doc, [{ op: 'test', path, value }]), doc);
  const bad = (doc, path, value) => failsWith(doc, [{ op: 'test', path, value }], 'operation 0: test failed', 0);
  ok({ a: 1 }, '/a', 1.0);
  ok({ a: 0 }, '/a', -0);
  ok({ a: -0 }, '/a', 0);
  ok({ a: 1, b: [1, { c: null }] }, '', { b: [1, { c: null }], a: 1 });
  ok('x', '', 'x');
  bad({ a: 1 }, '/a', '1');
  bad({ a: 'é' }, '/a', 'é');
  bad({ a: [1, 2] }, '/a', [2, 1]);
  bad({ a: [1] }, '/a', [1, 1]);
  bad({ a: {} }, '/a', []);
  bad({ a: { x: 1 } }, '/a', { x: 1, y: 2 });
  bad({ a: { x: 1, y: 2 } }, '/a', { x: 1 });
  bad({ a: { x: 1 } }, '/a', { y: 1 });
  bad({ a: null }, '/a', false);
  bad({ a: 0 }, '/a', false);
  bad({ a: true }, '/a', 1);
  failsWith({}, [{ op: 'test', path: '/a', value: null }], 'operation 0: path not found', 0);
});

test('operations apply in order and report the failing index', () => {
  const patch = [
    { op: 'add', path: '/a', value: 1 },
    { op: 'test', path: '/a', value: 1 },
    { op: 'test', path: '/a', value: 2 },
  ];
  failsWith({}, patch, 'operation 2: test failed', 2);
});

test('applyPatch never changes doc or patch and shares nothing', () => {
  const doc = { a: [1, 2], b: { c: 1 } };
  const value = { deep: [1] };
  const patch = [
    { op: 'add', path: '/x', value },
    { op: 'remove', path: '/a/0' },
    { op: 'replace', path: '/b/c', value: [2] },
    { op: 'add', path: '/x/deep/-', value: 2 },
  ];
  const docCopy = structuredClone(doc);
  const patchCopy = structuredClone(patch);
  const out = applyPatch(doc, patch);
  assert.deepEqual(doc, docCopy);
  assert.deepEqual(patch, patchCopy);
  assert.deepEqual(out, { a: [2], b: { c: [2] }, x: { deep: [1, 2] } });
  assert.notEqual(out.x, value);
  failsWith(doc, [...patch, { op: 'test', path: '', value: 0 }], 'operation 4: test failed', 4);
  assert.deepEqual(doc, docCopy);
  assert.deepEqual(patch, patchCopy);
});

test('added values keep -0', () => {
  const out = applyPatch({}, [{ op: 'add', path: '/a', value: { b: -0 } }]);
  assert.ok(Object.is(out.a.b, -0));
});

test('handles 1000-level nesting', () => {
  let doc = 0;
  for (let i = 0; i < 1000; i++) doc = [doc];
  const out = applyPatch(doc, [{ op: 'copy', from: '', path: '/-' }, { op: 'test', path: '/0', value: doc[0] }]);
  assert.equal(out.length, 2);
});
