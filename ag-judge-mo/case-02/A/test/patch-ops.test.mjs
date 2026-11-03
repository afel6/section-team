import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch } from '../jsonpatch.mjs';
import { expectOpError, expectPatchError } from './helpers.mjs';

const add = (path, value) => ({ op: 'add', path, value });
const remove = (path) => ({ op: 'remove', path });
const replace = (path, value) => ({ op: 'replace', path, value });
const move = (from, path) => ({ op: 'move', from, path });
const copy = (from, path) => ({ op: 'copy', from, path });
const testOp = (path, value) => ({ op: 'test', path, value });
const apply = (doc, ...ops) => applyPatch(doc, ops);

// --- add ---

test('add at root replaces the document', () => {
  assert.deepStrictEqual(apply({ a: 1 }, add('', [1])), [1]);
  assert.strictEqual(apply({ a: 1 }, add('', 5)), 5);
  assert.strictEqual(apply({ a: 1 }, add('', null)), null);
});

test('add new object member', () => {
  assert.deepStrictEqual(apply({ a: 1 }, add('/b', 2)), { a: 1, b: 2 });
});

test('add existing member keeps its place', () => {
  const r = apply({ a: 1, b: 2 }, add('/a', 9));
  assert.deepStrictEqual(Object.keys(r), ['a', 'b']);
  assert.strictEqual(JSON.stringify(r), '{"a":9,"b":2}');
});

test('add "/__proto__" is an ordinary own member', () => {
  const r = apply({}, add('/__proto__', { x: 1 }));
  assert.strictEqual(Object.hasOwn(r, '__proto__'), true);
  assert.strictEqual(Object.getPrototypeOf(r), Object.prototype);
  assert.deepStrictEqual(Object.keys(r), ['__proto__']);
  assert.deepStrictEqual(r.__proto__, { x: 1 });
  assert.strictEqual(Object.getPrototypeOf(r) === Object.prototype, true);
  assert.strictEqual(({}).x, undefined);
});

test('add array append with "-"', () => {
  assert.deepStrictEqual(apply([1, 2], add('/-', 3)), [1, 2, 3]);
});

test('add array at index shifts up', () => {
  assert.deepStrictEqual(apply([1, 2], add('/2', 'x')), [1, 2, 'x']);
  assert.deepStrictEqual(apply([1, 2], add('/1', 'x')), [1, 'x', 2]);
  assert.deepStrictEqual(apply([1, 2], add('/0', 'x')), ['x', 1, 2]);
  assert.deepStrictEqual(apply([], add('/0', 'x')), ['x']);
});

test('add array index beyond length fails', () => {
  expectOpError([1, 2], add('/3', 'x'), 'path not found');
});

test('add array bad index', () => {
  const doc = { arr: [1, 2] };
  for (const tok of ['01', '1.0', '', '+1', '1e0', ' 1', 'length', '-1', 'a']) {
    expectOpError(doc, add(`/arr/${tok}`, 0), 'bad index');
  }
});

test('add into nested array and object', () => {
  assert.deepStrictEqual(apply({ a: [{ b: [1] }] }, add('/a/0/b/-', 2)), { a: [{ b: [1, 2] }] });
});

test('add last token fails when parent is not object or array', () => {
  expectOpError({ a: 1 }, add('/a/b', 0), 'path not found');
  expectOpError({ a: 'str' }, add('/a/0', 0), 'path not found');
  expectOpError({ a: null }, add('/a/b', 0), 'path not found');
  expectOpError({ a: true }, add('/a/b', 0), 'path not found');
});

test('add parent missing fails', () => {
  expectOpError({}, add('/a/b', 0), 'path not found');
});

test('add through "-" parent fails with path not found', () => {
  expectOpError({ arr: [1] }, add('/arr/-/x', 0), 'path not found');
});

test('add "/a" on non-container root fails', () => {
  expectOpError(5, add('/a', 0), 'path not found');
  expectOpError(null, add('/a', 0), 'path not found');
});

test('add at "/" uses the empty-name member', () => {
  assert.deepStrictEqual(apply({}, add('/', 1)), { '': 1 });
});

// --- remove ---

test('remove object member', () => {
  assert.deepStrictEqual(apply({ a: 1, b: 2 }, remove('/a')), { b: 2 });
});

test('remove array element shifts later down', () => {
  assert.deepStrictEqual(apply([1, 2, 3], remove('/0')), [2, 3]);
  assert.deepStrictEqual(apply([1, 2, 3], remove('/2')), [1, 2]);
});

test('remove nested', () => {
  assert.deepStrictEqual(apply({ a: { b: [1, 2] } }, remove('/a/b/0')), { a: { b: [2] } });
});

