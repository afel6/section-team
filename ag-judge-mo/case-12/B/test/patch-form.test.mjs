import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, PatchError } from '../jsonpatch.mjs';
import { expectPatchError } from './helpers/patch-assert.mjs';

test('PatchError extends Error directly', () => {
  assert.strictEqual(Object.getPrototypeOf(PatchError.prototype), Error.prototype);
});

function expectOp(op, reason, doc = {}) {
  expectPatchError(doc, [op], `operation 0: ${reason}`, 0);
}

function withProto(proto, own = {}) {
  return Object.assign(Object.create(proto), own);
}

test('patch must be an array', () => {
  const notArrays = [
    undefined, null, {}, '[]', {length: 0}, new Uint8Array(0), 5, true,
    (function () { return arguments; })(),
  ];
  for (const p of notArrays) expectPatchError({}, p, 'patch must be an array', null);
});

test('sparse arrays and Array subclasses count as arrays', () => {
  class MyArr extends Array {}
  assert.deepEqual(applyPatch({a: 1}, new MyArr()), {a: 1});
  const sub = MyArr.from([{op: 'add', path: '/b', value: 2}]);
  assert.deepEqual(applyPatch({a: 1}, sub), {a: 1, b: 2});
  expectPatchError({}, new Array(1), 'operation 0: not an object', 0);
  assert.deepEqual(applyPatch({a: 1}, new Array(0)), {a: 1});
});

test('holes count as undefined', () => {
  // eslint-disable-next-line no-sparse-arrays
  expectPatchError({}, [ , ], 'operation 0: not an object', 0);
  expectPatchError({}, new Array(2), 'operation 0: not an object', 0);
  // eslint-disable-next-line no-sparse-arrays
  expectPatchError(1, [{op: 'test', path: '', value: 1}, ,], 'operation 1: not an object', 1);
});

test('all ops are form-checked before any is applied', () => {
  expectPatchError({}, [{op: 'remove', path: '/missing'}, {op: 'bogus', path: ''}], 'operation 1: bad op', 1);
  expectPatchError({}, [{op: 'test', path: '', value: 'nope'}, {}], 'operation 1: bad op', 1);
  expectPatchError({}, [
    {op: 'test', path: '', value: {}},
    {op: 'add', path: '/a', value: 1},
    {op: 'nope'},
    {op: 'remove', path: ''},
  ], 'operation 2: bad op', 2);
  expectPatchError({}, [
    {op: 'test', path: '', value: {}},
    {op: 'add', path: '/a', value: 1},
    {op: 'add', path: 'x', value: 1},
    {op: 'add', path: '/b'},
  ], 'operation 2: bad path', 2);
});

test('index of 10 or more is reported as a number', () => {
  const patch = Array.from({length: 11}, () => ({op: 'test', path: '', value: {}}));
  patch.push({op: 'zzz', path: ''});
  expectPatchError({}, patch, 'operation 11: bad op', 11);
});

test('not an object', () => {
  const fn = () => {};
  fn.op = 'add'; fn.path = '/a'; fn.value = 1;
  const bad = [null, [], [{op: 'add'}], 5, 'add', true, false, undefined, fn, () => {}];
  for (const op of bad) expectOp(op, 'not an object');
});

test('String and Date objects are objects, so bad op', () => {
  expectOp(new String('x'), 'bad op');
  expectOp(new Date(), 'bad op');
});

test('null-prototype operation objects work', () => {
  const op = Object.create(null);
  op.op = 'add'; op.path = '/a'; op.value = 1;
  assert.deepEqual(applyPatch({}, [op]), {a: 1});
});

test('bad op', () => {
  const ops = [
    undefined, 'ADD', 'Add', ' add', 'add ', new String('add'), ['add'], null, 1,
    '_get', 'toString', 'constructor', '__proto__', '',
  ];
  expectOp({path: ''}, 'bad op');
  for (const op of ops) expectOp({op, path: '/a', value: 1}, 'bad op');
  expectOp({op: 'bad'}, 'bad op');
});

test('bad path', () => {
  expectOp({op: 'remove'}, 'bad path');
  for (const path of [1, null, new String('/a'), ['/a'], undefined, 'a', '/~', '/~2', '/a~']) {
    expectOp({op: 'add', path, value: 1}, 'bad path');
  }
  expectOp({op: 'move', path: 'x', from: 'y~'}, 'bad path');
  expectOp({op: 'move'}, 'bad path');
  expectOp({op: 'add', path: 'x'}, 'bad path');
  expectOp({op: 'remove', path: 5}, 'bad path');
});

test('bad from for move and copy', () => {
  for (const op of ['move', 'copy']) {
    expectOp({op, path: '/a'}, 'bad from');
    for (const from of [5, null, ['/a'], new String('/a'), 'a', '/~', undefined]) {
      expectOp({op, path: '/a', from}, 'bad from');
    }
  }
  expectOp({op: 'copy', path: '/a', from: 'x'}, 'bad from');
});

