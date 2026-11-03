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

test('parsePointer decodes tokens', () => {
  assert.deepEqual(parsePointer(''), []);
  assert.deepEqual(parsePointer('/'), ['']);
  assert.deepEqual(parsePointer('/a//b/'), ['a', '', 'b', '']);
  assert.deepEqual(parsePointer('/~01'), ['~1']);
  assert.deepEqual(parsePointer('/~10'), ['/0']);
  assert.deepEqual(parsePointer('/a~1b/c~0d'), ['a/b', 'c~d']);
  assert.deepEqual(parsePointer('/~0~0'), ['~~']);
});

test('parsePointer returns a new array each time', () => {
  const a = parsePointer('/x');
  a.push('y');
  assert.deepEqual(parsePointer('/x'), ['x']);
});

test('parsePointer rejects non-strings with TypeError', () => {
  for (const p of [new String('/a'), null, undefined, 1, ['/a'], {}]) {
    assert.throws(() => parsePointer(p), (e) => e instanceof TypeError && e.message === 'pointer must be a string');
  }
});

test('parsePointer rejects invalid pointers with SyntaxError', () => {
  for (const p of ['a', ' /a', '#/a', '/~', '/~2', '/a~', '/~~0', '/a/~b']) {
    assert.throws(() => parsePointer(p), (e) => e instanceof SyntaxError && e.message === 'invalid pointer', p);
  }
});

test('patch must be an array', () => {
  for (const p of [null, undefined, {}, 'x', { length: 0 }]) fails({}, p, 'patch must be an array', null);
});

test('empty patch returns a deep copy keeping -0 and order', () => {
  const doc = { b: { c: [1, { d: -0 }] }, a: -0, 2: 'x' };
  const out = applyPatch(doc, []);
  assert.deepEqual(out, doc);
  assert.notEqual(out, doc);
  assert.notEqual(out.b, doc.b);
  assert.notEqual(out.b.c, doc.b.c);
  assert.ok(Object.is(out.a, -0));
  assert.ok(Object.is(out.b.c[1].d, -0));
  assert.deepEqual(Object.keys(out), ['2', 'b', 'a']);
  assert.equal(applyPatch(5, []), 5);
});

test('__proto__ is an ordinary member name', () => {
  const doc = JSON.parse('{"__proto__":{"x":1}}');
  const out = applyPatch(doc, []);
  assert.ok(Object.hasOwn(out, '__proto__'));
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  const added = applyPatch({}, [{ op: 'add', path: '/__proto__', value: { y: 2 } }]);
  assert.ok(Object.hasOwn(added, '__proto__'));
  assert.equal(Object.getPrototypeOf(added), Object.prototype);
  assert.deepEqual(Object.keys(added), ['__proto__']);
});

test('inherited properties are never found', () => {
  for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
    fails({}, [{ op: 'remove', path: `/${name}` }], 'operation 0: path not found', 0);
    fails({}, [{ op: 'test', path: `/${name}`, value: null }], 'operation 0: path not found', 0);
  }
  fails([], [{ op: 'replace', path: '/length', value: 1 }], 'operation 0: bad index', 0);
});

test('add', () => {
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'add', path: '', value: [1] }]), [1]);
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'add', path: '/b', value: 2 }]), { a: 1, b: 2 });
  assert.deepEqual(applyPatch([1, 2], [{ op: 'add', path: '/-', value: 3 }]), [1, 2, 3]);
  assert.deepEqual(applyPatch([1, 2], [{ op: 'add', path: '/0', value: 0 }]), [0, 1, 2]);
  assert.deepEqual(applyPatch([1, 2], [{ op: 'add', path: '/2', value: 3 }]), [1, 2, 3]);
  assert.deepEqual(applyPatch({ '': 1 }, [{ op: 'add', path: '/', value: 2 }]), { '': 2 });
});

