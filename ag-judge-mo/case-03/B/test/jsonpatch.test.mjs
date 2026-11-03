import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePointer, applyPatch, PatchError } from '../jsonpatch.mjs';

function fails(doc, patch, message, index) {
  let caught;
  try {
    applyPatch(doc, patch);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof PatchError, `expected PatchError, got ${caught}`);
  assert.ok(caught instanceof Error);
  assert.equal(caught.name, 'PatchError');
  assert.equal(caught.message, message);
  assert.equal(caught.index, index);
}

test('parsePointer: tokens', () => {
  assert.deepEqual(parsePointer(''), []);
  assert.deepEqual(parsePointer('/'), ['']);
  assert.deepEqual(parsePointer('/a//b/'), ['a', '', 'b', '']);
  assert.deepEqual(parsePointer('/~01'), ['~1']);
  assert.deepEqual(parsePointer('/~10'), ['/0']);
  assert.deepEqual(parsePointer('/a~1b/c~0d'), ['a/b', 'c~d']);
  assert.deepEqual(parsePointer('/~0~0'), ['~~']);
});

test('parsePointer: returns a new array each time', () => {
  const a = parsePointer('/x');
  a.push('y');
  assert.deepEqual(parsePointer('/x'), ['x']);
  assert.notEqual(parsePointer(''), parsePointer(''));
});

test('parsePointer: invalid pointers', () => {
  for (const p of ['a', ' /a', '/~', '/~2', '/a~', '/~a', '#/a', '/~~1']) {
    assert.throws(() => parsePointer(p), (err) => err instanceof SyntaxError && err.message === 'invalid pointer', p);
  }
});

test('parsePointer: non-strings', () => {
  for (const p of [new String('/a'), null, undefined, 1, ['/a'], {}]) {
    assert.throws(() => parsePointer(p), (err) => err instanceof TypeError && err.message === 'pointer must be a string');
  }
});

test('patch must be an array', () => {
  for (const patch of [null, undefined, {}, '[]', { length: 0 }]) fails({}, patch, 'patch must be an array', null);
});

test('empty patch returns a deep copy preserving -0 and order', () => {
  const doc = { b: { c: [1, { d: -0 }] }, a: -0, 1: 2 };
  const out = applyPatch(doc, []);
  assert.deepEqual(out, doc);
  assert.notEqual(out, doc);
  assert.notEqual(out.b, doc.b);
  assert.notEqual(out.b.c, doc.b.c);
  assert.notEqual(out.b.c[1], doc.b.c[1]);
  assert.ok(Object.is(out.a, -0));
  assert.ok(Object.is(out.b.c[1].d, -0));
  assert.deepEqual(Object.keys(out), ['1', 'b', 'a']);
  const named = applyPatch({ z: 1, m: 2, a: 3 }, []);
  assert.deepEqual(Object.keys(named), ['z', 'm', 'a']);
});

test('primitive documents', () => {
  assert.equal(applyPatch(5, []), 5);
  assert.equal(applyPatch(null, []), null);
  assert.equal(applyPatch('s', [{ op: 'test', path: '', value: 's' }]), 's');
});

test('__proto__ is an ordinary member', () => {
  const doc = JSON.parse('{"__proto__":{"x":1}}');
  const out = applyPatch(doc, []);
  assert.ok(Object.hasOwn(out, '__proto__'));
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  const added = applyPatch({}, [{ op: 'add', path: '/__proto__', value: { y: 1 } }]);
  assert.ok(Object.hasOwn(added, '__proto__'));
  assert.equal(Object.getPrototypeOf(added), Object.prototype);
  assert.deepEqual(added.__proto__, { y: 1 });
  const removed = applyPatch(doc, [{ op: 'remove', path: '/__proto__' }]);
  assert.deepEqual(Object.keys(removed), []);
  const replaced = applyPatch(doc, [{ op: 'replace', path: '/__proto__', value: 3 }]);
  assert.ok(Object.hasOwn(replaced, '__proto__'));
  assert.equal(Object.getPrototypeOf(replaced), Object.prototype);
});

test('inherited properties never count', () => {
  for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    fails({}, [{ op: 'remove', path: `/${name}` }], 'operation 0: path not found', 0);
    fails({}, [{ op: 'test', path: `/${name}`, value: null }], 'operation 0: path not found', 0);
    fails({}, [{ op: 'copy', from: `/${name}`, path: '/x' }], 'operation 0: from not found', 0);
  }
  fails([], [{ op: 'test', path: '/length', value: 0 }], 'operation 0: bad index', 0);
});