test('from is ignored for other ops', () => {
  assert.deepEqual(applyPatch({a: 1}, [{op: 'remove', path: '/a', from: 'x'}]), {});
  assert.deepEqual(applyPatch({}, [{op: 'add', path: '/a', value: 1, from: 'bad~'}]), {a: 1});
  assert.deepEqual(applyPatch({}, [{op: 'add', path: '/a', value: 1, from: 42}]), {a: 1});
  assert.deepEqual(applyPatch({a: 1}, [{op: 'test', path: '/a', value: 1, from: 5}]), {a: 1});
  assert.deepEqual(
    applyPatch({a: 1}, [{op: 'remove', path: '/a', value: 1, from: 'nope~', extra: true}]), {});
});

test('missing value', () => {
  for (const op of ['add', 'replace', 'test']) {
    expectOp({op, path: '/a'}, 'missing value', {a: 1});
  }
  expectOp({op: 'test', path: ''}, 'missing value');
  assert.deepEqual(applyPatch({a: 1}, [{op: 'copy', path: '/b', from: '/a'}]), {a: 1, b: 1});
  assert.deepEqual(applyPatch({a: 1}, [{op: 'move', path: '/b', from: '/a'}]), {b: 1});
  assert.deepEqual(applyPatch({a: 1}, [{op: 'remove', path: '/a'}]), {});
});

test('null value is present; undefined own value is present', () => {
  const out = applyPatch({}, [{op: 'add', path: '/a', value: null}]);
  assert.deepEqual(out, {a: null});
  assert.ok(Object.hasOwn(out, 'a'));
  const replaced = applyPatch({a: 1}, [{op: 'replace', path: '/a', value: undefined}]);
  assert.ok(Object.hasOwn(replaced, 'a'));
  assert.strictEqual(replaced.a, undefined);
  const added = applyPatch({}, [{op: 'add', path: '/b', value: undefined}]);
  assert.ok(Object.hasOwn(added, 'b'));
  assert.strictEqual(added.b, undefined);
});

test('members exist iff own (non-enumerable counts, inherited never)', () => {
  const o = {};
  Object.defineProperty(o, 'op', {value: 'add', enumerable: false});
  Object.defineProperty(o, 'path', {value: '/a', enumerable: false});
  Object.defineProperty(o, 'value', {value: 1, enumerable: false});
  assert.deepEqual(applyPatch({}, [o]), {a: 1});

  expectOp(Object.create({op: 'add', path: '/a', value: 1}), 'bad op');
  expectOp(withProto({value: 1}, {op: 'add', path: '/a'}), 'missing value');
  expectOp(withProto({from: '/a'}, {op: 'move', path: '/b'}), 'bad from');
  expectOp(withProto({path: '/a'}, {op: 'remove'}), 'bad path');
});

test('cannot remove root', () => {
  expectOp({op: 'remove', path: ''}, 'cannot remove root');
  assert.deepEqual(applyPatch({'': 1}, [{op: 'remove', path: '/'}]), {});
});

test('cannot move into own child', () => {
  const cases = [
    ['/a', '/a/b'], ['', '/a'], ['', '/'], ['/a', '/a/b/c'], ['/', '//x'],
  ];
  for (const [from, path] of cases) {
    expectOp({op: 'move', path, from}, 'cannot move into own child', {a: {}});
  }
});

test('moves that are not into an own child', () => {
  assert.deepEqual(applyPatch({a: 1}, [{op: 'move', from: '/a', path: '/ab'}]), {ab: 1});
  assert.deepEqual(
    applyPatch({a: {b: 1}}, [{op: 'move', from: '/a/b', path: '/a'}]), {a: 1});
  assert.deepEqual(applyPatch({a: 1}, [{op: 'move', from: '/a', path: '/a'}]), {a: 1});
});

test('move from root to root is a no-op returning a deep copy', () => {
  for (const doc of [{a: {b: [1, 2]}}, [1, {x: 2}], 5, null, 'str']) {
    const out = applyPatch(doc, [{op: 'move', from: '', path: ''}]);
    assert.deepEqual(out, doc);
    if (doc !== null && typeof doc === 'object') assert.notEqual(out, doc);
  }
  const doc = {a: {b: 1}};
  assert.notEqual(applyPatch(doc, [{op: 'move', from: '', path: ''}]).a, doc.a);
});

test('prefix comparison uses decoded tokens', () => {
  const doc = {'a/b': 1, a: {b: {}}};
  assert.deepEqual(
    applyPatch(doc, [{op: 'move', from: '/a~1b', path: '/a/b/c'}]),
    {a: {b: {c: 1}}});
});

test('copy into own child is allowed', () => {
  assert.deepEqual(
    applyPatch({a: {}}, [{op: 'copy', from: '/a', path: '/a/b'}]),
    {a: {b: {}}});
});

test('form rule precedence', () => {
  expectOp({op: 'bad', path: 'x'}, 'bad op');
  expectOp({op: 'copy', path: 'x', from: 'y'}, 'bad path');
  expectOp({op: 'move', path: '/a/b', from: 'x'}, 'bad from');
  expectOp({op: 'add', path: '/a'}, 'missing value');
  expectOp({op: 'remove', path: ''}, 'cannot remove root');
});