test('remove missing fails', () => {
  expectOpError({}, remove('/a'), 'path not found');
  expectOpError([1, 2], remove('/2'), 'path not found');
  expectOpError({ a: 1 }, remove('/a/b'), 'path not found');
});

test('remove "-" fails with path not found', () => {
  expectOpError({ arr: [1, 2] }, remove('/arr/-'), 'path not found');
});

test('remove on inherited names fails', () => {
  for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
    expectOpError({}, remove(`/${name}`), 'path not found');
  }
});

test('remove "/constructor/name" fails', () => {
  expectOpError({}, remove('/constructor/name'), 'path not found');
});

test('remove own "__proto__" member from parsed JSON', () => {
  const doc = JSON.parse('{"__proto__": 1, "a": 2}');
  const r = apply(doc, remove('/__proto__'));
  assert.deepStrictEqual(Object.keys(r), ['a']);
});

// --- replace ---

test('replace root', () => {
  assert.deepStrictEqual(apply({ a: 1 }, replace('', [2])), [2]);
  assert.strictEqual(apply({ a: 1 }, replace('', 0)), 0);
});

test('replace member keeps its place', () => {
  const r = apply({ a: 1, b: 2 }, replace('/a', 9));
  assert.deepStrictEqual(Object.keys(r), ['a', 'b']);
  assert.strictEqual(JSON.stringify(r), '{"a":9,"b":2}');
});

test('replace array element', () => {
  assert.deepStrictEqual(apply([1, 2], replace('/1', 'x')), [1, 'x']);
});

test('replace missing fails', () => {
  expectOpError([1, 2], replace('/2', 0), 'path not found');
  expectOpError([1, 2], replace('/-', 0), 'path not found');
  expectOpError({}, replace('/a', 0), 'path not found');
});

test('replace bad index', () => {
  expectOpError({ arr: [1, 2] }, replace('/arr/01', 0), 'bad index');
});

test('replace inherited names fail', () => {
  for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
    expectOpError({}, replace(`/${name}`, 1), 'path not found');
  }
  expectOpError({}, replace('/constructor/name', 1), 'path not found');
});

test('replace "/arr/-" fails with path not found', () => {
  expectOpError({ arr: [1] }, replace('/arr/-', 1), 'path not found');
});

// --- move ---

test('move between object members', () => {
  assert.deepStrictEqual(apply({ a: 1 }, move('/a', '/b')), { b: 1 });
});

test('move from /a to /b keeps b last', () => {
  const r = apply({ a: 1, c: 3, b: 2 }, move('/a', '/b'));
  assert.deepStrictEqual(Object.keys(r), ['c', 'b']);
  assert.strictEqual(JSON.stringify(r), '{"c":3,"b":1}');
});

test('move in array counts index after removal', () => {
  assert.deepStrictEqual(apply([1, 2, 3], move('/0', '/2')), [2, 3, 1]);
  assert.deepStrictEqual(apply([1, 2, 3], move('/2', '/0')), [3, 1, 2]);
});

test('move to index beyond length after removal fails', () => {
  expectOpError([1, 2, 3], move('/0', '/3'), 'path not found');
});

test('move to array end with "-"', () => {
  assert.deepStrictEqual(apply([1, 2, 3], move('/0', '/-')), [2, 3, 1]);
});

test('move with from === path leaves doc unchanged', () => {
  assert.deepStrictEqual(apply({ a: 1 }, move('/a', '/a')), { a: 1 });
  assert.deepStrictEqual(apply([1, 2], move('/0', '/0')), [1, 2]);
});

test('move with from === path still requires from', () => {
  expectOpError({}, move('/x', '/x'), 'from not found');
});

test('move from missing fails with from not found', () => {
  expectOpError({}, move('/a', '/b'), 'from not found');
  expectOpError({}, move('/a', '/x/y'), 'from not found');
});

test('move into missing parent fails with path not found', () => {
  expectOpError({ a: 1 }, move('/a', '/x/y'), 'path not found');
});

test('move bad index in from', () => {
  expectOpError({ arr: [1] }, move('/arr/01', '/b'), 'bad index');
});

test('move deep value to ancestor replaces it', () => {
  assert.deepStrictEqual(apply({ a: { b: { c: 1 } } }, move('/a/b', '/a')), { a: { c: 1 } });
});

// --- copy ---

test('copy to another member', () => {
  assert.deepStrictEqual(apply({ a: { x: 1 } }, copy('/a', '/b')), { a: { x: 1 }, b: { x: 1 } });
});