test('add', () => {
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'add', path: '', value: [1] }]), [1]);
  assert.deepEqual(applyPatch({}, [{ op: 'add', path: '/a', value: 1 }]), { a: 1 });
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'add', path: '/', value: 2 }]), { a: 1, '': 2 });
  assert.deepEqual(applyPatch([1, 2], [{ op: 'add', path: '/-', value: 3 }]), [1, 2, 3]);
  assert.deepEqual(applyPatch([1, 2], [{ op: 'add', path: '/0', value: 0 }]), [0, 1, 2]);
  assert.deepEqual(applyPatch([1, 2], [{ op: 'add', path: '/1', value: 9 }]), [1, 9, 2]);
  assert.deepEqual(applyPatch([1, 2], [{ op: 'add', path: '/2', value: 3 }]), [1, 2, 3]);
  assert.deepEqual(applyPatch({ a: { b: [] } }, [{ op: 'add', path: '/a/b/0', value: 'x' }]), { a: { b: ['x'] } });
  assert.deepEqual(applyPatch({ 'a/b': {} }, [{ op: 'add', path: '/a~1b/~0', value: 1 }]), { 'a/b': { '~': 1 } });
});

test('add: member order', () => {
  const out = applyPatch({ b: 0 }, [{ op: 'add', path: '/1', value: 5 }]);
  assert.deepEqual(Object.keys(out), ['1', 'b']);
  const out2 = applyPatch({ b: 0, a: 1, c: 2 }, [{ op: 'add', path: '/a', value: 9 }, { op: 'add', path: '/d', value: 3 }]);
  assert.deepEqual(Object.keys(out2), ['b', 'a', 'c', 'd']);
  assert.equal(out2.a, 9);
});

test('add: failures', () => {
  fails([1], [{ op: 'add', path: '/2', value: 0 }], 'operation 0: path not found', 0);
  fails([1], [{ op: 'add', path: '/01', value: 0 }], 'operation 0: bad index', 0);
  fails([1], [{ op: 'add', path: '/', value: 0 }], 'operation 0: bad index', 0);
  fails([1], [{ op: 'add', path: '/x', value: 0 }], 'operation 0: bad index', 0);
  fails({ a: 1 }, [{ op: 'add', path: '/a/b', value: 0 }], 'operation 0: path not found', 0);
  fails({ a: null }, [{ op: 'add', path: '/a/b', value: 0 }], 'operation 0: path not found', 0);
  fails({ a: 's' }, [{ op: 'add', path: '/a/0', value: 0 }], 'operation 0: path not found', 0);
  fails({}, [{ op: 'add', path: '/x/y', value: 0 }], 'operation 0: path not found', 0);
  fails([[]], [{ op: 'add', path: '/-/0', value: 0 }], 'operation 0: path not found', 0);
  fails([[]], [{ op: 'add', path: '/1/0', value: 0 }], 'operation 0: path not found', 0);
  fails([[]], [{ op: 'add', path: '/a/0', value: 0 }], 'operation 0: bad index', 0);
});

test('add: value is copied', () => {
  const value = { x: [1, -0] };
  const out = applyPatch({}, [{ op: 'add', path: '/v', value }]);
  assert.notEqual(out.v, value);
  assert.notEqual(out.v.x, value.x);
  assert.ok(Object.is(out.v.x[1], -0));
  const root = applyPatch({}, [{ op: 'add', path: '', value }]);
  assert.notEqual(root, value);
  assert.deepEqual(root, value);
});

test('remove', () => {
  assert.deepEqual(applyPatch({ a: 1, b: 2 }, [{ op: 'remove', path: '/a' }]), { b: 2 });
  assert.deepEqual(applyPatch([1, 2, 3], [{ op: 'remove', path: '/1' }]), [1, 3]);
  fails([1], [{ op: 'remove', path: '/1' }], 'operation 0: path not found', 0);
  fails([1], [{ op: 'remove', path: '/-' }], 'operation 0: path not found', 0);
  fails([1], [{ op: 'remove', path: '/00' }], 'operation 0: bad index', 0);
  fails({}, [{ op: 'remove', path: '/a' }], 'operation 0: path not found', 0);
});