test('add keeps member order rules', () => {
  const out = applyPatch({ b: 0 }, [{ op: 'add', path: '/1', value: 5 }]);
  assert.deepEqual(Object.keys(out), ['1', 'b']);
  const kept = applyPatch({ a: 1, b: 2, c: 3 }, [{ op: 'add', path: '/a', value: 9 }]);
  assert.deepEqual(Object.keys(kept), ['a', 'b', 'c']);
  assert.equal(kept.a, 9);
  const replaced = applyPatch({ a: 1, b: 2 }, [{ op: 'replace', path: '/a', value: 0 }]);
  assert.deepEqual(Object.keys(replaced), ['a', 'b']);
});

test('add failures', () => {
  fails([1], [{ op: 'add', path: '/2', value: 0 }], 'operation 0: path not found', 0);
  fails([1], [{ op: 'add', path: '/01', value: 0 }], 'operation 0: bad index', 0);
  fails([1], [{ op: 'add', path: '/', value: 0 }], 'operation 0: bad index', 0);
  fails({ a: 1 }, [{ op: 'add', path: '/a/b', value: 0 }], 'operation 0: path not found', 0);
  fails({ a: 'str' }, [{ op: 'add', path: '/a/0', value: 0 }], 'operation 0: path not found', 0);
  fails({ a: null }, [{ op: 'add', path: '/a/x', value: 0 }], 'operation 0: path not found', 0);
  fails({}, [{ op: 'add', path: '/x/y', value: 0 }], 'operation 0: path not found', 0);
  fails([[1]], [{ op: 'add', path: '/-/0', value: 0 }], 'operation 0: path not found', 0);
  fails([[1]], [{ op: 'add', path: '/1/0', value: 0 }], 'operation 0: path not found', 0);
  fails([[1]], [{ op: 'add', path: '/x/0', value: 0 }], 'operation 0: bad index', 0);
});

test('bad index tokens', () => {
  for (const t of ['01', '+1', '1.0', '1e0', ' 1', '1 ', 'length', '', '-1', '0x1']) {
    fails([1, 2], [{ op: 'remove', path: `/${t}` }], 'operation 0: bad index', 0);
  }
  fails([1, 2], [{ op: 'remove', path: '/-' }], 'operation 0: path not found', 0);
  fails([1, 2], [{ op: 'remove', path: '/2' }], 'operation 0: path not found', 0);
  fails([1, 2], [{ op: 'remove', path: '/99999999999999999999' }], 'operation 0: path not found', 0);
});

test('remove', () => {
  assert.deepEqual(applyPatch([1, 2, 3], [{ op: 'remove', path: '/1' }]), [1, 3]);
  assert.deepEqual(applyPatch({ a: 1, b: 2 }, [{ op: 'remove', path: '/a' }]), { b: 2 });
  fails({ a: 1 }, [{ op: 'remove', path: '/b' }], 'operation 0: path not found', 0);
  fails(1, [{ op: 'remove', path: '/0' }], 'operation 0: path not found', 0);
});

test('replace', () => {
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'replace', path: '', value: null }]), null);
  assert.deepEqual(applyPatch([1, 2], [{ op: 'replace', path: '/1', value: { x: 1 } }]), [1, { x: 1 }]);
  fails({ a: 1 }, [{ op: 'replace', path: '/b', value: 1 }], 'operation 0: path not found', 0);
  fails([1], [{ op: 'replace', path: '/1', value: 1 }], 'operation 0: path not found', 0);
  fails([1], [{ op: 'replace', path: '/-', value: 1 }], 'operation 0: path not found', 0);
});

test('move', () => {
  assert.deepEqual(applyPatch({ a: 1, b: 2 }, [{ op: 'move', from: '/a', path: '/c' }]), { b: 2, c: 1 });
  assert.deepEqual(applyPatch([1, 2, 3], [{ op: 'move', from: '/0', path: '/2' }]), [2, 3, 1]);
  assert.deepEqual(applyPatch([1, 2, 3], [{ op: 'move', from: '/2', path: '/0' }]), [3, 1, 2]);
  assert.deepEqual(applyPatch({ a: { b: 1 } }, [{ op: 'move', from: '/a/b', path: '/a' }]), { a: 1 });
  const same = applyPatch({ a: 1, b: 2 }, [{ op: 'move', from: '/a', path: '/a' }]);
  assert.deepEqual(Object.keys(same), ['a', 'b']);
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'move', from: '', path: '' }]), { a: 1 });
  fails({ a: 1 }, [{ op: 'move', from: '/x', path: '/x' }], 'operation 0: from not found', 0);
  fails([1], [{ op: 'move', from: '/01', path: '/0' }], 'operation 0: bad index', 0);
  fails({ a: 1 }, [{ op: 'move', from: '/x', path: '/q/r' }], 'operation 0: from not found', 0);
  fails({ a: 1 }, [{ op: 'move', from: '/a', path: '/q/r' }], 'operation 0: path not found', 0);
  fails([1, 2], [{ op: 'move', from: '/0', path: '/2' }], 'operation 0: path not found', 0);
});

