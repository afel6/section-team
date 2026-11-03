import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch } from '../jsonpatch.mjs';
import { expectPatchError, expectOpError } from './helpers.mjs';

// --- patch not an array ---

test('non-array patch is rejected with index null', () => {
  const patches = [
    null,
    undefined,
    {},
    { length: 0 },
    'x',
    new String('x'),
    { 0: { op: 'add', path: '/a', value: 1 }, length: 1 },
    5,
  ];
  for (const patch of patches) {
    expectPatchError({}, patch, 'patch must be an array', null);
  }
});

// --- not an object ---

test('not an object: null, array, primitives, function', () => {
  const ops = [null, [], 5, 'add', true, undefined, () => {}];
  for (const op of ops) expectOpError({}, op, 'not an object');
});

test('not an object: holes', () => {
  expectPatchError({}, [,], 'operation 0: not an object', 0);
  expectPatchError({}, new Array(1), 'operation 0: not an object', 0);
  expectPatchError({}, [{ op: 'test', path: '', value: {} }, , ], 'operation 1: not an object', 1);
});

test('String object op goes on to bad op', () => {
  expectOpError({}, new String('x'), 'bad op');
});

test('Date with own op/path/value is a valid operation', () => {
  const d = new Date(0);
  d.op = 'add';
  d.path = '/a';
  d.value = 1;
  assert.deepStrictEqual(applyPatch({}, [d]), { a: 1 });
});

// --- bad op ---

test('bad op values', () => {
  const ops = [
    {},
    { path: '/a', value: 1 },
    { op: 'ADD', path: '/a', value: 1 },
    { op: ' add', path: '/a', value: 1 },
    { op: 'add ', path: '/a', value: 1 },
    { op: new String('add'), path: '/a', value: 1 },
    { op: 5, path: '/a', value: 1 },
    { op: null, path: '/a', value: 1 },
    { op: 'merge', path: '/a', value: 1 },
    { op: '', path: '/a', value: 1 },
  ];
  for (const op of ops) expectOpError({}, op, 'bad op');
});

test('inherited op does not count', () => {
  const op = Object.create({ op: 'add', path: '/a', value: 1 });
  expectOpError({}, op, 'bad op');
});

test('non-enumerable own members count', () => {
  const op = {};
  Object.defineProperty(op, 'op', { value: 'add', enumerable: false });
  Object.defineProperty(op, 'path', { value: '/a', enumerable: false });
  Object.defineProperty(op, 'value', { value: 7, enumerable: false });
  assert.deepStrictEqual(applyPatch({}, [op]), { a: 7 });
});

test('inherited path does not count', () => {
  const op = Object.create({ path: '/a' });
  op.op = 'add';
  op.value = 1;
  expectOpError({}, op, 'bad path');
});

test('inherited value does not count', () => {
  const op = Object.create({ value: 1 });
  op.op = 'add';
  op.path = '/a';
  expectOpError({}, op, 'missing value');
});

test('inherited from does not count', () => {
  const op = Object.create({ from: '/a' });
  op.op = 'copy';
  op.path = '/b';
  expectOpError({ a: 1 }, op, 'bad from');
});

// --- bad path ---

test('bad path values', () => {
  const paths = ['a', '/~2', '/~', new String('/a'), 5, null, undefined, ['/a'], {}];
  for (const path of paths) {
    expectOpError({}, { op: 'add', path, value: 1 }, 'bad path');
  }
});

test('missing path', () => {
  expectOpError({}, { op: 'add', value: 1 }, 'bad path');
  expectOpError({}, { op: 'remove' }, 'bad path');
});

// --- bad from ---

test('bad from for move and copy', () => {
  const froms = [undefined, 'a', '/~2', '/~', new String('/a'), 5, null, ['/a']];
  for (const name of ['move', 'copy']) {
    for (const from of froms) {
      const op = { op: name, path: '/b' };
      if (from !== undefined) op.from = from;
      expectOpError({ a: 1 }, op, 'bad from');
    }
  }
});

test('from is ignored for ops that do not use it', () => {
  const doc = { a: 1 };
  assert.deepStrictEqual(applyPatch(doc, [{ op: 'add', path: '/b', value: 2, from: 5 }]), { a: 1, b: 2 });
  assert.deepStrictEqual(applyPatch(doc, [{ op: 'remove', path: '/a', from: 'bad' }]), {});
  assert.deepStrictEqual(applyPatch(doc, [{ op: 'test', path: '/a', value: 1, from: 'bad' }]), { a: 1 });
  assert.deepStrictEqual(applyPatch(doc, [{ op: 'replace', path: '/a', value: 3, from: null }]), { a: 3 });
});

