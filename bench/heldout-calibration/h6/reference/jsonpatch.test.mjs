// Tests for jsonpatch.mjs: pointers, form rules, each operation, failures and copy guarantees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, parsePointer, PatchError } from './jsonpatch.mjs';

// Asserts that applyPatch throws a PatchError with this message and index.
function throwsPatch(doc, patch, message, index) {
  assert.throws(() => applyPatch(doc, patch), (err) => {
    assert.ok(err instanceof PatchError);
    assert.ok(err instanceof Error);
    assert.equal(err.name, 'PatchError');
    assert.equal(err.message, message);
    assert.equal(err.index, index);
    return true;
  });
}

const nested = (depth) => {
  let value = 0;
  for (let i = 0; i < depth; i++) value = [value];
  return value;
};

test('parsePointer decodes tokens', () => {
  assert.deepEqual(parsePointer(''), []);
  assert.deepEqual(parsePointer('/'), ['']);
  assert.deepEqual(parsePointer('/a//b/'), ['a', '', 'b', '']);
  assert.deepEqual(parsePointer('/~01'), ['~1']);
  assert.deepEqual(parsePointer('/~10'), ['/0']);
  assert.deepEqual(parsePointer('/a~1b/c~0d'), ['a/b', 'c~d']);
});

test('parsePointer returns a new array each time', () => {
  const first = parsePointer('/a');
  first.push('x');
  assert.deepEqual(parsePointer('/a'), ['a']);
});

test('parsePointer rejects non-strings and invalid pointers', () => {
  for (const bad of [undefined, null, 1, ['/a'], new String('/a')]) {
    assert.throws(() => parsePointer(bad), { name: 'TypeError', message: 'pointer must be a string' });
  }
  for (const bad of ['a', ' /a', '/~', '/~2', '/a~', '/~/', '#/a']) {
    assert.throws(() => parsePointer(bad), { name: 'SyntaxError', message: 'invalid pointer' });
  }
});

test('add: members, array insert, append and root', () => {
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'add', path: '/b', value: [2] }]), { a: 1, b: [2] });
  assert.deepEqual(applyPatch([1, 2], [{ op: 'add', path: '/1', value: 9 }]), [1, 9, 2]);
  assert.deepEqual(applyPatch([1, 2], [{ op: 'add', path: '/2', value: 9 }]), [1, 2, 9]);
  assert.deepEqual(applyPatch([1, 2], [{ op: 'add', path: '/-', value: 9 }]), [1, 2, 9]);
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'add', path: '', value: [3] }]), [3]);
  assert.deepEqual(applyPatch({ '': 0 }, [{ op: 'add', path: '/', value: 1 }]), { '': 1 });
});

test('member order follows JavaScript property order', () => {
  const added = applyPatch({ b: 0 }, [{ op: 'add', path: '/1', value: 5 }]);
  assert.deepEqual(Object.keys(added), ['1', 'b']);
  const kept = applyPatch({ a: 1, b: 2, c: 3 }, [
    { op: 'add', path: '/a', value: 7 },
    { op: 'replace', path: '/b', value: 8 },
  ]);
  assert.deepEqual(Object.keys(kept), ['a', 'b', 'c']);
  assert.deepEqual(kept, { a: 7, b: 8, c: 3 });
});

test('add failures on the last token', () => {
  throwsPatch([1], [{ op: 'add', path: '/2', value: 0 }], 'operation 0: path not found', 0);
  throwsPatch([1], [{ op: 'add', path: '/01', value: 0 }], 'operation 0: bad index', 0);
  throwsPatch({ a: 1 }, [{ op: 'add', path: '/a/b', value: 0 }], 'operation 0: path not found', 0);
  throwsPatch({ a: null }, [{ op: 'add', path: '/a/b', value: 0 }], 'operation 0: path not found', 0);
  throwsPatch({}, [{ op: 'add', path: '/x/y', value: 0 }], 'operation 0: path not found', 0);
  throwsPatch([[]], [{ op: 'add', path: '/-/0', value: 0 }], 'operation 0: path not found', 0);
});

test('bad index tokens on arrays', () => {
  for (const token of ['01', '+1', '1.0', '1e0', ' 1', 'length', '', '-1']) {
    throwsPatch([1, 2], [{ op: 'remove', path: `/${token}` }], 'operation 0: bad index', 0);
  }
  throwsPatch([1], [{ op: 'remove', path: '/1' }], 'operation 0: path not found', 0);
  throwsPatch([1], [{ op: 'remove', path: '/-' }], 'operation 0: path not found', 0);
  throwsPatch([1], [{ op: 'remove', path: '/99999999999999999999999' }], 'operation 0: path not found', 0);
});