test('copy', () => {
  const doc = { a: { b: [1] } };
  const out = applyPatch(doc, [{ op: 'copy', from: '/a', path: '/a/c' }]);
  assert.deepEqual(out, { a: { b: [1], c: { b: [1] } } });
  assert.notEqual(out.a.c.b, out.a.b);
  assert.deepEqual(applyPatch([1], [{ op: 'copy', from: '', path: '/-' }]), [1, [1]]);
  fails({}, [{ op: 'copy', from: '/a', path: '/b' }], 'operation 0: from not found', 0);
  fails({ a: 1 }, [{ op: 'copy', from: '/a', path: '/x/y' }], 'operation 0: path not found', 0);
});

test('test op equality', () => {
  const ok = (doc, path, value) => assert.deepEqual(applyPatch(doc, [{ op: 'test', path, value }]), doc);
  ok({ a: 1 }, '/a', 1.0);
  ok({ a: 0 }, '/a', -0);
  ok({ a: { x: 1, y: [1, 'a'] } }, '/a', { y: [1, 'a'], x: 1 });
  ok([null], '/0', null);
  ok({ a: 1 }, '', { a: 1 });
  const no = (doc, path, value) => fails(doc, [{ op: 'test', path, value }], 'operation 0: test failed', 0);
  no({ a: 1 }, '/a', '1');
  no({ a: null }, '/a', false);
  no({ a: false }, '/a', 0);
  no({ a: [] }, '/a', {});
  no({ a: {} }, '/a', []);
  no({ a: [1, 2] }, '/a', [2, 1]);
  no({ a: [1] }, '/a', [1, 1]);
  no({ a: { x: 1 } }, '/a', { x: 1, y: 2 });
  no({ a: { x: 1, y: 2 } }, '/a', { x: 1 });
  no({ a: { x: 1 } }, '/a', { y: 1 });
  no({ a: 'é' }, '/a', 'é');
  no({ a: true }, '/a', 1);
  fails({}, [{ op: 'test', path: '/a', value: 1 }], 'operation 0: path not found', 0);
});

test('form rules in order', () => {
  const reason = (op) => {
    try {
      applyPatch({}, [op]);
    } catch (err) {
      return err.message;
    }
    return 'no error';
  };
  for (const op of [null, [], 'x', 1, () => {}, undefined, true]) assert.equal(reason(op), 'operation 0: not an object');
  assert.equal(reason(new String('x')), 'operation 0: bad op');
  assert.equal(reason(new Date()), 'operation 0: bad op');
  assert.equal(reason({}), 'operation 0: bad op');
  assert.equal(reason({ op: 'ADD', path: '' }), 'operation 0: bad op');
  assert.equal(reason({ op: new String('add'), path: '', value: 1 }), 'operation 0: bad op');
  assert.equal(reason(Object.create({ op: 'add', path: '', value: 1 })), 'operation 0: bad op');
  assert.equal(reason({ op: 'add', value: 1 }), 'operation 0: bad path');
  assert.equal(reason({ op: 'add', path: new String('/a'), value: 1 }), 'operation 0: bad path');
  assert.equal(reason({ op: 'add', path: 'a', value: 1 }), 'operation 0: bad path');
  assert.equal(reason({ op: 'add', path: '/~2', value: 1 }), 'operation 0: bad path');
  assert.equal(reason({ op: 'move', path: '/a' }), 'operation 0: bad from');
  assert.equal(reason({ op: 'copy', path: '/a', from: 5 }), 'operation 0: bad from');
  assert.equal(reason({ op: 'copy', path: '/a', from: '~' }), 'operation 0: bad from');
  assert.equal(reason({ op: 'add', path: '/a' }), 'operation 0: missing value');
  assert.equal(reason({ op: 'replace', path: '/a', value: undefined }), 'operation 0: path not found');
  assert.equal(reason({ op: 'test', path: '/a' }), 'operation 0: missing value');
  assert.equal(reason({ op: 'remove', path: '' }), 'operation 0: cannot remove root');
  assert.equal(reason({ op: 'move', from: '/a', path: '/a/b' }), 'operation 0: cannot move into own child');
  assert.equal(reason({ op: 'move', from: '', path: '/a' }), 'operation 0: cannot move into own child');
  assert.equal(reason({ op: 'move', from: '/a', path: '/ab' }), 'operation 0: from not found');
});