test('copy into array', () => {
  assert.deepStrictEqual(apply([1, 2], copy('/0', '/-')), [1, 2, 1]);
  assert.deepStrictEqual(apply([1, 2], copy('/1', '/0')), [2, 1, 2]);
});

test('copy path may lie inside from', () => {
  assert.deepStrictEqual(
    apply({ a: { x: 1 } }, copy('/a', '/a/b')),
    { a: { x: 1, b: { x: 1 } } },
  );
});

test('copy from missing fails', () => {
  expectOpError({}, copy('/a', '/b'), 'from not found');
  expectOpError({ arr: [1] }, copy('/arr/-', '/b'), 'from not found');
  expectOpError({ arr: [1] }, copy('/arr/1', '/b'), 'from not found');
  expectOpError({}, copy('/a', '/x/y'), 'from not found');
});

test('copy and move from a path through "-" fail with from not found', () => {
  const doc = { arr: [1, 2], b: 0 };
  expectOpError(doc, copy('/arr/-/x', '/c'), 'from not found');
  expectOpError(doc, move('/arr/-/x', '/c'), 'from not found');
});

test('remove through "-" fails with path not found', () => {
  expectOpError({ arr: [1, 2], b: 0 }, remove('/arr/-/x'), 'path not found');
});

test('copy from a leading-zero index fails with bad index', () => {
  expectOpError({ arr: [1, 2], b: 0 }, copy('/arr/01', '/c'), 'bad index');
});

test('copy into missing parent fails', () => {
  expectOpError({ a: 1 }, copy('/a', '/x/y'), 'path not found');
});

test('copy from inherited name fails', () => {
  expectOpError({}, copy('/toString', '/b'), 'from not found');
  expectOpError({}, copy('/constructor/name', '/b'), 'from not found');
});

test('copy from "" copies the whole doc', () => {
  assert.deepStrictEqual(apply({ a: 1 }, copy('', '/b')), { a: 1, b: { a: 1 } });
});

// --- test ---

test('test passes on equal values', () => {
  assert.deepStrictEqual(apply({ a: 1 }, testOp('/a', 1)), { a: 1 });
  assert.deepStrictEqual(apply({ a: 1 }, testOp('', { a: 1 })), { a: 1 });
});

test('test numbers: 1, 1.0, 1e0 equal; 0 and -0 equal', () => {
  const doc = JSON.parse('{"a":1,"z":0}');
  assert.deepStrictEqual(applyPatch(doc, [testOp('/a', JSON.parse('1.0'))]), doc);
  assert.deepStrictEqual(applyPatch(doc, [testOp('/a', JSON.parse('1e0'))]), doc);
  assert.deepStrictEqual(applyPatch(doc, [testOp('/z', -0)]), doc);
  assert.deepStrictEqual(applyPatch({ z: -0 }, [testOp('/z', 0)]), { z: -0 });
});

test('test strings exact, no normalization', () => {
  expectOpError({ a: 'é' }, testOp('/a', 'é'), 'test failed');
  assert.deepStrictEqual(apply({ a: 'é' }, testOp('/a', 'é')), { a: 'é' });
  expectOpError({ a: 'A' }, testOp('/a', 'a'), 'test failed');
});

test('test arrays are order sensitive and length sensitive', () => {
  expectOpError([1, 2], testOp('', [2, 1]), 'test failed');
  expectOpError([1, 2], testOp('', [1]), 'test failed');
  expectOpError([1], testOp('', [1, 2]), 'test failed');
  assert.deepStrictEqual(apply([1, [2]], testOp('', [1, [2]])), [1, [2]]);
});

test('test objects ignore member order', () => {
  assert.deepStrictEqual(apply({ a: 1, b: 2 }, testOp('', { b: 2, a: 1 })), { a: 1, b: 2 });
});

test('test objects differing in names fail both ways', () => {
  expectOpError({ a: 1 }, testOp('', { a: 1, b: 2 }), 'test failed');
  expectOpError({ a: 1, b: 2 }, testOp('', { a: 1 }), 'test failed');
  expectOpError({ a: 1 }, testOp('', { b: 1 }), 'test failed');
});

test('test nested inequality fails', () => {
  expectOpError({ a: { b: [1, { c: 1 }] } }, testOp('', { a: { b: [1, { c: 2 }] } }), 'test failed');
});

test('test across types fails', () => {
  expectOpError({ a: null }, testOp('/a', {}), 'test failed');
  expectOpError({ a: 0 }, testOp('/a', false), 'test failed');
  expectOpError({ a: '1' }, testOp('/a', 1), 'test failed');
  expectOpError({ a: [] }, testOp('/a', {}), 'test failed');
  expectOpError({ a: {} }, testOp('/a', []), 'test failed');
  expectOpError({ a: null }, testOp('/a', 0), 'test failed');
  expectOpError({ a: true }, testOp('/a', 1), 'test failed');
});

