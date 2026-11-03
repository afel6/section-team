import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePointer } from '../jsonpatch.mjs';

function expectThrows(input, ErrorType, message) {
  let thrown;
  try {
    parsePointer(input);
  } catch (err) {
    thrown = err;
  }
  assert.notStrictEqual(thrown, undefined, 'expected parsePointer to throw');
  assert.ok(thrown instanceof ErrorType);
  assert.strictEqual(thrown.message, message);
}

test('empty pointer has no tokens', () => {
  assert.deepStrictEqual(parsePointer(''), []);
});

test('"/" has one empty token', () => {
  assert.deepStrictEqual(parsePointer('/'), ['']);
});

test('"/a//b/" has four tokens', () => {
  assert.deepStrictEqual(parsePointer('/a//b/'), ['a', '', 'b', '']);
});

test('simple multi-token pointer', () => {
  assert.deepStrictEqual(parsePointer('/foo/0/bar'), ['foo', '0', 'bar']);
});

test('~1 decodes to slash', () => {
  assert.deepStrictEqual(parsePointer('/a~1b'), ['a/b']);
});

test('~0 decodes to tilde', () => {
  assert.deepStrictEqual(parsePointer('/m~0n'), ['m~n']);
});

test('"/~01" has token "~1"', () => {
  assert.deepStrictEqual(parsePointer('/~01'), ['~1']);
});

test('"/~10" has token "/0"', () => {
  assert.deepStrictEqual(parsePointer('/~10'), ['/0']);
});

test('multiple escapes in one token', () => {
  assert.deepStrictEqual(parsePointer('/~0~1~0~1'), ['~/~/']);
});

test('returns a new array each call', () => {
  const a = parsePointer('');
  const b = parsePointer('');
  assert.notStrictEqual(a, b);
  const c = parsePointer('/x');
  c.push('y');
  assert.deepStrictEqual(parsePointer('/x'), ['x']);
});

test('non-string input throws TypeError', () => {
  const inputs = [new String('/a'), 1, 0, null, undefined, ['/a'], {}, true];
  for (const input of inputs) {
    expectThrows(input, TypeError, 'pointer must be a string');
  }
});

test('invalid pointers throw SyntaxError', () => {
  const inputs = ['a', '~', '/~', '/~2', '/a~', '/~a', 'a/b', ' /a', '~0', '/a/~x', '/~ '];
  for (const input of inputs) {
    expectThrows(input, SyntaxError, 'invalid pointer');
  }
});