test('object tokens are own member names only', () => {
  for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
    throwsPatch({}, [{ op: 'test', path: `/${name}`, value: null }], 'operation 0: path not found', 0);
  }
  const result = applyPatch({}, [{ op: 'add', path: '/__proto__', value: { x: 1 } }]);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.deepEqual(Object.keys(result), ['__proto__']);
  assert.equal(JSON.stringify(result), '{"__proto__":{"x":1}}');
  const doc = JSON.parse('{"__proto__":1,"constructor":2}');
  const replaced = applyPatch(doc, [{ op: 'replace', path: '/__proto__', value: 3 }, { op: 'remove', path: '/constructor' }]);
  assert.equal(JSON.stringify(replaced), '{"__proto__":3}');
});

test('primitives name nothing', () => {
  throwsPatch('abc', [{ op: 'test', path: '/0', value: 'a' }], 'operation 0: path not found', 0);
  throwsPatch({ a: 5 }, [{ op: 'remove', path: '/a/0' }], 'operation 0: path not found', 0);
});

test('remove and replace', () => {
  assert.deepEqual(applyPatch([1, 2, 3], [{ op: 'remove', path: '/0' }]), [2, 3]);
  assert.deepEqual(applyPatch({ a: 1, b: 2 }, [{ op: 'remove', path: '/a', value: 'ignored' }]), { b: 2 });
  assert.deepEqual(applyPatch([1, 2], [{ op: 'replace', path: '/1', value: { x: 1 } }]), [1, { x: 1 }]);
  assert.deepEqual(applyPatch(1, [{ op: 'replace', path: '', value: null }]), null);
  throwsPatch({}, [{ op: 'replace', path: '/a', value: 1 }], 'operation 0: path not found', 0);
});

test('move', () => {
  assert.deepEqual(applyPatch({ a: 1, b: { c: 2 } }, [{ op: 'move', from: '/a', path: '/b/a' }]), { b: { c: 2, a: 1 } });
  assert.deepEqual(applyPatch([1, 2, 3, 4], [{ op: 'move', from: '/0', path: '/3' }]), [2, 3, 4, 1]);
  assert.deepEqual(applyPatch({ a: 1, ab: 2 }, [{ op: 'move', from: '/a', path: '/ab' }]), { ab: 1 });
  assert.deepEqual(applyPatch({ a: { b: 1 } }, [{ op: 'move', from: '/a/b', path: '/a' }]), { a: 1 });
  assert.deepEqual(applyPatch({ a: [1] }, [{ op: 'move', from: '/a', path: '' }]), [1]);
  const same = applyPatch({ x: 1, y: 2 }, [{ op: 'move', from: '/x', path: '/x' }]);
  assert.deepEqual(Object.keys(same), ['x', 'y']);
  assert.deepEqual(applyPatch([1], [{ op: 'move', from: '', path: '' }]), [1]);
  throwsPatch([1, 2], [{ op: 'move', from: '/0', path: '/2' }], 'operation 0: path not found', 0);
  throwsPatch({}, [{ op: 'move', from: '/x', path: '/x' }], 'operation 0: from not found', 0);
  throwsPatch({}, [{ op: 'move', from: '/x', path: '/y/z' }], 'operation 0: from not found', 0);
  throwsPatch([], [{ op: 'move', from: '/a', path: '/b' }], 'operation 0: bad index', 0);
});

test('copy takes a deep copy before changing anything', () => {
  const result = applyPatch({ a: { b: 1 } }, [{ op: 'copy', from: '/a', path: '/a/c' }]);
  assert.deepEqual(result, { a: { b: 1, c: { b: 1 } } });
  assert.notEqual(result.a, result.a.c);
  const twice = applyPatch([[1]], [{ op: 'copy', from: '/0', path: '/-' }, { op: 'add', path: '/1/-', value: 2 }]);
  assert.deepEqual(twice, [[1], [1, 2]]);
  assert.deepEqual(applyPatch([1], [{ op: 'copy', from: '/0', path: '/0' }]), [1, 1]);
  throwsPatch({}, [{ op: 'copy', from: '/-', path: '/x' }], 'operation 0: from not found', 0);
});

test('test compares JSON values', () => {
  const doc = { n: 1, z: -0, s: 'é', a: [1, { b: null }], o: { x: 1, y: [true] } };
  const passes = [
    ['/n', 1.0], ['/z', 0], ['/a', [1, { b: null }]], ['/o', { y: [true], x: 1 }], ['', doc],
  ];
  for (const [path, value] of passes) assert.deepEqual(applyPatch(doc, [{ op: 'test', path, value }]), doc);
  const fails = [
    ['/n', '1'], ['/n', true], ['/s', 'é'], ['/a', [{ b: null }, 1]], ['/a', [1]],
    ['/o', { x: 1 }], ['/o', { x: 1, y: [true], z: 1 }], ['/o', [1]], ['/a/1/b', 0], ['/a', { 0: 1, 1: { b: null } }],
  ];
  for (const [path, value] of fails) {
    throwsPatch(doc, [{ op: 'test', path: '/n', value: 1 }, { op: 'test', path, value }], 'operation 1: test failed', 1);
  }
});