test('replace', () => {
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'replace', path: '', value: 2 }]), 2);
  const out = applyPatch({ a: 1, b: 2 }, [{ op: 'replace', path: '/a', value: 3 }]);
  assert.deepEqual(out, { a: 3, b: 2 });
  assert.deepEqual(Object.keys(out), ['a', 'b']);
  assert.deepEqual(applyPatch([1, 2], [{ op: 'replace', path: '/1', value: null }]), [1, null]);
  fails({}, [{ op: 'replace', path: '/a', value: 1 }], 'operation 0: path not found', 0);
  fails([1], [{ op: 'replace', path: '/1', value: 1 }], 'operation 0: path not found', 0);
  fails([1], [{ op: 'replace', path: '/-', value: 1 }], 'operation 0: path not found', 0);
  fails([1], [{ op: 'replace', path: '/1e0', value: 1 }], 'operation 0: bad index', 0);
});

test('move', () => {
  assert.deepEqual(applyPatch({ a: 1, b: 2 }, [{ op: 'move', from: '/a', path: '/c' }]), { b: 2, c: 1 });
  assert.deepEqual(applyPatch([1, 2, 3], [{ op: 'move', from: '/0', path: '/2' }]), [2, 3, 1]);
  assert.deepEqual(applyPatch([1, 2, 3], [{ op: 'move', from: '/0', path: '/-' }]), [2, 3, 1]);
  assert.deepEqual(applyPatch({ a: { b: 1 } }, [{ op: 'move', from: '/a/b', path: '/a' }]), { a: 1 });
  assert.deepEqual(applyPatch({ a: 1, b: 2 }, [{ op: 'move', from: '/a', path: '/b' }]), { b: 1 });
  assert.deepEqual(applyPatch({ a: [1] }, [{ op: 'move', from: '/a', path: '/ab' }]), { ab: [1] });
  const same = applyPatch({ a: 1, b: 2 }, [{ op: 'move', from: '/a', path: '/a' }]);
  assert.deepEqual(Object.keys(same), ['a', 'b']);
  assert.deepEqual(applyPatch(3, [{ op: 'move', from: '', path: '' }]), 3);
  // Index in path counts after removal: [1,2] -> remove /0 -> [2] -> /2 is past the end.
  fails([1, 2], [{ op: 'move', from: '/0', path: '/2' }], 'operation 0: path not found', 0);
  fails({}, [{ op: 'move', from: '/a', path: '/b' }], 'operation 0: from not found', 0);
  fails({}, [{ op: 'move', from: '/a', path: '/a' }], 'operation 0: from not found', 0);
  fails([], [{ op: 'move', from: '/x', path: '/x' }], 'operation 0: bad index', 0);
  fails({ a: 1 }, [{ op: 'move', from: '/a', path: '/x/y' }], 'operation 0: path not found', 0);
  fails({ x: 1 }, [{ op: 'move', from: '/a', path: '/x/y' }], 'operation 0: from not found', 0);
});

test('copy', () => {
  const out = applyPatch({ a: { b: [1] } }, [{ op: 'copy', from: '/a', path: '/c' }]);
  assert.deepEqual(out, { a: { b: [1] }, c: { b: [1] } });
  assert.notEqual(out.a, out.c);
  assert.notEqual(out.a.b, out.c.b);
  assert.deepEqual(applyPatch({ a: { b: 1 } }, [{ op: 'copy', from: '/a', path: '/a/c' }]), { a: { b: 1, c: { b: 1 } } });
  assert.deepEqual(applyPatch([1, 2], [{ op: 'copy', from: '', path: '/-' }]), [1, 2, [1, 2]]);
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'copy', from: '/a', path: '' }]), 1);
  assert.ok(Object.is(applyPatch({ a: -0 }, [{ op: 'copy', from: '/a', path: '/b' }]).b, -0));
  fails({}, [{ op: 'copy', from: '/a', path: '/b' }], 'operation 0: from not found', 0);
  fails([], [{ op: 'copy', from: '/-', path: '/0' }], 'operation 0: from not found', 0);
  fails([1], [{ op: 'copy', from: '/0', path: '/5' }], 'operation 0: path not found', 0);
});