test('non-enumerable own members count', () => {
  const op = {};
  Object.defineProperty(op, 'op', { value: 'add' });
  Object.defineProperty(op, 'path', { value: '/a' });
  Object.defineProperty(op, 'value', { value: 1 });
  assert.deepEqual(applyPatch({}, [op]), { a: 1 });
});

test('unused members are ignored', () => {
  assert.deepEqual(applyPatch({}, [{ op: 'add', path: '/a', value: 1, from: 7 }]), { a: 1 });
  assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'remove', path: '/a', value: undefined, from: null }]), {});
});

test('every operation is checked before any is applied', () => {
  fails({}, [{ op: 'test', path: '/x', value: 1 }, { op: 'bogus' }], 'operation 1: bad op', 1);
  fails({}, [{ op: 'add', path: '/a', value: 1 }, { op: 'test', path: '/a', value: 2 }], 'operation 1: test failed', 1);
});

test('holes count as undefined', () => {
  const patch = [{ op: 'add', path: '/a', value: 1 }, , { op: 'remove', path: '/a' }];
  fails({}, patch, 'operation 1: not an object', 1);
});

test('operations apply in sequence', () => {
  const out = applyPatch({}, [
    { op: 'add', path: '/a', value: [] },
    { op: 'add', path: '/a/-', value: 1 },
    { op: 'copy', from: '/a', path: '/b' },
    { op: 'move', from: '/a/0', path: '/c' },
    { op: 'test', path: '/b', value: [1] },
  ]);
  assert.deepEqual(out, { a: [], b: [1], c: 1 });
});

test('inputs are never changed and never shared', () => {
  const doc = { a: [1, { b: 2 }], c: { d: 3 } };
  const value = { v: [1] };
  const patch = [
    { op: 'add', path: '/x', value },
    { op: 'remove', path: '/a/0' },
    { op: 'replace', path: '/c/d', value: 4 },
    { op: 'test', path: '/q', value: 0 },
  ];
  const docCopy = structuredClone(doc);
  const patchCopy = structuredClone(patch);
  fails(doc, patch, 'operation 3: path not found', 3);
  assert.deepEqual(doc, docCopy);
  assert.deepEqual(patch, patchCopy);
  const out = applyPatch(doc, patch.slice(0, 3));
  assert.notEqual(out.x, value);
  assert.notEqual(out.x.v, value.v);
  assert.deepEqual(doc, docCopy);
  const whole = applyPatch(doc, [{ op: 'replace', path: '', value }]);
  assert.notEqual(whole, value);
  assert.deepEqual(whole, value);
});

test('added values keep -0', () => {
  const out = applyPatch({}, [{ op: 'add', path: '/a', value: [-0] }]);
  assert.ok(Object.is(out.a[0], -0));
});

test('very deep results do not overflow the stack', () => {
  let value = 1;
  for (let i = 0; i < 100000; i++) value = [value];
  const out = applyPatch({}, [
    { op: 'add', path: '/a', value },
    { op: 'copy', from: '/a', path: '/b' },
    { op: 'test', path: '/b', value },
  ]);
  assert.ok(Array.isArray(out.b));
});