test('value is ignored for ops that do not use it', () => {
  assert.deepStrictEqual(applyPatch({ a: 1 }, [{ op: 'remove', path: '/a' }]), {});
  assert.deepStrictEqual(applyPatch({ a: 1 }, [{ op: 'remove', path: '/a', value: 5 }]), {});
  assert.deepStrictEqual(applyPatch({ a: 1 }, [{ op: 'move', from: '/a', path: '/b', value: 5 }]), { b: 1 });
  assert.deepStrictEqual(applyPatch({ a: 1 }, [{ op: 'copy', from: '/a', path: '/b', value: 5 }]), { a: 1, b: 1 });
});

// --- missing value ---

test('missing value for add, replace, test', () => {
  for (const name of ['add', 'replace', 'test']) {
    expectOpError({ a: 1 }, { op: name, path: '/a' }, 'missing value');
  }
});

test('value null is present', () => {
  assert.deepStrictEqual(applyPatch({}, [{ op: 'add', path: '/a', value: null }]), { a: null });
  assert.deepStrictEqual(applyPatch({ a: 1 }, [{ op: 'replace', path: '/a', value: null }]), { a: null });
  assert.deepStrictEqual(applyPatch({ a: null }, [{ op: 'test', path: '/a', value: null }]), { a: null });
});

// --- cannot remove root ---

test('cannot remove root', () => {
  expectOpError({ a: 1 }, { op: 'remove', path: '' }, 'cannot remove root');
});

// --- cannot move into own child ---

test('move from "" to any other path is own child', () => {
  expectOpError({ a: 1 }, { op: 'move', from: '', path: '/a' }, 'cannot move into own child');
  expectOpError({ a: 1 }, { op: 'move', from: '', path: '/' }, 'cannot move into own child');
});

test('move from "/a" to "/a/b" is own child', () => {
  expectOpError({ a: {} }, { op: 'move', from: '/a', path: '/a/b' }, 'cannot move into own child');
  expectOpError({ a: {} }, { op: 'move', from: '/a', path: '/a/' }, 'cannot move into own child');
});

test('move from "/a" to "/ab" is not own child', () => {
  assert.deepStrictEqual(applyPatch({ a: 1 }, [{ op: 'move', from: '/a', path: '/ab' }]), { ab: 1 });
});

test('move from "/a" to "/a" is not own child', () => {
  assert.deepStrictEqual(applyPatch({ a: 1 }, [{ op: 'move', from: '/a', path: '/a' }]), { a: 1 });
});

test('move from "" to "" is not own child', () => {
  assert.deepStrictEqual(applyPatch({ a: 1 }, [{ op: 'move', from: '', path: '' }]), { a: 1 });
});

test('move from deeper path to its ancestor is not own child', () => {
  assert.deepStrictEqual(applyPatch({ a: { b: 1 } }, [{ op: 'move', from: '/a/b', path: '/a' }]), { a: 1 });
});

test('copy from "/a" to "/a/b" is fine', () => {
  assert.deepStrictEqual(
    applyPatch({ a: { x: 1 } }, [{ op: 'copy', from: '/a', path: '/a/b' }]),
    { a: { x: 1, b: { x: 1 } } },
  );
});

// --- precedence ---

test('bad op beats bad path', () => {
  expectOpError({}, { op: 'nope', path: 'x' }, 'bad op');
});

test('bad path beats bad from', () => {
  expectOpError({}, { op: 'move', path: 'x', from: 'y' }, 'bad path');
});

test('bad path beats missing value', () => {
  expectOpError({}, { op: 'add', path: 'x' }, 'bad path');
});

test('bad path beats cannot remove root (remove with bad path)', () => {
  expectOpError({}, { op: 'remove', path: 'x' }, 'bad path');
});

test('copy with bad from reports bad from', () => {
  expectOpError({}, { op: 'copy', path: '/a', from: 'x' }, 'bad from');
});

test('bad from beats own child', () => {
  expectOpError({}, { op: 'move', from: 'a', path: '/a/b' }, 'bad from');
});

test('add at root without value reports missing value', () => {
  expectOpError({}, { op: 'add', path: '' }, 'missing value');
});

// --- form check runs before applying ---

test('form error at op 2 is reported even if op 0 would fail when applying', () => {
  const patch = [
    { op: 'remove', path: '/nope' },
    { op: 'add', path: '/a', value: 1 },
    { op: 'add', path: '/b' },
  ];
  expectPatchError({}, patch, 'operation 2: missing value', 2);
});

test('first form failure wins over later ones', () => {
  const patch = [{ op: 'add', path: '/a', value: 1 }, { op: 'bogus' }, null];
  expectPatchError({}, patch, 'operation 1: bad op', 1);
});

test('applying failure reports its index', () => {
  const patch = [
    { op: 'add', path: '/a', value: 1 },
    { op: 'test', path: '/a', value: 1 },
    { op: 'test', path: '/a', value: 2 },
  ];
  expectPatchError({}, patch, 'operation 2: test failed', 2);
});

test('first applying failure stops', () => {
  const patch = [
    { op: 'remove', path: '/x' },
    { op: 'test', path: '/a', value: 99 },
  ];
  expectPatchError({ a: 1 }, patch, 'operation 0: path not found', 0);
});