test('test: equality', () => {
  const ok = (doc, path, value) => assert.deepEqual(applyPatch(doc, [{ op: 'test', path, value }]), doc);
  const no = (doc, path, value) => fails(doc, [{ op: 'test', path, value }], 'operation 0: test failed', 0);
  ok({ a: 1 }, '/a', 1.0);
  ok({ a: 0 }, '/a', -0);
  ok({ a: -0 }, '/a', 0);
  ok({ a: { x: 1, y: [1, 2] } }, '/a', { y: [1, 2], x: 1 });
  ok({ a: 1 }, '', { a: 1 });
  ok([null], '/0', null);
  ok({ s: 'é' }, '/s', 'é');
  no({ s: 'é' }, '/s', 'é');
  no({ a: 1 }, '/a', '1');
  no({ a: 0 }, '/a', false);
  no({ a: null }, '/a', false);
  no({ a: null }, '/a', {});
  no({ a: [] }, '/a', {});
  no({ a: {} }, '/a', []);
  no({ a: [1, 2] }, '/a', [2, 1]);
  no({ a: [1] }, '/a', [1, 1]);
  no({ a: { x: 1 } }, '/a', { x: 1, y: 2 });
  no({ a: { x: 1, y: 2 } }, '/a', { x: 1 });
  no({ a: { x: 1 } }, '/a', { y: 1 });
  no({ a: true }, '/a', 1);
  fails({}, [{ op: 'test', path: '/a', value: 1 }], 'operation 0: path not found', 0);
  fails([], [{ op: 'test', path: '/ 1', value: 1 }], 'operation 0: bad index', 0);
});

test('bad index forms on arrays', () => {
  for (const token of ['01', '+1', '1.0', '1e0', ' 1', 'length', '', '-1', '0x1']) {
    fails([1, 2], [{ op: 'test', path: `/${token}`, value: 1 }], 'operation 0: bad index', 0);
  }
  fails([1], [{ op: 'test', path: '/99999999999999999999', value: 1 }], 'operation 0: path not found', 0);
  fails('str', [{ op: 'test', path: '/0', value: 1 }], 'operation 0: path not found', 0);
  fails(5, [{ op: 'test', path: '/x', value: 1 }], 'operation 0: path not found', 0);
});

test('first failing token wins', () => {
  fails({ a: [1] }, [{ op: 'test', path: '/a/x/y', value: 1 }], 'operation 0: bad index', 0);
  fails({ a: [1] }, [{ op: 'test', path: '/b/x', value: 1 }], 'operation 0: path not found', 0);
});

test('form rules: reasons and order', () => {
  const reason = (op) => {
    try {
      applyPatch({}, [op]);
    } catch (err) {
      return err.message;
    }
    return 'ok';
  };
  for (const op of [null, [], 1, 'add', true, () => {}, undefined]) assert.equal(reason(op), 'operation 0: not an object');
  assert.equal(reason(new String('x')), 'operation 0: bad op');
  assert.equal(reason(new Date()), 'operation 0: bad op');
  assert.equal(reason({}), 'operation 0: bad op');
  assert.equal(reason({ op: 'ADD', path: '/a', value: 1 }), 'operation 0: bad op');
  assert.equal(reason({ op: new String('add'), path: '/a', value: 1 }), 'operation 0: bad op');
  assert.equal(reason({ op: 'get', path: '/a' }), 'operation 0: bad op');
  assert.equal(reason(Object.create({ op: 'add', path: '/a', value: 1 })), 'operation 0: bad op');
  assert.equal(reason({ op: 'add', value: 1 }), 'operation 0: bad path');
  assert.equal(reason({ op: 'add', path: 'a', value: 1 }), 'operation 0: bad path');
  assert.equal(reason({ op: 'add', path: '/~2', value: 1 }), 'operation 0: bad path');
  assert.equal(reason({ op: 'add', path: new String('/a'), value: 1 }), 'operation 0: bad path');
  assert.equal(reason({ op: 'add', path: 1 }), 'operation 0: bad path');
  assert.equal(reason({ op: 'move', path: '/a' }), 'operation 0: bad from');
  assert.equal(reason({ op: 'copy', path: '/a', from: 'a' }), 'operation 0: bad from');
  assert.equal(reason({ op: 'copy', path: '/a', from: '/~' }), 'operation 0: bad from');
  assert.equal(reason({ op: 'move', path: '/a', from: null }), 'operation 0: bad from');
  assert.equal(reason({ op: 'add', path: '/a' }), 'operation 0: missing value');
  assert.equal(reason({ op: 'replace', path: '/a' }), 'operation 0: missing value');
  assert.equal(reason({ op: 'test', path: '/a' }), 'operation 0: missing value');
  assert.equal(reason({ op: 'add', path: '/a', value: null }), 'ok');
  assert.equal(reason({ op: 'remove', path: '' }), 'operation 0: cannot remove root');
  assert.equal(reason({ op: 'move', from: '/a', path: '/a/b' }), 'operation 0: cannot move into own child');
  assert.equal(reason({ op: 'move', from: '', path: '/a' }), 'operation 0: cannot move into own child');
  assert.equal(reason({ op: 'move', from: '/a', path: '/a/' }), 'operation 0: cannot move into own child');
  // Unused members are ignored.
  assert.equal(reason({ op: 'add', path: '/a', value: 1, from: 5 }), 'ok');
  assert.equal(reason({ op: 'remove', path: '/x', value: undefined }), 'operation 0: path not found');
  assert.equal(reason({ op: 'test', path: '', value: {}, from: 'bad' }), 'ok');
});