test('form rules, in order', () => {
  const cases = [
    [null, 'not an object'], [[], 'not an object'], ['add', 'not an object'], [() => {}, 'not an object'],
    [{}, 'bad op'], [{ op: 'ADD', path: '' }, 'bad op'], [{ op: new String('add'), path: '' }, 'bad op'],
    [{ op: 'add' }, 'bad path'], [{ op: 'add', path: 1, value: 1 }, 'bad path'],
    [{ op: 'add', path: 'a', value: 1 }, 'bad path'], [{ op: 'add', path: new String('/a'), value: 1 }, 'bad path'],
    [{ op: 'move', path: '/a' }, 'bad from'], [{ op: 'copy', path: '/a', from: '/~' }, 'bad from'],
    [{ op: 'move', path: '/~', from: '/~' }, 'bad path'], [{ op: 'add', path: '/a' }, 'missing value'],
    [{ op: 'test', path: '' }, 'missing value'], [{ op: 'remove', path: '' }, 'cannot remove root'],
    [{ op: 'move', from: '/a', path: '/a/b' }, 'cannot move into own child'],
    [{ op: 'move', from: '', path: '/a' }, 'cannot move into own child'],
    [{ op: 'move', from: '/a~1b', path: '/a~1b/' }, 'cannot move into own child'],
  ];
  for (const [op, reason] of cases) throwsPatch({}, [op], `operation 0: ${reason}`, 0);
  throwsPatch({}, [new String('x')], 'operation 0: bad op', 0);
  throwsPatch({}, [new Date(0)], 'operation 0: bad op', 0);
});

test('a hole is not an object, and form checks come before applying', () => {
  // eslint-disable-next-line no-sparse-arrays
  throwsPatch({}, [{ op: 'test', path: '', value: {} }, , { op: 'bad' }], 'operation 1: not an object', 1);
  throwsPatch({}, [{ op: 'remove', path: '/nope' }, { op: 'nope' }], 'operation 1: bad op', 1);
  throwsPatch({}, [{ op: 'add', path: '/a', value: 1 }, { op: 'test', path: '/a', value: 2 }], 'operation 1: test failed', 1);
});

test('members are own properties, enumerable or not', () => {
  const inherited = Object.create({ op: 'add', path: '/a', value: 1 });
  throwsPatch({}, [inherited], 'operation 0: bad op', 0);
  const hidden = {};
  Object.defineProperty(hidden, 'op', { value: 'add' });
  Object.defineProperty(hidden, 'path', { value: '/a' });
  Object.defineProperty(hidden, 'value', { value: 1 });
  assert.deepEqual(applyPatch({}, [hidden]), { a: 1 });
  const bare = Object.assign(Object.create(null), { op: 'replace', path: '', value: null, from: 5 });
  assert.equal(applyPatch({}, [bare]), null);
});

test('patch must be an array', () => {
  for (const bad of [null, {}, '[]', { length: 0 }, undefined]) throwsPatch({}, bad, 'patch must be an array', null);
});

test('never changes doc or patch and shares nothing with them', () => {
  const doc = { a: [1, { b: 2 }], c: { d: -0 } };
  const value = { v: [1] };
  const patch = [
    { op: 'add', path: '/x', value },
    { op: 'replace', path: '/a/1', value },
    { op: 'move', from: '/c', path: '/m' },
    { op: 'copy', from: '/x', path: '/y' },
  ];
  const before = structuredClone({ doc, patch });
  const result = applyPatch(doc, patch);
  assert.deepEqual({ doc, patch }, before);
  assert.notEqual(result.x, value);
  assert.notEqual(result.a[1], value);
  assert.notEqual(result.m, doc.c);
  assert.ok(Object.is(result.m.d, -0));
  throwsPatch(doc, [{ op: 'remove', path: '/a/0' }, { op: 'remove', path: '/zz' }], 'operation 1: path not found', 1);
  assert.deepEqual({ doc, patch }, before);
});

test('an empty patch returns a deep copy, -0 included', () => {
  const doc = { a: -0, b: [{ c: -0 }] };
  const result = applyPatch(doc, []);
  assert.deepEqual(result, doc);
  assert.notEqual(result, doc);
  assert.notEqual(result.b, doc.b);
  assert.ok(Object.is(result.a, -0) && Object.is(result.b[0].c, -0));
  assert.ok(Object.is(applyPatch({}, [{ op: 'add', path: '/z', value: -0 }]).z, -0));
  assert.equal(applyPatch('s', []), 's');
});

test('deep documents and values', () => {
  const doc = nested(1000);
  assert.deepEqual(applyPatch(doc, []), doc);
  const result = applyPatch(doc, [{ op: 'copy', from: '', path: '/-' }, { op: 'test', path: '/1', value: doc }]);
  assert.equal(result.length, 2);
  assert.deepEqual(applyPatch({}, [{ op: 'add', path: '/d', value: nested(1000) }]).d, nested(1000));
});