test('true, false, null equal only themselves', () => {
  assert.deepStrictEqual(apply({ a: true }, testOp('/a', true)), { a: true });
  assert.deepStrictEqual(apply({ a: false }, testOp('/a', false)), { a: false });
  assert.deepStrictEqual(apply({ a: null }, testOp('/a', null)), { a: null });
  expectOpError({ a: true }, testOp('/a', false), 'test failed');
  expectOpError({ a: false }, testOp('/a', null), 'test failed');
});

test('test missing path fails with path not found', () => {
  expectOpError({}, testOp('/a', 1), 'path not found');
  expectOpError({}, testOp('/toString', 1), 'path not found');
  expectOpError({}, testOp('/__proto__', 1), 'path not found');
  expectOpError({}, testOp('/constructor', 1), 'path not found');
  expectOpError({}, testOp('/hasOwnProperty', 1), 'path not found');
  expectOpError({ arr: [1] }, testOp('/arr/-', 1), 'path not found');
  expectOpError({ arr: [1, 2] }, testOp('/arr/2', 1), 'path not found');
});

test('test own "__proto__" member is an ordinary name', () => {
  const doc = JSON.parse('{"__proto__": 1}');
  assert.deepStrictEqual(Object.keys(apply(doc, testOp('/__proto__', 1))), ['__proto__']);
});

// --- following ---

test('array tokens that are bad indexes while following', () => {
  const doc = { arr: [1, 2] };
  for (const tok of ['01', '+1', '1.0', '1e0', ' 1', 'length', '', '-1']) {
    expectOpError(doc, remove(`/arr/${tok}`), 'bad index');
  }
});

test('bad index applies to test, replace, and move/copy from', () => {
  const doc = { arr: [1, 2] };
  expectOpError(doc, testOp('/arr/01', 1), 'bad index');
  expectOpError(doc, replace('/arr/length', 1), 'bad index');
  expectOpError(doc, copy('/arr/01', '/b'), 'bad index');
});

test('index equal to length is path not found', () => {
  expectOpError({ arr: [1, 2] }, remove('/arr/2'), 'path not found');
});

test('following through primitives fails', () => {
  expectOpError({ a: 'str' }, remove('/a/0'), 'path not found');
  expectOpError({ a: 5 }, remove('/a/x'), 'path not found');
  expectOpError({ a: null }, remove('/a/x'), 'path not found');
  expectOpError({ a: true }, remove('/a/x'), 'path not found');
  expectOpError({ a: 'str' }, testOp('/a/0', 's'), 'path not found');
});

test('following through inherited names fails', () => {
  expectOpError({}, testOp('/constructor/name', 'Object'), 'path not found');
  expectOpError({}, replace('/__proto__/x', 1), 'path not found');
});

test('empty-name token', () => {
  assert.deepStrictEqual(apply({ '': 1 }, testOp('/', 1)), { '': 1 });
  assert.deepStrictEqual(apply({ '': { '': 2 } }, remove('//')), { '': {} });
});

test('escaped tokens address members', () => {
  assert.deepStrictEqual(apply({ 'a/b': 1, 'm~n': 2 }, remove('/a~1b')), { 'm~n': 2 });
  assert.deepStrictEqual(apply({ 'a/b': 1, 'm~n': 2 }, remove('/m~0n')), { 'a/b': 1 });
  assert.deepStrictEqual(apply({ '~1': 1 }, testOp('/~01', 1)), { '~1': 1 });
  assert.deepStrictEqual(apply({ '/0': 1 }, testOp('/~10', 1)), { '/0': 1 });
});

// --- multi-op ---

test('ops apply each to the previous result', () => {
  assert.deepStrictEqual(
    applyPatch({}, [add('/a', { b: 1 }), testOp('/a', { b: 1 }), add('/a/c', 2), testOp('/a/c', 2)]),
    { a: { b: 1, c: 2 } },
  );
});

test('empty patch returns equal doc', () => {
  assert.deepStrictEqual(applyPatch({ a: [1, { b: 2 }] }, []), { a: [1, { b: 2 }] });
  assert.strictEqual(applyPatch(5, []), 5);
  assert.strictEqual(applyPatch(null, []), null);
});

test('later op sees earlier removal', () => {
  expectPatchError({ a: 1 }, [remove('/a'), testOp('/a', 1)], 'operation 1: path not found', 1);
});