test('non-enumerable own members count', () => {
  const op = {};
  Object.defineProperty(op, 'op', { value: 'add', enumerable: false });
  Object.defineProperty(op, 'path', { value: '/a', enumerable: false });
  Object.defineProperty(op, 'value', { value: 1, enumerable: false });
  assert.deepEqual(applyPatch({}, [op]), { a: 1 });
});

test('operation index in messages', () => {
  fails({ a: 1 }, [{ op: 'test', path: '/a', value: 1 }, { op: 'remove', path: '/a' }, { op: 'test', path: '/a', value: 1 }], 'operation 2: path not found', 2);
  fails({}, [{ op: 'add', path: '/a', value: 1 }, { op: 'test', path: '/a', value: 2 }], 'operation 1: test failed', 1);
});

test('form check runs before anything is applied', () => {
  // operation 0 would fail when applied, but operation 1 breaks the form rules first.
  fails({}, [{ op: 'remove', path: '/nope' }, { op: 'nope' }], 'operation 1: bad op', 1);
});

test('holes count as undefined', () => {
  // eslint-disable-next-line no-sparse-arrays
  fails({}, [{ op: 'add', path: '/a', value: 1 }, , { op: 'nope' }], 'operation 1: not an object', 1);
  fails({}, new Array(2), 'operation 0: not an object', 0);
});

test('doc and patch are never changed, even on failure', () => {
  const doc = { a: [1, 2], b: { c: 1 } };
  const patch = [
    { op: 'add', path: '/a/0', value: { n: 1 } },
    { op: 'remove', path: '/b/c' },
    { op: 'move', from: '/a/1', path: '/z' },
    { op: 'copy', from: '/a', path: '/y' },
    { op: 'replace', path: '/a/0/n', value: 2 },
    { op: 'test', path: '/nope', value: 1 },
  ];
  const docBefore = structuredClone(doc);
  const patchBefore = structuredClone(patch);
  fails(doc, patch, 'operation 5: path not found', 5);
  assert.deepEqual(doc, docBefore);
  assert.deepEqual(patch, patchBefore);
  const result = applyPatch(doc, patch.slice(0, 5));
  assert.deepEqual(doc, docBefore);
  assert.deepEqual(patch, patchBefore);
  assert.deepEqual(result, { a: [{ n: 2 }, 2], b: {}, z: 1, y: [{ n: 1 }, 2] });
  assert.notEqual(result.a[0], patch[0].value);
});

test('operations apply in sequence', () => {
  const out = applyPatch({}, [
    { op: 'add', path: '/list', value: [] },
    { op: 'add', path: '/list/-', value: 'a' },
    { op: 'add', path: '/list/0', value: 'b' },
    { op: 'test', path: '/list', value: ['b', 'a'] },
  ]);
  assert.deepEqual(out, { list: ['b', 'a'] });
});

test('deep values do not overflow', () => {
  let doc = 0;
  for (let i = 0; i < 1000; i++) doc = [doc];
  const value = structuredClone(doc);
  const out = applyPatch(doc, [
    { op: 'test', path: '', value },
    { op: 'copy', from: '', path: '/-' },
    { op: 'add', path: '/-', value },
  ]);
  assert.equal(out.length, 3);
});
